-- =================================================================
-- audit_logs — qui a fait quoi, et quand
-- =================================================================
-- Répond à la question centrale en cas de litige sur un véhicule.
--
-- CETTE TABLE EST EN AJOUT SEUL. On y écrit, on ne modifie ni ne
-- supprime jamais. D'où l'absence volontaire de `updated_at` et de
-- `deleted_at` : leur présence suggérerait qu'une ligne peut changer.
--
-- Actions journalisées (lots 4 et suivants) :
--   auth.login, auth.login_failed, auth.logout
--   vehicle.created, vehicle.updated
--   operation.created, operation.status_changed
--   inspection.created, inspection.photo_added
--   payment.recorded
--   operation.released          ← la restitution, la plus sensible
--   user.role_changed
-- =================================================================

CREATE TABLE audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    -- NULL possible : une tentative de connexion échouée n'a pas
    -- encore d'organisation identifiée.
    organization_id BIGINT UNSIGNED NULL DEFAULT NULL,
    station_id      BIGINT UNSIGNED NULL DEFAULT NULL,
    user_id         BIGINT UNSIGNED NULL DEFAULT NULL,

    -- Format « domaine.action » : operation.status_changed.
    -- La convention permet de filtrer sur un domaine entier.
    action VARCHAR(80) NOT NULL,

    -- Sur quoi a porté l'action. On ne met PAS de clé étrangère ici :
    -- entity_type change de table selon les lignes, et une clé
    -- étrangère empêcherait de conserver la trace d'un élément
    -- supprimé — exactement ce qu'un journal doit garder.
    entity_type VARCHAR(60) NULL,
    entity_id   BIGINT UNSIGNED NULL,

    -- Détails variables selon l'action : ancien et nouveau statut,
    -- montant, motif d'annulation.
    -- MariaDB traite JSON comme du texte long, MySQL 8 a un type
    -- natif : la déclaration fonctionne sur les deux.
    metadata JSON NULL,

    -- VARBINARY(16) plutôt qu'une chaîne : c'est le format compact
    -- renvoyé par INET6_ATON(), qui gère IPv4 comme IPv6.
    ip_address VARBINARY(16) NULL,
    user_agent VARCHAR(255) NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- « Que s'est-il passé dans mon entreprise cette semaine ? »
    KEY idx_audit_org_date (organization_id, created_at),

    -- « Tout l'historique de CE véhicule » — la requête d'un litige.
    KEY idx_audit_entity (entity_type, entity_id),

    KEY idx_audit_user (user_id),
    KEY idx_audit_action (action),

    CONSTRAINT fk_audit_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_audit_station
        FOREIGN KEY (station_id) REFERENCES stations (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_audit_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
