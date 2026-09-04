-- =================================================================
-- time_entries — le pointage
-- =================================================================
-- UNE LIGNE = UNE PRÉSENCE, D'UNE ARRIVÉE À UN DÉPART.
--
-- Dans une station de lavage, la paie se fait souvent à la journée
-- travaillée. Le pointage n'est donc pas un gadget de contrôle :
-- c'est ce qui répond à « combien de jours Aliou a-t-il faits ce
-- mois-ci ? » sans que personne n'ait à s'en souvenir.
--
-- ------------------------------------------------------------------
-- CE QUE CETTE TABLE NE FAIT PAS
--
-- Elle ne surveille personne. Il n'y a ni géolocalisation, ni photo,
-- ni pointage automatique. Un employé déclare son arrivée, son
-- responsable peut la corriger — et toute correction laisse une
-- trace. C'est un registre, pas une caméra.
--
-- ------------------------------------------------------------------
-- LA DURÉE EST FIGÉE À LA FERMETURE
--
-- On aurait pu la recalculer à chaque affichage à partir des deux
-- horodatages. Ce serait une erreur : une correction ultérieure sur
-- une heure changerait rétroactivement une durée déjà utilisée pour
-- payer quelqu'un. Un pointage fermé est une PHOTO, comme une
-- clôture de caisse.
-- =================================================================

CREATE TABLE time_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,

    -- La station où la personne a travaillé ce jour-là. Un employé
    -- envoyé en renfort ailleurs doit apparaître dans les heures de
    -- CETTE station, pas de la sienne.
    station_id BIGINT UNSIGNED NOT NULL,
    user_id    BIGINT UNSIGNED NOT NULL,

    clock_in_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    clock_out_at TIMESTAMP NULL DEFAULT NULL,

    -- Minutes travaillées, calculées et FIGÉES à la fermeture.
    duration_minutes INT UNSIGNED NULL DEFAULT NULL,

    -- --- La correction ---------------------------------------------
    -- Un responsable peut rectifier un pointage : quelqu'un a oublié
    -- de pointer en partant, ou est arrivé avant l'ouverture du
    -- logiciel.
    --
    -- MAIS CELA SE VOIT. Ces trois colonnes existent pour qu'une
    -- heure modifiée ne puisse pas passer pour une heure déclarée.
    -- Le détail du avant/après va dans le journal d'audit ; ici on
    -- garde de quoi AFFICHER « corrigé par Awa » à côté de la ligne.
    --
    -- Sans cela, un employé payé sur des heures qu'il n'a pas
    -- reconnues n'aurait aucun moyen de s'en apercevoir.
    corrected_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
    corrected_at TIMESTAMP NULL DEFAULT NULL,
    correction_reason VARCHAR(255) NULL,

    notes TEXT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- ==============================================================
    -- UN SEUL POINTAGE OUVERT PAR PERSONNE, GARANTI PAR LA BASE
    -- ==============================================================
    -- Deux pointages ouverts en même temps, et les heures se
    -- comptent deux fois. L'API le vérifie déjà, mais un double clic
    -- sur un téléphone lent passe les deux fois la vérification avant
    -- que la première écriture n'arrive.
    --
    -- Même mécanique que cash_sessions (migration 017) : une colonne
    -- calculée qui vaut l'identifiant tant que la ligne est ouverte,
    -- et NULL une fois fermée. Une contrainte UNIQUE tolère autant de
    -- NULL qu'on veut : on peut donc fermer mille pointages et n'en
    -- ouvrir qu'un.
    open_user_id BIGINT UNSIGNED
        AS (IF(clock_out_at IS NULL, user_id, NULL)) STORED,
    UNIQUE KEY uq_time_entries_one_open (open_user_id),

    -- La requête du module : « les pointages de cette station sur
    -- cette période ». L'ordre des colonnes suit celui du filtrage.
    KEY idx_time_entries_station_date (organization_id, station_id, clock_in_at),
    KEY idx_time_entries_user (user_id, clock_in_at),

    CONSTRAINT fk_time_entries_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    -- ON UPDATE RESTRICT et non CASCADE, comme pour cash_sessions :
    -- MySQL comme MariaDB refusent qu'une colonne calculée s'appuie
    -- sur une colonne mise à jour en cascade. La perte est nulle, un
    -- identifiant auto-incrémenté ne change jamais.
    CONSTRAINT fk_time_entries_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,

    CONSTRAINT fk_time_entries_station
        FOREIGN KEY (station_id) REFERENCES stations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_time_entries_corrected_by
        FOREIGN KEY (corrected_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
