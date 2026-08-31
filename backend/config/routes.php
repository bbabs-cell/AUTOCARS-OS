<?php

declare(strict_types=1);

/**
 * Table des routes de l'API
 * ------------------------------------------------------------------
 * Toutes les URL de l'API sont declarees ICI, et nulle part ailleurs.
 * Un seul fichier a ouvrir pour repondre a la question :
 * "quelles sont les URL disponibles ?"
 *
 * Convention adoptee (voir docs/api.md) :
 *   - toutes les routes commencent par /api
 *   - noms de ressources au pluriel : /api/vehicles, pas /api/vehicle
 *   - le verbe HTTP porte l'action, pas l'URL :
 *       GET    /api/vehicles      -> lister
 *       POST   /api/vehicles      -> creer
 *       GET    /api/vehicles/{id} -> consulter
 *       PUT    /api/vehicles/{id} -> modifier
 *       DELETE /api/vehicles/{id} -> supprimer
 *     On n'ecrit donc jamais /api/createVehicle.
 */

use Autocare\Core\Router;
use Autocare\Http\Controllers\HealthController;

return static function (Router $router): void {
    // --- Diagnostic (route publique, sans authentification) -------
    $router->get('/api/health', [HealthController::class, 'index']);

    // --- Les routes suivantes arriveront aux prochains lots -------
    // Lot 4 : /api/auth/register, /api/auth/login, /api/auth/refresh
    // Lot 5 : /api/stations, /api/services
    // Lot 6 : /api/customers, /api/vehicles
};
