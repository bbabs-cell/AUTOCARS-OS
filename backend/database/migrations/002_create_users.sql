-- =================================================================
-- users — les comptes de connexion
-- =================================================================
-- Un utilisateur appartient à UNE organisation. Son rattachement aux
-- stations et son rôle vivent dans station_users : un même employé
-- peut être manager sur une station et simple employé sur une autre.
--
-- IL N'Y A PAS DE TABLE `employees`. Un employé EST un utilisateur
-- rattaché à une station. On créera une table dédiée le jour où il y
-- aura de vraies données RH (contrat, horaires, salaire) — pas avant.
-- =================================================================

CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,

    first_name VARCHAR(80) NOT NULL,
    last_name  VARCHAR(80) NOT NULL,

    -- 190 caractères et non 255 : c'est la limite sûre pour indexer
    -- une colonne utf8mb4 sur toutes les versions de MySQL.
    email VARCHAR(190) NOT NULL,
    phone VARCHAR(30)  NULL,

    -- Le mot de passe n'est JAMAIS stocké. On garde le résultat de
    -- password_hash(), qui produit une empreinte lente et salée.
    -- 255 caractères pour laisser la place aux algorithmes futurs :
    -- bcrypt en fait 60, argon2id environ 96.
    password_hash VARCHAR(255) NOT NULL,

    status ENUM('ACTIVE', 'INVITED', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',

    last_login_at TIMESTAMP NULL DEFAULT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Suppression logique : on ne supprime jamais un utilisateur qui
    -- a manipulé des véhicules, sinon l'historique perd son auteur.
    deleted_at TIMESTAMP NULL DEFAULT NULL,

    PRIMARY KEY (id),

    -- L'adresse est unique dans TOUT le produit, pas seulement dans
    -- l'organisation : c'est elle qui sert d'identifiant de connexion,
    -- il ne peut donc pas y en avoir deux.
    -- Conséquence assumée : une personne travaillant pour deux
    -- entreprises clientes aura besoin de deux adresses.
    UNIQUE KEY uq_users_email (email),

    KEY idx_users_organization (organization_id),

    CONSTRAINT fk_users_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
