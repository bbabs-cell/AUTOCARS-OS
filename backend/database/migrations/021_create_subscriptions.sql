-- =================================================================
-- LES ABONNEMENTS — des lavages payés d'avance
-- =================================================================
-- « 10 lavages pour 40 000 F, valables 6 mois. »
--
-- ------------------------------------------------------------------
-- POURQUOI UN FORFAIT ET PAS UN « ILLIMITÉ MENSUEL » ?
--
-- L'illimité se vend bien et se gère mal : il suppose une règle
-- d'usage raisonnable (« pas plus d'un lavage par jour », « hors
-- detailing ») que le logiciel devrait arbitrer à la place du gérant,
-- devant un client. Le forfait, lui, se compte : « il vous en reste
-- trois ». Le client vérifie lui-même, comme pour la carte à tampons.
--
-- C'est le même raisonnement qu'au lot 14, et la même conclusion :
-- l'illimité viendra si un gérant le réclame, pas avant.
--
-- ==================================================================
-- LA QUESTION COMPTABLE DE CE LOT, ET LA RÉPONSE
-- ==================================================================
-- Un client paie 40 000 F aujourd'hui pour dix lavages qu'il prendra
-- sur six mois. Ces 40 000 F sont-ils la recette d'aujourd'hui ?
--
-- En comptabilité, non : ce sont des « produits constatés d'avance »,
-- reconnus au fur et à mesure des prestations livrées. Ce produit ne
-- fait PAS cette comptabilité d'engagement, et c'est un choix.
--
--   · L'ARGENT EST BIEN ENTRÉ AUJOURD'HUI. Il est dans le tiroir, il
--     doit être dans la caisse du soir, et la clôture doit tomber
--     juste. C'est non négociable : une caisse fausse est le pire
--     défaut possible de ce produit.
--   · Le gérant d'une station de lavage à Dakar ne tient pas une
--     comptabilité d'engagement. Lui afficher « 4 000 F de chiffre
--     d'affaires » un jour où il a encaissé 40 000 F le ferait douter
--     du logiciel, à raison.
--
-- La vente d'un forfait est donc un ENCAISSEMENT ORDINAIRE, dans la
-- caisse et dans la recette du jour. Les lavages qui suivent ne
-- rapportent rien : ils ont déjà été payés.
--
-- CE QUI EST AJOUTÉ EN ÉCHANGE, et qui n'existerait pas sans ce lot :
-- le compteur de ce qui RESTE À LIVRER. Une station qui a vendu 200
-- lavages d'avance doit 200 lavages. C'est une dette, elle se voit,
-- et c'est le seul chiffre qui manquerait vraiment à un gérant.
--
-- Le jour où un comptable réclamera de vrais produits constatés
-- d'avance, tout est là pour le calculer : la date de vente, le
-- nombre livré, le prix figé. Rien n'aura été perdu.
-- =================================================================


-- -----------------------------------------------------------------
-- 1. CE QUE LA STATION VEND
-- -----------------------------------------------------------------
CREATE TABLE subscription_plans (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    organization_id BIGINT UNSIGNED NOT NULL,

    name VARCHAR(120) NOT NULL,

    -- ==============================================================
    -- UN FORFAIT PORTE SUR UNE PRESTATION PRÉCISE
    -- ==============================================================
    -- « 10 lavages » ne veut rien dire tant qu'on n'a pas dit
    -- lesquels. Sans ce lien, le client qui a acheté dix lavages
    -- standard se présenterait pour un detailing à 35 000 F, et il
    -- faudrait trancher au comptoir, devant lui.
    --
    -- Une station qui veut couvrir deux prestations vend deux
    -- forfaits. C'est plus simple à expliquer qu'une liste, et ça
    -- reste vrai quand le catalogue change.
    service_id BIGINT UNSIGNED NOT NULL,

    -- Combien de lavages le forfait contient.
    washes SMALLINT UNSIGNED NOT NULL,

    -- Le prix du forfait, en FCFA. Il n'a AUCUNE raison d'être un
    -- multiple du prix unitaire : c'est justement la remise qui rend
    -- le forfait attractif.
    price BIGINT UNSIGNED NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'XOF',

    -- ==============================================================
    -- UNE DURÉE DE VALIDITÉ, ET POURQUOI ELLE EST OBLIGATOIRE
    -- ==============================================================
    -- Un forfait sans date de fin est une dette éternelle. Le client
    -- qui revient trois ans plus tard avec quatre lavages non
    -- utilisés a raison de les réclamer, et la station a encaissé cet
    -- argent depuis longtemps.
    --
    -- La durée protège les deux : elle borne l'engagement de la
    -- station, et elle est annoncée au client au moment de l'achat.
    validity_days SMALLINT UNSIGNED NOT NULL DEFAULT 180,

    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',

    created_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- PAS de contrainte « un seul forfait actif » : une station en
    -- propose plusieurs, c'est même tout l'intérêt. Troisième fois que
    -- ce projet refuse une contrainte qui paraît naturelle — la règle
    -- reste la même : on ne contraint que ce qui est vrai TOUJOURS.
    KEY idx_subscription_plans_org (organization_id, status),

    CONSTRAINT fk_subscription_plans_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_subscription_plans_service
        FOREIGN KEY (service_id) REFERENCES services (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_subscription_plans_created_by
        FOREIGN KEY (created_by_user_id) REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------
-- 2. CE QU'UN CLIENT A ACHETÉ
-- -----------------------------------------------------------------
CREATE TABLE subscriptions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    organization_id BIGINT UNSIGNED NOT NULL,
    customer_id     BIGINT UNSIGNED NOT NULL,
    plan_id         BIGINT UNSIGNED NOT NULL,
    -- La station où le forfait a été vendu : c'est sa caisse qui a
    -- reçu l'argent.
    station_id      BIGINT UNSIGNED NOT NULL,

    -- ==============================================================
    -- TOUT EST RECOPIÉ DU FORFAIT AU MOMENT DE LA VENTE
    -- ==============================================================
    -- Troisième fois dans ce projet, après le prix d'une opération
    -- (lot 7) et celui d'un rendez-vous (lot 13). Le gérant qui passe
    -- son forfait de 10 à 8 lavages le mois prochain ne doit pas
    -- retirer deux lavages à ceux qui ont déjà payé.
    service_id  BIGINT UNSIGNED NOT NULL,
    washes_total SMALLINT UNSIGNED NOT NULL,
    price_paid   BIGINT UNSIGNED NOT NULL,

    starts_at  DATE NOT NULL,
    expires_at DATE NOT NULL,

    -- ==============================================================
    -- DEUX STATUTS SEULEMENT, ET C'EST VOLONTAIRE
    -- ==============================================================
    -- Le réflexe serait quatre : ACTIF, EXPIRÉ, ÉPUISÉ, ANNULÉ.
    --
    -- Mais « expiré » se lit dans `expires_at`, et « épuisé » se
    -- compte dans les opérations rattachées. Les stocker en plus,
    -- c'est promettre de les tenir à jour — donc écrire une tâche
    -- planifiée qui passe chaque nuit, et vivre avec un forfait qui
    -- reste ACTIF parce que la tâche a échoué.
    --
    -- UN STATUT QUI SE CALCULE NE SE STOCKE PAS. Seule l'annulation
    -- est une décision humaine : elle seule mérite une colonne.
    --
    -- L'état complet est reconstitué à la lecture, dans
    -- `SubscriptionRepository::present()`.
    status ENUM('ACTIVE', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',

    cancelled_at         TIMESTAMP NULL DEFAULT NULL,
    cancelled_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,
    cancellation_reason  VARCHAR(255) NULL DEFAULT NULL,

    notes TEXT NULL,

    sold_by_user_id BIGINT UNSIGNED NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    -- « Les forfaits utilisables de ce client » : la requête faite à
    -- chaque ouverture d'un dossier au comptoir.
    KEY idx_subscriptions_customer (organization_id, customer_id, status, expires_at),
    KEY idx_subscriptions_plan (plan_id),
    KEY idx_subscriptions_station (station_id),

    CONSTRAINT fk_subscriptions_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_subscriptions_customer
        FOREIGN KEY (customer_id) REFERENCES customers (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_subscriptions_plan
        FOREIGN KEY (plan_id) REFERENCES subscription_plans (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_subscriptions_service
        FOREIGN KEY (service_id) REFERENCES services (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_subscriptions_station
        FOREIGN KEY (station_id) REFERENCES stations (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_subscriptions_sold_by
        FOREIGN KEY (sold_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_subscriptions_cancelled_by
        FOREIGN KEY (cancelled_by_user_id) REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------
-- 3. UN LAVAGE COUVERT PAR UN FORFAIT
-- -----------------------------------------------------------------
-- ==================================================================
-- IL N'Y A PAS DE TABLE `subscription_uses`.
-- ==================================================================
-- Le réflexe serait une table de consommations, ou une colonne
-- `washes_used` qu'on incrémente. Les deux dupliqueraient un état qui
-- existe déjà : UNE CONSOMMATION EST UNE OPÉRATION.
--
-- Le nombre de lavages utilisés est donc COUNT(operations WHERE
-- subscription_id = X). C'est le même raisonnement qu'au lot 8 pour
-- la file d'attente, et il conduit à la même conclusion : un compteur
-- séparé finit toujours par diverger de ce qu'il compte, et personne
-- ne sait alors lequel des deux croire.
ALTER TABLE operations
    ADD COLUMN subscription_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER discounted_at,

    -- ==============================================================
    -- POURQUOI DISTINGUER LA SOURCE D'UNE REMISE
    -- ==============================================================
    -- Le lot 14 a créé `discount_amount` pour les récompenses de
    -- fidélité. Un lavage couvert par un forfait ramène lui aussi le
    -- dû à zéro — la colonne convient donc parfaitement.
    --
    -- Mais les deux ne veulent PAS dire la même chose :
    --
    --   FIDÉLITÉ     la station donne. C'est un coût.
    --   ABONNEMENT   le client a déjà payé. Ce n'est pas un coût,
    --                c'est une dette qu'on solde.
    --
    -- Sans cette colonne, le « coût du programme de fidélité » de
    -- l'écran /loyalty compterait les lavages d'abonnés, et
    -- annoncerait au gérant qu'il donne un argent qu'il a en réalité
    -- déjà encaissé.
    ADD COLUMN discount_source ENUM('LOYALTY', 'SUBSCRIPTION') NULL DEFAULT NULL
        AFTER subscription_id,

    ADD KEY idx_operations_subscription (subscription_id),

    ADD CONSTRAINT fk_operations_subscription
        FOREIGN KEY (subscription_id) REFERENCES subscriptions (id)
        ON DELETE RESTRICT ON UPDATE CASCADE;


-- Les remises qui existaient AVANT cette migration venaient toutes de
-- la fidélité : c'était la seule source possible au lot 14. Sans ce
-- rattrapage, elles se retrouveraient avec une source vide et
-- sortiraient du calcul « ce que le programme a coûté » — un chiffre
-- qui baisserait tout seul le jour de la mise à jour, sans que
-- personne ne comprenne pourquoi.
--
-- Une migration qui ajoute une colonne à des lignes existantes doit
-- toujours se poser cette question : que vaut cette colonne pour le
-- passé ?
UPDATE operations
   SET discount_source = 'LOYALTY'
 WHERE discount_amount > 0
   AND discount_source IS NULL;


-- -----------------------------------------------------------------
-- 4. LA VENTE D'UN FORFAIT EST UN ENCAISSEMENT
-- -----------------------------------------------------------------
-- `payments.operation_id` était déjà NULLABLE depuis le lot 9 : un
-- encaissement n'a jamais été obligé de porter sur un dossier. La
-- vente d'un forfait s'y glisse donc sans rien casser.
--
-- Elle passe par la MÊME route et la MÊME table que n'importe quel
-- encaissement, ce qui lui vaut gratuitement : la session de caisse,
-- le journal, la recette du jour et le remboursement. Un circuit
-- parallèle aurait fallu tout reconstruire, et aurait fini par en
-- oublier un.
ALTER TABLE payments
    ADD COLUMN subscription_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER operation_id,
    ADD KEY idx_payments_subscription (subscription_id),
    ADD CONSTRAINT fk_payments_subscription
        FOREIGN KEY (subscription_id) REFERENCES subscriptions (id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
