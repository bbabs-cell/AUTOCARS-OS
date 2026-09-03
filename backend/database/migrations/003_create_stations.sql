-- =================================================================
-- stations — les points de service
-- =================================================================
-- « Station Dakar Plateau », « Station Thiès ». Une organisation en
-- possède une ou plusieurs.
-- =================================================================

CREATE TABLE stations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,

    name    VARCHAR(120) NOT NULL,
    address VARCHAR(255) NULL,
    city    VARCHAR(80)  NULL,
    phone   VARCHAR(30)  NULL,

    -- Code court affiché sur les références de dossier remises au
    -- client. Exemple : « DKP » pour Dakar Plateau.
    code VARCHAR(10) NOT NULL,

    -- Horaires d'ouverture, utilisés par les réservations (lot 13).
    opens_at  TIME NULL,
    closes_at TIME NULL,

    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- Deux stations d'une même entreprise ne peuvent pas porter le
    -- même code : les références de dossier deviendraient ambiguës.
    UNIQUE KEY uq_stations_org_code (organization_id, code),

    CONSTRAINT fk_stations_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
