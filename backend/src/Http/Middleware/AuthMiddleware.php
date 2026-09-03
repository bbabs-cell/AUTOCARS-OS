<?php

declare(strict_types=1);

namespace Autocare\Http\Middleware;

use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Security\TokenService;
use Autocare\Models\UserRepository;

/**
 * Contrôle d'accès des routes protégées
 * ------------------------------------------------------------------
 * Exécuté par le routeur AVANT le contrôleur, sur toute route
 * déclarée protégée. Il fait trois choses, dans cet ordre :
 *
 *   1. lire et vérifier le jeton d'accès          → sinon 401
 *   2. relire l'utilisateur et son rôle en base   → sinon 401
 *   3. vérifier la permission demandée            → sinon 403
 *
 * POURQUOI RELIRE L'UTILISATEUR EN BASE À CHAQUE REQUÊTE ?
 * Parce qu'un JWT n'est pas modifiable une fois émis. Si le rôle y
 * était inscrit, rétrograder ou désactiver un employé n'aurait aucun
 * effet avant l'expiration du jeton — jusqu'à 30 minutes pendant
 * lesquelles un compte compromis garderait ses droits.
 * Une requête de plus, mais une révocation immédiate.
 */
final class AuthMiddleware
{
    /**
     * @param string|null $requiredPermission null = authentification
     *                                        seule, sans droit précis
     */
    public static function handle(Request $request, ?string $requiredPermission): void
    {
        // --- 1. Le jeton -------------------------------------------
        $token = self::extractBearerToken($request);

        if ($token === null) {
            Response::unauthorized('Authentification requise.');
        }

        $claims = TokenService::readAccessToken($token);

        if ($claims === null) {
            // Message volontairement identique pour un jeton absent,
            // expiré ou falsifié : ne pas aider un attaquant à
            // comprendre où il en est.
            Response::unauthorized('Session expirée ou invalide.');
        }

        // --- 2. L'utilisateur --------------------------------------
        $users = new UserRepository();
        $user  = $users->findById($claims['sub']);

        if ($user === null || $user['status'] !== 'ACTIVE') {
            Response::unauthorized('Ce compte n\'est plus actif.');
        }

        // Le jeton dit appartenir à une organisation : on vérifie que
        // c'est bien celle de l'utilisateur en base. Sans ce contrôle,
        // un jeton forgé avec une autre organisation ouvrirait la
        // porte aux données d'un autre client.
        if ((int) $user['organization_id'] !== $claims['org']) {
            Response::unauthorized('Jeton incohérent.');
        }

        $membership = $users->membership($claims['sub']);

        AuthContext::set(
            userId:         (int) $user['id'],
            organizationId: (int) $user['organization_id'],
            email:          (string) $user['email'],
            fullName:       trim($user['first_name'] . ' ' . $user['last_name']),
            role:           $membership['role'],
            stationIds:     $membership['station_ids'],
        );

        // --- 3. La permission --------------------------------------
        if ($requiredPermission !== null && !AuthContext::current()->can($requiredPermission)) {
            Response::forbidden(
                'Votre rôle ne vous permet pas d\'effectuer cette action.'
            );
        }
    }

    /**
     * Lit l'en-tête « Authorization: Bearer <jeton> ».
     */
    private static function extractBearerToken(Request $request): ?string
    {
        $header = $request->header('Authorization');

        if ($header === null || !str_starts_with($header, 'Bearer ')) {
            return null;
        }

        $token = trim(substr($header, 7));

        return $token === '' ? null : $token;
    }
}
