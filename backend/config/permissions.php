<?php

declare(strict_types=1);

/**
 * Matrice des permissions
 * ------------------------------------------------------------------
 * QUI A LE DROIT DE FAIRE QUOI.
 *
 * Ce fichier est la source unique de vérité des droits. Il est
 * volontairement en PHP plutôt qu'en base :
 *   - on le lit d'un coup d'œil, ce qu'une table ne permet pas ;
 *   - il est versionné dans Git, donc toute modification laisse une
 *     trace et peut être relue ;
 *   - il ne coûte aucune requête à chaque vérification.
 *
 * On passera à des tables le jour où un client voudra composer ses
 * propres rôles — pas avant.
 *
 * CONVENTION : « domaine.action ».
 * L'étoile autorise tout un domaine : « vehicles.* » couvre
 * vehicles.view, vehicles.create, vehicles.update, vehicles.delete.
 *
 * RAPPEL FONDAMENTAL
 * Cacher un bouton dans Angular n'est PAS une permission : c'est du
 * confort d'affichage. N'importe qui peut appeler l'API directement
 * avec curl. Toute action sensible est donc vérifiée ICI, côté
 * serveur, à chaque requête.
 */

return [

    /**
     * ADMINISTRATEUR — le propriétaire.
     * Accès complet, sur toutes les stations de son entreprise.
     */
    'ADMIN' => ['*'],

    /**
     * MANAGER — responsable des opérations d'une station.
     *
     * Il gère le quotidien mais ne touche ni aux paramètres de
     * l'entreprise, ni aux comptes utilisateurs, ni à l'abonnement :
     * ce sont des décisions du propriétaire.
     */
    'MANAGER' => [
        'dashboard.view',
        'vehicles.*',
        'customers.*',
        'operations.*',
        'inspections.*',
        'payments.*',
        'cash.*',
        'services.view',
        'employees.view',
        'reports.view',
        'stations.view',
    ],

    /**
     * EMPLOYÉ — celui qui travaille sur les véhicules.
     *
     * Il voit ce dont il a besoin et fait avancer les opérations,
     * mais ne voit NI les prix, NI les paiements, NI les statistiques.
     *
     * Ce n'est pas de la méfiance : c'est le principe du moindre
     * privilège. Un compte employé volé ne doit pas donner accès au
     * chiffre d'affaires de la station.
     */
    'EMPLOYEE' => [
        'dashboard.view',
        'vehicles.view',
        'vehicles.create',
        'customers.view',
        'customers.create',
        'operations.view',
        'operations.update_status',
        'inspections.view',
        'inspections.create',
    ],
];
