<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Les stations de l'entreprise
 * ------------------------------------------------------------------
 * Remarque la taille de ce fichier : tout l'accès aux données vient
 * de TenantRepository, qui applique le filtre d'organisation à
 * chaque lecture et chaque écriture.
 *
 * C'est exactement l'effet recherché : un dépôt métier n'a plus à se
 * préoccuper du cloisonnement, donc il ne peut pas l'oublier.
 */
final class StationRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'stations';
    }

    /**
     * Le code identifie la station dans les références de dossier
     * (« DKP-2608-0042 »). Il doit rester unique dans l'entreprise.
     *
     * @param int|null $exceptId Station à ignorer, lors d'une modification
     */
    public function codeIsTaken(string $code, ?int $exceptId = null): bool
    {
        $rows = $this->select(
            'id',
            'AND code = :code' . ($exceptId !== null ? ' AND id != :except' : ''),
            $exceptId !== null
                ? ['code' => $code, 'except' => $exceptId]
                : ['code' => $code],
        );

        return $rows !== [];
    }
}
