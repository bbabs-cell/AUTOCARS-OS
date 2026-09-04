<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Les statistiques
 * ==================================================================
 * CE DÉPÔT NE FAIT QUE LIRE.
 * ==================================================================
 *
 * Le lot 16 n'ajoute AUCUNE table, AUCUNE colonne, AUCUNE migration.
 * C'est son intérêt : quinze lots ont accumulé des données en
 * enregistrant honnêtement ce qui se passait, et il se trouve qu'on
 * peut maintenant leur poser des questions auxquelles personne
 * n'avait pensé en les écrivant.
 *
 * C'est aussi la meilleure preuve que le modèle tient. Un schéma qui
 * aurait pris des raccourcis — un compteur ici, un statut stocké là —
 * obligerait à ajouter des tables pour analyser ce qu'il a lui-même
 * rendu incalculable.
 *
 * ------------------------------------------------------------------
 * DEUX PÉRIMÈTRES QU'IL NE FAUT JAMAIS CONFONDRE
 *
 *   L'ENCAISSÉ    l'argent reçu pendant la période. Il comprend les
 *                 forfaits vendus, dont les lavages seront livrés
 *                 plus tard.
 *   LE LIVRÉ      la valeur des prestations rendues pendant la
 *                 période. Elle comprend des lavages payés il y a six
 *                 mois, et des lavages offerts.
 *
 * Les deux sont vrais, ils ne sont pas égaux, et un écran d'analyse
 * qui les mélangerait produirait des chiffres que personne ne pourrait
 * expliquer. Ils sont donc calculés séparément, et l'écran montre
 * comment on passe de l'un à l'autre.
 */
final class AnalyticsRepository extends TenantRepository
{
    /**
     * Ce dépôt lit plusieurs tables ; `table()` désigne celle qui
     * porte l'essentiel des questions.
     */
    protected function table(): string
    {
        return 'operations';
    }

    /**
     * L'activité jour par jour : combien de véhicules, combien
     * d'argent encaissé.
     *
     * LES DEUX SÉRIES SONT RENVOYÉES ENSEMBLE MAIS S'AFFICHENT
     * SÉPARÉMENT. Un graphique à deux axes verticaux — véhicules à
     * gauche, francs à droite — invente une corrélation que la donnée
     * ne contient pas : l'alignement des deux échelles est arbitraire,
     * et le lecteur y voit un rapport qui n'existe pas. Deux
     * graphiques côte à côte disent la même chose sans mentir.
     *
     * @return list<array{day:string, vehicles:int, revenue:int}>
     */
    public function daily(string $from, string $to, ?int $stationId = null): array
    {
        [$filterOps, $paramsOps] = $this->stationFilter($stationId, 'o');
        [$filterPay, $paramsPay] = $this->stationFilter($stationId, 'p');

        // Les véhicules se comptent à leur ARRIVÉE, l'argent à son
        // ENCAISSEMENT. Ce ne sont pas les mêmes dates, et les
        // rapprocher de force n'apporterait rien.
        $vehicles = $this->db->prepare(
            "SELECT DATE(o.created_at) AS jour, COUNT(*) AS n
               FROM operations o
              WHERE o.organization_id = :organization_id
                AND o.created_at >= :from AND o.created_at <= :to
                AND o.status <> 'CANCELLED'
                    {$filterOps}
           GROUP BY DATE(o.created_at)"
        );

        $vehicles->execute($paramsOps + [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ]);

        $revenue = $this->db->prepare(
            "SELECT DATE(p.paid_at) AS jour, COALESCE(SUM(p.amount), 0) AS total
               FROM payments p
              WHERE p.organization_id = :organization_id
                AND p.status = 'PAID'
                AND p.paid_at >= :from AND p.paid_at <= :to
                    {$filterPay}
           GROUP BY DATE(p.paid_at)"
        );

        $revenue->execute($paramsPay + [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ]);

        $byDay = [];

        foreach ($vehicles->fetchAll() as $row) {
            $byDay[(string) $row['jour']]['vehicles'] = (int) $row['n'];
        }

        foreach ($revenue->fetchAll() as $row) {
            $byDay[(string) $row['jour']]['revenue'] = (int) $row['total'];
        }

        // ON REMPLIT LES JOURS VIDES. Un graphique qui saute les
        // dimanches fermés écrase l'axe du temps : deux colonnes
        // voisines paraissent consécutives alors qu'une semaine les
        // sépare. Un zéro affiché est une information ; un jour absent
        // est un mensonge de forme.
        $days = [];
        $cursor = strtotime($from);
        $end = strtotime($to);

        while ($cursor <= $end) {
            $key = date('Y-m-d', $cursor);

            $days[] = [
                'day' => $key,
                'vehicles' => (int) ($byDay[$key]['vehicles'] ?? 0),
                'revenue' => (int) ($byDay[$key]['revenue'] ?? 0),
            ];

            $cursor = strtotime('+1 day', $cursor);
        }

        return $days;
    }

    /**
     * ==================================================================
     * LA VALEUR DE CE QUI A ÉTÉ LIVRÉ, ET COMMENT ELLE A ÉTÉ COUVERTE
     * ==================================================================
     * Le panneau qui vérifie que le produit ne se contredit pas.
     *
     * Pour les dossiers RESTITUÉS pendant la période :
     *
     *   valeur livrée = encaissé + offert + prépayé + impayé
     *
     * Les quatre termes viennent de quatre endroits différents du
     * produit — les paiements (lot 9), la fidélité (lot 14), les
     * abonnements (lot 15) et le prix figé de l'opération (lot 7). Si
     * l'identité ne tombe pas juste, c'est qu'un de ces modules ment,
     * et l'écran le dit au lieu de le cacher.
     *
     * `unpaid` est un RESTE, pas une mesure : il se déduit des trois
     * autres. C'est volontaire — une cinquième requête qui compterait
     * les impayés séparément pourrait diverger, et on aurait deux
     * chiffres sans savoir lequel croire.
     *
     * @return array{delivered:int, paid:int, gifted:int, prepaid:int, unpaid:int, operations:int}
     */
    public function deliveredBreakdown(string $from, string $to, ?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $statement = $this->db->prepare(
            "SELECT COUNT(*) AS dossiers,
                    COALESCE(SUM(o.price), 0) AS valeur,
                    COALESCE(SUM(CASE WHEN o.discount_source = 'LOYALTY'
                                      THEN o.discount_amount ELSE 0 END), 0) AS offert,
                    COALESCE(SUM(CASE WHEN o.discount_source = 'SUBSCRIPTION'
                                      THEN o.discount_amount ELSE 0 END), 0) AS prepaye,
                    COALESCE(SUM(
                        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                          WHERE p.operation_id = o.id AND p.status = 'PAID')
                    ), 0) AS encaisse
               FROM operations o
              WHERE o.organization_id = :organization_id
                AND o.status = 'COMPLETED'
                AND o.released_at >= :from AND o.released_at <= :to
                    {$filter}"
        );

        $statement->execute($parameters + [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ]);

        $row = $statement->fetch() ?: [];

        $delivered = (int) ($row['valeur'] ?? 0);
        $paid      = (int) ($row['encaisse'] ?? 0);
        $gifted    = (int) ($row['offert'] ?? 0);
        $prepaid   = (int) ($row['prepaye'] ?? 0);

        return [
            'operations' => (int) ($row['dossiers'] ?? 0),
            'delivered' => $delivered,
            'paid' => $paid,
            'gifted' => $gifted,
            'prepaid' => $prepaid,
            // Peut être NÉGATIF si un dossier a été trop encaissé —
            // ce que l'API refuse, mais qu'un remboursement mal saisi
            // pourrait produire. On ne le masque pas : un reste
            // négatif est précisément ce qu'il faut voir.
            'unpaid' => $delivered - $paid - $gifted - $prepaid,
        ];
    }

    /**
     * L'argent RÉELLEMENT ENCAISSÉ sur la période, tous motifs
     * confondus — y compris les forfaits vendus, dont les lavages
     * seront livrés plus tard.
     *
     * C'est le chiffre de la caisse. Il ne se compare pas ligne à
     * ligne avec la valeur livrée, et l'écran explique pourquoi.
     *
     * @return array{total:int, on_operations:int, on_subscriptions:int}
     */
    public function collected(string $from, string $to, ?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'p');

        $statement = $this->db->prepare(
            "SELECT COALESCE(SUM(p.amount), 0) AS total,
                    COALESCE(SUM(CASE WHEN p.operation_id IS NOT NULL
                                      THEN p.amount ELSE 0 END), 0) AS sur_dossiers,
                    COALESCE(SUM(CASE WHEN p.subscription_id IS NOT NULL
                                      THEN p.amount ELSE 0 END), 0) AS sur_forfaits
               FROM payments p
              WHERE p.organization_id = :organization_id
                AND p.status = 'PAID'
                AND p.paid_at >= :from AND p.paid_at <= :to
                    {$filter}"
        );

        $statement->execute($parameters + [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ]);

        $row = $statement->fetch() ?: [];

        return [
            'total' => (int) ($row['total'] ?? 0),
            'on_operations' => (int) ($row['sur_dossiers'] ?? 0),
            'on_subscriptions' => (int) ($row['sur_forfaits'] ?? 0),
        ];
    }

    /**
     * Ce qui se vend : volume et valeur par prestation.
     *
     * LES DEUX ENSEMBLE, PARCE QUE SÉPARÉS ILS MENTENT. Soixante
     * lavages à 5 000 F et deux detailings à 35 000 F, ce n'est pas la
     * même conversation : le premier remplit la station, le second
     * remplit la caisse.
     *
     * @return list<array{service:string, operations:int, value:int, average:int}>
     */
    public function byService(string $from, string $to, ?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $statement = $this->db->prepare(
            "SELECT s.name AS prestation,
                    COUNT(*) AS n,
                    COALESCE(SUM(o.price), 0) AS valeur
               FROM operations o
               JOIN services s ON s.id = o.service_id
              WHERE o.organization_id = :organization_id
                AND o.status <> 'CANCELLED'
                AND o.created_at >= :from AND o.created_at <= :to
                    {$filter}
           GROUP BY o.service_id, s.name
           ORDER BY valeur DESC"
        );

        $statement->execute($parameters + [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ]);

        return array_map(
            static function (array $row): array {
                $count = (int) $row['n'];
                $value = (int) $row['valeur'];

                return [
                    'service' => (string) $row['prestation'],
                    'operations' => $count,
                    'value' => $value,
                    'average' => $count > 0 ? intdiv($value, $count) : 0,
                ];
            },
            $statement->fetchAll(),
        );
    }

    /**
     * À quelle heure les véhicules arrivent.
     *
     * LE CHIFFRE QUI SERT À DÉCIDER DES HORAIRES D'ÉQUIPE. Un gérant
     * qui voit que la moitié de sa journée se joue entre 8 h et 11 h
     * n'organise pas ses relèves comme celui dont l'activité est
     * plate.
     *
     * Les 24 heures sont toujours renvoyées, y compris à zéro : un axe
     * du temps troué se lit de travers.
     *
     * @return list<array{hour:int, operations:int}>
     */
    public function byHour(string $from, string $to, ?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $statement = $this->db->prepare(
            "SELECT HOUR(o.created_at) AS h, COUNT(*) AS n
               FROM operations o
              WHERE o.organization_id = :organization_id
                AND o.status <> 'CANCELLED'
                AND o.created_at >= :from AND o.created_at <= :to
                    {$filter}
           GROUP BY HOUR(o.created_at)"
        );

        $statement->execute($parameters + [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ]);

        $counts = [];

        foreach ($statement->fetchAll() as $row) {
            $counts[(int) $row['h']] = (int) $row['n'];
        }

        $hours = [];

        for ($hour = 0; $hour < 24; $hour++) {
            $hours[] = ['hour' => $hour, 'operations' => $counts[$hour] ?? 0];
        }

        return $hours;
    }

    /**
     * Quels jours de la semaine.
     *
     * ⚠️ `DAYOFWEEK()` de MySQL renvoie 1 pour DIMANCHE et 7 pour
     * samedi. Une semaine française commence le lundi. On convertit
     * ici, une fois, plutôt que de laisser chaque écran s'en
     * débrouiller — c'est exactement le genre de décalage qu'on ne
     * remarque qu'en production, quand le gérant dit « mais le samedi
     * n'est pas mon plus gros jour ».
     *
     * @return list<array{weekday:int, label:string, operations:int}>
     */
    public function byWeekday(string $from, string $to, ?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $statement = $this->db->prepare(
            "SELECT DAYOFWEEK(o.created_at) AS d, COUNT(*) AS n
               FROM operations o
              WHERE o.organization_id = :organization_id
                AND o.status <> 'CANCELLED'
                AND o.created_at >= :from AND o.created_at <= :to
                    {$filter}
           GROUP BY DAYOFWEEK(o.created_at)"
        );

        $statement->execute($parameters + [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ]);

        $counts = [];

        foreach ($statement->fetchAll() as $row) {
            $counts[(int) $row['d']] = (int) $row['n'];
        }

        // Lundi (DAYOFWEEK = 2) à dimanche (DAYOFWEEK = 1).
        $order = [
            2 => 'Lundi', 3 => 'Mardi', 4 => 'Mercredi', 5 => 'Jeudi',
            6 => 'Vendredi', 7 => 'Samedi', 1 => 'Dimanche',
        ];

        $days = [];
        $position = 1;

        foreach ($order as $mysqlDay => $label) {
            $days[] = [
                'weekday' => $position++,
                'label' => $label,
                'operations' => $counts[$mysqlDay] ?? 0,
            ];
        }

        return $days;
    }

    /**
     * ==================================================================
     * LE TEMPS ANNONCÉ CONTRE LE TEMPS RÉEL
     * ==================================================================
     * La question que le lot 8 avait laissée ouverte.
     *
     * Les seuils d'alerte de la file d'attente étaient explicitement
     * « des points de départ, pas des vérités : elles viennent du bon
     * sens, pas de mesures, aucune station ne tourne encore avec le
     * produit ». Cet écran est l'endroit où les mesures arrivent.
     *
     * Si toutes les prestations dépassent systématiquement leur durée
     * annoncée, ce n'est pas l'équipe qui est lente : c'est le
     * catalogue qui ment aux clients — et c'est là qu'on s'en aperçoit.
     *
     * ON EXCLUT LES DOSSIERS DE PLUS DE HUIT HEURES. Un véhicule laissé
     * pour la nuit n'est pas un lavage long ; le compter tirerait la
     * moyenne au point de la rendre inutile. On dit combien ont été
     * écartés plutôt que de le taire.
     *
     * @return list<array{service:string, announced:int, actual:int, samples:int, excluded:int}>
     */
    public function durations(string $from, string $to, ?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $statement = $this->db->prepare(
            "SELECT s.name AS prestation,
                    s.duration_minutes AS annonce,
                    COUNT(*) AS total,
                    SUM(CASE WHEN TIMESTAMPDIFF(MINUTE, o.started_at, o.completed_at) <= 480
                             THEN 1 ELSE 0 END) AS retenus,
                    COALESCE(AVG(CASE WHEN TIMESTAMPDIFF(MINUTE, o.started_at, o.completed_at) <= 480
                                      THEN TIMESTAMPDIFF(MINUTE, o.started_at, o.completed_at)
                                      END), 0) AS reel
               FROM operations o
               JOIN services s ON s.id = o.service_id
              WHERE o.organization_id = :organization_id
                AND o.started_at IS NOT NULL
                AND o.completed_at IS NOT NULL
                AND o.completed_at > o.started_at
                AND o.created_at >= :from AND o.created_at <= :to
                    {$filter}
           GROUP BY o.service_id, s.name, s.duration_minutes
           ORDER BY s.name ASC"
        );

        $statement->execute($parameters + [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ]);

        $rows = [];

        foreach ($statement->fetchAll() as $row) {
            $kept = (int) $row['retenus'];

            // Une moyenne sur un seul passage est une anecdote, pas une
            // mesure. Même règle qu'au tableau de bord (lot 10), où le
            // délai moyen n'apparaît qu'au-delà de trois dossiers.
            if ($kept < 3) {
                continue;
            }

            $rows[] = [
                'service' => (string) $row['prestation'],
                'announced' => (int) $row['annonce'],
                'actual' => (int) round((float) $row['reel']),
                'samples' => $kept,
                'excluded' => (int) $row['total'] - $kept,
            ];
        }

        return $rows;
    }

    /**
     * Les clients qui reviennent.
     *
     * UN CLIENT « QUI REVIENT » EST UN CLIENT DÉJÀ VENU AVANT LE DÉBUT
     * DE LA PÉRIODE — pas quelqu'un venu deux fois cette semaine. La
     * nuance décide du sens du chiffre : la première mesure la
     * fidélité, la seconde mesure surtout la longueur de la période
     * qu'on regarde.
     *
     * @return array{total:int, returning:int, new:int}
     */
    public function customerReturn(string $from, string $to, ?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $statement = $this->db->prepare(
            "SELECT COUNT(DISTINCT o.customer_id) AS total,
                    COUNT(DISTINCT CASE WHEN EXISTS (
                        SELECT 1 FROM operations avant
                         WHERE avant.customer_id = o.customer_id
                           AND avant.organization_id = o.organization_id
                           AND avant.status <> 'CANCELLED'
                           AND avant.created_at < :from_inner
                    ) THEN o.customer_id END) AS revenus
               FROM operations o
              WHERE o.organization_id = :organization_id
                AND o.status <> 'CANCELLED'
                AND o.created_at >= :from AND o.created_at <= :to
                    {$filter}"
        );

        $statement->execute($parameters + [
            'organization_id' => $this->organizationId(),
            // PDO sans émulation : un nom de paramètre ne sert qu'une
            // fois. La borne basse apparaît deux fois, d'où le second
            // nom (le piège s'est déjà payé aux lots 13 et 15).
            'from' => $from . ' 00:00:00',
            'from_inner' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ]);

        $row = $statement->fetch() ?: [];

        $total = (int) ($row['total'] ?? 0);
        $returning = (int) ($row['revenus'] ?? 0);

        return [
            'total' => $total,
            'returning' => $returning,
            'new' => max(0, $total - $returning),
        ];
    }

    /**
     * Le filtre de station, préfixé par l'alias de la requête.
     *
     * @return array{0:string, 1:array<string,mixed>}
     */
    private function stationFilter(?int $stationId, string $alias): array
    {
        if ($stationId === null) {
            return ['', []];
        }

        return [" AND {$alias}.station_id = :station_id", ['station_id' => $stationId]];
    }
}
