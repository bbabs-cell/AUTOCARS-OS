-- =================================================================
-- organizations — l'entreprise cliente du SaaS
-- =================================================================
-- Sommet de la hiérarchie des données. Une organisation possède des
-- stations, qui possèdent tout le reste.
--
-- Toutes les tables métier portent une colonne organization_id qui
-- pointe ici : c'est ce qui garantit qu'une entreprise ne peut jamais
-- voir les données d'une autre.
-- =================================================================

CREATE TABLE organizations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    name VARCHAR(150) NOT NULL,

    -- Identifiant lisible et stable, utilisé dans les URL et les
    -- références de dossier. Exemple : « diallo-auto ».
    slug VARCHAR(120) NOT NULL,

    phone VARCHAR(30) NULL,
    email VARCHAR(190) NULL,

    -- Le produit vise d'abord le Sénégal mais doit pouvoir servir
    -- ailleurs : pays, devise et fuseau sont donc des données, pas
    -- des constantes codées en dur.
    country_code  CHAR(2)     NOT NULL DEFAULT 'SN',
    currency_code CHAR(3)     NOT NULL DEFAULT 'XOF',
    timezone      VARCHAR(64) NOT NULL DEFAULT 'Africa/Dakar',

    status ENUM('ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_organizations_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
