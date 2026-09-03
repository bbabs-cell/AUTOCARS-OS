<?php

declare(strict_types=1);

/**
 * Le parcours d'un véhicule, de l'arrivée à la restitution
 * ------------------------------------------------------------------
 * LA MACHINE À ÉTATS DU PRODUIT.
 *
 * Une opération ne change pas de statut librement. Elle suit un
 * chemin, et ce fichier décrit ce chemin — une seule fois, à un seul
 * endroit.
 *
 * POURQUOI PAS DE simples `if` DANS LE CONTRÔLEUR ?
 * Parce que les règles de passage seront lues par trois endroits
 * différents : l'API qui les applique, le Kanban qui grise les
 * colonnes interdites, et les tests qui les vérifient. Trois copies
 * d'une même règle finissent toujours par diverger. Ici, le
 * contrôleur, le frontend (qui reçoit `allowed_transitions`) et les
 * tests lisent la MÊME table.
 *
 * ------------------------------------------------------------------
 * LES TROIS RÈGLES MÉTIER VALIDÉES
 *
 * 1. L'INSPECTION D'ENTRÉE EST OBLIGATOIRE.
 *    Il n'existe aucune transition IN_PROGRESS → WASHING. Pour laver,
 *    il faut être passé par INSPECTION. C'est la protection contre le
 *    litige « cette rayure y était-elle avant ? » : sans état constaté
 *    à l'arrivée, la station perd systématiquement l'arbitrage.
 *
 * 2. LE CONTRÔLE QUALITÉ EST OBLIGATOIRE.
 *    WASHING ne mène qu'à QUALITY_CHECK. Et QUALITY_CHECK peut
 *    RENVOYER vers WASHING : c'est tout l'intérêt du contrôle. Un
 *    contrôle qui ne peut que valider n'est pas un contrôle.
 *
 * 3. LA RESTITUTION EXIGE UN PAIEMENT.
 *    READY → COMPLETED n'est permis que si l'opération est réglée, ou
 *    si un responsable lève explicitement le blocage — et cette levée
 *    est tracée nominativement dans le journal d'audit.
 *
 * ------------------------------------------------------------------
 * POURQUOI L'ANNULATION EST-ELLE PARTOUT ?
 * Parce que la réalité l'impose. Un client peut repartir à n'importe
 * quel moment : sa voiture est déjà savonnée mais il est pressé,
 * il a un imprévu, il n'est finalement pas d'accord sur le prix.
 * Un logiciel qui refuse d'annuler oblige à mentir sur les statuts —
 * et des données fausses valent moins que pas de données du tout.
 */

return [

    /**
     * Depuis chaque statut, les statuts atteignables.
     * Un tableau vide = état final, l'opération est close.
     */
    'transitions' => [
        'WAITING'       => ['IN_PROGRESS', 'CANCELLED'],
        'IN_PROGRESS'   => ['INSPECTION', 'CANCELLED'],
        'INSPECTION'    => ['WASHING', 'CANCELLED'],
        'WASHING'       => ['QUALITY_CHECK', 'CANCELLED'],
        // Retour en arrière volontaire : le contrôle a échoué.
        'QUALITY_CHECK' => ['READY', 'WASHING', 'CANCELLED'],
        'READY'         => ['COMPLETED', 'CANCELLED'],
        'COMPLETED'     => [],
        'CANCELLED'     => [],
    ],

    /**
     * Libellés affichés. Écrits comme un employé les dirait à
     * l'oral, pas comme un développeur nomme une constante.
     */
    'labels' => [
        'WAITING'       => 'En attente',
        'IN_PROGRESS'   => 'Pris en charge',
        'INSPECTION'    => 'Inspection en cours',
        'WASHING'       => 'Lavage en cours',
        'QUALITY_CHECK' => 'Contrôle qualité',
        'READY'         => 'Prêt à restituer',
        'COMPLETED'     => 'Restitué',
        'CANCELLED'     => 'Annulé',
    ],

    /**
     * Conditions supplémentaires, au-delà du simple enchaînement.
     *
     * Ces règles ne sont PAS exprimables par la table des transitions :
     * elles dépendent de données extérieures à l'opération (une
     * inspection existe-t-elle ? un paiement a-t-il été encaissé ?).
     * Elles sont donc déclarées ici et appliquées par
     * OperationStatus::guard().
     */
    'guards' => [
        // Passer de INSPECTION à WASHING suppose que l'inspection a
        // réellement été enregistrée. Sans cette règle, un employé
        // pressé cliquerait deux fois et sauterait l'étape en gardant
        // les apparences d'un parcours conforme.
        'INSPECTION:WASHING'   => 'entry_inspection_recorded',

        // La règle la plus sensible du produit : on ne rend pas un
        // véhicule impayé.
        'READY:COMPLETED'      => 'payment_settled',
    ],

    /**
     * Jalons horodatés au passage dans certains statuts.
     * Les stocker évite de reconstituer les durées en relisant tout
     * le journal d'audit à chaque affichage du tableau de bord.
     */
    'timestamps' => [
        'IN_PROGRESS' => 'started_at',
        'READY'       => 'completed_at',
        'COMPLETED'   => 'released_at',
    ],

    /**
     * Statuts considérés comme « dans la file ».
     * Sert au comptage du tableau de bord et au Kanban (lot 8).
     */
    'active' => ['WAITING', 'IN_PROGRESS', 'INSPECTION', 'WASHING', 'QUALITY_CHECK', 'READY'],

    /**
     * Les colonnes du tableau de la file d'attente.
     * ------------------------------------------------------------------
     * POURQUOI CINQ COLONNES ALORS QU'IL Y A SIX STATUTS ACTIFS ?
     *
     * Parce que IN_PROGRESS ne dure que quelques secondes dans la
     * réalité : l'employé prend le véhicule en charge et enchaîne
     * aussitôt sur l'inspection. Lui donner sa propre colonne, c'est
     * réserver un sixième de l'écran à une case vide en permanence —
     * et voler cette place aux colonnes qu'on regarde vraiment.
     *
     * Sur le tableau, « pris en charge » et « inspection en cours »
     * veulent dire la même chose pour celui qui regarde : quelqu'un
     * s'en occupe, le lavage n'a pas commencé.
     *
     * ATTENTION : ce regroupement est un choix d'AFFICHAGE. Les deux
     * statuts restent distincts en base et dans la machine à états —
     * c'est ce qui permet d'exiger l'inspection avant le lavage.
     * On regroupe ce qu'on montre, jamais ce qu'on enregistre.
     *
     * `drop` est le statut appliqué quand on dépose une carte dans la
     * colonne. Pour un regroupement, c'est l'entrée du groupe.
     */
    'board' => [
        ['label' => 'En attente',    'drop' => 'WAITING',       'statuses' => ['WAITING']],
        ['label' => 'Inspection',    'drop' => 'INSPECTION',    'statuses' => ['IN_PROGRESS', 'INSPECTION']],
        ['label' => 'Lavage',        'drop' => 'WASHING',       'statuses' => ['WASHING']],
        ['label' => 'Contrôle',      'drop' => 'QUALITY_CHECK', 'statuses' => ['QUALITY_CHECK']],
        ['label' => 'Prêts',         'drop' => 'READY',         'statuses' => ['READY']],
    ],

    /**
     * Au bout de combien de minutes une étape mérite-t-elle un
     * coup d'œil ?
     * ------------------------------------------------------------------
     * CE QUI REND LA FILE D'ATTENTE UTILE.
     *
     * « 6 véhicules en lavage » ne dit rien d'actionnable. « Cette
     * voiture est en lavage depuis 1 h 40 » déclenche une action.
     * Ces seuils sont ce qui transforme un état en alerte.
     *
     * `null` signifie « s'appuyer sur la durée annoncée de la
     * prestation ». C'est le cas du lavage : dépasser de moitié une
     * prestation vendue 30 minutes n'a pas le même sens que dépasser
     * de moitié un detailing vendu 3 heures. Un seuil fixe serait
     * absurde pour l'un ou pour l'autre.
     *
     * CES VALEURS SONT DES POINTS DE DÉPART, PAS DES VÉRITÉS.
     * Elles viennent du bon sens, pas de mesures : aucune station ne
     * tourne encore avec le produit. Elles seront réglées sur des
     * durées réelles au test terrain — et elles vivent ici, dans un
     * seul fichier, précisément pour que ce réglage prenne une minute.
     */
    'alerts' => [
        // Un client qui attend plus de 20 minutes sans que personne
        // ne prenne sa voiture commence à se demander s'il a été vu.
        'WAITING'       => 20,
        'IN_PROGRESS'   => 15,
        'INSPECTION'    => 15,
        // Durée de la prestation : c'est ce qui a été annoncé au client.
        'WASHING'       => null,
        'QUALITY_CHECK' => 10,
        // Le véhicule est prêt et personne ne vient : c'est au comptoir
        // de rappeler, pas au client de deviner.
        'READY'         => 45,
    ],
];
