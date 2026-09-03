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
use Autocare\Http\Controllers\OnboardingController;
use Autocare\Http\Controllers\ServiceController;
use Autocare\Http\Controllers\StationController;
use Autocare\Http\Controllers\TeamController;

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

    // --- Installation guidée ----------------------------------------
    $router->get('/api/onboarding/status',    [OnboardingController::class, 'status'],
        ['auth' => true, 'permission' => 'onboarding.view']);
    $router->post('/api/onboarding/complete', [OnboardingController::class, 'complete'],
        ['auth' => true, 'permission' => 'stations.update']);

    // --- Stations ----------------------------------------------------
    $router->get('/api/stations',      [StationController::class, 'index'],
        ['auth' => true, 'permission' => 'stations.view']);
    $router->get('/api/stations/{id}', [StationController::class, 'show'],
        ['auth' => true, 'permission' => 'stations.view']);
    $router->put('/api/stations/{id}', [StationController::class, 'update'],
        ['auth' => true, 'permission' => 'stations.update']);

    // --- Prestations --------------------------------------------------
    // Un employé peut LIRE le catalogue (il doit savoir ce qu'il fait
    // sur un véhicule) mais pas le modifier.
    $router->get('/api/services',      [ServiceController::class, 'index'],
        ['auth' => true, 'permission' => 'services.view']);
    $router->get('/api/services/{id}', [ServiceController::class, 'show'],
        ['auth' => true, 'permission' => 'services.view']);
    $router->post('/api/services',     [ServiceController::class, 'store'],
        ['auth' => true, 'permission' => 'services.create']);
    $router->put('/api/services/{id}', [ServiceController::class, 'update'],
        ['auth' => true, 'permission' => 'services.update']);
    $router->put('/api/services/{id}/status', [ServiceController::class, 'toggleStatus'],
        ['auth' => true, 'permission' => 'services.update']);

    // --- Équipe -------------------------------------------------------
    $router->get('/api/team',  [TeamController::class, 'index'],
        ['auth' => true, 'permission' => 'employees.view']);
    $router->post('/api/team', [TeamController::class, 'store'],
        ['auth' => true, 'permission' => 'employees.create']);

    // --- Les routes suivantes arriveront aux prochains lots --------
    // Lot 6 : /api/customers, /api/vehicles
    // Lot 7 : /api/inspections
    // Lot 8 : /api/operations, /api/queue
    // Lot 9 : /api/payments
};
