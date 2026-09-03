-- =================================================================
-- inspections — l'état constaté d'un véhicule
-- =================================================================
-- LE CŒUR DIFFÉRENCIANT DU PRODUIT.
--
-- Le litige « il y avait cette rayure ? / non, elle y était déjà »
-- est ce qui coûte le plus cher à une station, et c'est le seul
-- problème qu'aucun cahier ni WhatsApp ne résout.
--
-- Deux inspections par opération au maximum :
--   ENTRY  à l'arrivée, avant toute intervention
--   EXIT   avant restitution (optionnelle, lot 7)
-- =================================================================

CREATE TABLE inspections (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,
    operation_id    BIGINT UNSIGNED NOT NULL,
    vehicle_id      BIGINT UNSIGNED NOT NULL,

    type ENUM('ENTRY', 'EXIT') NOT NULL DEFAULT 'ENTRY',

    -- Qui a constaté. Cette information est la raison d'être de la
    -- table : en cas de litige, on doit pouvoir nommer la personne.
    performed_by_user_id BIGINT UNSIGNED NOT NULL,

    -- Niveau de carburant à l'arrivée. Contesté plus souvent qu'on
    -- ne le croit quand un véhicule reste plusieurs heures.
    fuel_level ENUM('EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTERS', 'FULL') NULL,

    mileage INT UNSIGNED NULL,

    -- Dommages constatés, en texte libre pour le MVP.
    -- Le repérage par zone du véhicule (schéma cliquable) viendra au
    -- lot 7 s'il s'avère nécessaire ; il demandera alors une table
    -- inspection_damages. On ne la crée pas d'avance.
    has_damage   TINYINT(1) NOT NULL DEFAULT 0,
    damage_notes TEXT NULL,

    -- Objets laissés dans le véhicule. Sujet de litige fréquent.
    items_left TEXT NULL,

    observations TEXT NULL,

    -- Validation par le client. Le nom saisi vaut accord sur l'état
    -- constaté : c'est la « signature numérique » du cahier des
    -- charges, dans sa forme la plus simple et la plus fiable.
    customer_present TINYINT(1) NOT NULL DEFAULT 0,
    signature_name   VARCHAR(120) NULL,

    performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- Une seule inspection d'entrée et une seule de sortie par
    -- opération : la contrainte empêche les doublons qui rendraient
    -- l'historique ambigu.
    UNIQUE KEY uq_inspections_operation_type (operation_id, type),

    KEY idx_inspections_vehicle (vehicle_id),
    KEY idx_inspections_org (organization_id),

    CONSTRAINT fk_inspections_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_inspections_operation
        FOREIGN KEY (operation_id) REFERENCES operations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_inspections_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES vehicles (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_inspections_performed_by
        FOREIGN KEY (performed_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
