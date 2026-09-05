-- =================================================================
-- Index de performance (lot 20)
-- =================================================================
-- AJOUTÉS APRÈS MESURE, PAS PAR ANTICIPATION.
--
-- Chacun de ces index répond à une requête dont le coût a été
-- constaté sur 76 000 opérations et 74 000 encaissements — le volume
-- d'une entreprise de trois stations après trois ans d'activité
-- (`php tools/benchmark_seed.php`).
--
-- Un index n'est pas gratuit : il occupe de la place, et il ralentit
-- chaque écriture, car MySQL doit le tenir à jour. On n'en pose donc
-- pas « au cas où » — on en pose quand une mesure montre ce qu'il
-- fait gagner, et le commentaire garde le chiffre.
-- =================================================================


-- -----------------------------------------------------------------
-- 1. LES ÉCRANS DE COMPTOIR : 87 ms → quelques millisecondes
-- -----------------------------------------------------------------
-- La file d'attente et la liste des dossiers en cours demandent
-- toutes deux « les opérations de cette entreprise dont le statut est
-- actif, les plus prioritaires d'abord ». Ce sont les écrans les plus
-- ouverts du produit — celui du comptoir reste affiché toute la
-- journée.
--
-- L'index existant `idx_operations_queue` commence par
-- (organization_id, station_id, …) : il sert parfaitement quand on
-- filtre SUR UNE STATION, et ne sert presque à rien sans ce filtre —
-- MySQL ne peut alors utiliser que sa première colonne. C'est
-- exactement ce que la mesure montrait : 10 ms filtré sur une
-- station, 87 ms sans filtre.
--
-- Pire, faute d'un index utilisable, l'optimiseur partait de la table
-- `services` et joignait les opérations par prestation, en triant le
-- résultat dans un fichier temporaire (« Using temporary; Using
-- filesort » au plan d'exécution).
ALTER TABLE operations
    ADD KEY idx_operations_org_status_priority (organization_id, status, priority);


-- -----------------------------------------------------------------
-- 2. « QUI REVIENT ? » : 282 ms → quelques millisecondes
-- -----------------------------------------------------------------
-- La statistique des clients fidèles pose, pour chaque client de la
-- période, la question « était-il déjà venu avant ? ». C'est une
-- sous-requête corrélée : elle s'exécute une fois par client.
--
-- Elle ne disposait que de `idx_operations_customer (customer_id)` :
-- MySQL trouvait bien les lignes du client, puis lisait chacune pour
-- vérifier l'entreprise, le statut et la date. Sur un client qui a
-- soixante passages, c'est soixante lectures — multipliées par
-- quelques milliers de clients.
--
-- LE `status` EST DANS L'INDEX, ET C'EST LUI QUI FAIT LA DIFFÉRENCE.
-- Sans lui, MySQL trouve les bonnes entrées puis doit ouvrir chaque
-- ligne de la table pour vérifier qu'elle n'est pas annulée : 80 ms.
-- Avec lui, l'index se suffit à lui-même — le plan d'exécution
-- l'annonce par « Using index » — et le même parcours tombe à 24 ms.
-- Une colonne d'un octet pour un facteur trois.
ALTER TABLE operations
    ADD KEY idx_operations_org_customer_created
        (organization_id, customer_id, created_at, status);


-- -----------------------------------------------------------------
-- 3. LES BALAYAGES DE STATISTIQUES : un index COUVRANT
-- -----------------------------------------------------------------
-- Les statistiques d'une année parcourent 38 000 opérations pour
-- compter, additionner et regrouper. Ce parcours est inévitable — la
-- question porte vraiment sur toutes ces lignes.
--
-- Ce qui l'est moins, c'est d'aller chercher chaque ligne dans la
-- table pour y lire trois colonnes. Un index qui PORTE ces colonnes
-- répond sans jamais ouvrir la table : MySQL l'annonce par « Using
-- index » au plan d'exécution.
--
-- On s'arrête à quatre colonnes. Y ajouter station_id, service_id et
-- les horodatages ferait un index presque aussi gros que la table :
-- on aurait recopié les données au lieu de les indexer.
ALTER TABLE operations
    ADD KEY idx_operations_analytics (organization_id, created_at, status, price);


-- -----------------------------------------------------------------
-- 4. LE TABLEAU DE BORD DU MATIN : ce qui a bougé AUJOURD'HUI
-- -----------------------------------------------------------------
-- Les compteurs de la journée — accueillis, restitués, annulés —
-- étaient calculés en parcourant l'historique ENTIER de l'entreprise,
-- sans aucun filtre de date. Le coût de l'écran du matin grandissait
-- donc avec l'âge du client, pour toujours.
--
-- La requête est corrigée dans DashboardRepository, et elle se borne
-- maintenant à `updated_at >= CURDATE()` : toute ligne touchée
-- aujourd'hui porte forcément cette marque, puisque la colonne se met
-- à jour à chaque écriture. Encore faut-il un index pour l'atteindre
-- sans lire le reste.
ALTER TABLE operations
    ADD KEY idx_operations_org_updated (organization_id, updated_at);


-- -----------------------------------------------------------------
-- 5. L'ARGENT PAR DATE : 21 ms → 0,2 ms, et 108 ms → 6 ms
-- -----------------------------------------------------------------
-- Le tableau de bord pose quatre questions aux encaissements — la
-- recette d'aujourd'hui, celle d'hier, celle des sept derniers jours,
-- la répartition par moyen de paiement — et le journal des recettes
-- en balaie quatre-vingt-dix jours.
--
-- Toutes filtrent sur (entreprise, date). L'index existant
-- `idx_payments_station_date` commence par (organization_id,
-- station_id, paid_at) : comme pour les opérations, il ne sert que
-- lorsqu'on filtre AUSSI sur une station — c'est-à-dire jamais sur le
-- tableau de bord d'un propriétaire qui regarde tout son réseau.
--
-- `status` et `amount` sont dans l'index parce que ces requêtes ne
-- demandent rien d'autre : MySQL additionne les montants sans ouvrir
-- la table une seule fois.
ALTER TABLE payments
    ADD KEY idx_payments_org_paid (organization_id, paid_at, status, amount);
