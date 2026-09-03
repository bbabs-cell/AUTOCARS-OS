<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Les photos d'inspection : les preuves
 * ------------------------------------------------------------------
 * Ces lignes ont une valeur de preuve. Deux conséquences directes sur
 * ce dépôt :
 *
 *   1. AUCUNE MÉTHODE DE SUPPRESSION. Une photo se retire de
 *      l'affichage par le statut ARCHIVED, jamais par un DELETE.
 *      Une preuve effaçable ne vaut rien — et « effacée par erreur »
 *      est exactement ce que dirait quelqu'un qui l'a fait exprès.
 *
 *   2. L'empreinte SHA-256 est stockée à l'enregistrement et
 *      vérifiable à tout moment. Si le fichier sur le disque est
 *      remplacé, la substitution devient détectable.
 */
final class InspectionPhotoRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'inspection_photos';
    }

    /** @return list<array<string,mixed>> */
    public function forInspection(int $inspectionId): array
    {
        return $this->select(
            '*',
            'AND inspection_id = :inspection_id AND status = :status ORDER BY id ASC',
            ['inspection_id' => $inspectionId, 'status' => 'ACTIVE'],
        );
    }

    public function countForInspection(int $inspectionId): int
    {
        return $this->count(['inspection_id' => $inspectionId, 'status' => 'ACTIVE']);
    }

    /**
     * Retire une photo de l'affichage sans détruire le fichier.
     * Sert au doigt sur l'objectif ou à la photo prise par erreur.
     */
    public function archive(int $id): bool
    {
        return $this->update($id, ['status' => 'ARCHIVED']);
    }
}
