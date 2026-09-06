-- =================================================================
-- Index de performance (étape 7 de la migration)
-- =================================================================
-- AJOUTÉS APRÈS MESURE, PAS PAR ANTICIPATION.
--
-- Les cinq index du lot 20 avaient été choisis en lisant le plan
-- d'exécution de MySQL. Le planificateur de SQLite est différent :
-- les recopier aurait été faire semblant d'avoir mesuré. La
-- migration 0002 le disait, et voici les mesures.
--
-- MÉTHODE
--   node tools/banc-donnees.mjs 30000     30 000 dossiers sur 3 ans
--   node tools/banc-mesures.mjs --plans   avant / après
--
-- Chaque chiffre ci-dessous est la médiane de cinq passages, telle
-- que D1 la rapporte lui-même. Aucun index n'est posé sans qu'un plan
-- d'exécution montre qu'il est utilisé : les sept le sont, chacun par
-- une requête nommée.
--
-- Un index n'est pas gratuit : il occupe de la place et ralentit
-- chaque écriture. On n'en pose donc pas « au cas où ».
-- =================================================================


-- -----------------------------------------------------------------
-- 1. LA FILE D'ATTENTE, TOUTES STATIONS : 8 ms → 1 ms
-- -----------------------------------------------------------------
-- C'est l'écran que le gérant laisse ouvert toute la journée, et il
-- se rafraîchit toutes les trente secondes.
--
-- `idx_operations_queue` commence par (organization_id, station_id) :
-- il sert quand on filtre SUR UNE STATION — et c'est bien ce que la
-- mesure montre, 4 ms dans ce cas. Sans filtre de station, SQLite ne
-- pouvait utiliser que la clé unique d'organisation et triait le
-- résultat dans un arbre temporaire.
--
-- `priority DESC` est écrit dans l'index : SQLite ne se sert d'un
-- index pour un ORDER BY que si le SENS correspond.
CREATE INDEX idx_operations_org_status_priority
    ON operations (organization_id, status, priority DESC, created_at);


-- -----------------------------------------------------------------
-- 2. LE TABLEAU DE BORD DU MATIN : 27 ms → 0 ms
-- -----------------------------------------------------------------
-- Les compteurs de la journée filtrent sur `updated_at`. Aucun index
-- ne portait cette colonne : SQLite prenait l'index d'organisation et
-- lisait les 30 000 lignes de l'entreprise pour en garder quelques
-- dizaines. Le coût de l'écran du matin grandissait donc avec l'âge
-- du client, pour toujours.
CREATE INDEX idx_operations_org_updated
    ON operations (organization_id, updated_at);


-- -----------------------------------------------------------------
-- 3. CE QUI A ÉTÉ LIVRÉ : 31 ms → 4 ms
-- -----------------------------------------------------------------
-- La décomposition des statistiques ne regarde que les dossiers
-- RESTITUÉS pendant la période, donc `status` et `released_at`. Les
-- deux sont dans l'index, dans cet ordre : le statut est une égalité,
-- la date un intervalle — et une colonne d'intervalle ne sert plus
-- rien de ce qui la suit.
CREATE INDEX idx_operations_org_released
    ON operations (organization_id, status, released_at);


-- -----------------------------------------------------------------
-- 4. L'HISTORIQUE D'UN VÉHICULE : 27 ms → 0 ms
-- -----------------------------------------------------------------
-- `idx_operations_vehicle (vehicle_id)` existait, et SQLite ne
-- l'utilisait PAS : le tri par date lui coûtait plus cher que de
-- parcourir l'index d'organisation. En mettant la date dans le même
-- index, le tri disparaît avec le parcours.
CREATE INDEX idx_operations_org_vehicle_created
    ON operations (organization_id, vehicle_id, created_at);


-- -----------------------------------------------------------------
-- 5. LES BALAYAGES DE STATISTIQUES : 19 ms → 4 ms
-- -----------------------------------------------------------------
-- Les statistiques d'une année parcourent les dossiers pour compter,
-- additionner et regrouper. Ce parcours est inévitable — la question
-- porte vraiment sur toutes ces lignes.
--
-- Ce qui l'est moins, c'est d'ouvrir chaque ligne de la table pour y
-- lire quatre colonnes. Un index qui les PORTE répond sans jamais
-- toucher la table : SQLite l'annonce par « USING COVERING INDEX ».
--
-- On s'arrête à six colonnes. Y ajouter les horodatages ferait un
-- index presque aussi gros que la table : on aurait recopié les
-- données au lieu de les indexer.
CREATE INDEX idx_operations_analytics
    ON operations (organization_id, created_at, status, customer_id, price, service_id);


-- -----------------------------------------------------------------
-- 6. LES CLIENTS QUI REVIENNENT : 168 ms → 5 ms
-- -----------------------------------------------------------------
-- Le regroupement par client se fait sans arbre temporaire quand
-- l'index commence par (organization_id, customer_id) : les lignes
-- arrivent déjà groupées.
--
-- CET INDEX SEUL NE SUFFISAIT PAS. Avec lui mais sans la réécriture
-- de la requête (voir plus bas), le temps restait à 139 ms — le coût
-- n'était pas dans la lecture, il était dans la JOINTURE de deux
-- ensembles matérialisés sans index.
--
-- Réécriture seule, sans cet index : 11 ms. Les deux : 5 ms.
CREATE INDEX idx_operations_org_customer_created
    ON operations (organization_id, customer_id, created_at, status);


-- -----------------------------------------------------------------
-- 7. L'ARGENT PAR DATE : 27 ms → 0 ms, et 5 ms → 1 ms
-- -----------------------------------------------------------------
-- Le tableau de bord demande la recette du jour, le journal balaie
-- quatre-vingt-dix jours. Les deux filtrent sur (entreprise, date).
--
-- `idx_payments_station_date` commence par (organization_id,
-- station_id, paid_at) : comme pour les opérations, il ne sert que
-- lorsqu'on filtre AUSSI sur une station — c'est-à-dire jamais sur le
-- tableau de bord d'un propriétaire qui regarde tout son réseau.
--
-- `status` et `amount` sont dans l'index parce que ces requêtes ne
-- demandent rien d'autre : les montants s'additionnent sans ouvrir la
-- table une seule fois.
CREATE INDEX idx_payments_org_paid
    ON payments (organization_id, paid_at, status, amount);
