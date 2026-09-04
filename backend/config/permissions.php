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
        // Un manager ajuste les prix de sa station : c'est une
        // décision d'exploitation quotidienne, pas de structure.
        'services.update',
        'employees.view',
        // Le pointage est de la gestion quotidienne : c'est le
        // responsable de station qui constate les présences et
        // rattrape les oublis, pas le propriétaire depuis Dakar.
        'attendance.*',
        'reports.view',
        'stations.view',
        'onboarding.view',
    ],

    /**
     * EMPLOYÉ — celui qui travaille sur les véhicules.
     *
     * Il voit ce dont il a besoin et fait avancer les opérations,
     * mais ne voit NI le chiffre d'affaires, NI la caisse, NI les
     * statistiques. Il encaisse au comptoir sans consulter la recette
     * de la journée : voir la note sur payments.create plus bas.
     *
     * Ce n'est pas de la méfiance : c'est le principe du moindre
     * privilège. Un compte employé volé ne doit pas donner accès au
     * chiffre d'affaires de la station.
     */
    'EMPLOYEE' => [
        'dashboard.view',
        'vehicles.view',
        'vehicles.create',
        // Corriger une plaque mal saisie fait partie du travail au
        // comptoir. La suppression, elle, reste hors de portée.
        'vehicles.update',
        'customers.view',
        'customers.create',
        'customers.update',

        // ENCAISSER, OUI. CONSULTER LA RECETTE, NON.
        //
        // C'est l'employé qui est au comptoir quand le client sort son
        // téléphone ou son argent. Lui refuser la saisie obligerait à
        // déranger un responsable à chaque véhicule rendu — et un
        // logiciel qu'on doit contourner pour travailler finit par ne
        // plus être utilisé du tout.
        //
        // Il voit donc ce qui est dû et ce qui a été réglé SUR LE
        // DOSSIER QU'IL REND (payments.view), mais pas le journal de
        // la journée (payments.journal), pas la caisse (cash.*), et il
        // ne rembourse pas (payments.refund) : rendre de l'argent
        // n'est pas une décision de comptoir.
        //
        // C'est une PRÉCISION par rapport au lot 4, qui disait « ne
        // voit pas les paiements » sans distinguer l'encaissement du
        // chiffre d'affaires. Pour revenir en arrière, il suffit de
        // retirer ces deux lignes.
        'payments.create',
        'payments.view',

        // CHACUN POINTE POUR SOI.
        // Pointer à la place d'un collègue est le premier
        // détournement d'un registre de présence : l'employé n'a donc
        // que `attendance.clock`, qui n'agit que sur son propre
        // pointage. Consulter le registre de l'équipe
        // (attendance.view) et corriger une heure (attendance.correct)
        // restent au responsable.
        'attendance.clock',

        // L'accueil d'un véhicule au comptoir est le travail de
        // l'employé : lui refuser la création de dossier obligerait à
        // déranger un responsable à chaque arrivée.
        'operations.create',
        'operations.view',
        'operations.update_status',
        // Il ne réorganise PAS la file (operations.prioritize) et ne
        // confie PAS un dossier à un collègue (operations.assign) :
        // faire reculer un client qui attendait déjà, ou répartir le
        // travail de l'équipe, engage la station — c'est au
        // responsable de le décider.
        //
        // Choisir « client pressé » À L'ACCUEIL reste possible : là,
        // l'employé enregistre ce que le client lui dit, il ne
        // réorganise pas une file existante.
        //
        // Il rend les clés — c'est lui qui est au comptoir. La
        // procédure de vérification l'encadre, et la dérogation de
        // paiement (operations.override_payment) reste hors de portée :
        // un employé ne peut pas s'autoriser lui-même à laisser
        // partir un véhicule impayé.
        'operations.release',
        'inspections.view',
        'inspections.create',
        // Un employé consulte le catalogue : il doit savoir ce qu'il
        // fait sur un véhicule — et depuis le lot 9, annoncer le prix
        // au client puis l'encaisser. Ce qui lui reste inaccessible,
        // c'est le cumul : la recette du jour, la caisse, les
        // statistiques.
        'services.view',
    ],
];
