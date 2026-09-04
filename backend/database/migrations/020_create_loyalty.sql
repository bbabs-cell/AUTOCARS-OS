-- =================================================================
-- LA FIDÉLITÉ — une carte à tampons, pas un programme à points
-- =================================================================
-- Deux tables et quatre colonnes ajoutées à `operations`.
--
-- ------------------------------------------------------------------
-- POURQUOI UNE CARTE À TAMPONS ET PAS DES POINTS ?
--
-- Le modèle à points (« 1 point par 100 F dépensés ») est plus
-- souple, et c'est exactement son problème : le client ne peut pas
-- vérifier son solde de tête. Il doit croire une arithmétique qu'il
-- ne voit pas, faite par un logiciel qu'il ne connaît pas.
--
-- La carte à tampons est ce que la station fait déjà sur du carton :
-- « après 10 lavages, 5 000 F offerts ». Le client compte lui-même.
-- Un client qui peut vérifier est un client qui fait confiance — et
-- la confiance est tout ce qu'un programme de fidélité achète.
--
-- Les points viendront si un gérant les réclame. Pas avant.
--
-- ------------------------------------------------------------------
-- POURQUOI UN GRAND LIVRE, ET PAS UN COMPTEUR
--
-- La tentation était une colonne `customers.loyalty_points` qu'on
-- incrémente. Elle aurait été fausse au premier incident : un
-- paiement rejoué, une remise annulée, et plus personne ne sait
-- comment on en est arrivé là.
--
-- `loyalty_entries` est un GRAND LIVRE : une ligne par événement, en
-- ajout seul. Le solde est la SOMME des lignes. On ne modifie jamais
-- une ligne — on en écrit une qui la compense. C'est la même règle
-- que pour les encaissements (lot 9) et pour la même raison : un
-- solde qu'on ne peut pas expliquer ne vaut rien.
-- =================================================================


-- -----------------------------------------------------------------
-- 1. LES RÈGLES DU PROGRAMME
-- -----------------------------------------------------------------
CREATE TABLE loyalty_programs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    organization_id BIGINT UNSIGNED NOT NULL,

    name VARCHAR(120) NOT NULL DEFAULT 'Carte de fidélité',

    -- Combien de lavages pour une récompense.
    stamps_required TINYINT UNSIGNED NOT NULL DEFAULT 10,

    -- Ce que vaut la récompense, en FCFA.
    --
    -- UN MONTANT, ET NON « UN LAVAGE OFFERT ».
    -- « Le 11ᵉ est offert » soulève aussitôt la question : offert
    -- jusqu'à quel montant ? Le client qui a collecté ses tampons sur
    -- des lavages à 5 000 F revient avec un detailing à 35 000 F, et
    -- c'est au comptoir qu'il faut trancher, devant lui. Un montant
    -- ferme la question avant qu'elle se pose, et il se compte.
    reward_amount BIGINT UNSIGNED NOT NULL DEFAULT 5000,

    -- En dessous de ce montant, la prestation ne donne pas de tampon.
    --
    -- POURQUOI UN MONTANT ET NON UNE LISTE DE PRESTATIONS ?
    -- Une liste doit être tenue à jour : la prestation ajoutée le
    -- mois prochain n'y sera pas, et personne ne s'en apercevra avant
    -- qu'un client réclame. Un montant plancher s'applique tout seul
    -- à ce qui n'existe pas encore.
    min_operation_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,

    -- ==============================================================
    -- UN PROGRAMME NAÎT INACTIF.
    -- ==============================================================
    -- La table est créée par une migration, sur toutes les
    -- installations, y compris celles qui n'ont jamais entendu parler
    -- de fidélité. Un programme actif par défaut se mettrait à
    -- distribuer des tampons — donc de l'argent — sans que personne
    -- ne l'ait décidé.
    status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'INACTIVE',

    created_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- UN SEUL PROGRAMME ACTIF PAR ENTREPRISE, garanti par la base.
    -- Deux programmes actifs, et la question « lequel s'applique ? »
    -- n'a pas de réponse : le montant de la récompense dépendrait de
    -- l'ordre des lignes.
    --
    -- Même mécanisme qu'aux lots 9 et 12 (« une seule caisse
    -- ouverte », « un seul pointage ouvert ») : une colonne calculée
    -- qui vaut l'identifiant tant que la ligne est active, NULL
    -- ensuite — une contrainte UNIQUE tolère autant de NULL qu'on
    -- veut.
    active_organization_id BIGINT UNSIGNED
        AS (IF(status = 'ACTIVE', organization_id, NULL)) STORED,

    PRIMARY KEY (id),
    UNIQUE KEY uq_loyalty_programs_one_active (active_organization_id),
    KEY idx_loyalty_programs_org (organization_id),

    -- ⚠️ ON UPDATE RESTRICT, et non CASCADE comme partout ailleurs.
    -- MySQL comme MariaDB refusent qu'une colonne calculée s'appuie
    -- sur une colonne qui se met à jour en cascade (erreur 1901, dont
    -- le message ne dit rien de la cause). La perte est nulle :
    -- l'identifiant d'une organisation est auto-incrémenté.
    CONSTRAINT fk_loyalty_programs_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_loyalty_programs_created_by
        FOREIGN KEY (created_by_user_id) REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------
-- 2. LE GRAND LIVRE
-- -----------------------------------------------------------------
CREATE TABLE loyalty_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

    organization_id BIGINT UNSIGNED NOT NULL,
    program_id      BIGINT UNSIGNED NOT NULL,
    customer_id     BIGINT UNSIGNED NOT NULL,

    -- EARN      un lavage payé  → +1
    -- REDEEM    une récompense utilisée → −stamps_required
    -- REVERSAL  une utilisation annulée → +stamps_required
    --
    -- POURQUOI REVERSAL PLUTÔT QU'UNE SUPPRESSION ?
    -- Parce qu'un employé qui applique une remise par erreur, puis
    -- l'annule, a fait DEUX gestes. Effacer le premier ferait
    -- disparaître le fait qu'il a eu lieu — et avec lui la seule
    -- trace d'une manipulation possible : appliquer, annuler,
    -- réappliquer sur un autre dossier.
    type ENUM('EARN', 'REDEEM', 'REVERSAL') NOT NULL,

    -- SIGNÉ, contrairement à toutes les autres colonnes numériques du
    -- projet : c'est le propre d'un grand livre. Le solde est la
    -- somme, sans soustraction à faire ni cas particulier à connaître.
    points SMALLINT NOT NULL,

    -- Le dossier concerné : celui qui a fait gagner le tampon, ou
    -- celui sur lequel la récompense a été appliquée.
    operation_id BIGINT UNSIGNED NULL DEFAULT NULL,

    -- Pour un REVERSAL : le REDEEM qu'il annule.
    related_entry_id BIGINT UNSIGNED NULL DEFAULT NULL,

    -- ==============================================================
    -- CE QUI ÉTAIT VRAI LE JOUR OÙ LA LIGNE A ÉTÉ ÉCRITE
    -- ==============================================================
    -- Les règles du programme peuvent changer. Un client qui a
    -- collecté sous « 10 tampons, 5 000 F » ne doit pas se retrouver
    -- avec un historique réécrit parce que le gérant est passé à
    -- « 12 tampons, 6 000 F » hier soir.
    --
    -- Même règle que le prix figé d'une opération (lot 7) et d'un
    -- rendez-vous (lot 13) : on recopie ce qui a été promis.
    reward_amount BIGINT UNSIGNED NULL DEFAULT NULL,

    note VARCHAR(255) NULL DEFAULT NULL,

    created_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- ==============================================================
    -- UN LAVAGE NE DONNE QU'UN SEUL TAMPON
    -- ==============================================================
    -- Le tampon est écrit au moment où le dossier devient réglé. Un
    -- client qui paie en deux fois déclenche donc deux fois le même
    -- calcul, et un paiement rejoué — connexion coupée, bouton
    -- pressé deux fois — le déclencherait une troisième.
    --
    -- Le contrôleur vérifie avant d'écrire ; la base, elle, ne peut
    -- pas se tromper.
    earn_operation_id BIGINT UNSIGNED
        AS (IF(type = 'EARN', operation_id, NULL)) STORED,

    -- Et une utilisation ne s'annule qu'une fois : sans cela, deux
    -- appuis sur « Annuler » rendraient deux fois les tampons.
    reversed_entry_id BIGINT UNSIGNED
        AS (IF(type = 'REVERSAL', related_entry_id, NULL)) STORED,

    PRIMARY KEY (id),

    UNIQUE KEY uq_loyalty_entries_one_earn_per_operation (earn_operation_id),
    UNIQUE KEY uq_loyalty_entries_one_reversal (reversed_entry_id),

    -- La requête de loin la plus fréquente : « le solde de ce
    -- client », lue à chaque ouverture d'un dossier au comptoir.
    KEY idx_loyalty_entries_customer (organization_id, customer_id, created_at),
    KEY idx_loyalty_entries_operation (operation_id),

    CONSTRAINT fk_loyalty_entries_organization
        FOREIGN KEY (organization_id) REFERENCES organizations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_loyalty_entries_program
        FOREIGN KEY (program_id) REFERENCES loyalty_programs (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_loyalty_entries_customer
        FOREIGN KEY (customer_id) REFERENCES customers (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    -- RESTRICT ici aussi : `operation_id` est lu par une colonne
    -- calculée, même contrainte technique que ci-dessus.
    CONSTRAINT fk_loyalty_entries_operation
        FOREIGN KEY (operation_id) REFERENCES operations (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_loyalty_entries_related
        FOREIGN KEY (related_entry_id) REFERENCES loyalty_entries (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_loyalty_entries_created_by
        FOREIGN KEY (created_by_user_id) REFERENCES users (id)
        ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- -----------------------------------------------------------------
-- 3. LA REMISE SUR UNE OPÉRATION
-- -----------------------------------------------------------------
-- ==================================================================
-- UNE RÉCOMPENSE EST UNE REMISE, PAS UN ENCAISSEMENT.
-- ==================================================================
-- La solution facile aurait été d'écrire un paiement de méthode
-- « FIDÉLITÉ » : le dossier devenait réglé, rien d'autre à changer.
--
-- Elle était fausse. Le tableau de bord additionne les encaissements
-- pour calculer la recette : un lavage offert serait compté comme de
-- l'argent reçu. La recette du jour aurait annoncé une somme que le
-- tiroir ne contient pas.
--
-- Une récompense diminue donc CE QUI EST DÛ. Trois conséquences,
-- toutes voulues :
--
--   1. La recette ne compte que de l'argent réellement reçu.
--   2. La caisse du soir reste juste.
--   3. LE COÛT DU PROGRAMME DEVIENT VISIBLE. Un gérant peut demander
--      « combien m'a coûté la fidélité ce mois-ci ? » et obtenir un
--      chiffre. Un programme dont on ne peut pas mesurer le coût est
--      un programme qu'on ne peut pas juger.
--
-- Les colonnes sont volontairement GÉNÉRIQUES et non nommées
-- « loyalty_* » : un geste commercial suivra un jour le même chemin.
-- Elles ne sont pour autant écrites aujourd'hui que par la fidélité —
-- aucune route ne permet une remise à la main, parce qu'une remise
-- décidée au comptoir est une décision d'argent qui mérite son propre
-- examen.
ALTER TABLE operations
    ADD COLUMN discount_amount BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER price,
    ADD COLUMN discount_reason VARCHAR(255) NULL DEFAULT NULL AFTER discount_amount,
    ADD COLUMN discount_by_user_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER discount_reason,
    ADD COLUMN discounted_at TIMESTAMP NULL DEFAULT NULL AFTER discount_by_user_id,
    ADD CONSTRAINT fk_operations_discount_by
        FOREIGN KEY (discount_by_user_id) REFERENCES users (id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
