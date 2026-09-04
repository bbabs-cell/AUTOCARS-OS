<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Le pointage
 * ------------------------------------------------------------------
 * Une ligne par présence, d'une arrivée à un départ.
 *
 * CE DÉPÔT NE SUPPRIME RIEN. Un pointage effacé, c'est une journée
 * de travail qui disparaît de la paie sans que personne ne puisse le
 * démontrer. Une erreur se corrige — et la correction se voit.
 */
final class TimeEntryRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'time_entries';
    }

    /**
     * Le pointage en cours de cette personne, s'il y en a un.
     *
     * @return array<string,mixed>|null
     */
    public function openFor(int $userId): ?array
    {
        $rows = $this->select(
            '*',
            'AND user_id = :user_id AND clock_out_at IS NULL LIMIT 1',
            ['user_id' => $userId],
        );

        return $rows[0] ?? null;
    }

    /**
     * Une ligne de pointage AVEC les noms lisibles.
     *
     * POURQUOI PAS `find()` ?
     * `find()` fait un `SELECT *` sur la seule table `time_entries` :
     * il en revient des identifiants, pas des noms. La ligne renvoyée
     * après une correction affichait donc « corrigé par — », alors que
     * le registre, lui, affichait bien le nom : deux écrans, deux
     * vérités, pour la même donnée.
     *
     * Cette méthode utilise exactement les mêmes jointures que
     * `listDetailed()`, pour que la ligne renvoyée après un pointage
     * ou une correction soit IDENTIQUE à celle du registre.
     *
     * @return array<string,mixed>|null
     */
    public function findDetailed(int $id): ?array
    {
        $statement = $this->db->prepare(
            "SELECT t.*,
                    CONCAT(u.first_name, ' ', u.last_name) AS user_name,
                    s.name AS station_name,
                    CONCAT(c.first_name, ' ', c.last_name) AS corrected_by_name
               FROM time_entries t
               JOIN users    u ON u.id = t.user_id
               JOIN stations s ON s.id = t.station_id
          LEFT JOIN users    c ON c.id = t.corrected_by_user_id
              WHERE t.organization_id = :organization_id
                AND t.id = :id
              LIMIT 1"
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'id' => $id,
        ]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /**
     * Les pointages d'une période, avec le nom des personnes.
     *
     * @param array{from?:string, to?:string, user_id?:int, station_id?:int} $filters
     * @return list<array<string,mixed>>
     */
    public function listDetailed(array $filters = [], int $limit = 300): array
    {
        $conditions = [];
        $parameters = [];

        // Les bornes portent sur l'ARRIVÉE. Un pointage commencé à
        // 22 h et fermé à 2 h du matin appartient à la journée où la
        // personne a pris son poste, pas à celle où elle est partie.
        if (!empty($filters['from'])) {
            $conditions[] = 't.clock_in_at >= :from';
            $parameters['from'] = $filters['from'] . ' 00:00:00';
        }

        if (!empty($filters['to'])) {
            $conditions[] = 't.clock_in_at <= :to';
            $parameters['to'] = $filters['to'] . ' 23:59:59';
        }

        foreach (['user_id', 'station_id'] as $column) {
            if (!empty($filters[$column])) {
                $conditions[] = "t.{$column} = :{$column}";
                $parameters[$column] = (int) $filters[$column];
            }
        }

        $extra = $conditions === [] ? '' : ' AND ' . implode(' AND ', $conditions);
        $limit = max(1, min($limit, 500));

        $statement = $this->db->prepare(
            "SELECT t.*,
                    CONCAT(u.first_name, ' ', u.last_name) AS user_name,
                    s.name AS station_name,
                    CONCAT(c.first_name, ' ', c.last_name) AS corrected_by_name
               FROM time_entries t
               JOIN users    u ON u.id = t.user_id
               JOIN stations s ON s.id = t.station_id
          LEFT JOIN users    c ON c.id = t.corrected_by_user_id
              WHERE t.organization_id = :organization_id
                    {$extra}
           ORDER BY t.clock_in_at DESC
              LIMIT {$limit}"
        );

        $statement->execute($parameters + ['organization_id' => $this->organizationId()]);

        return $statement->fetchAll();
    }

    /**
     * Les pointages restés OUVERTS depuis plus de N heures.
     *
     * ==============================================================
     * L'ANOMALIE LA PLUS FRÉQUENTE DE TOUT LE MODULE.
     * ==============================================================
     * Quelqu'un pointe le matin, part le soir sans pointer, et le
     * compteur tourne toute la nuit. Le lendemain, la ligne affiche
     * dix-huit heures de travail.
     *
     * ON NE FERME PAS AUTOMATIQUEMENT ces pointages. Le logiciel ne
     * sait pas à quelle heure la personne est partie : inventer une
     * heure de sortie, c'est fabriquer une donnée de paie. On les
     * SIGNALE, et un responsable tranche avec ce qu'il sait.
     *
     * @return list<array<string,mixed>>
     */
    public function stale(int $afterHours = 12): array
    {
        $afterHours = max(1, min($afterHours, 72));

        $statement = $this->db->prepare(
            "SELECT t.*,
                    CONCAT(u.first_name, ' ', u.last_name) AS user_name,
                    s.name AS station_name,
                    TIMESTAMPDIFF(HOUR, t.clock_in_at, NOW()) AS hours_open
               FROM time_entries t
               JOIN users    u ON u.id = t.user_id
               JOIN stations s ON s.id = t.station_id
              WHERE t.organization_id = :organization_id
                AND t.clock_out_at IS NULL
                AND t.clock_in_at < (NOW() - INTERVAL {$afterHours} HOUR)
           ORDER BY t.clock_in_at ASC"
        );

        $statement->execute(['organization_id' => $this->organizationId()]);

        return $statement->fetchAll();
    }

    /**
     * Le total d'heures et de jours par personne sur une période.
     *
     * POURQUOI COMPTER AUSSI LES JOURS ?
     * Parce que la paie d'une station de lavage se fait souvent à la
     * journée travaillée, pas à l'heure. « 14 jours » est le chiffre
     * qu'on cherche ; « 112 heures » est celui qu'un logiciel
     * européen afficherait.
     *
     * Les pointages encore ouverts sont EXCLUS : leur durée n'est pas
     * connue, et l'estimer fausserait un total qui sert à payer.
     *
     * @return list<array{user_id:int, user_name:string, days:int, minutes:int}>
     */
    public function totalsByUser(string $from, string $to): array
    {
        $statement = $this->db->prepare(
            "SELECT t.user_id,
                    CONCAT(u.first_name, ' ', u.last_name) AS user_name,
                    COUNT(DISTINCT DATE(t.clock_in_at)) AS days,
                    COALESCE(SUM(t.duration_minutes), 0) AS minutes,
                    COUNT(*) AS entries
               FROM time_entries t
               JOIN users u ON u.id = t.user_id
              WHERE t.organization_id = :organization_id
                AND t.clock_out_at IS NOT NULL
                AND t.clock_in_at >= :from
                AND t.clock_in_at <= :to
           GROUP BY t.user_id, u.first_name, u.last_name
           ORDER BY minutes DESC"
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to'   => $to . ' 23:59:59',
        ]);

        return array_map(
            static fn (array $row): array => [
                'user_id'   => (int) $row['user_id'],
                'user_name' => (string) $row['user_name'],
                'days'      => (int) $row['days'],
                'minutes'   => (int) $row['minutes'],
                'entries'   => (int) $row['entries'],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * Qui est présent en ce moment, sur cette station.
     *
     * ==============================================================
     * LES POINTAGES OUBLIÉS SONT EXCLUS.
     * ==============================================================
     * Un pointage ouvert depuis quatre-vingts heures n'est pas une
     * présence : c'est quelqu'un qui est parti sans pointer, il y a
     * trois jours. L'afficher comme « présent depuis 81 h » ferait
     * douter de tout le panneau — et un panneau dont on doute, on
     * cesse de le regarder.
     *
     * Ces lignes ne disparaissent pas pour autant : elles ont leur
     * propre bloc, `stale()`, en tête de l'écran, parce qu'il faut
     * les corriger.
     *
     * Le seuil est le même dans les deux méthodes : une ligne est
     * soit une présence, soit une anomalie, jamais les deux.
     *
     * @return list<array<string,mixed>>
     */
    public function presentNow(?int $stationId = null, int $staleAfterHours = 12): array
    {
        $staleAfterHours = max(1, min($staleAfterHours, 72));

        $extra = " AND t.clock_in_at >= (NOW() - INTERVAL {$staleAfterHours} HOUR)";
        $parameters = ['organization_id' => $this->organizationId()];

        if ($stationId !== null) {
            $extra .= ' AND t.station_id = :station_id';
            $parameters['station_id'] = $stationId;
        }

        $statement = $this->db->prepare(
            "SELECT t.*,
                    CONCAT(u.first_name, ' ', u.last_name) AS user_name,
                    su.role,
                    TIMESTAMPDIFF(MINUTE, t.clock_in_at, NOW()) AS minutes_present
               FROM time_entries t
               JOIN users u ON u.id = t.user_id
          LEFT JOIN station_users su ON su.user_id = t.user_id AND su.station_id = t.station_id
              WHERE t.organization_id = :organization_id
                AND t.clock_out_at IS NULL
                    {$extra}
           ORDER BY t.clock_in_at ASC"
        );

        $statement->execute($parameters);

        return $statement->fetchAll();
    }
}
