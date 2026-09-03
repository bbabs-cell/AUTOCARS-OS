<?php

declare(strict_types=1);

/**
 * Table des routes de l'API
 * ------------------------------------------------------------------
 * Toutes les URL de l'API sont déclarées ICI, et nulle part ailleurs.
 * Un seul fichier à ouvrir pour répondre à deux questions :
 * « quelles URL existent ? » et « lesquelles sont protégées ? »
 *
 * Chaque route déclare ses exigences de sécurité :
 *
 *   (rien)                       → route PUBLIQUE
 *   ['auth' => true]             → connexion requise
 *   ['auth' => true,
 *    'permission' => 'x.y']      → connexion + droit précis
 *
 * Les rendre visibles ici est délibéré : une protection oubliée saute
 * aux yeux à la relecture, alors qu'elle serait invisible si elle
 * était enfouie au fond d'un contrôleur.
 *
 * Conventions (voir docs/api.md) :
 *   - toutes les routes commencent par /api
 *   - ressources au pluriel : /api/vehicles, pas /api/vehicle
 *   - le verbe HTTP porte l'action, pas l'URL :
 *       GET /api/vehicles/{id}   et non   /api/getVehicle
 */

use Autocare\Core\Router;
use Autocare\Http\Controllers\AuthController;
use Autocare\Http\Controllers\HealthController;

return static function (Router $router): void {

    // --- Diagnostic ------------------------------------------------
    $router->get('/api/health', [HealthController::class, 'index']);

    // --- Authentification ------------------------------------------
    // Ces routes sont forcément publiques : on ne peut pas exiger
    // d'être connecté pour se connecter.
    $router->post('/api/auth/register',        [AuthController::class, 'register']);
    $router->post('/api/auth/login',           [AuthController::class, 'login']);
    $router->post('/api/auth/refresh',         [AuthController::class, 'refresh']);
    $router->post('/api/auth/logout',          [AuthController::class, 'logout']);
    $router->post('/api/auth/forgot-password', [AuthController::class, 'forgotPassword']);
    $router->post('/api/auth/reset-password',  [AuthController::class, 'resetPassword']);

    // Profil de l'utilisateur connecté : première route protégée.
    $router->get('/api/auth/me', [AuthController::class, 'me'], ['auth' => true]);

    // --- Les routes suivantes arriveront aux prochains lots --------
    // Lot 5 : /api/stations, /api/services
    // Lot 6 : /api/customers, /api/vehicles
    // Lot 7 : /api/inspections
    // Lot 8 : /api/operations, /api/queue
    // Lot 9 : /api/payments
};
