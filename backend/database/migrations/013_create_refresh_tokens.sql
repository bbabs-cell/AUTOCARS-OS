-- =================================================================
-- refresh_tokens — les sessions ouvertes
-- =================================================================
-- Le jeton d'accès (JWT) est volontairement court : 30 minutes. S'il
-- est volé, il expire vite. Mais on ne va pas demander son mot de
-- passe à l'utilisateur toutes les demi-heures : le jeton de
-- rafraîchissement, lui, vit 7 jours et sert à en obtenir un nouveau.
--
-- ON NE STOCKE PAS LE JETON, MAIS SON EMPREINTE SHA-256.
-- Même raison que pour les mots de passe : si quelqu'un met la main
-- sur la base, il ne doit pas pouvoir se faire passer pour un
-- utilisateur connecté. L'empreinte permet de vérifier un jeton
-- présenté sans jamais détenir le jeton lui-même.
--
-- ROTATION : à chaque rafraîchissement, l'ancien jeton est révoqué et
-- un nouveau émis. Si un jeton déjà utilisé réapparaît, c'est qu'il a
-- été volé — le comportement est détectable.
-- =================================================================

CREATE TABLE refresh_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,
    user_id         BIGINT UNSIGNED NOT NULL,

    -- SHA-256 en hexadécimal : 64 caractères, longueur fixe.
    token_hash CHAR(64) NOT NULL,

    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL DEFAULT NULL,

    -- Contexte de création, utile pour afficher « vos sessions
    -- actives » (lot 17) et pour enquêter après un incident.
    created_ip VARBINARY(16) NULL,
    user_agent VARCHAR(255) NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_refresh_tokens_hash (token_hash),
    KEY idx_refresh_tokens_user (user_id),

    -- Pour le nettoyage périodique des jetons expirés.
    KEY idx_refresh_tokens_expiry (expires_at),

    CONSTRAINT fk_refresh_tokens_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_refresh_tokens_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
