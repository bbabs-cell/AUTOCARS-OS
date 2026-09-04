<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Les forfaits achetés par les clients
 * ==================================================================
 * IL N'Y A PAS DE COMPTEUR `washes_used`.
 * ==================================================================
 *
 * Le nombre de lavages consommés est `COUNT(operations WHERE
 * subscription_id = X)`. Une consommation EST une opération : il n'y
 * a rien d'autre à enregistrer.
 *
 * C'est le même raisonnement qu'au lot 8 pour la file d'attente, et
 * il conduit à la même conclusion. Un compteur séparé finit toujours
 * par diverger de ce qu'il compte — une opération annulée, une
 * transaction interrompue — et personne ne sait alors lequel des deux
 * croire. Ici, on recompte.
 *
 * MÊME CHOSE POUR LE STATUT. « Expiré » se lit dans `expires_at`,
 * « épuisé » se compte dans les opérations. Seule l'annulation est
 * une décision humaine, et elle seule est stockée.
 */
final class SubscriptionRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'subscriptions';
    }

    /**
     * Les jointures et le comptage communs à toutes les lectures.
     *
     * `washes_used` est calculé ici, une fois. Les opérations
     * ANNULÉES ne comptent pas : un lavage qui n'a pas eu lieu ne
     * doit pas être décompté du forfait du client.
     */
    private const DETAILED_SELECT = "
        SELECT s.*,
               CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
               c.phone AS customer_phone,
               p.name  AS plan_name,
               srv.name AS service_name,
               srv.price AS service_price,
               st.name AS station_name,
               CONCAT(u.first_name, ' ', u.last_name) AS sold_by_name,
               (SELECT COUNT(*) FROM operations o
                 WHERE o.subscription_id = s.id
                   AND o.status <> 'CANCELLED') AS washes_used
          FROM subscriptions s
          JOIN customers c   ON c.id = s.customer_id
          JOIN subscription_plans p ON p.id = s.plan_id
          JOIN services srv  ON srv.id = s.service_id
          JOIN stations st   ON st.id = s.station_id
          JOIN users u       ON u.id = s.sold_by_user_id
    ";

    /**
     * @param array{customer_id?:int, station_id?:int, usable?:bool, search?:string} $filters
     * @return list<array<string,mixed>>
     */
    public function listDetailed(array $filters = [], int $limit = 200): array
    {
        $conditions = [];
        $parameters = [];

        foreach (['customer_id', 'station_id', 'plan_id'] as $column) {
            if (!empty($filters[$column])) {
                $conditions[] = "s.{$column} = :{$column}";
                $parameters[$column] = (int) $filters[$column];
            }
        }

        // « Utilisable » : ni annulé, ni périmé, ni épuisé. Les trois
        // conditions sont CALCULÉES, jamais lues dans une colonne.
        if (!empty($filters['usable'])) {
            $conditions[] = $this->usableCondition();
        }

        if (!empty($filters['search'])) {
            $conditions[] = "(CONCAT(c.first_name, ' ', c.last_name) LIKE :search"
                . ' OR c.phone LIKE :search)';
            $parameters['search'] = '%' . trim((string) $filters['search']) . '%';
        }

        $extra = $conditions === [] ? '' : ' AND ' . implode(' AND ', $conditions);
        $limit = max(1, min($limit, 500));

        $statement = $this->db->prepare(
            self::DETAILED_SELECT
            . " WHERE s.organization_id = :organization_id {$extra}
              ORDER BY s.expires_at ASC, s.id DESC
                 LIMIT {$limit}"
        );

        $statement->execute($parameters + ['organization_id' => $this->organizationId()]);

        return $statement->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public function findDetailed(int $id): ?array
    {
        $statement = $this->db->prepare(
            self::DETAILED_SELECT
            . ' WHERE s.organization_id = :organization_id AND s.id = :id LIMIT 1'
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
     * LE FORFAIT À UTILISER POUR CE LAVAGE
     * ==================================================================
     * Un client peut avoir plusieurs forfaits utilisables : il en a
     * racheté un avant d'épuiser le premier, ou il en a deux sur des
     * prestations différentes.
     *
     * ON PREND CELUI QUI EXPIRE LE PLUS TÔT. C'est le seul choix qui
     * soit dans l'intérêt du client : consommer d'abord le périssable
     * lui évite de perdre des lavages qu'il a payés. L'ordre inverse
     * ferait périmer le premier forfait pendant qu'on entame le
     * second, et la station gagnerait de l'argent sur une distraction.
     *
     * @return array<string,mixed>|null
     */
    public function usableFor(int $customerId, int $serviceId): ?array
    {
        $statement = $this->db->prepare(
            self::DETAILED_SELECT
            . ' WHERE s.organization_id = :organization_id
                  AND s.customer_id = :customer_id
                  AND s.service_id = :service_id
                  AND ' . $this->usableCondition() . '
              ORDER BY s.expires_at ASC, s.id ASC
                 LIMIT 1'
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'customer_id' => $customerId,
            'service_id' => $serviceId,
        ]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /**
     * Tous les forfaits encore utilisables d'un client, quelle que
     * soit la prestation. Affiché sur sa fiche.
     *
     * @return list<array<string,mixed>>
     */
    public function usableForCustomer(int $customerId): array
    {
        return $this->listDetailed(['customer_id' => $customerId, 'usable' => true]);
    }

    /**
     * ==================================================================
     * CE QUE LA STATION DOIT ENCORE LIVRER
     * ==================================================================
     * Le chiffre qui n'existerait pas sans ce module, et le seul qui
     * manquerait vraiment à un gérant.
     *
     * Une station qui a vendu 200 lavages d'avance DOIT 200 lavages.
     * L'argent est encaissé depuis longtemps ; la prestation, non.
     * C'est une dette, et elle doit se voir.
     *
     * Les forfaits périmés n'y figurent pas : la station ne les doit
     * plus. C'est justement pour cela que la durée de validité est
     * obligatoire.
     *
     * @return array{subscriptions:int, washes:int, value:int}
     */
    public function outstanding(?int $stationId = null): array
    {
        $extra = '';
        // PDO est configuré SANS émulation (voir Core\Database) : un
        // même nom de paramètre ne peut pas servir deux fois dans une
        // requête. Le filtre d'organisation apparaît ici dans la
        // sous-requête ET dans le WHERE extérieur, d'où les deux noms.
        // Le piège s'était déjà payé au lot 13.
        $parameters = [
            'organization_id' => $this->organizationId(),
            'organization_id_inner' => $this->organizationId(),
        ];

        if ($stationId !== null) {
            $extra = ' AND s.station_id = :station_id';
            $parameters['station_id'] = $stationId;
        }

        $statement = $this->db->prepare(
            'SELECT COUNT(*) AS forfaits,
                    COALESCE(SUM(s.washes_total - used.n), 0) AS lavages,
                    -- La VALEUR de la dette, au prix du catalogue
                    -- d\'aujourd\'hui : c\'est ce que ces lavages
                    -- coûteraient à la station s\'ils étaient tous
                    -- réclamés demain.
                    COALESCE(SUM((s.washes_total - used.n) * srv.price), 0) AS valeur
               FROM subscriptions s
               JOIN services srv ON srv.id = s.service_id
               JOIN (SELECT sub.id,
                            (SELECT COUNT(*) FROM operations o
                              WHERE o.subscription_id = sub.id
                                AND o.status <> \'CANCELLED\') AS n
                       FROM subscriptions sub
                      WHERE sub.organization_id = :organization_id_inner) AS used
                 ON used.id = s.id
              WHERE s.organization_id = :organization_id
                AND s.status = \'ACTIVE\'
                AND s.expires_at >= CURDATE()
                AND used.n < s.washes_total
                    ' . $extra
        );

        $statement->execute($parameters);

        $row = $statement->fetch() ?: [];

        return [
            'subscriptions' => (int) ($row['forfaits'] ?? 0),
            'washes' => (int) ($row['lavages'] ?? 0),
            'value'  => (int) ($row['valeur'] ?? 0),
        ];
    }

    /**
     * Les forfaits vendus sur une période — le chiffre d'affaires
     * « d'avance » du mois.
     *
     * @return array{count:int, amount:int}
     */
    public function soldBetween(string $from, string $to, ?int $stationId = null): array
    {
        $extra = '';
        $parameters = [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ];

        if ($stationId !== null) {
            $extra = ' AND station_id = :station_id';
            $parameters['station_id'] = $stationId;
        }

        $statement = $this->db->prepare(
            "SELECT COUNT(*) AS n, COALESCE(SUM(price_paid), 0) AS total
               FROM subscriptions
              WHERE organization_id = :organization_id
                AND created_at >= :from
                AND created_at <= :to
                    {$extra}"
        );

        $statement->execute($parameters);

        $row = $statement->fetch() ?: [];

        return ['count' => (int) ($row['n'] ?? 0), 'amount' => (int) ($row['total'] ?? 0)];
    }

    /**
     * Les lavages livrés sur une période au titre d'un forfait.
     *
     * C'est le pendant de `soldBetween()` : d'un côté ce qu'on a
     * encaissé d'avance, de l'autre ce qu'on a livré. Les deux ne
     * tombent pas le même mois, et c'est justement ce qu'il faut
     * pouvoir regarder.
     */
    public function deliveredBetween(string $from, string $to, ?int $stationId = null): int
    {
        $extra = '';
        $parameters = [
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ];

        if ($stationId !== null) {
            $extra = ' AND o.station_id = :station_id';
            $parameters['station_id'] = $stationId;
        }

        $statement = $this->db->prepare(
            "SELECT COUNT(*)
               FROM operations o
              WHERE o.organization_id = :organization_id
                AND o.subscription_id IS NOT NULL
                AND o.status <> 'CANCELLED'
                AND o.created_at >= :from
                AND o.created_at <= :to
                    {$extra}"
        );

        $statement->execute($parameters);

        return (int) $statement->fetchColumn();
    }

    /**
     * « Ni annulé, ni périmé, ni épuisé », en SQL.
     *
     * Écrit une seule fois : c'est la définition d'un forfait
     * utilisable, et elle est lue par la liste, par la sélection
     * automatique et par la vérification faite avant chaque
     * consommation. Trois copies auraient fini par diverger, et un
     * forfait périmé serait passé quelque part.
     */
    private function usableCondition(): string
    {
        return "(s.status = 'ACTIVE'
                 AND s.expires_at >= CURDATE()
                 AND (SELECT COUNT(*) FROM operations o
                       WHERE o.subscription_id = s.id
                         AND o.status <> 'CANCELLED') < s.washes_total)";
    }
}
