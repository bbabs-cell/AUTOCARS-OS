<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Le catalogue des prestations
 * ------------------------------------------------------------------
 * « Lavage standard », « Detailing complet ». Configuré par le gérant
 * pendant l'installation, puis ajusté au fil du temps.
 */
final class ServiceRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'services';
    }

    public function nameIsTaken(string $name, ?int $exceptId = null): bool
    {
        $rows = $this->select(
            'id',
            'AND name = :name' . ($exceptId !== null ? ' AND id != :except' : ''),
            $exceptId !== null
                ? ['name' => $name, 'except' => $exceptId]
                : ['name' => $name],
        );

        return $rows !== [];
    }

    /**
     * Prestations proposables au comptoir, triées par prix croissant.
     *
     * On ne SUPPRIME jamais une prestation : elle est référencée par
     * les opérations passées, et sa disparition trouerait l'historique.
     * On la désactive — d'où ce filtre sur le statut.
     *
     * @return list<array<string,mixed>>
     */
    public function activeServices(): array
    {
        return $this->select('*', "AND status = 'ACTIVE' ORDER BY price ASC");
    }
}
