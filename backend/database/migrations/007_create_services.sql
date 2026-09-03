-- =================================================================
-- services — le catalogue des prestations
-- =================================================================
-- « Lavage standard », « Detailing complet ». Configurés par le
-- gérant pendant l'installation (lot 5).
-- =================================================================

CREATE TABLE services (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,

    name        VARCHAR(120) NOT NULL,
    description TEXT NULL,
    category    VARCHAR(60) NULL,

    -- LES MONTANTS SONT DES ENTIERS, JAMAIS DES NOMBRES À VIRGULE.
    --
    -- Le franc CFA n'a pas de décimales, et surtout un FLOAT introduit
    -- des erreurs d'arrondi : 0.1 + 0.2 ne vaut pas exactement 0.3 en
    -- binaire. Sur une caisse qu'un gérant doit équilibrer au franc
    -- près, c'est inacceptable.
    --
    -- Pour une devise à décimales (euro, dollar), on stockera les
    -- centimes dans ce même entier.
    price BIGINT UNSIGNED NOT NULL,

    duration_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 30,

    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_services_org_name (organization_id, name),

    CONSTRAINT fk_services_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
