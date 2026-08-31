<?php

declare(strict_types=1);

/**
 * Outil de diagnostic de la base de donnees
 * ------------------------------------------------------------------
 * A lancer depuis le dossier backend/ :
 *
 *     php tools/check_db.php
 *
 * Il repond a une seule question, mais la plus frequente quand on
 * demarre : "pourquoi ma connexion MySQL ne marche pas ?"
 * Chaque cause possible donne un message d'erreur explicite plutot
 * qu'une exception PDO illisible.
 */

use Autocare\Core\Database;
use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

echo "=== AUTOCARE OS — verification de la base de donnees ===\n\n";

// 1. Le fichier .env existe-t-il ?
$envPath = dirname(__DIR__) . '/.env';

if (!is_file($envPath)) {
    echo "[ECHEC] Le fichier backend/.env n'existe pas.\n";
    echo "        Copie backend/.env.example vers backend/.env,\n";
    echo "        puis renseigne tes identifiants MySQL.\n";
    exit(1);
}

Env::load($envPath);

echo "[OK]    Fichier .env charge\n";
echo "        Hote  : " . Env::get('DB_HOST') . ':' . Env::get('DB_PORT', '3306') . "\n";
echo "        Base  : " . Env::get('DB_NAME') . "\n";
echo "        User  : " . Env::get('DB_USER') . "\n\n";

// 2. L'extension PDO MySQL est-elle installee ?
if (!extension_loaded('pdo_mysql')) {
    echo "[ECHEC] L'extension PHP 'pdo_mysql' n'est pas activee.\n";
    echo "        Ouvre ton php.ini et decommente la ligne :\n";
    echo "        extension=pdo_mysql\n";
    exit(1);
}

echo "[OK]    Extension pdo_mysql disponible\n";

// 3. La connexion fonctionne-t-elle ?
try {
    $connection = Database::connection();

    $version = $connection->query('SELECT VERSION()')?->fetchColumn();

    echo "[OK]    Connexion MySQL etablie\n";
    echo "        Version du serveur : {$version}\n\n";

    // 4. Combien de tables ? (0 est normal avant le Lot 3)
    $tables = $connection
        ->query('SHOW TABLES')
        ?->fetchAll(PDO::FETCH_COLUMN) ?? [];

    $tableCount = count($tables);

    if ($tableCount === 0) {
        echo "[INFO]  La base est vide (0 table).\n";
        echo "        C'est normal : les tables seront creees au Lot 3.\n";
    } else {
        echo "[OK]    {$tableCount} table(s) presente(s) :\n";
        foreach ($tables as $table) {
            echo "        - {$table}\n";
        }
    }

    echo "\n=== Tout est en ordre. ===\n";
    exit(0);

} catch (Throwable $exception) {
    echo "[ECHEC] Connexion impossible.\n";
    echo "        Message : " . $exception->getMessage() . "\n\n";
    echo "        Causes les plus frequentes :\n";
    echo "        - MySQL n'est pas demarre\n";
    echo "        - la base '" . Env::get('DB_NAME') . "' n'existe pas encore\n";
    echo "        - identifiant ou mot de passe incorrect dans .env\n";
    echo "        - l'hote distant n'autorise pas ton adresse IP\n";
    exit(1);
}
