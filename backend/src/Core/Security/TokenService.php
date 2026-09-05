<?php

declare(strict_types=1);

namespace Autocare\Core\Security;

use Autocare\Core\Database;
use Autocare\Core\Env;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Throwable;

/**
 * Jetons d'authentification
 * ------------------------------------------------------------------
 * DEUX JETONS, DEUX RÔLES DIFFÉRENTS.
 *
 * 1. Le JETON D'ACCÈS (JWT), valable 30 minutes.
 *    Envoyé à chaque requête dans l'en-tête Authorization. Angular le
 *    garde EN MÉMOIRE, jamais dans localStorage.
 *
 *    Pourquoi pas localStorage ? Parce qu'il est lisible par
 *    n'importe quel JavaScript de la page. Une seule faille XSS et le
 *    compte est volé pour toute la durée du jeton.
 *
 * 2. Le JETON DE RAFRAÎCHISSEMENT, valable 7 jours.
 *    Stocké dans un cookie httpOnly : invisible au JavaScript, donc
 *    non exfiltrable même en cas de XSS. Il sert uniquement à obtenir
 *    un nouveau jeton d'accès.
 *
 * POURQUOI CETTE COMPLEXITÉ ?
 * Un jeton unique de longue durée serait plus simple, mais s'il est
 * volé l'attaquant garde l'accès une semaine. Un jeton unique de
 * courte durée obligerait l'utilisateur à se reconnecter toutes les
 * demi-heures. Le couple des deux donne à la fois la sécurité et le
 * confort.
 *
 * ROTATION : à chaque rafraîchissement, l'ancien jeton est révoqué et
 * un nouveau émis. Un jeton déjà utilisé qui réapparaît signale un vol.
 *
 * CE QUE LE JETON NE CONTIENT PAS
 * Le rôle de l'utilisateur n'est PAS dans le JWT. Il est relu en base
 * à chaque requête. Un jeton n'est pas modifiable une fois émis :
 * si le rôle y figurait, rétrograder un employé n'aurait aucun effet
 * avant l'expiration du jeton. Une requête de plus, mais une révocation
 * immédiate.
 */
final class TokenService
{
    private const ALGORITHM = 'HS256';

    // ==================================================================
    // JETON D'ACCÈS
    // ==================================================================

    public static function issueAccessToken(int $userId, int $organizationId): string
    {
        $now      = time();
        $lifetime = (int) (Env::get('JWT_ACCESS_TTL_MINUTES', '30') ?? '30') * 60;

        $payload = [
            'sub' => $userId,          // « subject » : de qui on parle
            'org' => $organizationId,
            'iat' => $now,             // émis à
            'exp' => $now + $lifetime, // expire à
            'jti' => bin2hex(random_bytes(8)), // identifiant unique du jeton
        ];

        return JWT::encode($payload, self::secret(), self::ALGORITHM);
    }

    /**
     * Vérifie un jeton d'accès et retourne son contenu.
     *
     * @return array{sub:int, org:int}|null null si invalide ou expiré
     */
    public static function readAccessToken(string $token): ?array
    {
        try {
            // On impose explicitement l'algorithme attendu.
            // Sans cela, un attaquant pourrait présenter un jeton se
            // déclarant « alg: none » et se faire passer pour
            // n'importe qui : c'est la « confusion d'algorithme »,
            // faille classique des implémentations JWT maison.
            $decoded = JWT::decode($token, new Key(self::secret(), self::ALGORITHM));

            return [
                'sub' => (int) $decoded->sub,
                'org' => (int) $decoded->org,
            ];
        } catch (Throwable) {
            // Signature invalide, jeton expiré, format incorrect :
            // dans tous les cas la réponse est la même. Détailler la
            // cause aiderait un attaquant à comprendre ce qu'il doit
            // corriger.
            return null;
        }
    }

    // ==================================================================
    // JETON DE RAFRAÎCHISSEMENT
    // ==================================================================

    /**
     * Crée un jeton de rafraîchissement et l'enregistre.
     * Retourne le jeton EN CLAIR : c'est la seule fois où il existe
     * sous cette forme. La base n'en garde que l'empreinte.
     */
    public static function issueRefreshToken(int $userId, int $organizationId): string
    {
        // 32 octets aléatoires cryptographiquement sûrs, soit
        // 64 caractères hexadécimaux. Impossible à deviner.
        $token = bin2hex(random_bytes(32));

        $days = (int) (Env::get('JWT_REFRESH_TTL_DAYS', '7') ?? '7');

        Database::connection()->prepare(
            'INSERT INTO refresh_tokens
                (organization_id, user_id, token_hash, expires_at, created_ip, user_agent)
             VALUES
                (:organization_id, :user_id, :token_hash,
                 (NOW() + INTERVAL :days DAY), INET6_ATON(:ip), :user_agent)'
        )->execute([
            'organization_id' => $organizationId,
            'user_id'         => $userId,
            'token_hash'      => self::hash($token),
            'days'            => $days,
            'ip'              => $_SERVER['REMOTE_ADDR'] ?? null,
            'user_agent'      => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
        ]);

        return $token;
    }

    /**
     * Vérifie un jeton de rafraîchissement présenté par le client.
     *
     * @return array{id:int, user_id:int, organization_id:int}|null
     */
    public static function readRefreshToken(string $token): ?array
    {
        $statement = Database::connection()->prepare(
            'SELECT id, user_id, organization_id
               FROM refresh_tokens
              WHERE token_hash = :token_hash
                AND revoked_at IS NULL
                AND expires_at > NOW()'
        );

        $statement->execute(['token_hash' => self::hash($token)]);

        $row = $statement->fetch();

        if ($row === false) {
            return null;
        }

        return [
            'id'              => (int) $row['id'],
            'user_id'         => (int) $row['user_id'],
            'organization_id' => (int) $row['organization_id'],
        ];
    }

    /**
     * Retrouve un jeton de rafraîchissement SANS filtrer sur son état.
     *
     * ==================================================================
     * SERT À DÉTECTER UN REJEU (audit du lot 21).
     * ==================================================================
     * `readRefreshToken()` ignore volontairement les jetons révoqués :
     * c'est ce qui fait qu'un jeton ne sert qu'une fois. Mais il ne
     * distingue pas « ce jeton n'a jamais existé » de « ce jeton a
     * déjà servi ».
     *
     * Or les deux ne disent pas la même chose. Un jeton inconnu est
     * du bruit. Un jeton DÉJÀ CONSOMMÉ qui revient est un signal :
     * quelqu'un présente une copie. Le propriétaire légitime, lui, a
     * reçu le jeton suivant lors de la rotation.
     *
     * @return array{id:int, user_id:int, revoked:bool}|null
     */
    public static function findAnyRefreshToken(string $token): ?array
    {
        $statement = Database::connection()->prepare(
            'SELECT id, user_id, revoked_at
               FROM refresh_tokens
              WHERE token_hash = :token_hash'
        );

        $statement->execute(['token_hash' => self::hash($token)]);

        $row = $statement->fetch();

        if ($row === false) {
            return null;
        }

        return [
            'id'      => (int) $row['id'],
            'user_id' => (int) $row['user_id'],
            'revoked' => $row['revoked_at'] !== null,
        ];
    }

    public static function revokeRefreshToken(int $tokenId): void
    {
        Database::connection()
            ->prepare('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = :id')
            ->execute(['id' => $tokenId]);
    }

    /**
     * Révoque TOUTES les sessions d'un utilisateur.
     * Utilisé après un changement de mot de passe : si quelqu'un
     * s'était introduit, il perd immédiatement l'accès.
     */
    public static function revokeAllForUser(int $userId): void
    {
        Database::connection()
            ->prepare('UPDATE refresh_tokens SET revoked_at = NOW()
                        WHERE user_id = :user_id AND revoked_at IS NULL')
            ->execute(['user_id' => $userId]);
    }

    // ==================================================================
    // OUTILS
    // ==================================================================

    /**
     * Empreinte d'un jeton. SHA-256 simple et non password_hash() :
     * un jeton de 32 octets aléatoires n'a pas besoin d'un hachage
     * lent — il n'y a rien à deviner par force brute, contrairement à
     * un mot de passe choisi par un humain. Et la vérification a lieu
     * à chaque rafraîchissement : elle doit rester rapide.
     */
    private static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    private static function secret(): string
    {
        $secret = Env::get('JWT_SECRET', '') ?? '';

        // Un secret vide ou trop court rendrait toutes les signatures
        // devinables. On refuse de démarrer plutôt que de donner une
        // fausse impression de sécurité.
        if (mb_strlen($secret) < 32) {
            throw new \RuntimeException(
                'JWT_SECRET est absent ou trop court dans le fichier .env. '
                . 'Génère-le avec : php -r "echo bin2hex(random_bytes(32));"'
            );
        }

        return $secret;
    }
}
