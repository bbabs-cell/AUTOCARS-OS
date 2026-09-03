<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Les inspections : l'état constaté d'un véhicule
 * ------------------------------------------------------------------
 * LE CŒUR DIFFÉRENCIANT DU PRODUIT.
 *
 * Le litige « il y avait cette rayure ? / non, elle y était déjà »
 * est ce qui coûte le plus cher à une station, et c'est le seul
 * problème qu'aucun cahier ni groupe WhatsApp ne résout.
 *
 * Deux inspections au maximum par opération, garanties par une
 * contrainte d'unicité en base :
 *   ENTRY  à l'arrivée, avant toute intervention
 *   EXIT   avant restitution
 */
final class InspectionRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'inspections';
    }

    /**
     * Les inspections d'une opération, photos comprises.
     *
     * @return list<array<string,mixed>>
     */
    public function forOperation(int $operationId): array
    {
        $statement = $this->db->prepare(
            "SELECT i.*,
                    CONCAT(u.first_name, ' ', u.last_name) AS performed_by_name
               FROM inspections i
               JOIN users u ON u.id = i.performed_by_user_id
              WHERE i.operation_id = :operation_id
                AND i.organization_id = :organization_id
           ORDER BY i.performed_at ASC"
        );

        $statement->execute([
            'operation_id'    => $operationId,
            'organization_id' => $this->organizationId(),
        ]);

        return $statement->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public function findForOperation(int $operationId, string $type): ?array
    {
        $rows = $this->select(
            '*',
            'AND operation_id = :operation_id AND type = :type LIMIT 1',
            ['operation_id' => $operationId, 'type' => $type],
        );

        return $rows[0] ?? null;
    }

    /**
     * L'historique des états constatés d'un véhicule.
     *
     * C'est CETTE liste qu'on ouvre en cas de litige : elle montre
     * comment le véhicule est arrivé à chacun de ses passages, avec
     * le nom de la personne qui l'a constaté.
     *
     * @return list<array<string,mixed>>
     */
    public function historyForVehicle(int $vehicleId, int $limit = 20): array
    {
        $limit = max(1, min($limit, 100));

        $statement = $this->db->prepare(
            "SELECT i.*, o.reference, o.created_at AS operation_created_at,
                    CONCAT(u.first_name, ' ', u.last_name) AS performed_by_name,
                    (SELECT COUNT(*) FROM inspection_photos p
                      WHERE p.inspection_id = i.id AND p.status = 'ACTIVE') AS photo_count
               FROM inspections i
               JOIN operations o ON o.id = i.operation_id
               JOIN users u      ON u.id = i.performed_by_user_id
              WHERE i.vehicle_id = :vehicle_id
                AND i.organization_id = :organization_id
           ORDER BY i.performed_at DESC
              LIMIT {$limit}"
        );

        $statement->execute([
            'vehicle_id'      => $vehicleId,
            'organization_id' => $this->organizationId(),
        ]);

        return $statement->fetchAll();
    }
}
