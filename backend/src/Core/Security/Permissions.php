<?php

declare(strict_types=1);

namespace Autocare\Core\Security;

/**
 * Vérification des droits
 * ------------------------------------------------------------------
 * Lit la matrice de config/permissions.php et répond à une seule
 * question : « ce rôle a-t-il le droit de faire cette action ? »
 *
 * La matrice est chargée une seule fois par requête.
 */
final class Permissions
{
    /** @var array<string, list<string>>|null */
    private static ?array $matrix = null;

    /**
     * @param string $role   ADMIN, MANAGER ou EMPLOYEE
     * @param string $action « vehicles.create »
     */
    public static function allows(string $role, string $action): bool
    {
        $granted = self::matrix()[$role] ?? [];

        foreach ($granted as $pattern) {
            // Accès total
            if ($pattern === '*') {
                return true;
            }

            // Correspondance exacte
            if ($pattern === $action) {
                return true;
            }

            // Domaine entier : « vehicles.* » couvre « vehicles.create »
            if (str_ends_with($pattern, '.*')) {
                $domain = substr($pattern, 0, -2);

                if (str_starts_with($action, $domain . '.')) {
                    return true;
                }
            }
        }

        return false;
    }

    /** @return array<string, list<string>> */
    private static function matrix(): array
    {
        if (self::$matrix === null) {
            /** @var array<string, list<string>> $loaded */
            $loaded = require dirname(__DIR__, 3) . '/config/permissions.php';
            self::$matrix = $loaded;
        }

        return self::$matrix;
    }

    /** Utilisé par les tests pour repartir d'une matrice fraîche. */
    public static function reset(): void
    {
        self::$matrix = null;
    }
}
