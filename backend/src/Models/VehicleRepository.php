<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\PlateNumber;
use Autocare\Core\TenantRepository;

/**
 * Les véhicules confiés à la station
 * ------------------------------------------------------------------
 * Le véhicule est l'objet central du produit : c'est autour de lui
 * que s'organisent l'historique, les inspections et les litiges.
 */
final class VehicleRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'vehicles';
    }

    protected function usesSoftDeletes(): bool
    {
        return true;
    }

    /**
     * Recherche d'un véhicule au comptoir.
     *
     * Sur la plaque, la marque, le modèle ou le nom du propriétaire.
     * La plaque est normalisée avant comparaison : « dk 1234 aa »
     * retrouve « DK1234AA », sans quoi l'employé conclurait à tort
     * que le véhicule n'est pas enregistré.
     *
     * @return list<array<string,mixed>>
     */
    public function search(string $term, ?int $customerId = null, int $limit = 50): array
    {
        $conditions = [];
        $parameters = [];

        $term = trim($term);

        if ($term !== '') {
            // Un nom de paramètre par occurrence : les requêtes
            // préparées natives de MySQL refusent la réutilisation
            // (voir la note détaillée dans CustomerRepository).
            $conditions[] = "(
                    v.plate_number LIKE :plate
                 OR v.brand        LIKE :brand
                 OR v.model        LIKE :model
                 OR c.last_name    LIKE :last_name
                 OR c.first_name   LIKE :first_name
            )";

            $parameters['plate']      = PlateNumber::normalize($term) . '%';
            $parameters['brand']      = $term . '%';
            $parameters['model']      = $term . '%';
            $parameters['last_name']  = $term . '%';
            $parameters['first_name'] = $term . '%';
        }

        if ($customerId !== null) {
            $conditions[] = 'v.customer_id = :customer_id';
            $parameters['customer_id'] = $customerId;
        }

        $extraWhere = $conditions === [] ? '' : ' AND ' . implode(' AND ', $conditions);

        return $this->withOwner($extraWhere, $parameters, $limit);
    }

    /** @return array<string,mixed>|null */
    public function findWithOwner(int $id): ?array
    {
        $rows = $this->withOwner('AND v.id = :id', ['id' => $id], 1);

        return $rows[0] ?? null;
    }

    /**
     * Ce numéro de plaque est-il déjà enregistré ?
     * La contrainte existe en base (unique par organisation) ; on la
     * vérifie ici pour renvoyer un message clair plutôt qu'une erreur
     * SQL brute.
     */
    public function plateIsTaken(string $plate, ?int $exceptId = null): bool
    {
        $rows = $this->select(
            'id',
            'AND plate_number = :plate' . ($exceptId !== null ? ' AND id != :except' : ''),
            $exceptId !== null
                ? ['plate' => PlateNumber::normalize($plate), 'except' => $exceptId]
                : ['plate' => PlateNumber::normalize($plate)],
        );

        return $rows !== [];
    }

    /**
     * L'historique d'un véhicule : toutes ses opérations.
     *
     * C'EST LA RAISON D'ÊTRE DU PRODUIT. En cas de litige, c'est cette
     * liste qui répond à « qu'a-t-on fait sur ce véhicule, et quand ».
     *
     * Vide au lot 6 : les opérations arrivent au lot 8. La requête est
     * écrite dès maintenant pour que la fiche véhicule soit complète
     * le jour où les données existeront.
     *
     * @return list<array<string,mixed>>
     */
    public function history(int $vehicleId, int $limit = 50): array
    {
        $statement = $this->db->prepare(
            "SELECT o.id, o.reference, o.status, o.price, o.created_at,
                    o.started_at, o.completed_at, o.released_at,
                    s.name AS service_name,
                    CONCAT(u.first_name, ' ', u.last_name) AS employee_name
               FROM operations o
               JOIN services s ON s.id = o.service_id
          LEFT JOIN users u    ON u.id = o.assigned_user_id
              WHERE o.vehicle_id = :vehicle_id
                AND o.organization_id = :organization_id
           ORDER BY o.created_at DESC
              LIMIT {$limit}"
        );

        $statement->execute([
            'vehicle_id'      => $vehicleId,
            'organization_id' => $this->organizationId(),
        ]);

        return $statement->fetchAll();
    }

    /**
     * Requête commune : le véhicule avec son propriétaire.
     *
     * Comme pour les clients, le filtre d'organisation est écrit
     * explicitement car la requête joint deux tables.
     *
     * @param array<string,mixed> $parameters
     * @return list<array<string,mixed>>
     */
    private function withOwner(string $extraWhere, array $parameters, int $limit): array
    {
        $sql = "SELECT v.*,
                       c.first_name AS customer_first_name,
                       c.last_name  AS customer_last_name,
                       c.phone      AS customer_phone,
                       (SELECT COUNT(*) FROM operations o WHERE o.vehicle_id = v.id) AS operation_count,
                       (SELECT MAX(o.created_at) FROM operations o WHERE o.vehicle_id = v.id) AS last_operation_at
                  FROM vehicles v
                  JOIN customers c ON c.id = v.customer_id
                 WHERE v.organization_id = :organization_id
                   AND v.deleted_at IS NULL
                   {$extraWhere}
              ORDER BY v.created_at DESC
                 LIMIT {$limit}";

        $statement = $this->db->prepare($sql);
        $statement->execute($parameters + ['organization_id' => $this->organizationId()]);

        return $statement->fetchAll();
    }
}
