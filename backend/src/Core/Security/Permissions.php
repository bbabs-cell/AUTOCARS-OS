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

    /**
     * Tous les droits d'un rôle, sous leur forme déclarée.
     *
     * POURQUOI ENVOYER CETTE LISTE AU FRONTEND ?
     * Pour qu'il n'ait pas à recopier la matrice en TypeScript. Deux
     * copies d'une même règle divergent toujours : on ajouterait un
     * droit ici en oubliant là-bas, et le menu proposerait une porte
     * fermée pendant des mois sans que personne ne comprenne.
     *
     * ATTENTION À CE QUE CELA N'EST PAS. Cette liste sert à cacher un
     * lien inutile, JAMAIS à protéger quoi que ce soit : elle arrive
     * dans le navigateur, où n'importe qui peut la modifier. Toute
     * action reste vérifiée par AuthMiddleware à chaque requête.
     *
     * Les motifs sont renvoyés tels quels — « vehicles.* » plutôt que
     * la liste développée. Le frontend applique la même règle
     * d'étoile, en cinq lignes, plutôt que de recevoir deux cents
     * chaînes à chaque connexion.
     *
     * @return list<string>
     */
    public static function grantedTo(string $role): array
    {
        return self::matrix()[$role] ?? [];
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
