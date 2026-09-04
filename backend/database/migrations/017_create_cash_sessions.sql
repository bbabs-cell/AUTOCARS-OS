-- =================================================================
-- cash_sessions — les journées de caisse
-- =================================================================
-- UNE SESSION = UNE CAISSE OUVERTE, D'UN MATIN À UN SOIR.
--
-- À l'ouverture, le caissier compte le fond de caisse. À la
-- fermeture, il recompte. Le logiciel dit ce qu'il devrait y avoir ;
-- l'écart entre les deux est LA raison d'être de cette table.
--
-- POURQUOI ENREGISTRER L'ÉCART PLUTÔT QUE DE LE CORRIGER ?
-- Parce qu'un écart corrigé en silence n'existe plus, et qu'on ne
-- peut donc plus le chercher. Mille francs manquants un mardi, ça
-- arrive : une erreur de rendu de monnaie. Mille francs manquants
-- tous les mardis, c'est autre chose — et on ne le voit qu'en
-- gardant la trace de chacun.
--
-- Un logiciel de caisse qui affiche toujours zéro d'écart ne sert à
-- rien : il dit seulement que personne ne compte.
--
-- CE QUI ENTRE DANS LA CAISSE : LES ESPÈCES, ET RIEN D'AUTRE.
-- Un paiement Wave n'est pas dans le tiroir. Les additionner
-- rendrait la clôture fausse tous les soirs, et le caissier
-- cesserait de la faire.
-- =================================================================

CREATE TABLE cash_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,

    -- Une caisse appartient à une STATION, pas à une personne.
    -- Deux employés qui se relaient au comptoir travaillent sur le
    -- même tiroir : lier la session à un utilisateur obligerait à
    -- fermer et rouvrir à chaque changement d'équipe, et l'écart ne
    -- voudrait plus rien dire.
    station_id BIGINT UNSIGNED NOT NULL,

    status ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',

    -- --- Ouverture ------------------------------------------------
    -- Le fond de caisse : la monnaie laissée dans le tiroir pour
    -- pouvoir rendre. Il n'est pas une recette et ne doit jamais être
    -- compté comme telle.
    opening_float BIGINT UNSIGNED NOT NULL DEFAULT 0,
    opened_by_user_id BIGINT UNSIGNED NOT NULL,
    opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    opening_notes TEXT NULL,

    -- --- Fermeture ------------------------------------------------
    -- Ce que le logiciel attend : fond de caisse + espèces encaissées
    -- pendant la session. FIGÉ à la clôture, jamais recalculé.
    --
    -- Recalculer à l'affichage semblerait plus propre. Ce serait une
    -- erreur : une correction ultérieure sur un paiement changerait
    -- rétroactivement un écart déjà constaté et signé. Une clôture
    -- est une PHOTO, pas une vue.
    expected_amount BIGINT UNSIGNED NULL DEFAULT NULL,

    -- Ce que le caissier a réellement compté dans le tiroir.
    counted_amount BIGINT UNSIGNED NULL DEFAULT NULL,

    -- counted - expected. SIGNÉ : négatif s'il manque de l'argent,
    -- positif s'il y en a en trop. Un excédent est aussi une anomalie
    -- qu'un manque — il signale souvent un encaissement non saisi.
    difference BIGINT NULL DEFAULT NULL,

    closed_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
    closed_at TIMESTAMP NULL DEFAULT NULL,
    closing_notes TEXT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- ==============================================================
    -- UNE SEULE CAISSE OUVERTE PAR STATION, GARANTIE PAR LA BASE
    -- ==============================================================
    -- Deux sessions ouvertes en même temps sur le même tiroir, et les
    -- encaissements se répartissent au hasard entre elles : les deux
    -- clôtures sont fausses, et on ne sait pas laquelle croire.
    --
    -- L'API le vérifie déjà avant d'ouvrir. Mais deux caissiers qui
    -- cliquent à la même seconde passeraient tous les deux la
    -- vérification avant que l'un des deux n'écrive. Seule la base
    -- peut trancher.
    --
    -- COMMENT : une colonne CALCULÉE qui vaut station_id tant que la
    -- session est ouverte, et NULL une fois fermée. L'unicité porte
    -- sur elle. Comme une contrainte UNIQUE autorise autant de NULL
    -- qu'on veut, on peut fermer mille sessions sur une station et
    -- n'en ouvrir qu'une.
    --
    -- STORED et non VIRTUAL : les deux fonctionnent sur MySQL 8, mais
    -- l'indexation d'une colonne virtuelle a un historique plus
    -- accidenté selon les versions. Le coût est quelques octets par
    -- ligne, pour une table qui en compte une par jour et par station.
    open_station_id BIGINT UNSIGNED
        AS (IF(status = 'OPEN', station_id, NULL)) STORED,
    UNIQUE KEY uq_cash_sessions_one_open (open_station_id),

    KEY idx_cash_sessions_station (organization_id, station_id, opened_at),

    CONSTRAINT fk_cash_sessions_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- ON UPDATE RESTRICT, et non CASCADE comme partout ailleurs.
    --
    -- CE N'EST PAS UN OUBLI : MySQL comme MariaDB refusent qu'une
    -- colonne calculée s'appuie sur une colonne qui se met à jour en
    -- cascade — la valeur calculée serait recopiée sans que le moteur
    -- sache dans quel ordre. Le message d'erreur, « Function or
    -- expression 'station_id' cannot be used in the GENERATED ALWAYS
    -- AS clause », ne le dit pas du tout ; il a fallu le chercher.
    --
    -- La perte est nulle : l'identifiant d'une station est une clé
    -- auto-incrémentée, elle ne change jamais. La cascade ne servait
    -- à rien ici.
    CONSTRAINT fk_cash_sessions_station
        FOREIGN KEY (station_id) REFERENCES stations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_cash_sessions_opened_by
        FOREIGN KEY (opened_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cash_sessions_closed_by
        FOREIGN KEY (closed_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =================================================================
-- payments.cash_session_id — à quelle caisse appartient cet
-- encaissement ?
-- =================================================================
-- On aurait pu rattacher les paiements à leur session PAR LA DATE :
-- « tous ceux encaissés entre l'ouverture et la fermeture ». C'est
-- fragile. Un paiement enregistré à la seconde de la clôture tombe
-- d'un côté ou de l'autre selon l'ordre des écritures, et l'écart
-- change sans que personne ne comprenne pourquoi.
--
-- Le lien explicite supprime la question. Il rend aussi visible le
-- cas où le tiroir n'était pas ouvert : la colonne reste NULL.
--
-- POURQUOI NE PAS REFUSER UN ENCAISSEMENT SANS CAISSE OUVERTE ?
-- Parce qu'un client qui paie n'attendra pas qu'on règle un problème
-- d'informatique. Bloquer ici, c'est obtenir de l'argent encaissé
-- sans être saisi — c'est-à-dire des données fausses au lieu de
-- données incomplètes. On enregistre, et la clôture signale les
-- encaissements restés hors caisse.
-- =================================================================

ALTER TABLE payments
    ADD COLUMN cash_session_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER station_id,
    ADD KEY idx_payments_cash_session (cash_session_id),
    ADD CONSTRAINT fk_payments_cash_session
        FOREIGN KEY (cash_session_id) REFERENCES cash_sessions (id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
