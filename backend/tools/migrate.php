<?php

declare(strict_types=1);

/**
 * Outil de migration de la base de données
 * ------------------------------------------------------------------
 * Usage, depuis le dossier backend/ :
 *
 *   php tools/migrate.php            applique les migrations en attente
 *   php tools/migrate.php --status   liste sans rien exécuter
 *   php tools/migrate.php --fresh    efface tout et rejoue depuis zéro
 *
 * POURQUOI UN OUTIL PLUTÔT QUE DES FICHIERS .sql À LANCER À LA MAIN ?
 *
 * Parce qu'à trois personnes et six mois de développement, « est-ce
 * que j'ai déjà passé le script qui ajoute la colonne devise ? »
 * devient une question impossible à trancher.
 *
 * L'outil tient un registre : la table `migrations` mémorise chaque
 * fichier déjà appliqué. Relancer la commande ne rejoue donc rien —
 * on dit qu'elle est *idempotente*. C'est ce qui permet de déployer
 * en production sans se demander où on en était.
 */

use Autocare\Core\Database;
use Autocare\Core\Env;
use Autocare\Core\SqlScript;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

$migrationsDirectory = dirname(__DIR__) . '/database/migrations';
$options             = array_slice($argv, 1);

$showStatusOnly = in_array('--status', $options, true);
$startFromEmpty = in_array('--fresh', $options, true);

echo "=== AUTOCARE OS — migrations ===\n\n";

try {
    $connection = Database::connection();
} catch (Throwable $exception) {
    echo "[ÉCHEC] " . $exception->getMessage() . "\n";
    echo "        Lance « php tools/check_db.php » pour diagnostiquer.\n";
    exit(1);
}

// ------------------------------------------------------------------
// --fresh : on repart d'une base vide
// ------------------------------------------------------------------
if ($startFromEmpty) {
    // Garde-fou : cette commande DÉTRUIT toutes les données. Elle ne
    // doit jamais pouvoir s'exécuter en production, même par erreur
    // de copier-coller.
    if (Env::get('APP_ENV') === 'production') {
        echo "[REFUSÉ] --fresh est interdit quand APP_ENV=production.\n";
        exit(1);
    }

    echo "[ATTENTION] Suppression de toutes les tables de « "
        . Env::get('DB_NAME') . " »…\n";

    // On désactive temporairement les clés étrangères : sinon
    // l'ordre de suppression devient un casse-tête (une table ne peut
    // pas être supprimée tant qu'une autre la référence).
    $connection->exec('SET FOREIGN_KEY_CHECKS = 0');

    $tables = $connection->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);

    foreach ($tables as $table) {
        // Le nom vient de la base, pas de l'utilisateur : on peut
        // l'insérer directement, mais on l'entoure de backticks au cas
        // où il contiendrait un caractère particulier.
        $connection->exec("DROP TABLE IF EXISTS `{$table}`");
        echo "            supprimée : {$table}\n";
    }

    $connection->exec('SET FOREIGN_KEY_CHECKS = 1');
    echo "\n";
}

// ------------------------------------------------------------------
// Registre des migrations déjà appliquées
// ------------------------------------------------------------------
$connection->exec(<<<SQL
    CREATE TABLE IF NOT EXISTS migrations (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        filename    VARCHAR(191) NOT NULL,
        batch       INT UNSIGNED NOT NULL,
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_migrations_filename (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);

$alreadyApplied = $connection
    ->query('SELECT filename FROM migrations')
    ->fetchAll(PDO::FETCH_COLUMN);

// ------------------------------------------------------------------
// Fichiers disponibles
// ------------------------------------------------------------------
$files = glob($migrationsDirectory . '/*.sql') ?: [];
sort($files); // l'ordre alphabétique est l'ordre d'exécution, d'où le préfixe 001_

if ($files === []) {
    echo "[INFO] Aucun fichier dans database/migrations/.\n";
    exit(0);
}

$pending = [];

foreach ($files as $file) {
    $name = basename($file);

    if (in_array($name, $alreadyApplied, true)) {
        echo "  [déjà appliquée] {$name}\n";
        continue;
    }

    $pending[] = $file;
}

if ($pending === []) {
    echo "\n=== La base est à jour. Rien à faire. ===\n";
    exit(0);
}

echo "\n" . count($pending) . " migration(s) en attente :\n";

foreach ($pending as $file) {
    echo "  - " . basename($file) . "\n";
}

if ($showStatusOnly) {
    echo "\n(--status : rien n'a été exécuté)\n";
    exit(0);
}

// ------------------------------------------------------------------
// Application
// ------------------------------------------------------------------
echo "\n";

$batch = (int) $connection->query('SELECT COALESCE(MAX(batch), 0) FROM migrations')->fetchColumn() + 1;

$record = $connection->prepare(
    'INSERT INTO migrations (filename, batch) VALUES (:filename, :batch)'
);

foreach ($pending as $file) {
    $name = basename($file);
    echo "→ {$name}\n";

    $sql        = file_get_contents($file) ?: '';
    $statements = SqlScript::split($sql);

    // NOTE IMPORTANTE : en MySQL, les instructions de structure
    // (CREATE TABLE, ALTER TABLE…) ne peuvent PAS être annulées par
    // un ROLLBACK — elles valident la transaction en cours
    // automatiquement. Encadrer une migration dans une transaction
    // donnerait donc une fausse impression de sécurité.
    //
    // On s'arrête plutôt au premier échec, en indiquant précisément
    // quelle instruction a échoué, pour que la correction soit
    // évidente.
    foreach ($statements as $index => $statement) {
        try {
            $connection->exec($statement);
        } catch (PDOException $exception) {
            echo "\n[ÉCHEC] Instruction n°" . ($index + 1) . " de {$name}\n\n";
            echo substr($statement, 0, 400) . "\n\n";
            echo "MySQL répond : " . $exception->getMessage() . "\n\n";
            echo "La base est dans un état partiel. Corrige le fichier,\n";
            echo "puis relance « php tools/migrate.php --fresh ».\n";
            exit(1);
        }
    }

    $record->execute(['filename' => $name, 'batch' => $batch]);
    echo "  " . count($statements) . " instruction(s) exécutée(s)\n";
}

$tableCount = (int) $connection->query('SHOW TABLES')->rowCount();

echo "\n=== Terminé. {$tableCount} table(s) dans la base. ===\n";
