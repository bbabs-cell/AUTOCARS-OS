-- =================================================================
-- payments — les encaissements
-- =================================================================
-- AUCUNE INTÉGRATION DE PAIEMENT N'EST CODÉE, et il n'en sera codé
-- aucune tant qu'un compte marchand réel n'existera pas.
--
-- Au Sénégal, l'essentiel des encaissements se fait en espèces ou par
-- mobile money (Wave, Orange Money). Au MVP, le caissier saisit ce
-- qu'il a reçu : la table enregistre un FAIT COMPTABLE, elle ne
-- déclenche pas de transaction.
--
-- Les colonnes `provider` et `external_reference` sont donc du texte
-- saisi à la main, jamais renseigné par une API. Le jour où une vraie
-- intégration arrivera, elle remplira ces mêmes colonnes : la
-- structure est prête sans rien simuler aujourd'hui.
-- =================================================================

CREATE TABLE payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NOT NULL,
    station_id      BIGINT UNSIGNED NOT NULL,

    -- Un paiement se rattache normalement à une opération. NULL reste
    -- possible pour un encaissement hors prestation (vente d'un
    -- produit au comptoir, avoir).
    operation_id BIGINT UNSIGNED NULL DEFAULT NULL,
    customer_id  BIGINT UNSIGNED NULL DEFAULT NULL,

    -- Entier, jamais un nombre à virgule. Voir services.price.
    amount        BIGINT UNSIGNED NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'XOF',

    method ENUM('CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER')
        NOT NULL DEFAULT 'CASH',

    -- Nom du service utilisé, SAISI par le caissier : « Wave »,
    -- « Orange Money ». Aucune vérification automatique.
    provider VARCHAR(60) NULL,

    -- Numéro de transaction recopié depuis le téléphone du client.
    -- Sert de trace en cas de contestation.
    external_reference VARCHAR(120) NULL,

    status ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED')
        NOT NULL DEFAULT 'PAID',

    paid_at TIMESTAMP NULL DEFAULT NULL,

    -- Qui a encaissé. Indispensable pour la clôture de caisse (lot 9)
    -- et pour retrouver l'origine d'un écart.
    recorded_by_user_id BIGINT UNSIGNED NOT NULL,

    notes TEXT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- Recettes du jour par station : la requête du tableau de bord.
    KEY idx_payments_station_date (organization_id, station_id, paid_at),
    KEY idx_payments_operation (operation_id),
    KEY idx_payments_customer (customer_id),

    CONSTRAINT fk_payments_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_station
        FOREIGN KEY (station_id) REFERENCES stations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_operation
        FOREIGN KEY (operation_id) REFERENCES operations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_customer
        FOREIGN KEY (customer_id) REFERENCES customers (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payments_recorded_by
        FOREIGN KEY (recorded_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
