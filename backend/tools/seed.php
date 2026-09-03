<?php

declare(strict_types=1);

/**
 * Chargement du jeu de données de démonstration
 * ------------------------------------------------------------------
 * Usage, depuis le dossier backend/ :
 *
 *   php tools/seed.php
 *
 * À lancer sur une base fraîchement migrée :
 *
 *   php tools/migrate.php --fresh
 *   php tools/seed.php
 *
 * POURQUOI DES DONNÉES DE DÉMONSTRATION ?
 * Pour développer les écrans des lots suivants sans devoir ressaisir
 * une station entière à chaque fois qu'on repart de zéro. Et pour
 * juger l'interface sur des données réalistes : un tableau rempli de
 * « test1 » ne montre pas si les colonnes tiennent avec de vrais noms.
 */

use Autocare\Core\Database;
use Autocare\Core\Env;
use Autocare\Core\SqlScript;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

echo "=== AUTOCARE OS — données de démonstration ===\n\n";

// Garde-fou : ces données n'ont rien à faire dans une vraie base.
if (Env::get('APP_ENV') === 'production') {
    echo "[REFUSÉ] Le jeu de démonstration est interdit quand APP_ENV=production.\n";
    exit(1);
}

$connection = Database::connection();

// Si des données existent déjà, on s'arrête plutôt que de créer des
// doublons ou de faire échouer les insertions sur des identifiants
// déjà pris.
//
// On MONTRE ce qui bloque, avec le nombre d'utilisateurs de chaque
// organisation. Sans cette information, impossible de décider si l'on
// peut effacer : une organisation sans utilisateur est un résidu de
// test, une organisation avec des comptes est peut-être un vrai
// début de travail. Un outil qui dit « c'est occupé » sans dire par
// quoi oblige à aller fouiller soi-même.
$existing = $connection->query(
    'SELECT o.id, o.name, o.slug,
            (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) AS user_count
       FROM organizations o
   ORDER BY o.id'
)->fetchAll();

if ($existing !== []) {
    echo '[ARRÊT] La base contient déjà ' . count($existing) . " organisation(s) :\n\n";

    $hasRealData = false;

    foreach ($existing as $organization) {
        $userCount = (int) $organization['user_count'];
        $note      = $userCount === 0
            ? '  ← aucun utilisateur : probablement un résidu de test'
            : '';

        if ($userCount > 0) {
            $hasRealData = true;
        }

        printf(
            "        #%-4d %-30s %d utilisateur(s)%s\n",
            (int) $organization['id'],
            mb_substr((string) $organization['name'], 0, 30),
            $userCount,
            $note
        );
    }

    echo "\n";

    if ($hasRealData) {
        echo "        ⚠️  Des comptes existent. Les effacer est irréversible.\n";
    } else {
        echo "        Aucun compte n'existe : rien d'utilisable ne sera perdu.\n";
    }

    echo "\n        Pour repartir de zéro :\n";
    echo "          php tools/migrate.php --fresh\n";
    echo "          php tools/seed.php\n";

    exit(1);
}

$files = glob(dirname(__DIR__) . '/database/seeds/*.sql') ?: [];
sort($files);

foreach ($files as $file) {
    echo "→ " . basename($file) . "\n";

    $statements = SqlScript::split(file_get_contents($file) ?: '');

    // Contrairement aux migrations, les insertions PEUVENT être
    // annulées : ce sont des données, pas de la structure. On les
    // encadre donc dans une transaction — soit tout est chargé, soit
    // rien ne l'est, jamais un jeu de démonstration à moitié rempli.
    $connection->beginTransaction();

    try {
        foreach ($statements as $statement) {
            $connection->exec($statement);
        }

        $connection->commit();
        echo "  " . count($statements) . " instruction(s) exécutée(s)\n";
    } catch (PDOException $exception) {
        $connection->rollBack();

        echo "\n[ÉCHEC] " . $exception->getMessage() . "\n";
        echo "Aucune donnée n'a été insérée (transaction annulée).\n";
        exit(1);
    }
}

// Récapitulatif, pour vérifier d'un coup d'œil que tout est arrivé.
echo "\nContenu de la base :\n";

$tables = [
    'organizations'     => 'organisations',
    'users'             => 'utilisateurs',
    'stations'          => 'stations',
    'station_users'     => 'affectations',
    'customers'         => 'clients',
    'vehicles'          => 'véhicules',
    'services'          => 'prestations',
    'operations'        => 'opérations',
    'inspections'       => 'inspections',
    'inspection_photos' => 'photos',
    'payments'          => 'paiements',
    'audit_logs'        => 'entrées de journal',
];

foreach ($tables as $table => $label) {
    $count = (int) $connection->query("SELECT COUNT(*) FROM {$table}")->fetchColumn();
    printf("  %-20s %3d\n", $label, $count);
}

echo "\nComptes de démonstration — mot de passe : Autocare2026!\n";
echo "  mamadou.diallo@dialloauto.sn   Administrateur\n";
echo "  awa.ndiaye@dialloauto.sn       Manager\n";
echo "  aliou.sow@dialloauto.sn        Employé\n";
echo "\n=== Terminé. ===\n";
