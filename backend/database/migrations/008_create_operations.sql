-- =================================================================
-- operations — LA TABLE CENTRALE DU PRODUIT
-- =================================================================
-- Une opération = une prestation réalisée sur un véhicule, à une
-- date, par un employé, pour un client.
--
-- Tout le produit tourne autour d'elle :
--   - la file d'attente est une VUE de cette table (statut + priorité)
--   - le tableau de bord la compte et l'additionne
--   - l'inspection, le paiement et la restitution s'y rattachent
--   - le journal d'audit trace ses changements de statut
--
-- IL N'Y A PAS DE TABLE `queue`. La file d'attente n'est pas une
-- entité : c'est la liste des opérations dont le statut est en cours,
-- triée par priorité. Une table séparée dupliquerait l'état et
-- finirait fatalement par diverger de celle-ci.
-- =================================================================

CREATE TABLE operations (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    organization_id BIGINT UNSIGNED NOT NULL,
    station_id      BIGINT UNSIGNED NOT NULL,
    vehicle_id      BIGINT UNSIGNED NOT NULL,
    customer_id     BIGINT UNSIGNED NOT NULL,
    service_id      BIGINT UNSIGNED NOT NULL,

    -- Employé en charge. NULL tant que personne n'est assigné :
    -- un véhicule peut attendre dans la file sans affectation.
    assigned_user_id BIGINT UNSIGNED NULL DEFAULT NULL,

    -- Référence remise au client, du type « DKP-2608-0042 ».
    -- Le module sécurité l'exige avant toute restitution : c'est ce
    -- que la personne présente au comptoir pour récupérer sa voiture.
    reference VARCHAR(30) NOT NULL,

    -- Les huit statuts du parcours d'un véhicule.
    -- Les transitions autorisées entre ces valeurs sont vérifiées par
    -- l'API (lot 8) : la base garantit les valeurs possibles, pas
    -- l'ordre dans lequel on y passe.
    status ENUM(
        'WAITING',        -- en attente, dans la file
        'IN_PROGRESS',    -- pris en charge par un employé
        'INSPECTION',     -- inspection d'entrée en cours
        'WASHING',        -- prestation en cours
        'QUALITY_CHECK',  -- contrôle avant remise
        'READY',          -- prêt, le client peut venir
        'COMPLETED',      -- restitué au client
        'CANCELLED'       -- annulé
    ) NOT NULL DEFAULT 'WAITING',

    -- Ordre dans la file d'attente. Plus la valeur est haute, plus
    -- l'opération remonte : permet de faire passer un client pressé
    -- devant sans toucher aux heures d'arrivée.
    priority SMALLINT NOT NULL DEFAULT 0,

    -- PRIX FIGÉ À LA CRÉATION, recopié depuis services.price.
    --
    -- C'est une duplication VOLONTAIRE. Si le gérant augmente le prix
    -- du lavage premium le mois prochain, les opérations passées
    -- doivent continuer à montrer ce qui a réellement été facturé.
    -- Lire le prix par une jointure sur services réécrirait le passé
    -- à chaque changement de tarif.
    price         BIGINT UNSIGNED NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'XOF',

    -- Jalons du parcours. Renseignés au fil des changements de statut,
    -- ils permettent de calculer les durées réelles sans relire tout
    -- le journal d'audit.
    started_at   TIMESTAMP NULL DEFAULT NULL,  -- prise en charge
    completed_at TIMESTAMP NULL DEFAULT NULL,  -- prestation terminée
    released_at  TIMESTAMP NULL DEFAULT NULL,  -- véhicule restitué

    released_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
    created_by_user_id  BIGINT UNSIGNED NOT NULL,

    notes TEXT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    UNIQUE KEY uq_operations_org_reference (organization_id, reference),

    -- L'index le plus important du produit : c'est la requête de la
    -- file d'attente, rechargée en permanence sur tous les postes.
    -- L'ordre des colonnes suit celui du filtrage réel :
    -- « dans cette organisation, cette station, ces statuts ».
    KEY idx_operations_queue (organization_id, station_id, status, priority),

    KEY idx_operations_vehicle  (vehicle_id),
    KEY idx_operations_customer (customer_id),
    KEY idx_operations_assigned (assigned_user_id),

    -- Pour le tableau de bord : « le chiffre d'affaires d'aujourd'hui ».
    KEY idx_operations_org_created (organization_id, created_at),

    CONSTRAINT fk_operations_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_operations_station
        FOREIGN KEY (station_id) REFERENCES stations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_operations_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES vehicles (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_operations_customer
        FOREIGN KEY (customer_id) REFERENCES customers (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_operations_service
        FOREIGN KEY (service_id) REFERENCES services (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_operations_assigned_user
        FOREIGN KEY (assigned_user_id) REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_operations_released_by
        FOREIGN KEY (released_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_operations_created_by
        FOREIGN KEY (created_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
