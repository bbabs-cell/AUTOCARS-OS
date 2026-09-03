<?php

declare(strict_types=1);

namespace Autocare\Core\Security;

use RuntimeException;

/**
 * L'utilisateur de la requête en cours
 * ------------------------------------------------------------------
 * Rempli une seule fois par AuthMiddleware, au tout début du
 * traitement, puis lu partout ailleurs.
 *
 * POURQUOI UN ACCÈS STATIQUE ?
 * Parce que la couche d'accès aux données (TenantRepository) doit
 * connaître l'organisation courante SANS qu'on ait à la lui passer.
 * C'est précisément ce qui rend le filtre d'isolation impossible à
 * oublier : un développeur ne peut pas « omettre » un paramètre qui
 * n'existe pas.
 *
 * Le contexte vit le temps d'une requête HTTP. En PHP, chaque requête
 * démarre dans un processus neuf : il n'y a donc aucun risque qu'un
 * utilisateur hérite du contexte d'un autre.
 */
final class AuthContext
{
    private static ?self $current = null;

    /**
     * @param string $role Rôle le plus élevé de l'utilisateur dans
     *                     l'organisation (ADMIN > MANAGER > EMPLOYEE)
     * @param list<int> $stationIds Stations auxquelles il est rattaché
     */
    private function __construct(
        public readonly int $userId,
        public readonly int $organizationId,
        public readonly string $email,
        public readonly string $fullName,
        public readonly string $role,
        public readonly array $stationIds,
    ) {
    }

    /**
     * @param list<int> $stationIds
     */
    public static function set(
        int $userId,
        int $organizationId,
        string $email,
        string $fullName,
        string $role,
        array $stationIds,
    ): void {
        self::$current = new self($userId, $organizationId, $email, $fullName, $role, $stationIds);
    }

    /**
     * L'utilisateur courant.
     *
     * Lève une exception s'il n'y en a pas : c'est volontaire. Si du
     * code appelle cette méthode sur une route publique, c'est un bug
     * de conception — mieux vaut une erreur bruyante qu'une requête
     * silencieusement exécutée sans filtre d'organisation.
     */
    public static function current(): self
    {
        if (self::$current === null) {
            throw new RuntimeException(
                'Aucun utilisateur authentifié dans le contexte. '
                . 'Cette route devrait être protégée par AuthMiddleware.'
            );
        }

        return self::$current;
    }

    public static function isAuthenticated(): bool
    {
        return self::$current !== null;
    }

    /** Utilisé au logout et par les tests. */
    public static function clear(): void
    {
        self::$current = null;
    }

    public function can(string $action): bool
    {
        return Permissions::allows($this->role, $action);
    }

    /**
     * L'utilisateur a-t-il accès à cette station ?
     *
     * Un administrateur voit toutes les stations de son entreprise,
     * même celles où il n'est pas explicitement rattaché : c'est le
     * propriétaire, il pilote l'ensemble du réseau.
     */
    public function canAccessStation(int $stationId): bool
    {
        if ($this->role === 'ADMIN') {
            return true;
        }

        return in_array($stationId, $this->stationIds, true);
    }
}
