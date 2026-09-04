<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Les forfaits proposés par la station
 * ------------------------------------------------------------------
 * « 10 lavages standard pour 40 000 F, valables 6 mois. »
 *
 * Une station en propose plusieurs — un par prestation qu'elle veut
 * couvrir. Il n'y a donc aucune contrainte « un seul actif », à la
 * différence du programme de fidélité.
 */
final class SubscriptionPlanRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'subscription_plans';
    }

    /**
     * Les forfaits, avec le nom et le prix de la prestation couverte.
     *
     * @return list<array<string,mixed>>
     */
    public function listDetailed(bool $activeOnly = false): array
    {
        $extra = $activeOnly ? "AND p.status = 'ACTIVE'" : '';

        $statement = $this->db->prepare(
            "SELECT p.*,
                    s.name  AS service_name,
                    s.price AS service_price,
                    s.status AS service_status,
                    (SELECT COUNT(*) FROM subscriptions sub
                      WHERE sub.plan_id = p.id) AS sold_count
               FROM subscription_plans p
               JOIN services s ON s.id = p.service_id
              WHERE p.organization_id = :organization_id
                    {$extra}
           ORDER BY p.status = 'ACTIVE' DESC, p.name ASC"
        );

        $statement->execute(['organization_id' => $this->organizationId()]);

        return $statement->fetchAll();
    }

    /**
     * Un forfait avec sa prestation.
     *
     * @return array<string,mixed>|null
     */
    public function findDetailed(int $id): ?array
    {
        $statement = $this->db->prepare(
            'SELECT p.*, s.name AS service_name, s.price AS service_price, s.status AS service_status
               FROM subscription_plans p
               JOIN services s ON s.id = p.service_id
              WHERE p.organization_id = :organization_id AND p.id = :id
              LIMIT 1'
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'id' => $id,
        ]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }
}
