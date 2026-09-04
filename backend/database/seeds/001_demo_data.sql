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

-- ------------------------------------------------------------------
-- L'HISTORIQUE DE LA SEMAINE
-- ------------------------------------------------------------------
-- Treize dossiers déjà clos, répartis sur les six jours précédents.
--
-- POURQUOI S'EMBÊTER AVEC UN HISTORIQUE ?
-- Parce que le tableau de bord du lot 10 montre une TENDANCE. Avec
-- les seules opérations du jour, la courbe de recette n'aurait qu'une
-- barre — et un graphique à une barre n'apprend rien à personne, il
-- fait juste croire que l'écran est cassé.
--
-- DEUX PRÉCAUTIONS QUI ONT L'AIR DE DÉTAILS ET N'EN SONT PAS :
--
-- 1. Les montants varient d'un jour à l'autre. Un jeu de données où
--    chaque journée vaut la même somme laisserait croire qu'une
--    station tourne à plat, et masquerait l'intérêt même du
--    graphique.
--
-- 2. L'arrivée et la fin de prestation sont ESPACÉES de 36 à
--    120 minutes selon la prestation. Les mettre à la même seconde
--    ferait afficher « durée moyenne : 0 minute » au tableau de
--    bord — un chiffre faux qu'on croirait, ce qui est pire qu'un
--    chiffre absent.
-- ------------------------------------------------------------------
INSERT INTO operations
    (id, organization_id, station_id, vehicle_id, customer_id, service_id, assigned_user_id,
     reference, status, status_changed_at, priority, price, started_at, completed_at, released_at,
     released_by_user_id, created_by_user_id, created_at) VALUES
(11, 1, 1, 1, 1, 1, 3, 'DKP-2608-0011', 'COMPLETED', NOW() - INTERVAL 1 DAY, 0,  5000,
 NOW() - INTERVAL 1 DAY - INTERVAL 30 MINUTE, NOW() - INTERVAL 1 DAY, NOW() - INTERVAL 1 DAY, 2, 2, NOW() - INTERVAL 1 DAY - INTERVAL 40 MINUTE),
(12, 1, 1, 2, 2, 3, 4, 'DKP-2608-0012', 'COMPLETED', NOW() - INTERVAL 1 DAY, 0,  7500,
 NOW() - INTERVAL 1 DAY - INTERVAL 45 MINUTE, NOW() - INTERVAL 1 DAY, NOW() - INTERVAL 1 DAY, 2, 2, NOW() - INTERVAL 1 DAY - INTERVAL 55 MINUTE),
(13, 1, 1, 4, 4, 2, 3, 'DKP-2608-0013', 'COMPLETED', NOW() - INTERVAL 2 DAY, 0, 10000,
 NOW() - INTERVAL 2 DAY - INTERVAL 55 MINUTE, NOW() - INTERVAL 2 DAY, NOW() - INTERVAL 2 DAY, 2, 2, NOW() - INTERVAL 2 DAY - INTERVAL 65 MINUTE),
(14, 1, 1, 3, 3, 1, 4, 'DKP-2608-0014', 'COMPLETED', NOW() - INTERVAL 2 DAY, 0,  5000,
 NOW() - INTERVAL 2 DAY - INTERVAL 28 MINUTE, NOW() - INTERVAL 2 DAY, NOW() - INTERVAL 2 DAY, 2, 2, NOW() - INTERVAL 2 DAY - INTERVAL 38 MINUTE),
(15, 1, 1, 5, 4, 3, 3, 'DKP-2608-0015', 'COMPLETED', NOW() - INTERVAL 2 DAY, 0,  7500,
 NOW() - INTERVAL 2 DAY - INTERVAL 40 MINUTE, NOW() - INTERVAL 2 DAY, NOW() - INTERVAL 2 DAY, 2, 2, NOW() - INTERVAL 2 DAY - INTERVAL 50 MINUTE),
(16, 1, 1, 1, 1, 5, 3, 'DKP-2608-0016', 'COMPLETED', NOW() - INTERVAL 3 DAY, 0, 35000,
 NOW() - INTERVAL 3 DAY - INTERVAL 110 MINUTE, NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY, 2, 2, NOW() - INTERVAL 3 DAY - INTERVAL 120 MINUTE),
(17, 1, 1, 2, 2, 1, 4, 'DKP-2608-0017', 'COMPLETED', NOW() - INTERVAL 3 DAY, 0,  5000,
 NOW() - INTERVAL 3 DAY - INTERVAL 32 MINUTE, NOW() - INTERVAL 3 DAY, NOW() - INTERVAL 3 DAY, 2, 2, NOW() - INTERVAL 3 DAY - INTERVAL 42 MINUTE),
(18, 1, 1, 4, 4, 1, 3, 'DKP-2608-0018', 'COMPLETED', NOW() - INTERVAL 4 DAY, 0,  5000,
 NOW() - INTERVAL 4 DAY - INTERVAL 26 MINUTE, NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 4 DAY, 2, 2, NOW() - INTERVAL 4 DAY - INTERVAL 36 MINUTE),
(19, 1, 1, 3, 3, 2, 4, 'DKP-2608-0019', 'COMPLETED', NOW() - INTERVAL 4 DAY, 0, 10000,
 NOW() - INTERVAL 4 DAY - INTERVAL 48 MINUTE, NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 4 DAY, 2, 2, NOW() - INTERVAL 4 DAY - INTERVAL 58 MINUTE),
(20, 1, 1, 5, 4, 1, 3, 'DKP-2608-0020', 'COMPLETED', NOW() - INTERVAL 5 DAY, 0,  5000,
 NOW() - INTERVAL 5 DAY - INTERVAL 34 MINUTE, NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 5 DAY, 2, 2, NOW() - INTERVAL 5 DAY - INTERVAL 44 MINUTE),
(21, 1, 1, 1, 1, 3, 4, 'DKP-2608-0021', 'COMPLETED', NOW() - INTERVAL 5 DAY, 0,  7500,
 NOW() - INTERVAL 5 DAY - INTERVAL 42 MINUTE, NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 5 DAY, 2, 2, NOW() - INTERVAL 5 DAY - INTERVAL 52 MINUTE),
(22, 1, 1, 2, 2, 1, 3, 'DKP-2608-0022', 'COMPLETED', NOW() - INTERVAL 5 DAY, 0,  5000,
 NOW() - INTERVAL 5 DAY - INTERVAL 29 MINUTE, NOW() - INTERVAL 5 DAY, NOW() - INTERVAL 5 DAY, 2, 2, NOW() - INTERVAL 5 DAY - INTERVAL 39 MINUTE),
(23, 1, 1, 4, 4, 2, 4, 'DKP-2608-0023', 'COMPLETED', NOW() - INTERVAL 6 DAY, 0, 10000,
 NOW() - INTERVAL 6 DAY - INTERVAL 51 MINUTE, NOW() - INTERVAL 6 DAY, NOW() - INTERVAL 6 DAY, 2, 2, NOW() - INTERVAL 6 DAY - INTERVAL 61 MINUTE);

-- Les encaissements correspondants. Le mélange espèces / mobile money
-- reflète l'usage sénégalais : Wave et Orange Money sont très
-- répandus en ville, les espèces restent fréquentes.
INSERT INTO payments
    (organization_id, station_id, operation_id, customer_id, amount, method,
     provider, external_reference, status, paid_at, recorded_by_user_id) VALUES
(1, 1, 11, 1,  5000, 'CASH',            NULL,          NULL, 'PAID', NOW() - INTERVAL 1 DAY, 2),
(1, 1, 12, 2,  7500, 'MOBILE_MONEY',          'Wave',  'TX-7712004', 'PAID', NOW() - INTERVAL 1 DAY, 2),
(1, 1, 13, 4, 10000, 'MOBILE_MONEY',  'Orange Money',  'OM-4410233', 'PAID', NOW() - INTERVAL 2 DAY, 2),
(1, 1, 14, 3,  5000, 'CASH',            NULL,          NULL, 'PAID', NOW() - INTERVAL 2 DAY, 2),
(1, 1, 15, 4,  7500, 'CASH',            NULL,          NULL, 'PAID', NOW() - INTERVAL 2 DAY, 2),
(1, 1, 16, 1, 35000, 'CARD',            NULL,   'CB-559120', 'PAID', NOW() - INTERVAL 3 DAY, 2),
(1, 1, 17, 2,  5000, 'CASH',            NULL,          NULL, 'PAID', NOW() - INTERVAL 3 DAY, 2),
(1, 1, 18, 4,  5000, 'MOBILE_MONEY',          'Wave',  'TX-7712889', 'PAID', NOW() - INTERVAL 4 DAY, 2),
(1, 1, 19, 3, 10000, 'CASH',            NULL,          NULL, 'PAID', NOW() - INTERVAL 4 DAY, 2),
(1, 1, 20, 4,  5000, 'CASH',            NULL,          NULL, 'PAID', NOW() - INTERVAL 5 DAY, 2),
(1, 1, 21, 1,  7500, 'MOBILE_MONEY',          'Wave',  'TX-7713401', 'PAID', NOW() - INTERVAL 5 DAY, 2),
(1, 1, 22, 2,  5000, 'CASH',            NULL,          NULL, 'PAID', NOW() - INTERVAL 5 DAY, 2),
(1, 1, 23, 4, 10000, 'MOBILE_MONEY',  'Orange Money',  'OM-4411907', 'PAID', NOW() - INTERVAL 6 DAY, 2);

-- ------------------------------------------------------------------
-- LE POINTAGE
-- ------------------------------------------------------------------
-- Six journées passées pour deux employés, plus deux situations que
-- l'écran doit savoir montrer :
--
--   - un pointage EN COURS (Aliou est là depuis ce matin) ;
--   - un pointage JAMAIS FERMÉ, il y a trois jours. C'est l'anomalie
--     la plus fréquente du module : quelqu'un part sans pointer, et
--     le compteur tourne toute la nuit. Le logiciel ne le ferme pas
--     tout seul — il ne sait pas à quelle heure la personne est
--     partie, et inventer cette heure fabriquerait une donnée de
--     paie. Il le signale, un responsable tranche.
--
-- Les journées font 8 à 9 heures, ce qui correspond à une station
-- ouverte de 8 h à 18 h avec une pause.
-- ------------------------------------------------------------------
INSERT INTO time_entries
    (organization_id, station_id, user_id, clock_in_at, clock_out_at, duration_minutes) VALUES
-- Aliou Sow (3)
(1, 1, 3, NOW() - INTERVAL 6 DAY - INTERVAL 9 HOUR, NOW() - INTERVAL 6 DAY, 540),
(1, 1, 3, NOW() - INTERVAL 5 DAY - INTERVAL 8 HOUR, NOW() - INTERVAL 5 DAY, 480),
(1, 1, 3, NOW() - INTERVAL 4 DAY - INTERVAL 9 HOUR, NOW() - INTERVAL 4 DAY, 540),
(1, 1, 3, NOW() - INTERVAL 2 DAY - INTERVAL 8 HOUR, NOW() - INTERVAL 2 DAY, 480),
(1, 1, 3, NOW() - INTERVAL 1 DAY - INTERVAL 9 HOUR, NOW() - INTERVAL 1 DAY, 540),
-- Ousmane Ba (4)
(1, 1, 4, NOW() - INTERVAL 6 DAY - INTERVAL 8 HOUR, NOW() - INTERVAL 6 DAY, 480),
(1, 1, 4, NOW() - INTERVAL 4 DAY - INTERVAL 9 HOUR, NOW() - INTERVAL 4 DAY, 540),
(1, 1, 4, NOW() - INTERVAL 2 DAY - INTERVAL 8 HOUR, NOW() - INTERVAL 2 DAY, 480),
(1, 1, 4, NOW() - INTERVAL 1 DAY - INTERVAL 8 HOUR, NOW() - INTERVAL 1 DAY, 480),
-- L'OUBLI : parti il y a trois jours sans pointer son départ.
(1, 1, 4, NOW() - INTERVAL 3 DAY - INTERVAL 9 HOUR, NULL, NULL),
-- EN COURS : Aliou est arrivé ce matin.
(1, 1, 3, NOW() - INTERVAL 190 MINUTE, NULL, NULL);

-- --- Les rendez-vous ----------------------------------------------
-- Sept lignes qui couvrent tout ce que l'écran doit savoir afficher :
-- un rendez-vous à venir, un confirmé, un dépassé qu'il faut traiter,
-- un client de passage sans fiche, deux véhicules sur le même
-- créneau, et l'historique d'une absence et d'une annulation.
--
-- Les prix sont RECOPIÉS du catalogue, comme le fait l'API : c'est
-- ce qui a été annoncé au client, pas le tarif du jour.
INSERT INTO bookings
    (organization_id, station_id, service_id, customer_id, vehicle_id,
     customer_name, customer_phone, plate_number,
     scheduled_at, duration_minutes, price, status,
     outcome_at, outcome_by_user_id, outcome_reason, notes, created_by_user_id) VALUES

-- 1. Dans deux heures. Client connu, véhicule connu.
(1, 1, 2, 1, 1, 'Cheikh Fall', '+221776112233', 'DK1234AA',
 DATE_ADD(CURDATE(), INTERVAL 15 HOUR), 60, 10000, 'SCHEDULED',
 NULL, NULL, NULL, NULL, 2),

-- 2. Confirmé : quelqu'un a rappelé hier soir.
(1, 1, 3, 2, 2, 'Fatou Ndiaye', '+221776223344', 'DK5678BC',
 DATE_ADD(CURDATE(), INTERVAL 16 HOUR), 45, 7500, 'CONFIRMED',
 NULL, NULL, NULL, 'A demandé qu\'on insiste sur les moquettes.', 2),

-- 3. L'HEURE EST PASSÉE et personne n'a rien noté : c'est la ligne
--    qui apparaît en tête de l'écran, dans « à traiter ».
(1, 1, 1, 3, 3, 'Aminata Sarr', '+221776334455', 'DK9087DE',
 DATE_ADD(CURDATE(), INTERVAL 8 HOUR), 30, 5000, 'SCHEDULED',
 NULL, NULL, NULL, NULL, 3),

-- 4. UN CLIENT DE PASSAGE : un nom, un numéro, rien d'autre. Ni
--    fiche client, ni véhicule — c'est le cas normal au téléphone.
(1, 1, 1, NULL, NULL, 'Moussa Diop', '+221775998877', NULL,
 DATE_ADD(CURDATE(), INTERVAL 1 DAY) + INTERVAL 10 HOUR, 30, 5000, 'SCHEDULED',
 NULL, NULL, NULL, 'Premier passage, a appelé pour les tarifs.', 3),

-- 5 et 6. DEUX VÉHICULES DE LA MÊME ENTREPRISE, MÊME CRÉNEAU.
--    C'est précisément le cas qu'une contrainte d'unicité sur
--    (station, heure, téléphone) aurait refusé — voir la note de la
--    migration 019.
(1, 1, 1, NULL, NULL, 'SENEGAL LOGISTIQUE (flotte)', '+221338224466', 'DK7788KL',
 DATE_ADD(CURDATE(), INTERVAL 1 DAY) + INTERVAL 11 HOUR, 30, 5000, 'SCHEDULED',
 NULL, NULL, NULL, 'Deux véhicules, même heure.', 2),
(1, 1, 1, NULL, NULL, 'SENEGAL LOGISTIQUE (flotte)', '+221338224466', 'DK7789KL',
 DATE_ADD(CURDATE(), INTERVAL 1 DAY) + INTERVAL 11 HOUR, 30, 5000, 'SCHEDULED',
 NULL, NULL, NULL, 'Deux véhicules, même heure.', 2),

-- 7. L'HISTORIQUE : une absence et une annulation la semaine dernière.
(1, 1, 4, 4, 4, 'Ibrahima Gueye', '+221776445566', 'TH4412CD',
 DATE_SUB(CURDATE(), INTERVAL 4 DAY) + INTERVAL 9 HOUR, 120, 20000, 'NO_SHOW',
 DATE_SUB(CURDATE(), INTERVAL 4 DAY) + INTERVAL 10 HOUR, 2, NULL, NULL, 2),
(1, 1, 2, 1, 5, 'Cheikh Fall', '+221776112233', 'DK2201FG',
 DATE_SUB(CURDATE(), INTERVAL 2 DAY) + INTERVAL 14 HOUR, 60, 10000, 'CANCELLED',
 DATE_SUB(CURDATE(), INTERVAL 3 DAY) + INTERVAL 18 HOUR, 2, 'Le client a eu un imprévu, rappellera.', NULL, 2);

-- --- La fidélité ---------------------------------------------------
-- Un programme ACTIF, et quatre clients à des stades différents pour
-- que l'écran ait immédiatement quelque chose à montrer : un qui a sa
-- récompense en poche, un à qui il manque un lavage, et deux qui
-- commencent.
--
-- LES TAMPONS SONT RATTACHÉS À DES DOSSIERS RÉELS de ce jeu de
-- démonstration, et à des dossiers RESTITUÉS. Dans le produit, un
-- tampon n'existe jamais sans le lavage payé qui l'a fait gagner —
-- un jeu de démonstration qui l'oublierait montrerait un écran
-- impossible à obtenir en vrai.
--
-- La contrainte d'unicité sur `earn_operation_id` interdit d'ailleurs
-- deux tampons sur le même dossier : ces lignes ne passeraient pas.
INSERT INTO loyalty_programs
    (id, organization_id, name, stamps_required, reward_amount,
     min_operation_amount, status, created_by_user_id) VALUES
(1, 1, 'Carte de fidélité', 5, 5000, 3000, 'ACTIVE', 1);

INSERT INTO loyalty_entries
    (organization_id, program_id, customer_id, type, points, operation_id,
     reward_amount, note, created_by_user_id, created_at) VALUES
-- LE COÛT DU PROGRAMME EST À ZÉRO dans ce jeu de démonstration, et
-- c'est volontaire : personne n'a encore utilisé sa récompense. Le
-- chiffre apparaîtra à la première remise appliquée — c'est
-- exactement ce que vit un gérant qui vient de lancer sa carte.
--
-- Ibrahima Gueye : cinq tampons. Sa récompense l'attend, et il ne le
-- sait probablement pas — c'est lui qui apparaît dans « à rappeler ».
(1, 1, 4, 'EARN', 1, 13, 5000, 'Dossier restitué', 2, NOW() - INTERVAL 62 DAY),
(1, 1, 4, 'EARN', 1, 15, 5000, 'Dossier restitué', 2, NOW() - INTERVAL 48 DAY),
(1, 1, 4, 'EARN', 1, 18, 5000, 'Dossier restitué', 3, NOW() - INTERVAL 31 DAY),
(1, 1, 4, 'EARN', 1, 20, 5000, 'Dossier restitué', 3, NOW() - INTERVAL 17 DAY),
(1, 1, 4, 'EARN', 1, 23, 5000, 'Dossier restitué', 2, NOW() - INTERVAL 1 DAY),
-- Cheikh Fall : quatre tampons, il lui en manque un seul.
(1, 1, 1, 'EARN', 1, 1,  5000, 'Dossier DKP-2608-0001', 2, NOW() - INTERVAL 55 DAY),
(1, 1, 1, 'EARN', 1, 11, 5000, 'Dossier restitué', 2, NOW() - INTERVAL 40 DAY),
(1, 1, 1, 'EARN', 1, 16, 5000, 'Dossier restitué', 3, NOW() - INTERVAL 21 DAY),
(1, 1, 1, 'EARN', 1, 21, 5000, 'Dossier restitué', 2, NOW() - INTERVAL 2 DAY),
-- Fatou Ndiaye : trois tampons.
(1, 1, 2, 'EARN', 1, 12, 5000, 'Dossier restitué', 2, NOW() - INTERVAL 44 DAY),
(1, 1, 2, 'EARN', 1, 17, 5000, 'Dossier restitué', 3, NOW() - INTERVAL 26 DAY),
(1, 1, 2, 'EARN', 1, 22, 5000, 'Dossier restitué', 2, NOW() - INTERVAL 3 DAY),
-- Aminata Sarr : elle commence.
(1, 1, 3, 'EARN', 1, 14, 5000, 'Dossier restitué', 2, NOW() - INTERVAL 35 DAY),
(1, 1, 3, 'EARN', 1, 19, 5000, 'Dossier restitué', 3, NOW() - INTERVAL 12 DAY);

-- --- Les abonnements -----------------------------------------------
-- Un forfait proposé, et deux clients à des stades différents : l'un
-- a bien entamé le sien, l'autre arrive au bout de sa validité — la
-- ligne qui apparaît dans « à rappeler ».
--
-- LES LAVAGES CONSOMMÉS NE SONT PAS UN COMPTEUR : ce sont les
-- opérations rattachées, plus bas. Un jeu de démonstration qui
-- écrirait « 3 lavages utilisés » sans les trois opérations
-- montrerait un écran impossible à obtenir en vrai.
INSERT INTO subscription_plans
    (id, organization_id, name, service_id, washes, price, validity_days,
     status, created_by_user_id) VALUES
(1, 1, 'Forfait 10 lavages', 1, 10, 40000, 180, 'ACTIVE', 1);

INSERT INTO subscriptions
    (id, organization_id, customer_id, plan_id, station_id, service_id,
     washes_total, price_paid, starts_at, expires_at, status,
     sold_by_user_id, created_at) VALUES
-- Cheikh Fall : forfait entamé, il lui reste de la marge.
(1, 1, 1, 1, 1, 1, 10, 40000,
 CURDATE() - INTERVAL 40 DAY, CURDATE() + INTERVAL 140 DAY, 'ACTIVE',
 2, NOW() - INTERVAL 40 DAY),
-- Fatou Ndiaye : son forfait périme dans deux semaines et il lui
-- reste des lavages. C'est elle qu'il faut appeler.
(2, 1, 2, 1, 1, 1, 10, 40000,
 CURDATE() - INTERVAL 166 DAY, CURDATE() + INTERVAL 14 DAY, 'ACTIVE',
 2, NOW() - INTERVAL 166 DAY);

-- L'ENCAISSEMENT DE CHAQUE VENTE. L'argent est entré le jour de
-- l'achat : il doit être dans le journal, comme n'importe quel
-- encaissement. Un forfait vendu sans ligne de paiement laisserait
-- croire que la station a donné dix lavages.
INSERT INTO payments
    (organization_id, station_id, operation_id, subscription_id, customer_id,
     amount, method, status, paid_at, recorded_by_user_id, notes) VALUES
(1, 1, NULL, 1, 1, 40000, 'CASH', 'PAID', NOW() - INTERVAL 40 DAY, 2,
 'Forfait « Forfait 10 lavages »'),
(1, 1, NULL, 2, 2, 40000, 'MOBILE_MONEY', 'PAID', NOW() - INTERVAL 166 DAY, 2,
 'Forfait « Forfait 10 lavages »');

-- Les lavages déjà pris sur ces forfaits : ce sont des OPÉRATIONS
-- restituées, marquées comme couvertes. Le dû est à zéro et la source
-- de la remise dit pourquoi — un lavage d'abonné n'est pas un cadeau.
-- ATTENTION : SEULES LES OPÉRATIONS DE LA PRESTATION COUVERTE.
-- Le forfait porte sur le lavage standard (prestation 1). Rattacher
-- un detailing à 35 000 F produirait une donnée que l'API refuserait
-- de créer — et un jeu de démonstration qui montre un écran
-- impossible à obtenir en vrai ne démontre rien.
UPDATE operations
   SET subscription_id = 1,
       discount_amount = price,
       discount_source = 'SUBSCRIPTION',
       discount_reason = 'Forfait « Forfait 10 lavages »',
       discount_by_user_id = 2,
       discounted_at = created_at
 WHERE id IN (11) AND service_id = 1;

UPDATE operations
   SET subscription_id = 2,
       discount_amount = price,
       discount_source = 'SUBSCRIPTION',
       discount_reason = 'Forfait « Forfait 10 lavages »',
       discount_by_user_id = 2,
       discounted_at = created_at
 WHERE id IN (17, 22) AND service_id = 1;

-- Ces lavages n'ont donc rien encaissé : on retire les paiements que
-- le jeu de démonstration leur avait attribués, sinon la recette
-- compterait deux fois le même argent — une fois à la vente du
-- forfait, une fois au lavage.
DELETE FROM payments WHERE operation_id IN (11, 17, 22);

-- --- Le journal d'audit -------------------------------------------
-- Quelques lignes montrant le format attendu. Ce journal sera
-- alimenté automatiquement par l'API à partir du lot 4.
INSERT INTO audit_logs (organization_id, station_id, user_id, action, entity_type, entity_id, metadata) VALUES
(1, 1, 2, 'operation.created',        'operation', 1, '{"reference":"DKP-2608-0001"}'),
(1, 1, 3, 'inspection.created',       'operation', 1, '{"type":"ENTRY","has_damage":false}'),
(1, 1, 3, 'operation.status_changed', 'operation', 1, '{"from":"WASHING","to":"QUALITY_CHECK"}'),
(1, 1, 2, 'payment.recorded',         'operation', 1, '{"amount":10000,"method":"MOBILE_MONEY"}'),
(1, 1, 2, 'operation.released',       'operation', 1, '{"released_to":"Cheikh Fall"}');
