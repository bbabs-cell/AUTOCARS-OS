-- =================================================================
-- inspection_photos — les preuves
-- =================================================================
-- Ces photos ont une valeur de PREUVE en cas de litige. Trois
-- conséquences sur la conception :
--
--   1. Elles ne sont jamais supprimées, seulement archivées.
--      Une preuve effaçable ne vaut rien. Il n'y a donc pas de
--      colonne deleted_at, mais un statut ARCHIVED.
--
--   2. On stocke l'empreinte SHA-256 du fichier. Si quelqu'un
--      remplace l'image sur le disque, l'empreinte ne correspond
--      plus et la substitution devient détectable.
--
--   3. Le nom du fichier est généré aléatoirement par le serveur.
--      Celui fourni par l'utilisateur n'est jamais utilisé : il peut
--      contenir « ../../ » ou une extension piégée.
--
-- Les fichiers vivent dans backend/storage/uploads/, HORS du dossier
-- web : aucune URL n'y donne accès directement, un contrôleur vérifie
-- les droits avant de servir l'image (lot 7).
-- =================================================================

CREATE TABLE inspection_photos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,
    inspection_id   BIGINT UNSIGNED NOT NULL,

    -- Les cinq prises de vue demandées à l'arrivée, plus les gros
    -- plans sur un dommage constaté.
    position ENUM('FRONT', 'REAR', 'LEFT', 'RIGHT', 'INTERIOR', 'DAMAGE', 'OTHER')
        NOT NULL DEFAULT 'OTHER',

    -- Chemin RELATIF dans storage/uploads (ex : 2026/08/a3f9…webp).
    -- Relatif et non absolu : déplacer le dossier de stockage ou
    -- changer de serveur ne doit pas invalider la base.
    file_path VARCHAR(255) NOT NULL,

    -- Empreinte SHA-256 : 64 caractères hexadécimaux, longueur fixe.
    file_hash CHAR(64) NOT NULL,

    mime_type VARCHAR(60)   NOT NULL,
    file_size INT UNSIGNED  NOT NULL,
    width     SMALLINT UNSIGNED NULL,
    height    SMALLINT UNSIGNED NULL,

    caption VARCHAR(255) NULL,

    uploaded_by_user_id BIGINT UNSIGNED NOT NULL,

    status ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_inspection_photos_inspection (inspection_id),
    KEY idx_inspection_photos_org (organization_id),

    CONSTRAINT fk_inspection_photos_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_inspection_photos_inspection
        FOREIGN KEY (inspection_id) REFERENCES inspections (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_inspection_photos_uploaded_by
        FOREIGN KEY (uploaded_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
