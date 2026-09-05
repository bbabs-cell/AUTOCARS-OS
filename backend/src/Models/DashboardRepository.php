<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\Database;
use Autocare\Core\OperationStatus;
use Autocare\Core\Security\AuthContext;
use PDO;

/**
 * Les chiffres du tableau de bord
 * ------------------------------------------------------------------
 * Ce dépôt n'écrit rien : il ne fait que compter et additionner.
 *
 * IL N'HÉRITE PAS DE TenantRepository parce qu'il ne travaille pas
 * sur une table mais sur cinq, jointes de plusieurs façons. Le filtre
 * d'organisation est donc écrit EXPLICITEMENT dans chaque requête —
 * et les tests de sécurité vérifient qu'aucune n'est oubliée.
 *
 * ------------------------------------------------------------------
 * « AUJOURD'HUI » : UNE SIMPLIFICATION ASSUMÉE
 *
 * Le serveur stocke tout en UTC. `CURDATE()` désigne donc le jour
 * UTC, pas le jour local de la station.
 *
 * Pour le Sénégal, la Gambie, la Guinée ou le Mali, c'est exact :
 * ces pays sont à UTC+0 toute l'année. Le produit vise cette zone,
 * la simplification est donc juste là où il sera utilisé.
 *
 * Elle deviendra fausse le jour d'une station au Cameroun (UTC+1) :
 * entre 23 h et minuit, la recette basculerait au lendemain.
 * La colonne `organizations.timezone` existe déjà pour ce jour-là ;
 * on ne s'en sert pas encore parce qu'aucun utilisateur n'en a
 * besoin, et qu'un fuseau mal géré est plus difficile à déboguer
 * qu'un fuseau absent.
 */
final class DashboardRepository
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::connection();
    }

    private function organizationId(): int
    {
        return AuthContext::current()->organizationId;
    }

    /**
     * Fragment SQL de filtrage par station, si demandé.
     * @return array{0:string, 1:array<string,mixed>}
     */
    private function stationFilter(?int $stationId, string $alias): array
    {
        if ($stationId === null) {
            return ['', []];
        }

        return [" AND {$alias}.station_id = :station_id", ['station_id' => $stationId]];
    }

    /**
     * L'activité du jour : combien de véhicules, à quel stade.
     *
     * @return array{vehicles_in:int, in_progress:int, released:int, cancelled:int}
     */
    public function todayActivity(?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $active = implode(', ', array_map(
            fn (string $s): string => $this->db->quote($s),
            OperationStatus::active()
        ));

        // ==============================================================
        // DEUX REQUÊTES DEPUIS LE LOT 20, ET LA RAISON EN VAUT LA PEINE.
        // ==============================================================
        // La version d'origine posait les quatre questions en une
        // seule requête — plus élégant à lire, et SANS AUCUN FILTRE DE
        // DATE. Elle parcourait donc l'historique ENTIER de
        // l'entreprise à chaque ouverture du tableau de bord, pour
        // compter ce qui s'est passé aujourd'hui.
        //
        // Le défaut ne se voyait pas : sur le jeu de démonstration, il
        // y a quinze opérations. Sur trois ans de trois stations, il y
        // en a 76 000 — et le coût de l'écran du matin grandit avec
        // l'âge de l'entreprise, pour toujours. C'est exactement ce
        // qu'un lot de performance existe pour trouver.
        //
        // Les quatre compteurs répondent en fait à DEUX questions :
        //
        //   « qu'est-ce qui a bougé aujourd'hui ? » — accueillis,
        //     restitués, annulés. Toute ligne concernée porte
        //     forcément un `updated_at` d'aujourd'hui, puisque cette
        //     colonne se met à jour à chaque écriture. Le filtre
        //     est donc exact, et il tient dans un index.
        //
        //   « qu'est-ce qui occupe la station MAINTENANT ? » — sans
        //     rapport avec une date : un véhicule laissé la veille
        //     compte toujours.
        $today = $this->db->prepare(
            "SELECT
                COALESCE(SUM(CASE WHEN DATE(o.created_at) = CURDATE() THEN 1 ELSE 0 END), 0) AS vehicles_in,
                COALESCE(SUM(CASE WHEN DATE(o.released_at) = CURDATE() THEN 1 ELSE 0 END), 0) AS released,
                COALESCE(SUM(CASE WHEN o.status = 'CANCELLED'
                                   AND DATE(o.updated_at) = CURDATE() THEN 1 ELSE 0 END), 0) AS cancelled
               FROM operations o
              WHERE o.organization_id = :organization_id
                AND o.updated_at >= CURDATE()
                    {$filter}"
        );

        $today->execute($parameters + ['organization_id' => $this->organizationId()]);
        $row = $today->fetch() ?: [];

        $inProgress = $this->db->prepare(
            "SELECT COUNT(*) FROM operations o
              WHERE o.organization_id = :organization_id
                AND o.status IN ({$active})
                    {$filter}"
        );

        $inProgress->execute($parameters + ['organization_id' => $this->organizationId()]);

        return [
            'vehicles_in' => (int) ($row['vehicles_in'] ?? 0),
            'in_progress' => (int) $inProgress->fetchColumn(),
            'released'    => (int) ($row['released'] ?? 0),
            'cancelled'   => (int) ($row['cancelled'] ?? 0),
        ];
    }

    /** Le nombre de véhicules accueillis un jour donné, en arrière. */
    public function vehiclesInOnDay(int $daysAgo, ?int $stationId = null): int
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $statement = $this->db->prepare(
            "SELECT COUNT(*) FROM operations o
              WHERE o.organization_id = :organization_id
                -- UNE BORNE, PAS UNE FONCTION (lot 20).
                --
                -- `DATE(o.created_at) = …` oblige MySQL à calculer la
                -- fonction sur CHAQUE ligne pour savoir si elle
                -- correspond : aucun index sur `created_at` ne peut
                -- alors servir, et la table entière y passe.
                --
                -- La même question posée en intervalle se lit
                -- directement dans l'index. C'est le défaut le plus
                -- répandu de tout le produit : il était présent dans
                -- cinq requêtes, toutes écrites de bonne foi.
                AND o.created_at >= (CURDATE() - INTERVAL :days DAY)
                AND o.created_at <  (CURDATE() - INTERVAL :days_end DAY) + INTERVAL 1 DAY
                    {$filter}"
        );

        $statement->bindValue('organization_id', $this->organizationId(), PDO::PARAM_INT);
        $statement->bindValue('days', $daysAgo, PDO::PARAM_INT);
        // PDO sans émulation refuse qu'un nom serve deux fois.
        $statement->bindValue('days_end', $daysAgo, PDO::PARAM_INT);

        foreach ($parameters as $name => $value) {
            $statement->bindValue($name, $value);
        }

        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    /**
     * La recette encaissée sur une journée.
     *
     * SEULS LES PAIEMENTS « PAID ». Un remboursement reste en base —
     * il fait partie de l'histoire — mais ce n'est plus de l'argent
     * reçu, et l'additionner gonflerait la recette d'un montant qui
     * est ressorti du tiroir.
     */
    public function revenueOnDay(int $daysAgo, ?int $stationId = null): int
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'p');

        $statement = $this->db->prepare(
            "SELECT COALESCE(SUM(p.amount), 0) FROM payments p
              WHERE p.organization_id = :organization_id
                AND p.status = 'PAID'
                -- Une borne, pas une fonction — voir vehiclesInOnDay().
                AND p.paid_at >= (CURDATE() - INTERVAL :days DAY)
                AND p.paid_at <  (CURDATE() - INTERVAL :days_end DAY) + INTERVAL 1 DAY
                    {$filter}"
        );

        $statement->bindValue('organization_id', $this->organizationId(), PDO::PARAM_INT);
        $statement->bindValue('days', $daysAgo, PDO::PARAM_INT);
        $statement->bindValue('days_end', $daysAgo, PDO::PARAM_INT);

        foreach ($parameters as $name => $value) {
            $statement->bindValue($name, $value);
        }

        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    /**
     * La recette des N derniers jours, aujourd'hui compris.
     *
     * UNE LIGNE PAR JOUR, MÊME LES JOURS SANS RECETTE. Sans cela, un
     * dimanche fermé disparaîtrait du graphique et le lundi
     * apparaîtrait collé au samedi : la courbe mentirait sur le
     * rythme réel de la station.
     *
     * @return list<array{date:string, total:int}>
     */
    public function revenueOverDays(int $days = 7, ?int $stationId = null): array
    {
        $days = max(2, min($days, 90));

        [$filter, $parameters] = $this->stationFilter($stationId, 'p');

        $statement = $this->db->prepare(
            "SELECT DATE(p.paid_at) AS jour, COALESCE(SUM(p.amount), 0) AS total
               FROM payments p
              WHERE p.organization_id = :organization_id
                AND p.status = 'PAID'
                AND p.paid_at >= (CURDATE() - INTERVAL :days DAY)
                    {$filter}
           GROUP BY DATE(p.paid_at)"
        );

        $statement->bindValue('organization_id', $this->organizationId(), PDO::PARAM_INT);
        $statement->bindValue('days', $days - 1, PDO::PARAM_INT);

        foreach ($parameters as $name => $value) {
            $statement->bindValue($name, $value);
        }

        $statement->execute();

        $byDay = [];

        foreach ($statement->fetchAll() as $row) {
            $byDay[(string) $row['jour']] = (int) $row['total'];
        }

        // On construit la série complète en PHP plutôt qu'avec une
        // table de calendrier en SQL : sept lignes ne justifient pas
        // une table de plus dans le schéma.
        $series = [];

        for ($offset = $days - 1; $offset >= 0; $offset--) {
            $date = date('Y-m-d', strtotime("-{$offset} day"));

            $series[] = ['date' => $date, 'total' => $byDay[$date] ?? 0];
        }

        return $series;
    }

    /**
     * La recette du jour ventilée par moyen de paiement.
     *
     * @return list<array{method:string, total:int, count:int}>
     */
    public function paymentSplitToday(?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'p');

        $statement = $this->db->prepare(
            "SELECT p.method, COALESCE(SUM(p.amount), 0) AS total, COUNT(*) AS operations
               FROM payments p
              WHERE p.organization_id = :organization_id
                AND p.status = 'PAID'
                -- Une borne, pas une fonction — voir vehiclesInOnDay().
                AND p.paid_at >= CURDATE()
                AND p.paid_at <  CURDATE() + INTERVAL 1 DAY
                    {$filter}
           GROUP BY p.method
           ORDER BY total DESC"
        );

        $statement->execute($parameters + ['organization_id' => $this->organizationId()]);

        return array_map(
            static fn (array $row): array => [
                'method' => (string) $row['method'],
                'total'  => (int) $row['total'],
                'count'  => (int) $row['operations'],
            ],
            $statement->fetchAll()
        );
    }

    /**
     * Les prestations les plus vendues sur les N derniers jours.
     *
     * SUR PLUSIEURS JOURS, PAS SUR AUJOURD'HUI. Un classement calculé
     * sur trois véhicules ne dit rien : il change à chaque nouvelle
     * arrivée et fait croire à une tendance là où il n'y a que du
     * hasard.
     *
     * @return list<array{name:string, count:int, total:int}>
     */
    public function topServices(int $days = 30, int $limit = 5, ?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $limit = max(1, min($limit, 20));
        $days  = max(1, min($days, 365));

        $statement = $this->db->prepare(
            "SELECT s.name, COUNT(*) AS operations, COALESCE(SUM(o.price), 0) AS total
               FROM operations o
               JOIN services s ON s.id = o.service_id
              WHERE o.organization_id = :organization_id
                AND o.status != 'CANCELLED'
                AND o.created_at >= (NOW() - INTERVAL :days DAY)
                    {$filter}
           GROUP BY s.id, s.name
           ORDER BY operations DESC, total DESC
              LIMIT {$limit}"
        );

        $statement->bindValue('organization_id', $this->organizationId(), PDO::PARAM_INT);
        $statement->bindValue('days', $days, PDO::PARAM_INT);

        foreach ($parameters as $name => $value) {
            $statement->bindValue($name, $value);
        }

        $statement->execute();

        return array_map(
            static fn (array $row): array => [
                'name'  => (string) $row['name'],
                'count' => (int) $row['operations'],
                'total' => (int) $row['total'],
            ],
            $statement->fetchAll()
        );
    }

    /**
     * Le temps moyen entre l'arrivée d'un véhicule et le moment où il
     * est prêt, sur les N derniers jours.
     *
     * ON MESURE JUSQU'À « PRÊT », PAS JUSQU'À LA RESTITUTION. Le
     * temps que met un client à venir rechercher sa voiture ne
     * dépend pas de la station ; l'y inclure noierait la performance
     * réelle dans l'attente d'un client parti déjeuner.
     *
     * Retourne null s'il n'y a pas assez de dossiers pour que la
     * moyenne veuille dire quelque chose.
     */
    public function averageTurnaroundMinutes(int $days = 7, ?int $stationId = null): ?int
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $statement = $this->db->prepare(
            "SELECT COUNT(*) AS dossiers,
                    AVG(TIMESTAMPDIFF(MINUTE, o.created_at, o.completed_at)) AS moyenne
               FROM operations o
              WHERE o.organization_id = :organization_id
                AND o.completed_at IS NOT NULL
                AND o.completed_at >= (NOW() - INTERVAL :days DAY)
                    {$filter}"
        );

        $statement->bindValue('organization_id', $this->organizationId(), PDO::PARAM_INT);
        $statement->bindValue('days', $days, PDO::PARAM_INT);

        foreach ($parameters as $name => $value) {
            $statement->bindValue($name, $value);
        }

        $statement->execute();
        $row = $statement->fetch() ?: [];

        // Sous trois dossiers, une « moyenne » est une anecdote. Mieux
        // vaut ne rien afficher qu'un chiffre qu'on croira.
        if ((int) ($row['dossiers'] ?? 0) < 3 || $row['moyenne'] === null) {
            return null;
        }

        return (int) round((float) $row['moyenne']);
    }

    /**
     * Les dossiers PRÊTS mais non réglés.
     *
     * C'est de l'argent qui dort dans la station : la voiture est
     * lavée, le client n'a pas payé. Chaque ligne est un appel
     * téléphonique à passer.
     *
     * @return array{count:int, amount:int}
     */
    public function readyButUnpaid(?int $stationId = null): array
    {
        [$filter, $parameters] = $this->stationFilter($stationId, 'o');

        $statement = $this->db->prepare(
            // `price - discount_amount` et non `price` : la remise de
            // fidélité (lot 14) n'est pas un impayé. Sans cette
            // soustraction, le tableau de bord réclamerait tous les
            // matins l'argent d'un lavage qu'on a décidé d'offrir.
            //
            // C'est la même formule que `OperationRepository::amountDue()`,
            // écrite ici en SQL parce qu'elle porte sur un ensemble de
            // lignes. Les deux doivent être modifiées ensemble — un
            // test le vérifie.
            "SELECT COUNT(*) AS dossiers,
                    COALESCE(SUM(GREATEST(o.price - o.discount_amount, 0) - regle.paye), 0) AS reste
               FROM operations o
               JOIN (SELECT o2.id,
                            COALESCE((SELECT SUM(p.amount) FROM payments p
                                       WHERE p.operation_id = o2.id AND p.status = 'PAID'), 0) AS paye
                       FROM operations o2
                      WHERE o2.organization_id = :organization_id_inner) AS regle ON regle.id = o.id
              WHERE o.organization_id = :organization_id
                AND o.status = 'READY'
                AND regle.paye < GREATEST(o.price - o.discount_amount, 0)
                    {$filter}"
        );

        $statement->execute($parameters + [
            'organization_id'       => $this->organizationId(),
            'organization_id_inner' => $this->organizationId(),
        ]);

        $row = $statement->fetch() ?: [];

        return [
            'count'  => (int) ($row['dossiers'] ?? 0),
            'amount' => (int) ($row['reste'] ?? 0),
        ];
    }
}
