<?php

declare(strict_types=1);

/**
 * ==================================================================
 * AUTOCARE OS — POINT D'ENTREE UNIQUE DE L'API
 * ==================================================================
 *
 * C'EST LE SEUL FICHIER PHP ACCESSIBLE DEPUIS INTERNET.
 *
 * Tout le reste du code se trouve dans backend/src/, en dehors du
 * dossier public/. Un visiteur ne peut donc pas appeler directement
 * un controleur ou lire un fichier de configuration : il DOIT passer
 * par ici. C'est ce qu'on appelle le "front controller".
 *
 * Pourquoi c'est important pour la securite ?
 * Parce que toutes les protections (en-tetes, authentification,
 * permissions, gestion d'erreurs) sont appliquees a un seul endroit.
 * Il devient impossible d'"oublier" une protection sur une page.
 *
 * Ce que fait ce fichier, dans l'ordre :
 *   1. charge l'autoloader et la configuration (.env)
 *   2. pose les en-tetes de securite
 *   3. autorise le frontend Angular a nous appeler (CORS)
 *   4. construit la requete et la confie au routeur
 *   5. attrape toute erreur imprevue pour ne rien divulguer
 */

use Autocare\Core\Env;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Router;

// ------------------------------------------------------------------
// 1. CHARGEMENT
// ------------------------------------------------------------------

$projectRoot = dirname(__DIR__);

require_once $projectRoot . '/vendor/autoload.php';

// Toutes les dates sont manipulees en UTC cote serveur.
// L'affichage en heure locale (Africa/Dakar) est le travail du
// frontend. Regle classique : stocker en UTC, afficher en local.
date_default_timezone_set('UTC');

try {
    Env::load($projectRoot . '/.env');
} catch (Throwable $exception) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => $exception->getMessage(),
        'errors'  => (object) [],
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$isDebug = Env::bool('APP_DEBUG', false);

// En developpement on veut voir les erreurs a l'ecran.
// En production on ne les affiche JAMAIS (elles reveleraient des
// chemins de fichiers et des details d'implementation) : on les
// enregistre dans un journal.
ini_set('display_errors', $isDebug ? '1' : '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

// ------------------------------------------------------------------
// 2. EN-TETES DE SECURITE
// ------------------------------------------------------------------

// Empeche le navigateur de "deviner" le type d'un fichier.
// Sans cet en-tete, un fichier envoye par un utilisateur pourrait
// etre interprete comme du HTML, donc executer du JavaScript.
header('X-Content-Type-Options: nosniff');

// Interdit l'affichage de l'API dans une iframe (protection
// contre le clickjacking).
header('X-Frame-Options: DENY');

// Limite les informations envoyees aux sites tiers.
header('Referrer-Policy: no-referrer');

// PHP annonce sa version par defaut dans l'en-tete X-Powered-By.
// Autant ne pas offrir cette information a un attaquant.
header_remove('X-Powered-By');

// ------------------------------------------------------------------
// AUCUNE REPONSE DE L'API NE SE MET EN CACHE (audit du lot 21)
// ------------------------------------------------------------------
// TROUVE PAR L'AUDIT : les reponses authentifiees ne portaient aucun
// en-tete de cache. La liste des clients, la recette du jour, le
// registre de pointage restaient donc dans le cache disque du
// navigateur — sur le poste PARTAGE d'un comptoir, l'employe suivant
// pouvait les retrouver apres deconnexion, et un mandataire
// intermediaire avait le droit de les garder aussi.
//
// « no-store » est plus fort que « no-cache » : no-cache autorise a
// garder la reponse a condition de la revalider, no-store interdit de
// l'ecrire. Pour des donnees d'entreprise, c'est le bon choix.
//
// « Pragma » ne sert qu'aux mandataires HTTP/1.0, qui existent encore
// sur les reseaux d'entreprise anciens. Il ne coute rien.
//
// EXCEPTION : les photos d'inspection posent leurs propres en-tetes
// (Cache-Control: private, max-age=3600) et passent par header()
// directement, apres celui-ci. Une image de 200 ko rechargee a chaque
// affichage d'un dossier couterait cher sur une connexion lente, et
// elle reste dans le navigateur de l'employe, jamais dans un cache
// partage.
header('Cache-Control: no-store');
header('Pragma: no-cache');

// ------------------------------------------------------------------
// 3. CORS — autoriser le frontend Angular
// ------------------------------------------------------------------
//
// En developpement, Angular tourne sur http://localhost:4200 et l'API
// sur http://localhost:8000. Pour le navigateur, ce sont deux origines
// DIFFERENTES : par defaut il bloque les appels entre elles.
// CORS est le mecanisme qui autorise explicitement cette exception.
//
// On n'utilise volontairement PAS "Access-Control-Allow-Origin: *".
// L'etoile autoriserait n'importe quel site a appeler notre API, et
// elle est de toute facon incompatible avec les cookies
// d'authentification que nous utiliserons au Lot 4.

$allowedOrigin = Env::get('APP_FRONTEND_URL', 'http://localhost:4200');
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';

if ($requestOrigin !== '' && $requestOrigin === $allowedOrigin) {
    header('Access-Control-Allow-Origin: ' . $allowedOrigin);
    header('Access-Control-Allow-Credentials: true'); // necessaire au cookie de refresh
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
    header('Vary: Origin');
}

// Avant un POST/PUT/DELETE, le navigateur envoie une requete OPTIONS
// dite "preflight" pour demander la permission. On y repond sans
// executer la moindre logique metier.
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ------------------------------------------------------------------
// 4. ROUTAGE
// ------------------------------------------------------------------

try {
    $router = new Router();

    // config/routes.php retourne une fonction qui remplit le routeur.
    $registerRoutes = require $projectRoot . '/config/routes.php';
    $registerRoutes($router);

    $router->dispatch(Request::fromGlobals());
} catch (Throwable $exception) {

    // ------------------------------------------------------------------
    // 5. FILET DE SECURITE
    // ------------------------------------------------------------------
    //
    // Si une erreur imprevue survient (bug, base injoignable...), on
    // l'enregistre cote serveur et on renvoie un message neutre.
    // Un message d'erreur PHP brut renvoye au client divulguerait
    // les chemins du serveur et la structure du code.

    error_log(sprintf(
        '[AUTOCARE][%s] %s dans %s:%d',
        date('c'),
        $exception->getMessage(),
        $exception->getFile(),
        $exception->getLine()
    ));

    Response::error(
        $isDebug
            ? $exception->getMessage()
            : 'Une erreur interne est survenue. Reessayez plus tard.',
        [],
        500
    );
}
