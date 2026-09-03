-- =================================================================
-- vehicles — les véhicules confiés à la station
-- =================================================================

CREATE TABLE vehicles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,
    customer_id     BIGINT UNSIGNED NOT NULL,

    -- Stockée normalisée : majuscules, sans espaces (DK1234AA).
    -- La normalisation est faite par l'application avant écriture,
    -- pour que « dk 1234 aa » et « DK-1234-AA » désignent bien le
    -- même véhicule. L'affichage remet les tirets.
    plate_number VARCHAR(20) NOT NULL,

    brand VARCHAR(60) NOT NULL,
    model VARCHAR(60) NOT NULL,
    color VARCHAR(40) NULL,

    -- Le type influence le prix d'une prestation : laver un 4x4 prend
    -- plus de temps qu'une citadine.
    vehicle_type ENUM('CAR', 'SUV', 'PICKUP', 'VAN', 'MOTORCYCLE', 'TRUCK', 'OTHER')
        NOT NULL DEFAULT 'CAR',

    notes TEXT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,

    PRIMARY KEY (id),

    -- Une plaque désigne un seul véhicule dans une organisation.
    -- Cette contrainte évite les fiches en double, qui casseraient
    -- l'historique — le cœur même du produit.
    UNIQUE KEY uq_vehicles_org_plate (organization_id, plate_number),

    KEY idx_vehicles_customer (customer_id),

    CONSTRAINT fk_vehicles_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    -- RESTRICT : on ne peut pas supprimer un client qui a des
    -- véhicules. C'est voulu — la suppression en cascade détruirait
    -- silencieusement un historique.
    CONSTRAINT fk_vehicles_customer
        FOREIGN KEY (customer_id) REFERENCES customers (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
