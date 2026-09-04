<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\BookingStatus;
use Autocare\Core\TenantRepository;

/**
 * Les rendez-vous
 * ------------------------------------------------------------------
 * CE DÉPÔT NE SUPPRIME RIEN, comme celui du pointage et pour une
 * raison voisine : un rendez-vous effacé, c'est un créneau qu'on
 * croit libre, un client qu'on ne rappellera pas, et une absence
 * qu'on ne pourra plus expliquer. Une réservation qui n'a pas lieu
 * s'annule — et l'annulation reste visible.
 */
final class BookingRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'bookings';
    }

    /**
     * Les jointures communes à toutes les lectures détaillées.
     *
     * Écrites une fois : la ligne renvoyée après une création doit
     * être IDENTIQUE à celle de la liste. Au lot 12, deux requêtes
     * différentes pour la même donnée affichaient « corrigé par — »
     * sur un écran et le nom sur l'autre.
     */
    private const DETAILED_SELECT = "
        SELECT b.*,
               s.name  AS service_name,
               s.category AS service_category,
               st.name AS station_name,
               st.code AS station_code,
               CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
               CONCAT(o.first_name, ' ', o.last_name) AS outcome_by_name,
               op.reference AS operation_reference,
               op.status    AS operation_status,
               v.brand      AS vehicle_brand,
               v.model      AS vehicle_model
          FROM bookings b
          JOIN services s   ON s.id  = b.service_id
          JOIN stations st  ON st.id = b.station_id
          JOIN users    u   ON u.id  = b.created_by_user_id
     LEFT JOIN users    o   ON o.id  = b.outcome_by_user_id
     LEFT JOIN operations op ON op.id = b.operation_id
     LEFT JOIN vehicles v   ON v.id  = b.vehicle_id
    ";

    /**
     * Les rendez-vous d'une période, d'une station, d'un statut.
     *
     * @param array{
     *     from?:string, to?:string, station_id?:int, status?:string,
     *     open?:bool, search?:string, customer_id?:int
     * } $filters
     * @return list<array<string,mixed>>
     */
    public function listDetailed(array $filters = [], int $limit = 300): array
    {
        $conditions = [];
        $parameters = [];

        // Les bornes portent sur l'HEURE DU RENDEZ-VOUS, pas sur la
        // date de saisie : « la journée de mardi » veut dire les
        // véhicules attendus mardi, pas les appels reçus mardi.
        if (!empty($filters['from'])) {
            $conditions[] = 'b.scheduled_at >= :from';
            $parameters['from'] = $filters['from'] . ' 00:00:00';
        }

        if (!empty($filters['to'])) {
            $conditions[] = 'b.scheduled_at <= :to';
            $parameters['to'] = $filters['to'] . ' 23:59:59';
        }

        foreach (['station_id', 'customer_id', 'service_id'] as $column) {
            if (!empty($filters[$column])) {
                $conditions[] = "b.{$column} = :{$column}";
                $parameters[$column] = (int) $filters[$column];
            }
        }

        if (!empty($filters['status'])) {
            $conditions[] = 'b.status = :status';
            $parameters['status'] = (string) $filters['status'];
        }

        // « Ce qui reste à traiter » : les rendez-vous encore vivants.
        if (!empty($filters['open'])) {
            $conditions[] = $this->openStatusCondition();
        }

        // Un client qui rappelle donne son nom ou son numéro, jamais
        // un identifiant. La recherche porte donc sur ce qu'il dit.
        if (!empty($filters['search'])) {
            $conditions[] = '(b.customer_name LIKE :search'
                . ' OR b.customer_phone LIKE :search'
                . ' OR b.plate_number LIKE :search)';
            $parameters['search'] = '%' . trim((string) $filters['search']) . '%';
        }

        $extra = $conditions === [] ? '' : ' AND ' . implode(' AND ', $conditions);
        $limit = max(1, min($limit, 500));

        $statement = $this->db->prepare(
            self::DETAILED_SELECT
            . " WHERE b.organization_id = :organization_id {$extra}
              ORDER BY b.scheduled_at ASC, b.id ASC
                 LIMIT {$limit}"
        );

        $statement->execute($parameters + ['organization_id' => $this->organizationId()]);

        return $statement->fetchAll();
    }

    /**
     * Une ligne avec les libellés, et non seulement des identifiants.
     *
     * @return array<string,mixed>|null
     */
    public function findDetailed(int $id): ?array
    {
        $statement = $this->db->prepare(
            self::DETAILED_SELECT
            . ' WHERE b.organization_id = :organization_id AND b.id = :id LIMIT 1'
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'id' => $id,
        ]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /**
     * ==================================================================
     * LES RENDEZ-VOUS DÉPASSÉS
     * ==================================================================
     * L'heure est passée depuis plus que le délai de grâce, et le
     * rendez-vous est toujours ouvert : soit le client est arrivé sans
     * que personne ne l'ait noté, soit il n'est pas venu.
     *
     * COMME AU LOT 12, LE LOGICIEL NE TRANCHE PAS. Marquer « absent »
     * automatiquement inscrirait dans l'historique d'un client une
     * absence qui n'a peut-être pas eu lieu — et cet historique
     * servira un jour à décider si on lui garde un créneau. On
     * SIGNALE, quelqu'un au comptoir sait ce qui s'est passé.
     *
     * @return list<array<string,mixed>>
     */
    public function overdue(?int $stationId = null): array
    {
        $grace = BookingStatus::noShowGraceMinutes();

        $extra = '';
        $parameters = ['organization_id' => $this->organizationId()];

        if ($stationId !== null) {
            $extra = ' AND b.station_id = :station_id';
            $parameters['station_id'] = $stationId;
        }

        $statement = $this->db->prepare(
            self::DETAILED_SELECT
            . " WHERE b.organization_id = :organization_id
                  AND " . $this->openStatusCondition() . "
                  AND b.scheduled_at < (NOW() - INTERVAL {$grace} MINUTE)
                      {$extra}
              ORDER BY b.scheduled_at ASC"
        );

        $statement->execute($parameters);

        return $statement->fetchAll();
    }

    /**
     * ==================================================================
     * COMBIEN DE VÉHICULES SONT DÉJÀ ATTENDUS SUR CE CRÉNEAU ?
     * ==================================================================
     * On compare des INTERVALLES, pas des heures de début. Deux
     * rendez-vous à 10 h et 10 h 30 se chevauchent si le premier dure
     * une heure : compter « combien à 10 h 30 » répondrait « un »
     * alors que deux voitures seront là.
     *
     * Cette valeur ne sert PAS à refuser une réservation : voir la
     * note du contrôleur. Elle sert à prévenir.
     */
    public function overlappingCount(
        int $stationId,
        string $scheduledAt,
        int $durationMinutes,
        ?int $excludeId = null,
    ): int {
        $extra = '';
        // PDO est configuré SANS émulation des requêtes préparées (voir
        // Core\Database) : un même nom de paramètre ne peut donc pas
        // être réutilisé deux fois dans une requête. L'heure de début
        // apparaît des deux côtés du chevauchement, elle est donc
        // passée sous deux noms.
        $parameters = [
            'organization_id' => $this->organizationId(),
            'station_id' => $stationId,
            'start_before' => $scheduledAt,
            'start_after'  => $scheduledAt,
            'duration' => max(1, $durationMinutes),
        ];

        if ($excludeId !== null) {
            $extra = ' AND b.id <> :exclude_id';
            $parameters['exclude_id'] = $excludeId;
        }

        $statement = $this->db->prepare(
            'SELECT COUNT(*) AS total
               FROM bookings b
              WHERE b.organization_id = :organization_id
                AND b.station_id = :station_id
                AND ' . $this->openStatusCondition() . '
                AND b.scheduled_at < DATE_ADD(:start_before, INTERVAL :duration MINUTE)
                AND DATE_ADD(b.scheduled_at, INTERVAL b.duration_minutes MINUTE) > :start_after'
            . $extra
        );

        $statement->execute($parameters);

        return (int) ($statement->fetch()['total'] ?? 0);
    }

    /**
     * La charge heure par heure d'une journée, pour une station.
     *
     * C'est ce qui remplace la « capacité » qu'on n'a pas voulu
     * inventer : plutôt qu'un maximum arbitraire, on montre ce qui est
     * déjà pris et on laisse décider quelqu'un qui connaît sa station.
     *
     * @return list<array{hour:int, bookings:int, minutes:int}>
     */
    public function loadByHour(int $stationId, string $date): array
    {
        $statement = $this->db->prepare(
            'SELECT HOUR(b.scheduled_at) AS hour,
                    COUNT(*) AS bookings,
                    COALESCE(SUM(b.duration_minutes), 0) AS minutes
               FROM bookings b
              WHERE b.organization_id = :organization_id
                AND b.station_id = :station_id
                AND DATE(b.scheduled_at) = :date
                AND ' . $this->openStatusCondition() . '
           GROUP BY HOUR(b.scheduled_at)
           ORDER BY hour ASC'
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'station_id' => $stationId,
            'date' => $date,
        ]);

        return array_map(
            static fn (array $row): array => [
                'hour' => (int) $row['hour'],
                'bookings' => (int) $row['bookings'],
                'minutes' => (int) $row['minutes'],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * Le compte par statut sur une période — le bandeau de l'écran.
     *
     * @return array<string,int>
     */
    public function countByStatus(string $from, string $to, ?int $stationId = null): array
    {
        $extra = '';
        $parameters = [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ];

        if ($stationId !== null) {
            $extra = ' AND b.station_id = :station_id';
            $parameters['station_id'] = $stationId;
        }

        $statement = $this->db->prepare(
            "SELECT b.status, COUNT(*) AS total
               FROM bookings b
              WHERE b.organization_id = :organization_id
                AND b.scheduled_at >= :from
                AND b.scheduled_at <= :to
                    {$extra}
           GROUP BY b.status"
        );

        $statement->execute($parameters);

        // Tous les statuts sont présents, à zéro s'il le faut : un
        // écran dont les compteurs apparaissent et disparaissent selon
        // les données saute sous les yeux à chaque rechargement.
        $counts = array_fill_keys(BookingStatus::all(), 0);

        foreach ($statement->fetchAll() as $row) {
            $counts[(string) $row['status']] = (int) $row['total'];
        }

        return $counts;
    }

    /**
     * Combien de rendez-vous attendus aujourd'hui, encore ouverts.
     * Alimente le tableau de bord.
     */
    public function openToday(?int $stationId = null): int
    {
        $extra = '';
        $parameters = ['organization_id' => $this->organizationId()];

        if ($stationId !== null) {
            $extra = ' AND b.station_id = :station_id';
            $parameters['station_id'] = $stationId;
        }

        $statement = $this->db->prepare(
            "SELECT COUNT(*) AS total
               FROM bookings b
              WHERE b.organization_id = :organization_id
                AND DATE(b.scheduled_at) = CURDATE()
                AND " . $this->openStatusCondition() . "
                    {$extra}"
        );

        $statement->execute($parameters);

        return (int) ($statement->fetch()['total'] ?? 0);
    }

    /**
     * « b.status IN ('SCHEDULED','CONFIRMED') », construit depuis la
     * configuration plutôt qu'écrit en dur.
     *
     * Les valeurs viennent de `config/booking_status.php`, jamais
     * d'une requête : elles ne peuvent donc pas être influencées par
     * un paramètre d'URL. C'est ce qui rend cette interpolation sûre.
     */
    private function openStatusCondition(): string
    {
        $quoted = array_map(
            static fn (string $status): string => "'" . $status . "'",
            BookingStatus::open(),
        );

        return 'b.status IN (' . implode(', ', $quoted) . ')';
    }
}
