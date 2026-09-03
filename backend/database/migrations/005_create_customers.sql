-- =================================================================
-- customers — les clients de la station
-- =================================================================
-- À ne pas confondre avec `users`, qui sont les comptes de connexion
-- du personnel. Un client ne se connecte pas au MVP : il est
-- enregistré au comptoir par un employé.
-- =================================================================

CREATE TABLE customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,

    first_name VARCHAR(80) NOT NULL,
    last_name  VARCHAR(80) NOT NULL,

    -- Le téléphone est OBLIGATOIRE : au Sénégal c'est l'identifiant
    -- naturel d'une personne, bien avant l'adresse e-mail. C'est par
    -- lui qu'un employé retrouvera un client habitué en trois
    -- secondes au comptoir.
    --
    -- Il n'est volontairement PAS unique : un couple partage souvent
    -- un numéro. Une contrainte d'unicité empêcherait un
    -- enregistrement légitime en pleine affluence. Le doublon sera
    -- signalé par l'application (lot 6), pas interdit par la base.
    phone VARCHAR(30) NOT NULL,

    email   VARCHAR(190) NULL,
    address VARCHAR(255) NULL,
    notes   TEXT NULL,

    status ENUM('ACTIVE', 'BLOCKED') NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL DEFAULT NULL,

    PRIMARY KEY (id),

    -- Index composé : la recherche par téléphone se fait toujours
    -- DANS une organisation. L'ordre des colonnes compte — MySQL ne
    -- peut utiliser un index composé que de la gauche vers la droite.
    KEY idx_customers_org_phone (organization_id, phone),
    KEY idx_customers_org_name  (organization_id, last_name),

    CONSTRAINT fk_customers_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
