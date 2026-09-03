<?php

declare(strict_types=1);

/**
 * Vérification du schéma de base de données
 * ------------------------------------------------------------------
 * Usage, depuis le dossier backend/ :
 *
 *   php tools/migrate.php --fresh
 *   php tools/seed.php
 *   php tests/schema_test.php
 *
 * POURQUOI TESTER UN SCHÉMA ?
 * Parce qu'une table qui « se crée sans erreur » ne prouve rien. Ce
 * qui compte, c'est qu'elle REFUSE ce qu'elle doit refuser :
 * supprimer un client qui a un historique, enregistrer deux fois la
 * même plaque, accepter un statut qui n'existe pas.
 *
 * Ces garde-fous sont la dernière ligne de défense de tes données.
 * Si un bug de l'application passe à travers, c'est la base qui doit
 * dire non — d'où ces tests.
 *
 * Écrit sans framework, volontairement : à ce stade du projet une
 * fonction d'assertion de dix lignes suffit et reste lisible.
 * On passera à PHPUnit au lot 20, quand il y aura assez de tests
 * pour que l'outillage se justifie.
 */

use Autocare\Core\Database;
use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

$connection = Database::connection();

$passed = 0;
$failed = 0;

/** Vérifie qu'une condition est vraie. */
function check(string $description, bool $condition): void
{
    global $passed, $failed;

    if ($condition) {
        $passed++;
        echo "  [OK]     {$description}\n";
    } else {
        $failed++;
        echo "  [ÉCHEC]  {$description}\n";
    }
}

/**
 * Vérifie qu'une requête est REFUSÉE par la base.
 * C'est le type de test le plus important ici : on s'assure que la
 * base protège les données contre une application boguée.
 */
function checkRejected(string $description, callable $query): void
{
    global $passed, $failed;

    try {
        $query();
        $failed++;
        echo "  [ÉCHEC]  {$description} — la base a ACCEPTÉ, elle aurait dû refuser\n";
    } catch (PDOException) {
        $passed++;
        echo "  [OK]     {$description}\n";
    }
}

echo "=== AUTOCARE OS — vérification du schéma ===\n\n";

/**
 * Nettoyage préalable.
 * Un test doit pouvoir être relancé autant de fois qu'on veut, y
 * compris après un plantage qui a laissé des données derrière lui.
 * On efface donc les traces d'une exécution précédente AVANT de
 * commencer, et pas seulement à la fin.
 */
function cleanUpTestData(PDO $connection): void
{
    $connection->exec("DELETE FROM operations WHERE reference LIKE 'PERF-%'");
    $connection->exec('DELETE FROM vehicles WHERE id = 99');
    $connection->exec('DELETE FROM customers WHERE id = 99');
    $connection->exec('DELETE FROM organizations WHERE id = 99');
}

cleanUpTestData($connection);

// ------------------------------------------------------------------
echo "1. Structure\n";
// ------------------------------------------------------------------

$expectedTables = [
    'organizations', 'users', 'stations', 'station_users',
    'customers', 'vehicles', 'services', 'operations',
    'inspections', 'inspection_photos', 'payments', 'audit_logs',
];

$actualTables = $connection->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);

foreach ($expectedTables as $table) {
    check("la table {$table} existe", in_array($table, $actualTables, true));
}

// ------------------------------------------------------------------
echo "\n2. Isolation entre entreprises\n";
// ------------------------------------------------------------------

// LE point de sécurité du produit : toute table métier doit porter
// organization_id, sinon la couche d'accès aux données ne pourra pas
// appliquer le filtre d'isolation de façon uniforme.
$businessTables = array_diff($expectedTables, ['organizations']);

foreach ($businessTables as $table) {
    $columns = $connection->query("SHOW COLUMNS FROM {$table}")->fetchAll(PDO::FETCH_COLUMN);
    check("{$table} porte organization_id", in_array('organization_id', $columns, true));
}

// ------------------------------------------------------------------
echo "\n3. Moteur et encodage\n";
// ------------------------------------------------------------------

$engines = $connection->query(
    "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()"
)->fetchAll();

$allInnoDb = true;
$allUtf8mb4 = true;

foreach ($engines as $row) {
    if ($row['ENGINE'] !== 'InnoDB') {
        $allInnoDb = false;
        echo "           ({$row['TABLE_NAME']} utilise {$row['ENGINE']})\n";
    }

    if (!str_starts_with((string) $row['TABLE_COLLATION'], 'utf8mb4')) {
        $allUtf8mb4 = false;
        echo "           ({$row['TABLE_NAME']} utilise {$row['TABLE_COLLATION']})\n";
    }
}

check('toutes les tables sont en InnoDB (clés étrangères et transactions)', $allInnoDb);
check('toutes les tables sont en utf8mb4 (accents et emojis)', $allUtf8mb4);

// ------------------------------------------------------------------
echo "\n4. Protection de l'historique\n";
// ------------------------------------------------------------------

checkRejected(
    "impossible de supprimer un client qui possède un véhicule",
    fn () => $connection->exec('DELETE FROM customers WHERE id = 1')
);

checkRejected(
    "impossible de supprimer un véhicule ayant une opération",
    fn () => $connection->exec('DELETE FROM vehicles WHERE id = 1')
);

checkRejected(
    "impossible de rattacher une opération à un client inexistant",
    fn () => $connection->exec(
        "INSERT INTO operations
            (organization_id, station_id, vehicle_id, customer_id, service_id,
             reference, price, created_by_user_id)
         VALUES (1, 1, 1, 99999, 1, 'TEST-0001', 5000, 1)"
    )
);

// ------------------------------------------------------------------
echo "\n5. Unicité\n";
// ------------------------------------------------------------------

checkRejected(
    "impossible d'enregistrer deux fois la même plaque dans une entreprise",
    fn () => $connection->exec(
        "INSERT INTO vehicles (organization_id, customer_id, plate_number, brand, model)
         VALUES (1, 1, 'DK1234AA', 'Doublon', 'Doublon')"
    )
);

checkRejected(
    "impossible d'avoir deux inspections d'entrée sur une même opération",
    fn () => $connection->exec(
        "INSERT INTO inspections (organization_id, operation_id, vehicle_id, type, performed_by_user_id)
         VALUES (1, 1, 1, 'ENTRY', 3)"
    )
);

checkRejected(
    "impossible d'avoir deux comptes avec la même adresse e-mail",
    fn () => $connection->exec(
        "INSERT INTO users (organization_id, first_name, last_name, email, password_hash)
         VALUES (1, 'Faux', 'Compte', 'mamadou.diallo@dialloauto.sn', 'x')"
    )
);

// La même plaque DOIT rester possible dans une AUTRE entreprise :
// deux stations concurrentes peuvent servir le même véhicule.
$connection->exec("INSERT INTO organizations (id, name, slug) VALUES (99, 'Autre Entreprise', 'autre-entreprise')");
$connection->exec("INSERT INTO customers (id, organization_id, first_name, last_name, phone)
                   VALUES (99, 99, 'Client', 'Autre', '+221770000000')");

$sameplateAllowed = true;

try {
    $connection->exec(
        "INSERT INTO vehicles (id, organization_id, customer_id, plate_number, brand, model)
         VALUES (99, 99, 99, 'DK1234AA', 'Toyota', 'Corolla')"
    );
} catch (PDOException) {
    $sameplateAllowed = false;
}

check("la même plaque reste possible dans une AUTRE entreprise", $sameplateAllowed);

// ------------------------------------------------------------------
echo "\n6. Valeurs autorisées\n";
// ------------------------------------------------------------------

checkRejected(
    "un statut d'opération inconnu est refusé",
    fn () => $connection->exec("UPDATE operations SET status = 'INVENTE' WHERE id = 1")
);

// ------------------------------------------------------------------
// La colonne qui rend la file d'attente utile (migration 016).
//
// Elle doit accepter NULL : un dossier importé ou créé avant sa mise
// en place n'a pas cette date, et l'API retombe alors sur created_at.
// La rendre obligatoire ferait échouer ces cas au lieu de les gérer.
// ------------------------------------------------------------------
$statusColumn = $connection
    ->query("SHOW COLUMNS FROM operations LIKE 'status_changed_at'")
    ->fetch();

check(
    "operations.status_changed_at existe",
    $statusColumn !== false
);
check(
    "elle accepte NULL, pour les dossiers antérieurs à sa création",
    ($statusColumn['Null'] ?? '') === 'YES'
);

// Chaque dossier de démonstration doit la porter : sans elle, toutes
// les cartes de la file afficheraient « depuis 0 minute », et une
// donnée fausse est pire qu'une donnée absente parce qu'on la croit.
$withoutDate = (int) $connection
    ->query('SELECT COUNT(*) FROM operations WHERE status_changed_at IS NULL')
    ->fetchColumn();

check(
    "aucune opération du jeu de démonstration n'est sans cette date",
    $withoutDate === 0,
    "{$withoutDate} sans date"
);

// ------------------------------------------------------------------
echo "\n7. Performance des requêtes clés\n";
// ------------------------------------------------------------------

// La file d'attente est rechargée en permanence sur tous les postes.
// Elle ne doit jamais provoquer un parcours complet de la table.
//
// ATTENTION AU PIÈGE : sur une table de quatre lignes, l'optimiseur
// de MySQL ignore volontairement les index — lire quatre lignes coûte
// moins cher que consulter un index puis la table. Vérifier « key »
// sur des données de démonstration ne prouverait donc rien.
//
// On fait deux choses :
//   1. on vérifie que l'index est APPLICABLE à la requête
//      (possible_keys), ce qui est la vraie question de conception ;
//   2. on charge 2 000 opérations et on vérifie qu'à ce volume
//      l'optimiseur le choisit effectivement.

$queueQuery = "SELECT id, reference, status, priority
                 FROM operations
                WHERE organization_id = 1 AND station_id = 1
                  AND status IN ('WAITING','IN_PROGRESS','WASHING')
                ORDER BY priority DESC";

$plan = $connection->query("EXPLAIN {$queueQuery}")->fetch();

check(
    "l'index de la file d'attente est applicable à la requête",
    $plan !== false && str_contains((string) $plan['possible_keys'], 'idx_operations_queue')
);

echo "           (chargement de 2 000 opérations pour tester à l'échelle…)\n";

$connection->beginTransaction();

$insert = $connection->prepare(
    "INSERT INTO operations
        (organization_id, station_id, vehicle_id, customer_id, service_id,
         reference, status, priority, price, created_by_user_id)
     VALUES (1, 1, 1, 1, 1, :reference, :status, :priority, 5000, 1)"
);

// La répartition imite une VRAIE station : l'immense majorité des
// opérations sont terminées, une poignée seulement est en cours.
//
// Ce détail est décisif. Avec une répartition uniforme sur les huit
// statuts, la requête de la file sélectionnerait la moitié de la
// table — et l'optimiseur préférerait alors, à juste titre, un
// balayage complet. Le test deviendrait instable et surtout il ne
// mesurerait rien de réel : une station qui laisse la moitié de ses
// véhicules en cours a un problème bien plus grave qu'un index.
for ($i = 0; $i < 2000; $i++) {
    // Environ 2 % d'opérations actives, le reste terminé ou annulé.
    $status = match (true) {
        $i % 100 === 0 => 'WAITING',
        $i % 100 === 1 => 'IN_PROGRESS',
        $i % 100 === 2 => 'WASHING',
        $i % 50  === 3 => 'CANCELLED',
        default        => 'COMPLETED',
    };

    $insert->execute([
        'reference' => sprintf('PERF-%05d', $i),
        'status'    => $status,
        'priority'  => $i % 20,
    ]);
}

$connection->commit();

// PDO garde un curseur ouvert sur la dernière requête préparée
// exécutée. Tant qu'il n'est pas fermé, toute autre requête échoue
// avec « Cannot execute queries while other unbuffered queries are
// active ». C'est un piège classique quand on réutilise un
// PDOStatement en boucle.
$insert->closeCursor();

// ANALYZE TABLE met à jour les statistiques dont l'optimiseur se sert
// pour décider. Sans cela, il raisonne encore sur l'ancien volume.
//
// On utilise query()->fetchAll() et non exec() : contrairement à un
// INSERT, ANALYZE TABLE RENVOIE un résultat. exec() le laisserait non
// lu et la requête suivante échouerait. Règle générale avec PDO :
// exec() pour ce qui ne renvoie rien, query() pour le reste.
$connection->query('ANALYZE TABLE operations')->fetchAll();

$planAtScale = $connection->query("EXPLAIN {$queueQuery}")->fetch();

check(
    "sur 2 000 opérations, l'index est effectivement utilisé (pas de balayage complet)",
    $planAtScale !== false && $planAtScale['key'] === 'idx_operations_queue'
);

echo "           (index retenu : " . ($planAtScale['key'] ?? 'aucun')
    . ", lignes examinées : " . ($planAtScale['rows'] ?? '?') . " sur 2004)\n";

// On retire les opérations de test : elles fausseraient le tableau
// de bord et la file d'attente pendant le développement.
$connection->exec("DELETE FROM operations WHERE reference LIKE 'PERF-%'");

// ------------------------------------------------------------------
echo "\n8. Montants\n";
// ------------------------------------------------------------------

// Un FLOAT sur de l'argent produit des erreurs d'arrondi : une caisse
// ne s'équilibre alors jamais exactement.
$moneyColumns = $connection->query(
    "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME IN ('price', 'amount')"
)->fetchAll();

$allIntegers = true;

foreach ($moneyColumns as $column) {
    if (!in_array($column['DATA_TYPE'], ['bigint', 'int'], true)) {
        $allIntegers = false;
        echo "           ({$column['TABLE_NAME']}.{$column['COLUMN_NAME']} est {$column['DATA_TYPE']})\n";
    }
}

check('tous les montants sont des entiers, jamais des nombres à virgule', $allIntegers);

// ------------------------------------------------------------------
echo "\n9. Journal d'audit en ajout seul\n";
// ------------------------------------------------------------------

$auditColumns = $connection->query('SHOW COLUMNS FROM audit_logs')->fetchAll(PDO::FETCH_COLUMN);

check(
    "audit_logs n'a pas de colonne updated_at (une trace ne se modifie pas)",
    !in_array('updated_at', $auditColumns, true)
);
check(
    "audit_logs n'a pas de colonne deleted_at (une trace ne s'efface pas)",
    !in_array('deleted_at', $auditColumns, true)
);

// ------------------------------------------------------------------
// Nettoyage des données créées par les tests
// ------------------------------------------------------------------
cleanUpTestData($connection);

// ------------------------------------------------------------------
echo "\n";
echo str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
