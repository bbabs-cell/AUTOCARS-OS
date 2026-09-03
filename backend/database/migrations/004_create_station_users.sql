-- =================================================================
-- station_users — qui travaille où, et avec quel rôle
-- =================================================================
-- Table de liaison entre users et stations. C'est ELLE qui porte le
-- rôle, et non la table users : un même employé peut être manager
-- sur une station et simple employé sur une autre.
--
-- IL N'Y A PAS DE TABLES `roles` NI `permissions`.
-- Le rôle est une valeur parmi trois, et la matrice des droits vit
-- dans un fichier PHP (config/permissions.php, lot 4) : lisible,
-- testable, sans jointure à chaque requête. On passera à des tables
-- le jour où un client voudra des rôles sur mesure.
-- =================================================================

CREATE TABLE station_users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    -- organization_id est déduisible via station_id. On le duplique
    -- volontairement : TOUTES les tables métier portent cette colonne,
    -- ce qui permet à la couche d'accès aux données d'appliquer le
    -- filtre d'isolation de façon uniforme, sans exception à retenir.
    -- Une exception est une occasion de l'oublier.
    organization_id BIGINT UNSIGNED NOT NULL,
    station_id      BIGINT UNSIGNED NOT NULL,
    user_id         BIGINT UNSIGNED NOT NULL,

    role ENUM('ADMIN', 'MANAGER', 'EMPLOYEE') NOT NULL,

    status ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- Un utilisateur n'a qu'un seul rôle par station.
    UNIQUE KEY uq_station_users (station_id, user_id),

    KEY idx_station_users_user (user_id),
    KEY idx_station_users_org (organization_id),

    CONSTRAINT fk_station_users_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_station_users_station
        FOREIGN KEY (station_id) REFERENCES stations (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_station_users_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
