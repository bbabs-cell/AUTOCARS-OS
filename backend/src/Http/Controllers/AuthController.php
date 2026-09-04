<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Database;
use Autocare\Core\Env;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Security\Permissions;
use Autocare\Core\Security\TokenService;
use Autocare\Core\Validator;
use Autocare\Models\UserRepository;
use Throwable;

/**
 * Inscription, connexion, session
 * ------------------------------------------------------------------
 * Le contrôleur le plus sensible du produit. Chaque méthode applique
 * les mêmes principes :
 *
 *   - valider tout ce qui entre, sans exception ;
 *   - ne jamais révéler si un compte existe ou non ;
 *   - journaliser les événements d'authentification ;
 *   - ne jamais renvoyer d'information technique en cas d'erreur.
 */
final class AuthController
{
    /** Nom du cookie portant le jeton de rafraîchissement. */
    private const REFRESH_COOKIE = 'autocare_refresh';

    // ==================================================================
    // INSCRIPTION
    // ==================================================================

    /**
     * POST /api/auth/register
     *
     * Crée en une seule transaction :
     *   - l'organisation (l'entreprise cliente)
     *   - sa première station
     *   - l'utilisateur, administrateur de cette station
     *
     * POURQUOI CRÉER UNE STATION DÈS L'INSCRIPTION ?
     * Parce que le rôle d'un utilisateur vit dans station_users : sans
     * station, il n'aurait aucun rôle et ne pourrait rien faire, pas
     * même terminer son installation. On crée donc une station avec un
     * nom provisoire, que l'onboarding (lot 5) complétera.
     * Cela évite d'introduire un second système de rôles au niveau de
     * l'organisation, qui compliquerait durablement la sécurité.
     */
    public function register(Request $request): void
    {
        $validator = Validator::make($request->body())
            ->required('organization_name', "Le nom de l'entreprise")->maxLength('organization_name', 150)
            ->required('first_name', 'Le prénom')->maxLength('first_name', 80)
            ->required('last_name', 'Le nom')->maxLength('last_name', 80)
            ->required('email', "L'adresse e-mail")->email('email')->maxLength('email', 190)
            ->required('password', 'Le mot de passe')->password('password')
            ->phone('phone');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $email = mb_strtolower($validator->string('email'));
        $users = new UserRepository();

        if ($users->emailExists($email)) {
            Response::validationFailed([
                'email' => 'Cette adresse e-mail est déjà utilisée.',
            ]);
        }

        $connection = Database::connection();

        // Transaction : les trois insertions forment un tout. Si l'une
        // échoue, on ne veut pas d'une organisation orpheline sans
        // utilisateur, ni d'un utilisateur incapable de se connecter.
        $connection->beginTransaction();

        try {
            $organizationName = $validator->string('organization_name');

            $connection->prepare(
                'INSERT INTO organizations (name, slug, phone, email)
                 VALUES (:name, :slug, :phone, :email)'
            )->execute([
                'name'  => $organizationName,
                'slug'  => $this->makeUniqueSlug($organizationName),
                'phone' => $validator->stringOrNull('phone'),
                'email' => $email,
            ]);

            $organizationId = (int) $connection->lastInsertId();

            $connection->prepare(
                "INSERT INTO stations (organization_id, name, code, city)
                 VALUES (:organization_id, 'Station principale', 'ST1', NULL)"
            )->execute(['organization_id' => $organizationId]);

            $stationId = (int) $connection->lastInsertId();

            $connection->prepare(
                'INSERT INTO users
                    (organization_id, first_name, last_name, email, phone, password_hash)
                 VALUES
                    (:organization_id, :first_name, :last_name, :email, :phone, :password_hash)'
            )->execute([
                'organization_id' => $organizationId,
                'first_name'      => $validator->string('first_name'),
                'last_name'       => $validator->string('last_name'),
                'email'           => $email,
                'phone'           => $validator->stringOrNull('phone'),
                // PASSWORD_DEFAULT suit les recommandations de PHP et
                // évoluera avec les versions : on ne fige pas
                // l'algorithme dans le code.
                'password_hash'   => password_hash($validator->string('password'), PASSWORD_DEFAULT),
            ]);

            $userId = (int) $connection->lastInsertId();

            $connection->prepare(
                "INSERT INTO station_users (organization_id, station_id, user_id, role)
                 VALUES (:organization_id, :station_id, :user_id, 'ADMIN')"
            )->execute([
                'organization_id' => $organizationId,
                'station_id'      => $stationId,
                'user_id'         => $userId,
            ]);

            $connection->commit();
        } catch (Throwable $exception) {
            $connection->rollBack();

            error_log('[AUTOCARE][REGISTER] ' . $exception->getMessage());

            Response::error("La création du compte a échoué. Réessayez.", [], 500);
        }

        AuditLogger::record(
            action: 'auth.registered',
            organizationId: $organizationId,
            userId: $userId,
            metadata: ['email' => $email],
        );

        $this->respondWithSession($userId, $organizationId, 'Compte créé.', 201);
    }

    // ==================================================================
    // CONNEXION
    // ==================================================================

    /** POST /api/auth/login */
    public function login(Request $request): void
    {
        $validator = Validator::make($request->body())
            ->required('email', "L'adresse e-mail")
            ->required('password', 'Le mot de passe');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $email = mb_strtolower($validator->string('email'));

        // --- Limitation des tentatives -----------------------------
        // Sans ce garde-fou, rien n'empêche d'essayer des milliers de
        // mots de passe. On s'appuie sur le journal d'audit déjà en
        // place plutôt que d'ajouter une table.
        if (AuditLogger::countRecent('auth.login_failed', $email, 15) >= 5) {
            AuditLogger::record('auth.login_blocked', metadata: ['email' => $email]);

            Response::error(
                'Trop de tentatives de connexion. Réessayez dans quinze minutes.',
                [],
                429
            );
        }

        $users = new UserRepository();
        $user  = $users->findByEmail($email);

        $passwordIsValid = $user !== null
            && password_verify($validator->string('password'), (string) $user['password_hash']);

        if (!$passwordIsValid) {
            AuditLogger::record('auth.login_failed', metadata: ['email' => $email]);

            // MESSAGE VOLONTAIREMENT VAGUE.
            // Dire « cet e-mail n'existe pas » permettrait de
            // découvrir quels comptes existent — première étape d'une
            // attaque ciblée.
            Response::unauthorized('Adresse e-mail ou mot de passe incorrect.');
        }

        if ($user['status'] !== 'ACTIVE') {
            AuditLogger::record(
                'auth.login_disabled',
                organizationId: (int) $user['organization_id'],
                userId: (int) $user['id'],
            );

            Response::forbidden('Ce compte est désactivé. Contactez votre administrateur.');
        }

        // Si PHP recommande désormais un algorithme plus solide, on en
        // profite : l'utilisateur vient de fournir son mot de passe en
        // clair, c'est le seul moment où le rehachage est possible.
        if (password_needs_rehash((string) $user['password_hash'], PASSWORD_DEFAULT)) {
            $users->updatePassword(
                (int) $user['id'],
                password_hash($validator->string('password'), PASSWORD_DEFAULT)
            );
        }

        $users->touchLastLogin((int) $user['id']);

        AuditLogger::record(
            action: 'auth.login',
            organizationId: (int) $user['organization_id'],
            userId: (int) $user['id'],
        );

        $this->respondWithSession(
            (int) $user['id'],
            (int) $user['organization_id'],
            'Connexion réussie.'
        );
    }

    // ==================================================================
    // SESSION
    // ==================================================================

    /**
     * POST /api/auth/refresh
     *
     * Le jeton de rafraîchissement arrive par le cookie httpOnly, pas
     * dans le corps de la requête : le JavaScript de la page n'y a
     * jamais accès, même en cas de faille XSS.
     */
    public function refresh(Request $request): void
    {
        $token = $_COOKIE[self::REFRESH_COOKIE] ?? '';

        if (!is_string($token) || $token === '') {
            Response::unauthorized('Session absente.');
        }

        $stored = TokenService::readRefreshToken($token);

        if ($stored === null) {
            $this->clearRefreshCookie();
            Response::unauthorized('Session expirée. Reconnectez-vous.');
        }

        // ROTATION : l'ancien jeton est révoqué immédiatement. Un
        // jeton ne sert donc qu'une fois. S'il réapparaît plus tard,
        // c'est qu'il a été volé — et il ne fonctionnera plus.
        TokenService::revokeRefreshToken($stored['id']);

        $this->respondWithSession(
            $stored['user_id'],
            $stored['organization_id'],
            'Session renouvelée.'
        );
    }

    /** POST /api/auth/logout */
    public function logout(Request $request): void
    {
        $token = $_COOKIE[self::REFRESH_COOKIE] ?? '';

        if (is_string($token) && $token !== '') {
            $stored = TokenService::readRefreshToken($token);

            if ($stored !== null) {
                TokenService::revokeRefreshToken($stored['id']);

                AuditLogger::record(
                    action: 'auth.logout',
                    organizationId: $stored['organization_id'],
                    userId: $stored['user_id'],
                );
            }
        }

        $this->clearRefreshCookie();

        Response::success(null, 'Déconnexion effectuée.');
    }

    /** GET /api/auth/me — route protégée */
    public function me(Request $request): void
    {
        $user = AuthContext::current();

        Response::success([
            'id'              => $user->userId,
            'organization_id' => $user->organizationId,
            'email'           => $user->email,
            'full_name'       => $user->fullName,
            'role'            => $user->role,
            'station_ids'     => $user->stationIds,
            // Les droits du rôle, pour que l'interface n'affiche pas
            // de menu menant à un « accès refusé ». Confort
            // d'affichage : la protection reste côté serveur.
            'permissions'     => Permissions::grantedTo($user->role),
            'onboarding_completed' => (new UserRepository())
                ->onboardingCompleted($user->organizationId),
        ]);
    }

    // ==================================================================
    // MOT DE PASSE OUBLIÉ
    // ==================================================================

    /**
     * POST /api/auth/forgot-password
     *
     * L'envoi d'e-mail n'est PAS implémenté : aucun serveur SMTP n'est
     * configuré, et on ne simule pas une intégration qui n'existe pas.
     * Le lien est journalisé côté serveur, et renvoyé dans la réponse
     * uniquement en développement (APP_DEBUG=true) pour permettre de
     * tester le parcours de bout en bout.
     * L'envoi réel arrivera au lot 15, avec une vraie configuration.
     */
    public function forgotPassword(Request $request): void
    {
        $validator = Validator::make($request->body())
            ->required('email', "L'adresse e-mail")->email('email');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $email = mb_strtolower($validator->string('email'));
        $user  = (new UserRepository())->findByEmail($email);

        $debugLink = null;

        if ($user !== null && $user['status'] === 'ACTIVE') {
            $token = bin2hex(random_bytes(32));

            Database::connection()->prepare(
                'INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip)
                 VALUES (:user_id, :token_hash, (NOW() + INTERVAL 1 HOUR), INET6_ATON(:ip))'
            )->execute([
                'user_id'    => (int) $user['id'],
                'token_hash' => hash('sha256', $token),
                'ip'         => $_SERVER['REMOTE_ADDR'] ?? null,
            ]);

            $link = rtrim((string) Env::get('APP_FRONTEND_URL', ''), '/')
                . '/reset-password?token=' . $token;

            error_log("[AUTOCARE][RESET] Lien pour {$email} : {$link}");

            AuditLogger::record(
                action: 'auth.password_reset_requested',
                organizationId: (int) $user['organization_id'],
                userId: (int) $user['id'],
            );

            if (Env::bool('APP_DEBUG', false)) {
                $debugLink = $link;
            }
        }

        // LA MÊME RÉPONSE DANS TOUS LES CAS, que le compte existe ou
        // non. Sinon ce formulaire deviendrait un moyen commode de
        // découvrir quelles adresses sont enregistrées.
        Response::success(
            $debugLink === null ? null : ['debug_reset_link' => $debugLink],
            'Si un compte existe pour cette adresse, un lien de réinitialisation a été envoyé.'
        );
    }

    /** POST /api/auth/reset-password */
    public function resetPassword(Request $request): void
    {
        $validator = Validator::make($request->body())
            ->required('token', 'Le jeton')
            ->required('password', 'Le mot de passe')->password('password');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $connection = Database::connection();

        $statement = $connection->prepare(
            'SELECT id, user_id FROM password_resets
              WHERE token_hash = :token_hash
                AND used_at IS NULL
                AND expires_at > NOW()'
        );

        $statement->execute(['token_hash' => hash('sha256', $validator->string('token'))]);

        $reset = $statement->fetch();

        if ($reset === false) {
            Response::error('Ce lien est invalide ou a expiré.', [], 400);
        }

        $userId = (int) $reset['user_id'];

        (new UserRepository())->updatePassword(
            $userId,
            password_hash($validator->string('password'), PASSWORD_DEFAULT)
        );

        $connection
            ->prepare('UPDATE password_resets SET used_at = NOW() WHERE id = :id')
            ->execute(['id' => (int) $reset['id']]);

        // Toutes les sessions ouvertes sont fermées. Si quelqu'un
        // s'était introduit dans le compte, il perd l'accès à
        // l'instant même où le mot de passe change.
        TokenService::revokeAllForUser($userId);

        AuditLogger::record('auth.password_reset', userId: $userId);

        Response::success(null, 'Mot de passe modifié. Vous pouvez vous connecter.');
    }

    // ==================================================================
    // OUTILS INTERNES
    // ==================================================================

    /**
     * Émet un jeton d'accès, pose le cookie de rafraîchissement et
     * renvoie le profil.
     */
    private function respondWithSession(
        int $userId,
        int $organizationId,
        string $message,
        int $status = 200,
    ): void {
        $accessToken  = TokenService::issueAccessToken($userId, $organizationId);
        $refreshToken = TokenService::issueRefreshToken($userId, $organizationId);

        $this->setRefreshCookie($refreshToken);

        $users      = new UserRepository();
        $user       = $users->findById($userId);
        $membership = $users->membership($userId);

        Response::success([
            'access_token' => $accessToken,
            // Durée en secondes : Angular saura quand rafraîchir.
            'expires_in'   => (int) (Env::get('JWT_ACCESS_TTL_MINUTES', '30') ?? '30') * 60,
            'user'         => [
                'id'              => $userId,
                'organization_id' => $organizationId,
                'email'           => $user['email'] ?? '',
                'full_name'       => trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')),
                'role'            => $membership['role'],
                'station_ids'     => $membership['station_ids'],
                'permissions'     => Permissions::grantedTo($membership['role']),
                'onboarding_completed' => $users->onboardingCompleted($organizationId),
            ],
        ], $message, $status);
    }

    private function setRefreshCookie(string $token): void
    {
        $days = (int) (Env::get('JWT_REFRESH_TTL_DAYS', '7') ?? '7');

        setcookie(self::REFRESH_COOKIE, $token, [
            'expires'  => time() + $days * 86400,

            // Limité aux routes d'authentification : le cookie n'est
            // même pas envoyé sur les autres appels, réduisant sa
            // surface d'exposition.
            'path'     => '/api/auth',

            // INVISIBLE AU JAVASCRIPT. C'est tout l'intérêt : même une
            // faille XSS ne permet pas de le lire ni de l'exfiltrer.
            'httponly' => true,

            // Le cookie n'est pas envoyé lors d'une navigation venant
            // d'un autre site : protection contre le CSRF.
            'samesite' => 'Strict',

            // HTTPS uniquement. Désactivé en développement local, où
            // l'on travaille en http — sinon le navigateur refuserait
            // simplement de poser le cookie.
            'secure'   => Env::get('APP_ENV') !== 'local',
        ]);
    }

    private function clearRefreshCookie(): void
    {
        setcookie(self::REFRESH_COOKIE, '', [
            'expires'  => time() - 3600,
            'path'     => '/api/auth',
            'httponly' => true,
            'samesite' => 'Strict',
            'secure'   => Env::get('APP_ENV') !== 'local',
        ]);
    }

    /**
     * Fabrique un identifiant lisible et unique à partir du nom.
     * « Groupe Diallo Auto » devient « groupe-diallo-auto ».
     */
    private function makeUniqueSlug(string $name): string
    {
        $base = mb_strtolower(trim($name));

        // On retire les accents pour que l'identifiant reste utilisable
        // dans une URL : « Thiès » devient « thies ».
        $base = iconv('UTF-8', 'ASCII//TRANSLIT', $base) ?: $base;
        $base = preg_replace('/[^a-z0-9]+/', '-', $base) ?? '';
        $base = trim($base, '-');

        if ($base === '') {
            $base = 'entreprise';
        }

        $connection = Database::connection();
        $slug       = $base;
        $suffix     = 1;

        // Deux entreprises peuvent porter le même nom : on ajoute un
        // numéro plutôt que de refuser l'inscription.
        while (true) {
            $statement = $connection->prepare('SELECT 1 FROM organizations WHERE slug = :slug');
            $statement->execute(['slug' => $slug]);

            if ($statement->fetchColumn() === false) {
                return $slug;
            }

            $slug = $base . '-' . (++$suffix);
        }
    }
}
