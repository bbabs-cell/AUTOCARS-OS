-- =================================================================
-- password_resets — les demandes de réinitialisation
-- =================================================================
-- Même principe que les jetons de rafraîchissement : on stocke
-- l'empreinte, jamais le jeton envoyé à l'utilisateur.
--
-- Durée de vie courte (1 heure) : un lien de réinitialisation qui
-- traîne des jours dans une boîte mail est un risque.
--
-- `used_at` empêche qu'un même lien serve deux fois.
-- =================================================================

CREATE TABLE password_resets (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,

    token_hash CHAR(64) NOT NULL,

    expires_at TIMESTAMP NOT NULL,
    used_at    TIMESTAMP NULL DEFAULT NULL,

    requested_ip VARBINARY(16) NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_password_resets_hash (token_hash),
    KEY idx_password_resets_user (user_id),

    CONSTRAINT fk_password_resets_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
