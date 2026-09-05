<?php

declare(strict_types=1);

/**
 * Fabrication d'un volume réaliste
 * ==================================================================
 * MESURER SUR LE JEU DE DÉMONSTRATION NE DIT RIEN.
 * ==================================================================
 * Usage, depuis le dossier backend/ :
 *
 *   php tools/benchmark_seed.php            trois ans d'activité
 *   php tools/benchmark_seed.php --purge    efface ce qu'il a créé
 *
 * ------------------------------------------------------------------
 * POURQUOI CET OUTIL EXISTE
 *
 * Le jeu de démonstration contient une quinzaine d'opérations. Toutes
 * les requêtes du produit y répondent en une milliseconde, y compris
 * celles qui parcourent la table entière — MySQL lit quinze lignes
 * plus vite qu'il ne lit un index.
 *
 * Une mesure sur ce jeu-là ne dit donc rien du tout : elle dit
 * seulement que quinze lignes tiennent en mémoire. Le premier travail
 * d'un lot de performance n'est pas de mesurer, c'est de se donner
 * quelque chose à mesurer.
 *
 * ------------------------------------------------------------------
 * LES VOLUMES VISÉS, ET D'OÙ ILS SORTENT
 *
 * Une station de lavage bien remplie traite 25 à 40 véhicules par
 * jour. Trois stations ouvertes six jours sur sept pendant trois ans,
 * cela fait environ 936 jours d'ouverture par station, et de l'ordre
 * de 75 000 dossiers avec leurs encaissements.
 *
 * C'est le volume d'une entreprise qui marche bien — précisément le
 * client qu'on ne peut pas se permettre de faire attendre, et celui
 * qu'on découvrirait trop tard si l'on ne mesurait que sur le jeu de
 * démonstration.
 *
 * Ces chiffres restent une HYPOTHÈSE, comme les seuils d'alerte du
 * lot 8 : personne n'a encore fait tourner le produit dans une vraie
 * station. Ils sont regroupés en tête de fichier pour se corriger en
 * une ligne après le test terrain.
 *
 * ------------------------------------------------------------------
 * TOUT EST ÉCRIT DANS UNE ENTREPRISE À PART
 *
 * Le volume est créé dans sa propre organisation, marquée par son
 * slug. `--purge` la supprime entièrement. Le jeu de démonstration
 * n'est jamais touché : on doit pouvoir mesurer le lundi et faire une
 * capture d'écran le mardi, sans reconstruire la base entre les deux.
 */

use Autocare\Core\Database;
use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

// ==================================================================
// LES HYPOTHÈSES, EN UN SEUL ENDROIT
// ==================================================================
const SLUG            = 'banc-de-mesure';
const STATIONS        = 3;
const YEARS           = 3;
const OPERATIONS_DAY  = 30;   // par station, les jours d'ouverture
const OPEN_DAYS_WEEK  = 6;
const CUSTOMERS       = 2200;
const EMPLOYEES       = 12;
const SERVICES        = 8;

if (Env::get('APP_ENV') === 'production') {
    echo "[REFUSÉ] Interdit quand APP_ENV=production.\n";
    exit(1);
}

$db     = Database::connection();
$purge  = in_array('--purge', array_slice($argv, 1), true);

// ------------------------------------------------------------------
// Retrouver — ou créer — l'entreprise du banc de mesure.
// ------------------------------------------------------------------
$statement = $db->prepare('SELECT id FROM organizations WHERE slug = :slug');
$statement->execute(['slug' => SLUG]);
$organizationId = $statement->fetchColumn();

if ($purge) {
    if ($organizationId === false) {
        echo "Rien à effacer.\n";
        exit(0);
    }

    echo "Effacement du banc de mesure…\n";

    // L'ordre suit les dépendances : une clé étrangère refuse de
    // laisser partir un parent avant ses enfants.
    foreach ([
        'loyalty_entries', 'loyalty_programs',
        'subscriptions', 'subscription_plans',
        'bookings', 'time_entries',
        'inspection_photos', 'inspections',
        'payments', 'operations',
        'vehicles', 'customers',
        'cash_sessions', 'services',
        'audit_logs', 'refresh_tokens', 'password_resets',
        'station_users', 'users', 'stations',
    ] as $table) {
        try {
            $column = in_array($table, ['refresh_tokens', 'password_resets'], true)
                ? 'user_id IN (SELECT id FROM users WHERE organization_id = :id)'
                : 'organization_id = :id';

            $db->prepare("DELETE FROM {$table} WHERE {$column}")
               ->execute(['id' => (int) $organizationId]);
        } catch (Throwable $exception) {
            echo "  (ignoré : {$table} — {$exception->getMessage()})\n";
        }
    }

    $db->prepare('DELETE FROM organizations WHERE id = :id')
       ->execute(['id' => (int) $organizationId]);

    echo "Effacé.\n";
    exit(0);
}

if ($organizationId !== false) {
    echo "Le banc de mesure existe déjà (organisation #{$organizationId}).\n";
    echo "Pour le refaire :  php tools/benchmark_seed.php --purge\n";
    exit(0);
}

$benchStartedAt = microtime(true);

echo "=== Fabrication du banc de mesure ===\n\n";

$db->beginTransaction();

$db->prepare(
    "INSERT INTO organizations (name, slug, phone, email, onboarding_completed_at)
     VALUES ('Banc de mesure', :slug, '770000000', 'banc@mesure.local', NOW())"
)->execute(['slug' => SLUG]);

$organizationId = (int) $db->lastInsertId();

// --- Stations -----------------------------------------------------
$stationIds = [];
$codes      = ['BM1', 'BM2', 'BM3', 'BM4', 'BM5'];

for ($i = 0; $i < STATIONS; $i++) {
    $db->prepare(
        "INSERT INTO stations (organization_id, name, code, city, opens_at, closes_at)
         VALUES (:org, :name, :code, 'Dakar', '08:00:00', '19:00:00')"
    )->execute([
        'org'  => $organizationId,
        'name' => 'Station de mesure ' . ($i + 1),
        'code' => $codes[$i],
    ]);

    $stationIds[] = (int) $db->lastInsertId();
}

// --- Équipe -------------------------------------------------------
$userIds = [];
$hash    = password_hash('mot-de-passe-de-mesure', PASSWORD_DEFAULT);

for ($i = 0; $i < EMPLOYEES; $i++) {
    $db->prepare(
        'INSERT INTO users (organization_id, first_name, last_name, email, password_hash)
         VALUES (:org, :first, :last, :email, :hash)'
    )->execute([
        'org'   => $organizationId,
        'first' => 'Employé',
        'last'  => 'Mesure ' . ($i + 1),
        'email' => "mesure-{$i}@banc.local",
        'hash'  => $hash,
    ]);

    $userId    = (int) $db->lastInsertId();
    $userIds[] = $userId;

    $db->prepare(
        'INSERT INTO station_users (organization_id, station_id, user_id, role)
         VALUES (:org, :station, :user, :role)'
    )->execute([
        'org'     => $organizationId,
        'station' => $stationIds[$i % STATIONS],
        'user'    => $userId,
        'role'    => $i === 0 ? 'ADMIN' : ($i < 4 ? 'MANAGER' : 'EMPLOYEE'),
    ]);
}

// --- Catalogue ----------------------------------------------------
$serviceIds = [];
$catalogue  = [
    ['Lavage express', 2000, 20], ['Lavage standard', 3500, 30],
    ['Lavage complet', 6000, 45], ['Lavage premium', 9000, 60],
    ['Intérieur seul', 4000, 35], ['Detailing', 25000, 180],
    ['Lustrage', 15000, 120],     ['Moteur', 7000, 40],
];

for ($i = 0; $i < SERVICES; $i++) {
    [$name, $price, $duration] = $catalogue[$i];

    $db->prepare(
        'INSERT INTO services (organization_id, name, price, duration_minutes)
         VALUES (:org, :name, :price, :duration)'
    )->execute([
        'org' => $organizationId, 'name' => $name,
        'price' => $price, 'duration' => $duration,
    ]);

    $serviceIds[] = (int) $db->lastInsertId();
}

$db->commit();

echo sprintf(
    "  %d stations, %d comptes, %d prestations\n",
    count($stationIds), count($userIds), count($serviceIds)
);

// ------------------------------------------------------------------
// Clients et véhicules
// ------------------------------------------------------------------
// UNE SEULE TRANSACTION POUR TOUT LE LOT, et des requêtes préparées
// réutilisées. Insérer 30 000 lignes une par une, chacune dans sa
// propre transaction, demanderait 30 000 écritures sur le disque —
// et cet outil mettrait un quart d'heure au lieu d'une minute.
$db->beginTransaction();

$customerStatement = $db->prepare(
    'INSERT INTO customers (organization_id, first_name, last_name, phone)
     VALUES (:org, :first, :last, :phone)'
);

$vehicleStatement = $db->prepare(
    'INSERT INTO vehicles (organization_id, customer_id, plate_number, brand, model, vehicle_type)
     VALUES (:org, :customer, :plate, :brand, :model, :type)'
);

$prenoms = ['Mamadou', 'Awa', 'Ousmane', 'Fatou', 'Cheikh', 'Aminata', 'Ibrahima',
            'Khady', 'Modou', 'Ndeye', 'Aliou', 'Bineta', 'Samba', 'Coumba'];
$noms    = ['Diallo', 'Ndiaye', 'Fall', 'Sarr', 'Ba', 'Gueye', 'Sow', 'Diop',
            'Faye', 'Cissé', 'Mbaye', 'Sy', 'Kane', 'Thiam'];
$marques = ['Toyota', 'Renault', 'Peugeot', 'Hyundai', 'Kia', 'Nissan', 'Mercedes'];
$types   = ['CAR', 'SUV', 'PICKUP', 'VAN'];

$vehicleIds  = [];
$vehicleOwner = [];

for ($i = 0; $i < CUSTOMERS; $i++) {
    $customerStatement->execute([
        'org'   => $organizationId,
        'first' => $prenoms[$i % count($prenoms)],
        'last'  => $noms[intdiv($i, count($prenoms)) % count($noms)],
        'phone' => '77' . str_pad((string) (1000000 + $i), 7, '0', STR_PAD_LEFT),
    ]);

    $customerId = (int) $db->lastInsertId();

    // Un client sur quatre a deux véhicules : c'est ce qui rend la
    // recherche par plaque intéressante à mesurer.
    $count = $i % 4 === 0 ? 2 : 1;

    for ($v = 0; $v < $count; $v++) {
        $serial = $i * 2 + $v;

        $vehicleStatement->execute([
            'org'      => $organizationId,
            'customer' => $customerId,
            'plate'    => sprintf('BM%04d%s', $serial % 10000, chr(65 + intdiv($serial, 10000))),
            'brand'    => $marques[$serial % count($marques)],
            'model'    => 'Modèle ' . ($serial % 20),
            'type'     => $types[$serial % count($types)],
        ]);

        $vehicleId              = (int) $db->lastInsertId();
        $vehicleIds[]           = $vehicleId;
        $vehicleOwner[$vehicleId] = $customerId;
    }
}

$db->commit();

echo sprintf("  %d clients, %d véhicules\n", CUSTOMERS, count($vehicleIds));

// ------------------------------------------------------------------
// Trois ans d'opérations, avec leurs encaissements
// ------------------------------------------------------------------
$db->beginTransaction();

$operationStatement = $db->prepare(
    'INSERT INTO operations
        (organization_id, station_id, vehicle_id, customer_id, service_id,
         assigned_user_id, created_by_user_id, reference, status, price,
         created_at, started_at, completed_at, status_changed_at, updated_at)
     VALUES
        (:org, :station, :vehicle, :customer, :service,
         :user, :user_created, :reference, :status, :price,
         :created, :started, :completed, :changed, :updated)'
);

$paymentStatement = $db->prepare(
    'INSERT INTO payments
        (organization_id, station_id, operation_id, customer_id,
         amount, method, status, paid_at, recorded_by_user_id)
     VALUES
        (:org, :station, :operation, :customer,
         :amount, :method, :status, :paid_at, :user)'
);

$methods    = ['CASH', 'CASH', 'CASH', 'MOBILE_MONEY', 'MOBILE_MONEY', 'CARD'];
$prices     = array_column($catalogue, 1);
$durations  = array_column($catalogue, 2);

$operations = 0;
$payments   = 0;
$reference  = 0;

$day = new DateTimeImmutable('-' . YEARS . ' years');
$end = new DateTimeImmutable('today');

while ($day < $end) {
    // Fermé un jour par semaine.
    if ((int) $day->format('N') > OPEN_DAYS_WEEK) {
        $day = $day->modify('+1 day');
        continue;
    }

    foreach ($stationIds as $stationIndex => $stationId) {
        // L'activité varie d'une station à l'autre et d'un jour à
        // l'autre : une charge parfaitement plate donnerait des
        // moyennes flatteuses et des index trop bien rangés.
        $today = (int) round(OPERATIONS_DAY * (0.6 + 0.2 * $stationIndex))
            + ((int) $day->format('j') % 7);

        for ($n = 0; $n < $today; $n++) {
            $serviceIndex = ($operations + $n) % SERVICES;
            $vehicleId    = $vehicleIds[($operations * 7 + $n * 13) % count($vehicleIds)];

            $hour    = 8 + ($n % 11);
            $minute  = ($n * 7) % 60;
            $created = $day->setTime($hour, $minute);

            $duration  = $durations[$serviceIndex];
            $started   = $created->modify('+' . (5 + $n % 20) . ' minutes');
            $completed = $started->modify('+' . ($duration + $n % 25) . ' minutes');

            // Une opération sur cinquante a été annulée. Sans elles,
            // les requêtes qui filtrent sur le statut n'auraient rien
            // à écarter.
            $cancelled = ($operations + $n) % 50 === 0;
            $reference++;

            $operationStatement->execute([
                'org'       => $organizationId,
                'station'   => $stationId,
                'vehicle'   => $vehicleId,
                'customer'  => $vehicleOwner[$vehicleId],
                'service'   => $serviceIds[$serviceIndex],
                'user'      => $userIds[($operations + $n) % count($userIds)],
                'user_created' => $userIds[($operations + $n) % count($userIds)],
                'reference' => sprintf('%s-%s-%05d', $codes[$stationIndex],
                                       $day->format('ym'), $reference),
                'status'    => $cancelled ? 'CANCELLED' : 'COMPLETED',
                'price'     => $prices[$serviceIndex],
                'created'   => $created->format('Y-m-d H:i:s'),
                'started'   => $started->format('Y-m-d H:i:s'),
                'completed' => $cancelled ? null : $completed->format('Y-m-d H:i:s'),
                'changed'   => $completed->format('Y-m-d H:i:s'),
                // ==================================================
                // `updated_at` DOIT ÊTRE POSÉ EXPLICITEMENT.
                // ==================================================
                // La colonne vaut CURRENT_TIMESTAMP à l'insertion :
                // sans cette ligne, les 76 000 dossiers fabriqués ici
                // porteraient tous la date d'AUJOURD'HUI, quelle que
                // soit leur date d'arrivée.
                //
                // Le banc de mesure mentirait alors précisément là où
                // il compte : le tableau de bord borne ses compteurs
                // du jour à `updated_at >= CURDATE()`, et il aurait
                // trouvé l'historique entier dans cette borne. Un
                // banc de mesure faux est pire que pas de banc du
                // tout — il donne des chiffres, et on les croit.
                'updated'   => $completed->format('Y-m-d H:i:s'),
            ]);

            $operations++;

            if ($cancelled) {
                continue;
            }

            $paymentStatement->execute([
                'org'       => $organizationId,
                'station'   => $stationId,
                'operation' => (int) $db->lastInsertId(),
                'customer'  => $vehicleOwner[$vehicleId],
                'amount'    => $prices[$serviceIndex],
                'method'    => $methods[($operations + $n) % count($methods)],
                'status'    => 'PAID',
                'paid_at'   => $completed->format('Y-m-d H:i:s'),
                'user'      => $userIds[($operations + $n) % count($userIds)],
            ]);

            $payments++;
        }
    }

    // On valide par tranches : une transaction de 30 000 insertions
    // gonfle le journal de MySQL et finit par ralentir l'outil
    // lui-même.
    if ($operations % 5000 < 100) {
        $db->commit();
        $db->beginTransaction();
        echo "  … {$operations} opérations\n";
    }

    $day = $day->modify('+1 day');
}

$db->commit();

// ------------------------------------------------------------------
// Quelques dossiers OUVERTS, pour que la file d'attente ait un sens
// ------------------------------------------------------------------
$db->beginTransaction();

$openStatuses = ['WAITING', 'IN_PROGRESS', 'INSPECTION', 'WASHING', 'QUALITY_CHECK', 'READY'];
$openCount    = 0;

foreach ($stationIds as $stationIndex => $stationId) {
    for ($n = 0; $n < 14; $n++) {
        $serviceIndex = $n % SERVICES;
        $vehicleId    = $vehicleIds[($stationIndex * 97 + $n * 31) % count($vehicleIds)];
        $reference++;

        $arrived = (new DateTimeImmutable())->modify('-' . (10 + $n * 7) . ' minutes');

        $operationStatement->execute([
            'org'       => $organizationId,
            'station'   => $stationId,
            'vehicle'   => $vehicleId,
            'customer'  => $vehicleOwner[$vehicleId],
            'service'   => $serviceIds[$serviceIndex],
            'user'      => $userIds[$n % count($userIds)],
            'user_created' => $userIds[$n % count($userIds)],
            'reference' => sprintf('%s-%s-%05d', $codes[$stationIndex],
                                   $arrived->format('ym'), $reference),
            'status'    => $openStatuses[$n % count($openStatuses)],
            'price'     => $prices[$serviceIndex],
            'created'   => $arrived->format('Y-m-d H:i:s'),
            'started'   => $arrived->modify('+4 minutes')->format('Y-m-d H:i:s'),
            'completed' => null,
            'changed'   => $arrived->modify('+6 minutes')->format('Y-m-d H:i:s'),
            // Les dossiers ouverts, eux, ont bien bougé aujourd'hui.
            'updated'   => $arrived->modify('+6 minutes')->format('Y-m-d H:i:s'),
        ]);

        $openCount++;
    }
}

$db->commit();

echo sprintf(
    "  %d opérations (%d ouvertes), %d encaissements\n",
    $operations + $openCount,
    $openCount,
    $payments,
);

// ------------------------------------------------------------------
// METTRE À JOUR LES STATISTIQUES DE L'OPTIMISEUR
// ------------------------------------------------------------------
// SANS CETTE ÉTAPE, LA PREMIÈRE MESURE EST FAUSSE.
//
// MySQL choisit ses index d'après des statistiques échantillonnées.
// Après une insertion massive, elles décrivent encore une table
// presque vide : l'optimiseur retient alors le mauvais index, et le
// banc de mesure accuse un code parfaitement correct.
//
// C'est arrivé pendant l'écriture de ce lot : la file d'attente est
// passée de 12 ms à 3 ms sur un simple ANALYZE, sans qu'une ligne de
// code change. La leçon vaut aussi en production, après une
// restauration de sauvegarde.
echo "\nMise à jour des statistiques de l'optimiseur…\n";
$db->query('ANALYZE TABLE operations, payments, customers, vehicles, stations')->fetchAll();

echo sprintf("\nTerminé en %.1f s.\n", microtime(true) - $benchStartedAt);
echo "Organisation #{$organizationId} — slug « " . SLUG . " ».\n";
echo "Connexion : mesure-0@banc.local / mot-de-passe-de-mesure\n";
