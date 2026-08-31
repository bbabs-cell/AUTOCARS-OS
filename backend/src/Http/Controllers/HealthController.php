<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\Database;
use Autocare\Core\Env;
use Autocare\Core\Request;
use Autocare\Core\Response;

/**
 * Endpoint de diagnostic : GET /api/health
 * ------------------------------------------------------------------
 * POURQUOI CE FICHIER ?
 * C'est le tout premier endpoint du projet, et il a une vraie utilite :
 * repondre a la question "est-ce que mon installation fonctionne ?"
 * sans avoir a deviner.
 *
 * Il verifie trois choses :
 *   1. PHP execute bien le code (si tu vois du JSON, c'est gagne) ;
 *   2. le fichier .env est lu correctement ;
 *   3. la base de donnees repond.
 *
 * Plus tard il servira aussi a la supervision en production
 * (un service externe appelle cette URL toutes les minutes pour
 * verifier que le serveur est vivant).
 *
 * SECURITE : en production (APP_DEBUG=false) on ne divulgue AUCUN
 * detail technique. Annoncer sa version de PHP a tout internet aide
 * les attaquants a cibler les failles connues.
 */
final class HealthController
{
    public function index(Request $request): void
    {
        $isDebug         = Env::bool('APP_DEBUG', false);
        $databaseIsReady = Database::isReachable();

        // Si la base ne repond pas, l'API n'est pas utilisable : on
        // renvoie 503 (Service Unavailable) et non 200. C'est ce code
        // que regardent les outils de supervision ; repondre 200 avec
        // un message "degrade" leur ferait croire que tout va bien.
        if (!$databaseIsReady) {
            Response::error(
                'L\'API repond mais la base de donnees est injoignable.',
                ['database' => 'Connexion impossible. Lance : php tools/check_db.php'],
                503
            );
        }

        $data = [
            'application' => 'AUTOCARE OS API',
            'status'      => 'ok',
            'database'    => 'connected',
            'timestamp'   => gmdate('c'), // date ISO 8601, en UTC
        ];

        // Informations techniques reservees au developpement.
        if ($isDebug) {
            $data['environment']   = Env::get('APP_ENV', 'local');
            $data['php_version']   = PHP_VERSION;
            $data['database_name'] = Env::get('DB_NAME');
        }

        Response::success($data, 'L\'API AUTOCARE OS fonctionne.');
    }
}
