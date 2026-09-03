-- =================================================================
-- Jeu de données de démonstration
-- =================================================================
-- Une station sénégalaise plausible, avec un parcours complet déjà
-- joué. Objectif : pouvoir développer et tester les écrans des lots
-- suivants sans devoir tout saisir à la main à chaque fois.
--
-- Les données sont VOLONTAIREMENT réalistes — vrais noms, vraies
-- plaques, vrais montants en FCFA. Une base remplie de « test1 » et
-- « aaa » ne permet pas de juger si une interface tient debout.
--
-- Mot de passe des trois comptes : Autocare2026!
-- (empreinte bcrypt ci-dessous — à ne jamais réutiliser en production)
--
-- ATTENTION : ce fichier suppose une base fraîchement migrée.
-- Lance « php tools/migrate.php --fresh » avant « php tools/seed.php ».
-- =================================================================

-- --- L'entreprise cliente ----------------------------------------
-- onboarding_completed_at est renseigné : cette entreprise a des
-- stations, des prestations, des clients et des véhicules — son
-- installation EST terminée. Sans cette date, se connecter avec un
-- compte de démonstration renverrait vers l'installation guidée d'une
-- station déjà configurée, ce qui n'a aucun sens.
INSERT INTO organizations (id, name, slug, phone, email, country_code, currency_code, timezone, onboarding_completed_at)
VALUES (1, 'Groupe Diallo Auto', 'diallo-auto', '+221338211234', 'contact@dialloauto.sn', 'SN', 'XOF', 'Africa/Dakar', '2026-08-01 09:00:00');

-- --- Les utilisateurs --------------------------------------------
-- Trois rôles pour pouvoir tester les permissions dès le lot 4.
INSERT INTO users (id, organization_id, first_name, last_name, email, phone, password_hash, status) VALUES
(1, 1, 'Mamadou', 'Diallo', 'mamadou.diallo@dialloauto.sn', '+221771234567', '$2y$12$aEImq6DKh7gSNNVHemCTwu/VGeug3lFGn5yFrwSajaR2gyNJ03/d.', 'ACTIVE'),
(2, 1, 'Awa',     'Ndiaye', 'awa.ndiaye@dialloauto.sn',     '+221772345678', '$2y$12$aEImq6DKh7gSNNVHemCTwu/VGeug3lFGn5yFrwSajaR2gyNJ03/d.', 'ACTIVE'),
(3, 1, 'Aliou',   'Sow',    'aliou.sow@dialloauto.sn',      '+221773456789', '$2y$12$aEImq6DKh7gSNNVHemCTwu/VGeug3lFGn5yFrwSajaR2gyNJ03/d.', 'ACTIVE'),
(4, 1, 'Ousmane', 'Ba',     'ousmane.ba@dialloauto.sn',     '+221774567890', '$2y$12$aEImq6DKh7gSNNVHemCTwu/VGeug3lFGn5yFrwSajaR2gyNJ03/d.', 'ACTIVE');

-- --- Les stations -------------------------------------------------
INSERT INTO stations (id, organization_id, name, code, address, city, phone, opens_at, closes_at) VALUES
(1, 1, 'Station Dakar Plateau', 'DKP', 'Avenue Léopold Sédar Senghor', 'Dakar', '+221338211234', '07:30:00', '20:00:00'),
(2, 1, 'Station Thiès',         'THS', 'Route de Dakar',                'Thiès', '+221339512345', '08:00:00', '19:00:00');

-- --- Qui travaille où --------------------------------------------
-- Mamadou est administrateur sur les deux stations.
-- Awa est manager à Dakar. Aliou et Ousmane y sont employés.
INSERT INTO station_users (organization_id, station_id, user_id, role) VALUES
(1, 1, 1, 'ADMIN'),
(1, 2, 1, 'ADMIN'),
(1, 1, 2, 'MANAGER'),
(1, 1, 3, 'EMPLOYEE'),
(1, 1, 4, 'EMPLOYEE');

-- --- Le catalogue de prestations ---------------------------------
-- Prix en FCFA, entiers. Durées réalistes pour une station de lavage.
INSERT INTO services (id, organization_id, name, description, category, price, duration_minutes) VALUES
(1, 1, 'Lavage standard',     'Extérieur, jantes et vitres.',                     'Lavage',    5000,  30),
(2, 1, 'Lavage premium',      'Extérieur, intérieur, tableau de bord, cire.',     'Lavage',   10000,  60),
(3, 1, 'Nettoyage intérieur', 'Aspiration, sièges, moquettes, plastiques.',       'Intérieur', 7500,  45),
(4, 1, 'Polissage',           'Correction des micro-rayures de la carrosserie.',  'Detailing',20000, 120),
(5, 1, 'Detailing complet',   'Traitement complet intérieur et extérieur.',       'Detailing',35000, 240);

-- --- Les clients --------------------------------------------------
-- created_at est renseigné explicitement : sans cela, MySQL daterait
-- tout de « maintenant », et l'interface afficherait « client depuis
-- à l'instant » à côté d'un historique de plusieurs mois. Une
-- démonstration incohérente donne l'impression d'un produit qui se
-- trompe.
INSERT INTO customers (id, organization_id, first_name, last_name, phone, email, created_at) VALUES
(1, 1, 'Cheikh',  'Fall',   '+221776112233', 'cheikh.fall@example.sn', '2026-02-14 10:20:00'),
(2, 1, 'Fatou',   'Ndiaye', '+221776223344', NULL,                     '2026-04-02 15:45:00'),
(3, 1, 'Aminata', 'Sarr',   '+221776334455', 'a.sarr@example.sn',      '2026-06-19 08:30:00'),
(4, 1, 'Ibrahima','Gueye',  '+221776445566', NULL,                     '2026-08-25 17:10:00');

-- --- Les véhicules ------------------------------------------------
-- Plaques stockées normalisées : majuscules, sans séparateur.
-- L'affichage remet les tirets (DK1234AA devient DK-1234-AA).
INSERT INTO vehicles (id, organization_id, customer_id, plate_number, brand, model, color, vehicle_type, created_at) VALUES
(1, 1, 1, 'DK1234AA', 'Toyota',  'Corolla', 'Gris',  'CAR',    '2026-02-14 10:25:00'),
(2, 1, 2, 'DK5678BC', 'Hyundai', 'Tucson',  'Blanc', 'SUV',    '2026-04-02 15:50:00'),
(3, 1, 3, 'DK9087DE', 'Renault', 'Duster',  'Noir',  'SUV',    '2026-06-19 08:35:00'),
(4, 1, 4, 'TH4412CD', 'Peugeot', '208',     'Rouge', 'CAR',    '2026-08-25 17:15:00'),
(5, 1, 1, 'DK2201FG', 'Toyota',  'Hilux',   'Blanc', 'PICKUP', '2026-05-11 11:00:00');

-- --- Les opérations -----------------------------------------------
-- Quatre véhicules à différents stades du parcours, pour que la file
-- d'attente du lot 8 ait immédiatement quelque chose à afficher.
-- Le prix est recopié depuis services.price : il est figé.
-- ------------------------------------------------------------------
-- LES DATES SONT RELATIVES À MAINTENANT, PAS ÉCRITES EN DUR.
--
-- La file d'attente ne montre pas un état, elle montre une DURÉE :
-- « en lavage depuis 1 h 40 alors que la prestation en prend 30 ».
-- Avec des dates figées au 31 août, le jeu de démonstration afficherait
-- au bout d'une semaine « en attente depuis 7 jours » sur chaque carte,
-- et l'écran paraîtrait cassé alors qu'il fonctionne.
--
-- NOW() - INTERVAL n MINUTE garde la démonstration vivante quel que
-- soit le jour où on la charge. C'est le genre de détail qui décide si
-- une démonstration convainc un gérant ou l'inquiète.
--
-- Les durées choisies racontent une matinée crédible : une voiture
-- restituée, une prête depuis un moment, un lavage qui traîne un peu,
-- et un client pressé qui vient d'arriver.
-- ------------------------------------------------------------------
INSERT INTO operations
    (id, organization_id, station_id, vehicle_id, customer_id, service_id, assigned_user_id,
     reference, status, status_changed_at, priority, price, started_at, completed_at, released_at,
     released_by_user_id, created_by_user_id, created_at) VALUES
-- Terminée et restituée : le parcours complet, celui du §41.
(1, 1, 1, 1, 1, 2, 3, 'DKP-2608-0001', 'COMPLETED', NOW() - INTERVAL 95 MINUTE, 0, 10000,
 NOW() - INTERVAL 185 MINUTE, NOW() - INTERVAL 120 MINUTE, NOW() - INTERVAL 95 MINUTE,
 2, 2, NOW() - INTERVAL 190 MINUTE),
-- Prête depuis 40 minutes : le client tarde à venir la chercher.
(2, 1, 1, 4, 4, 1, 3, 'DKP-2608-0002', 'READY', NOW() - INTERVAL 40 MINUTE, 0, 5000,
 NOW() - INTERVAL 115 MINUTE, NOW() - INTERVAL 40 MINUTE, NULL, NULL, 2,
 NOW() - INTERVAL 120 MINUTE),
-- En lavage depuis 50 minutes pour une prestation de 45 : en retard.
-- C'est volontaire — l'écran doit montrer à quoi ressemble un oubli.
(3, 1, 1, 2, 2, 3, 4, 'DKP-2608-0003', 'WASHING', NOW() - INTERVAL 50 MINUTE, 0, 7500,
 NOW() - INTERVAL 55 MINUTE, NULL, NULL, NULL, 2, NOW() - INTERVAL 60 MINUTE),
-- Dans la file depuis 12 minutes, personne d'assigné, client pressé.
(4, 1, 1, 3, 3, 5, NULL, 'DKP-2608-0004', 'WAITING', NOW() - INTERVAL 12 MINUTE, 2, 35000,
 NULL, NULL, NULL, NULL, 2, NOW() - INTERVAL 12 MINUTE);

-- --- Les inspections d'entrée -------------------------------------
INSERT INTO inspections
    (id, organization_id, operation_id, vehicle_id, type, performed_by_user_id,
     fuel_level, mileage, has_damage, damage_notes, items_left, customer_present,
     signature_name, performed_at) VALUES
(1, 1, 1, 1, 'ENTRY', 3, 'HALF', 84520, 0, NULL, NULL, 1, 'Cheikh Fall', NOW() - INTERVAL 188 MINUTE),
(2, 1, 2, 4, 'ENTRY', 3, 'QUARTER', 132890, 1,
 'Rayure de 10 cm sur la portière avant droite, présente à l''arrivée.',
 'Siège enfant à l''arrière.', 1, 'Ibrahima Gueye', NOW() - INTERVAL 118 MINUTE),
(3, 1, 3, 2, 'ENTRY', 4, 'FULL', 45120, 0, NULL, 'Chargeur de téléphone.', 0, NULL, NOW() - INTERVAL 58 MINUTE);

-- --- Les photos d'inspection --------------------------------------
-- Ce sont des MÉTADONNÉES seulement : aucun fichier n'existe encore
-- sur le disque. L'envoi réel des photos arrive au lot 7.
-- Les empreintes sont factices mais au bon format (64 caractères).
INSERT INTO inspection_photos
    (organization_id, inspection_id, position, file_path, file_hash, mime_type, file_size,
     width, height, uploaded_by_user_id) VALUES
(1, 1, 'FRONT',    '2026/08/demo-0001-front.webp',    REPEAT('a', 64), 'image/webp', 184320, 1280, 960, 3),
(1, 1, 'REAR',     '2026/08/demo-0001-rear.webp',     REPEAT('b', 64), 'image/webp', 176128, 1280, 960, 3),
(1, 2, 'FRONT',    '2026/08/demo-0002-front.webp',    REPEAT('c', 64), 'image/webp', 192512, 1280, 960, 3),
(1, 2, 'DAMAGE',   '2026/08/demo-0002-damage.webp',   REPEAT('d', 64), 'image/webp', 210944, 1280, 960, 3),
(1, 3, 'INTERIOR', '2026/08/demo-0003-interior.webp', REPEAT('e', 64), 'image/webp', 165888, 1280, 960, 4);

-- --- Les paiements ------------------------------------------------
-- Saisis à la main par le caissier : aucun fournisseur n'est intégré.
INSERT INTO payments
    (organization_id, station_id, operation_id, customer_id, amount, method,
     provider, external_reference, status, paid_at, recorded_by_user_id) VALUES
(1, 1, 1, 1, 10000, 'MOBILE_MONEY', 'Wave', 'TX-8842019', 'PAID', NOW() - INTERVAL 100 MINUTE, 2),
(1, 1, 2, 4,  5000, 'CASH',          NULL,   NULL,         'PAID', NOW() - INTERVAL 38 MINUTE, 2);

-- --- Le journal d'audit -------------------------------------------
-- Quelques lignes montrant le format attendu. Ce journal sera
-- alimenté automatiquement par l'API à partir du lot 4.
INSERT INTO audit_logs (organization_id, station_id, user_id, action, entity_type, entity_id, metadata) VALUES
(1, 1, 2, 'operation.created',        'operation', 1, '{"reference":"DKP-2608-0001"}'),
(1, 1, 3, 'inspection.created',       'operation', 1, '{"type":"ENTRY","has_damage":false}'),
(1, 1, 3, 'operation.status_changed', 'operation', 1, '{"from":"WASHING","to":"QUALITY_CHECK"}'),
(1, 1, 2, 'payment.recorded',         'operation', 1, '{"amount":10000,"method":"MOBILE_MONEY"}'),
(1, 1, 2, 'operation.released',       'operation', 1, '{"released_to":"Cheikh Fall"}');
