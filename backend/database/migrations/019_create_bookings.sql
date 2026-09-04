-- =================================================================
-- bookings — LES RENDEZ-VOUS PRIS À L'AVANCE
-- =================================================================
-- Une réservation est une PROMESSE : « mardi à 10 h, une Corolla,
-- lavage complet ». Une opération est un VÉHICULE PRÉSENT.
--
-- POURQUOI UNE TABLE SÉPARÉE, ALORS QU'ON A REFUSÉ UNE TABLE `queue` ?
--
-- Au lot 8, on a écrit qu'il n'y aurait pas de table `queue` : la
-- file d'attente n'est qu'une VUE des opérations en cours, et une
-- table séparée aurait dupliqué un état qui finirait par diverger.
--
-- Le raisonnement ne s'applique pas ici, et il vaut la peine de dire
-- pourquoi — c'est exactement la question à se poser avant de créer
-- n'importe quelle table :
--
--   · Une réservation EXISTE AVANT l'opération, et parfois sans elle
--     jamais : un client qui ne vient pas laisse une réservation, pas
--     une opération.
--   · Elle porte des états que la machine à états des opérations n'a
--     pas et ne doit pas avoir (NO_SHOW n'a aucun sens pour un
--     véhicule qui est là).
--   · Elle porte un client qui n'est peut-être pas encore en base :
--     au téléphone, on note un nom et un numéro, pas une fiche.
--
-- Une réservation n'est donc pas une opération à un autre statut :
-- c'est autre chose. Le lien entre les deux est explicite, une seule
-- fois, à l'arrivée : `operation_id`.
-- =================================================================

CREATE TABLE bookings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    organization_id BIGINT UNSIGNED NOT NULL,
    station_id      BIGINT UNSIGNED NOT NULL,
    service_id      BIGINT UNSIGNED NOT NULL,

    -- ------------------------------------------------------------------
    -- LE CLIENT : UN NOM ET UN NUMÉRO SUFFISENT
    -- ------------------------------------------------------------------
    -- Au téléphone, on note ce qu'on entend. Exiger une fiche client
    -- complète avant de pouvoir noter un rendez-vous, c'est obliger
    -- l'employé à créer une fiche à moitié fausse pendant que le
    -- client attend au bout du fil — ou à noter le rendez-vous sur un
    -- papier, ce qui est exactement ce qu'on cherche à remplacer.
    --
    -- Le nom et le numéro sont donc OBLIGATOIRES et stockés ici. Le
    -- rattachement à une fiche existante est FACULTATIF : il se fait
    -- quand le client est déjà connu, ou plus tard à l'arrivée.
    customer_id BIGINT UNSIGNED NULL DEFAULT NULL,
    vehicle_id  BIGINT UNSIGNED NULL DEFAULT NULL,

    customer_name  VARCHAR(160) NOT NULL,
    customer_phone VARCHAR(30)  NOT NULL,

    -- La plaque telle qu'annoncée, normalisée comme partout ailleurs.
    -- Facultative : beaucoup de clients ne la connaissent pas par cœur.
    plate_number VARCHAR(20) NULL DEFAULT NULL,

    -- ------------------------------------------------------------------
    -- L'HEURE DU RENDEZ-VOUS
    -- ------------------------------------------------------------------
    -- DATETIME et non TIMESTAMP, contrairement à toutes les autres
    -- colonnes de date du projet. Ce n'est pas une inattention.
    --
    -- Un `created_at` est un INSTANT : le moment précis où la ligne a
    -- été écrite. Un rendez-vous est une LECTURE D'HORLOGE MURALE :
    -- « mardi 10 h à la station ». MySQL convertit un TIMESTAMP selon
    -- le fuseau de la session ; le jour où le serveur change de
    -- fuseau, tous les rendez-vous passés se décaleraient. Un DATETIME
    -- est stocké tel qu'écrit.
    scheduled_at DATETIME NOT NULL,

    -- Recopiée du catalogue, comme le prix, et pour la même raison :
    -- la durée annoncée au client est celle du jour de la réservation.
    duration_minutes SMALLINT UNSIGNED NOT NULL,

    -- ------------------------------------------------------------------
    -- LE PRIX EST FIGÉ À LA RÉSERVATION
    -- ------------------------------------------------------------------
    -- C'est LA règle métier de cette table.
    --
    -- Un client réserve trois semaines à l'avance à 5 000 F. Le tarif
    -- passe à 6 000 F entre-temps. Que paie-t-il en arrivant ?
    --
    -- Le prix qu'on lui a annoncé. Un rendez-vous est un engagement,
    -- et facturer plus cher que ce qui a été dit au téléphone est la
    -- meilleure façon de perdre le client et sa recommandation.
    --
    -- Ce prix est donc recopié ici, et c'est LUI — pas le tarif du
    -- jour — que l'opération reprendra à l'arrivée.
    price         BIGINT UNSIGNED NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'XOF',

    -- ------------------------------------------------------------------
    -- LES CINQ ÉTATS D'UN RENDEZ-VOUS
    -- ------------------------------------------------------------------
    --   SCHEDULED  le rendez-vous est noté
    --   CONFIRMED  quelqu'un a rappelé, le client a confirmé
    --   ARRIVED    le véhicule est là, une opération a été ouverte
    --   NO_SHOW    l'heure est passée, personne n'est venu
    --   CANCELLED  annulé, par le client ou par la station
    --
    -- CONFIRMED mérite sa place : rappeler la veille est la seule
    -- mesure qui réduit vraiment les absences, et une station a besoin
    -- de savoir qui reste à rappeler.
    --
    -- ARRIVED, NO_SHOW et CANCELLED sont des états FINAUX. On n'en
    -- sort pas : une réservation manquée qu'on « rouvrirait » ferait
    -- disparaître le fait qu'elle a été manquée.
    status ENUM(
        'SCHEDULED',
        'CONFIRMED',
        'ARRIVED',
        'NO_SHOW',
        'CANCELLED'
    ) NOT NULL DEFAULT 'SCHEDULED',

    -- Le dossier ouvert à l'arrivée. NULL tant que le client n'est pas
    -- venu — et NULL pour toujours s'il n'est jamais venu.
    operation_id BIGINT UNSIGNED NULL DEFAULT NULL,

    -- ------------------------------------------------------------------
    -- L'ISSUE : UN SEUL TRIPLET POUR LES TROIS FINS
    -- ------------------------------------------------------------------
    -- Arrivée, absence et annulation sont trois façons de terminer un
    -- rendez-vous. Trois jeux de colonnes (`cancelled_at`,
    -- `no_show_at`, `arrived_at`…) auraient garanti qu'un jour l'une
    -- soit renseignée et l'autre oubliée, et qu'il faille lire les
    -- trois pour savoir ce qui s'est passé.
    --
    -- `status` dit CE QUI s'est passé, ce triplet dit QUAND, PAR QUI
    -- et POURQUOI.
    outcome_at         DATETIME NULL DEFAULT NULL,
    outcome_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
    outcome_reason     VARCHAR(255) NULL DEFAULT NULL,

    notes TEXT NULL,

    created_by_user_id BIGINT UNSIGNED NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- ------------------------------------------------------------------
    -- CE QU'ON NE CONTRAINT PAS, ET POURQUOI
    -- ------------------------------------------------------------------
    -- Les lots 9 et 12 ont chacun ajouté une colonne calculée sous
    -- contrainte UNIQUE pour interdire un doublon (« une seule caisse
    -- ouverte », « un seul pointage ouvert »). Le réflexe serait de
    -- recommencer ici, sur (station, heure, téléphone), afin qu'un
    -- double appui sur « Enregistrer » ne crée pas deux rendez-vous.
    --
    -- CE SERAIT UNE ERREUR. Un gestionnaire de flotte qui envoie
    -- trois véhicules de son entreprise à 10 h donne trois fois le
    -- même numéro : la contrainte refuserait un vrai client, avec un
    -- message que personne ne comprendrait. C'est fréquent ici.
    --
    -- Une contrainte ne se pose que sur une règle qui est vraie
    -- TOUJOURS. Contre le double appui, il reste le bouton désactivé
    -- pendant l'appel — et un doublon visible s'annule en un clic,
    -- alors qu'un client refusé s'en va.
    --
    -- L'index principal : « les rendez-vous de cette station, ce
    -- jour-là », qui est l'écran ouvert toute la journée.
    KEY idx_bookings_day (organization_id, station_id, scheduled_at),

    -- « Ce qui reste à traiter » : les rendez-vous encore ouverts,
    -- triés par heure.
    KEY idx_bookings_status (organization_id, status, scheduled_at),

    KEY idx_bookings_customer  (customer_id),
    KEY idx_bookings_vehicle   (vehicle_id),
    KEY idx_bookings_operation (operation_id),

    -- Retrouver un rendez-vous quand le client rappelle : il donne
    -- son numéro, jamais un numéro de dossier.
    KEY idx_bookings_phone (organization_id, customer_phone),

    CONSTRAINT fk_bookings_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_bookings_station
        FOREIGN KEY (station_id) REFERENCES stations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_bookings_service
        FOREIGN KEY (service_id) REFERENCES services (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_bookings_customer
        FOREIGN KEY (customer_id) REFERENCES customers (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_bookings_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES vehicles (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_bookings_operation
        FOREIGN KEY (operation_id) REFERENCES operations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_bookings_outcome_by
        FOREIGN KEY (outcome_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_bookings_created_by
        FOREIGN KEY (created_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
