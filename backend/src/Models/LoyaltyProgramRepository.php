<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Les règles du programme de fidélité
 * ------------------------------------------------------------------
 * Une entreprise n'a qu'un seul programme ACTIF à la fois — la base
 * le garantit par une colonne calculée sous contrainte d'unicité.
 * Les anciens restent en base : ils expliquent les tampons déjà
 * distribués.
 */
final class LoyaltyProgramRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'loyalty_programs';
    }

    /**
     * Le programme en vigueur, ou null si l'entreprise n'en a pas.
     *
     * @return array<string,mixed>|null
     */
    public function active(): ?array
    {
        $rows = $this->select('*', "AND status = 'ACTIVE' LIMIT 1");

        return $rows[0] ?? null;
    }

    /**
     * Le programme à AFFICHER : celui en vigueur, sinon le dernier
     * enregistré.
     *
     * Un gérant qui a désactivé son programme doit retrouver ses
     * réglages en le rouvrant, pas un formulaire vide.
     *
     * @return array<string,mixed>|null
     */
    public function current(): ?array
    {
        $rows = $this->select('*', 'ORDER BY status = \'ACTIVE\' DESC, id DESC LIMIT 1');

        return $rows[0] ?? null;
    }
}
