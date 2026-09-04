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
use Autocare\Http\Controllers\CustomerController;
use Autocare\Http\Controllers\HealthController;
use Autocare\Http\Controllers\InspectionController;
use Autocare\Http\Controllers\OnboardingController;
use Autocare\Http\Controllers\CashController;
use Autocare\Http\Controllers\DashboardController;
use Autocare\Http\Controllers\OperationController;
use Autocare\Http\Controllers\PaymentController;
use Autocare\Http\Controllers\QueueController;
use Autocare\Http\Controllers\ServiceController;
use Autocare\Http\Controllers\StationController;
use Autocare\Http\Controllers\TeamController;
use Autocare\Http\Controllers\VehicleController;

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

    // --- Clients ------------------------------------------------------
    // La vérification de doublon est déclarée AVANT /api/customers/{id} :
    // sinon « check-phone » serait interprété comme un identifiant.
    // Le routeur teste les routes dans l'ordre de déclaration.
    $router->get('/api/customers/check-phone', [CustomerController::class, 'checkPhone'],
        ['auth' => true, 'permission' => 'customers.view']);
    $router->get('/api/customers',      [CustomerController::class, 'index'],
        ['auth' => true, 'permission' => 'customers.view']);
    $router->get('/api/customers/{id}', [CustomerController::class, 'show'],
        ['auth' => true, 'permission' => 'customers.view']);
    $router->post('/api/customers',     [CustomerController::class, 'store'],
        ['auth' => true, 'permission' => 'customers.create']);
    $router->put('/api/customers/{id}', [CustomerController::class, 'update'],
        ['auth' => true, 'permission' => 'customers.update']);

    // --- Véhicules ----------------------------------------------------
    $router->get('/api/vehicles',      [VehicleController::class, 'index'],
        ['auth' => true, 'permission' => 'vehicles.view']);
    $router->get('/api/vehicles/{id}', [VehicleController::class, 'show'],
        ['auth' => true, 'permission' => 'vehicles.view']);
    $router->post('/api/vehicles',     [VehicleController::class, 'store'],
        ['auth' => true, 'permission' => 'vehicles.create']);
    $router->put('/api/vehicles/{id}', [VehicleController::class, 'update'],
        ['auth' => true, 'permission' => 'vehicles.update']);

    // --- Opérations ---------------------------------------------------
    // « statuses » est déclaré AVANT « {id} » : les deux motifs ont le
    // même nombre de segments, et le routeur retient le premier qui
    // correspond. Dans l'autre ordre, /api/operations/statuses serait
    // compris comme le dossier d'identifiant « statuses ».
    $router->get('/api/operations/statuses', [OperationController::class, 'statuses'],
        ['auth' => true, 'permission' => 'operations.view']);
    $router->get('/api/operations',      [OperationController::class, 'index'],
        ['auth' => true, 'permission' => 'operations.view']);
    $router->post('/api/operations',     [OperationController::class, 'store'],
        ['auth' => true, 'permission' => 'operations.create']);
    $router->get('/api/operations/{id}', [OperationController::class, 'show'],
        ['auth' => true, 'permission' => 'operations.view']);

    // Le changement de statut a sa propre permission : un employé fait
    // avancer un dossier, mais ne le crée pas forcément.
    $router->put('/api/operations/{id}/status', [OperationController::class, 'changeStatus'],
        ['auth' => true, 'permission' => 'operations.update_status']);

    // La restitution est une action à part, avec sa procédure de
    // vérification. Elle n'emprunte PAS la route de changement de
    // statut : ce serait contourner la liste de contrôle du comptoir.
    $router->get('/api/operations/{id}/release-check', [OperationController::class, 'releaseCheck'],
        ['auth' => true, 'permission' => 'operations.view']);
    $router->post('/api/operations/{id}/release',      [OperationController::class, 'release'],
        ['auth' => true, 'permission' => 'operations.release']);

    // --- Inspections ---------------------------------------------------
    // Une inspection se rattache toujours à un dossier : son URL le dit.
    $router->post('/api/operations/{id}/inspections', [InspectionController::class, 'store'],
        ['auth' => true, 'permission' => 'inspections.create']);
    $router->get('/api/inspections/{id}',             [InspectionController::class, 'show'],
        ['auth' => true, 'permission' => 'inspections.view']);
    $router->post('/api/inspections/{id}/photos',     [InspectionController::class, 'uploadPhoto'],
        ['auth' => true, 'permission' => 'inspections.create']);

    // L'historique des états constatés d'un véhicule : l'écran qu'on
    // ouvre en cas de litige.
    $router->get('/api/vehicles/{id}/inspections', [InspectionController::class, 'forVehicle'],
        ['auth' => true, 'permission' => 'inspections.view']);

    // La seule route de l'API qui renvoie un fichier et non du JSON.
    // Les photos vivant hors du dossier web, c'est le seul chemin qui
    // y mène — et il vérifie les droits avant de servir un octet.
    $router->get('/api/photos/{id}', [InspectionController::class, 'servePhoto'],
        ['auth' => true, 'permission' => 'inspections.view']);

    // --- File d'attente -------------------------------------------------
    // Il n'y a PAS de table `queue` : cette route est une lecture des
    // opérations actives, groupées et triées. Une table séparée
    // dupliquerait l'état et finirait par diverger.
    $router->get('/api/queue', [QueueController::class, 'index'],
        ['auth' => true, 'permission' => 'operations.view']);

    // Réorganiser une file où des gens attendent déjà fait reculer
    // quelqu'un : c'est une décision de responsable, pas un geste de
    // comptoir. D'où deux permissions que l'employé n'a pas.
    $router->put('/api/operations/{id}/priority', [QueueController::class, 'prioritize'],
        ['auth' => true, 'permission' => 'operations.prioritize']);
    $router->put('/api/operations/{id}/assign',   [QueueController::class, 'assign'],
        ['auth' => true, 'permission' => 'operations.assign']);

    // --- Encaissements ----------------------------------------------
    // AUCUN FOURNISSEUR DE PAIEMENT N'EST INTÉGRÉ. Ces routes
    // enregistrent ce que le caissier déclare avoir reçu ; elles
    // n'appellent ni Wave, ni Orange Money, ni aucune passerelle.
    //
    // Un employé au comptoir ENCAISSE (payments.create) et voit ce qui
    // a déjà été réglé sur le dossier qu'il rend (payments.view). Il
    // ne consulte PAS la recette de la journée (payments.journal) et
    // ne rembourse pas (payments.refund) : rendre de l'argent n'est
    // pas une décision de comptoir.
    $router->post('/api/operations/{id}/payments', [PaymentController::class, 'store'],
        ['auth' => true, 'permission' => 'payments.create']);
    $router->get('/api/operations/{id}/payments',  [PaymentController::class, 'forOperation'],
        ['auth' => true, 'permission' => 'payments.view']);

    $router->get('/api/payments', [PaymentController::class, 'index'],
        ['auth' => true, 'permission' => 'payments.journal']);
    $router->post('/api/payments/{id}/refund', [PaymentController::class, 'refund'],
        ['auth' => true, 'permission' => 'payments.refund']);

    // --- Caisse -------------------------------------------------------
    // Le tiroir-caisse appartient à la station, pas à une personne :
    // deux employés qui se relaient travaillent sur la même session.
    $router->get('/api/cash/current',   [CashController::class, 'current'],
        ['auth' => true, 'permission' => 'cash.view']);
    $router->get('/api/cash/sessions',  [CashController::class, 'history'],
        ['auth' => true, 'permission' => 'cash.view']);
    $router->post('/api/cash/open',     [CashController::class, 'open'],
        ['auth' => true, 'permission' => 'cash.open']);
    $router->post('/api/cash/close',    [CashController::class, 'close'],
        ['auth' => true, 'permission' => 'cash.close']);

    // --- Tableau de bord ----------------------------------------------
    // Tous les rôles peuvent l'ouvrir (dashboard.view). Le CONTENU
    // dépend en revanche des droits : les blocs financiers ne sont pas
    // masqués par l'interface, ils ne sont pas envoyés. Masquer un
    // bloc dans Angular ne protégerait rien — l'onglet réseau du
    // navigateur montre ce que le serveur a répondu.
    $router->get('/api/dashboard', [DashboardController::class, 'index'],
        ['auth' => true, 'permission' => 'dashboard.view']);

    // --- Les routes suivantes arriveront aux prochains lots --------
    // Lot 12 : /api/employees   ·   Lot 13 : /api/bookings
};
