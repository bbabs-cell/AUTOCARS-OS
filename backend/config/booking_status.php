<?php

declare(strict_types=1);

/**
 * Le parcours d'un rendez-vous
 * ------------------------------------------------------------------
 * Même principe qu'au lot 7 pour les opérations : les règles de
 * passage sont écrites UNE FOIS, ici, et lues par le contrôleur qui
 * les applique, par le frontend qui n'affiche que les boutons
 * utilisables, et par les tests qui les vérifient.
 *
 * ------------------------------------------------------------------
 * LES CINQ ÉTATS
 *
 *   SCHEDULED  noté, rien de plus
 *   CONFIRMED  quelqu'un a rappelé, le client a dit oui
 *   ARRIVED    le véhicule est là, un dossier est ouvert
 *   NO_SHOW    l'heure est passée, personne n'est venu
 *   CANCELLED  annulé
 *
 * ------------------------------------------------------------------
 * POURQUOI CONFIRMED N'EST PAS UN LUXE
 *
 * Rappeler la veille est la seule mesure qui réduit vraiment les
 * absences. Encore faut-il savoir QUI reste à rappeler : sans cet
 * état, la liste des appels à passer se refait de tête tous les
 * soirs, et finit par ne plus se faire.
 *
 * C'est le seul état « intermédiaire » du parcours, et il est
 * FACULTATIF : un client peut arriver sans avoir été rappelé.
 *
 * ------------------------------------------------------------------
 * POURQUOI LES TROIS FINS SONT DÉFINITIVES
 *
 * Un rendez-vous manqué qu'on « rouvrirait » ferait disparaître le
 * fait qu'il a été manqué. Si le client rappelle pour reprendre un
 * créneau, c'est un NOUVEAU rendez-vous : les deux lignes racontent
 * alors ce qui s'est réellement passé, ce qu'une ligne modifiée ne
 * saurait pas faire.
 */

return [

    /**
     * Depuis chaque statut, les statuts atteignables.
     * Un tableau vide = état final.
     */
    'transitions' => [
        'SCHEDULED' => ['CONFIRMED', 'ARRIVED', 'NO_SHOW', 'CANCELLED'],
        'CONFIRMED' => ['ARRIVED', 'NO_SHOW', 'CANCELLED'],
        'ARRIVED'   => [],
        'NO_SHOW'   => [],
        'CANCELLED' => [],
    ],

    /** Libellés, écrits comme on les dit au comptoir. */
    'labels' => [
        'SCHEDULED' => 'Prévu',
        'CONFIRMED' => 'Confirmé',
        'ARRIVED'   => 'Arrivé',
        'NO_SHOW'   => 'Absent',
        'CANCELLED' => 'Annulé',
    ],

    /**
     * Les statuts encore « vivants » : ceux qui occupent un créneau et
     * qui restent à traiter.
     */
    'open' => ['SCHEDULED', 'CONFIRMED'],

    /**
     * ==================================================================
     * LES STATUTS QU'ON NE PEUT PAS POSER DIRECTEMENT
     * ==================================================================
     * ARRIVED n'est pas qu'un changement de statut : il OUVRE UN
     * DOSSIER. Le laisser passer par la route générique
     * `PUT /api/bookings/{id}/status` autoriserait une réservation
     * marquée « arrivée » sans opération derrière — un véhicule
     * officiellement pris en charge que personne ne verrait dans la
     * file.
     *
     * Il a donc sa propre route, `POST /api/bookings/{id}/arrive`, qui
     * fait les deux choses ensemble ou aucune des deux.
     *
     * RÈGLE GÉNÉRALE : un statut qui a un effet de bord n'est jamais
     * atteignable par la route générique.
     */
    'set_by_route_only' => ['ARRIVED'],

    /**
     * ==================================================================
     * ON NE DÉCLARE PAS UNE ABSENCE AVANT L'HEURE DU RENDEZ-VOUS
     * ==================================================================
     * Marquer « absent » à 9 h un rendez-vous prévu à 10 h n'est pas
     * une information : c'est une erreur de saisie, ou un employé qui
     * fait le ménage dans la journée avant qu'elle ait eu lieu.
     *
     * Le délai de grâce évite l'autre extrême : un client qui arrive
     * à 10 h 05 n'est pas absent. Un quart d'heure est ce qu'on
     * accorde spontanément dans une station.
     *
     * VALEUR DE DÉPART, PAS VÉRITÉ : elle vient du bon sens, pas de
     * mesures. Elle vit ici, dans un seul fichier, pour que le
     * réglage prenne une minute après le test terrain.
     */
    'no_show_grace_minutes' => 15,

    /**
     * ==================================================================
     * JUSQU'OÙ ON ACCEPTE DE PRENDRE UN RENDEZ-VOUS
     * ==================================================================
     * Pas dans le passé : c'est une faute de frappe, pas un projet.
     *
     * Pas au-delà d'un an : au-delà, la station aura changé de
     * tarifs, d'horaires et peut-être de prestations. Le prix figé
     * n'aurait plus aucun sens. La borne n'est pas là pour brider le
     * commerce, elle est là parce qu'au-delà la promesse ne tient
     * plus.
     */
    'max_days_ahead' => 365,
];
