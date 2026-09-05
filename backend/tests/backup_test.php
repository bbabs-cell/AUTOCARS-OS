<?php

declare(strict_types=1);

/**
 * Tests de sauvegarde et de restauration (lot 22)
 * ==================================================================
 * UNE SAUVEGARDE QU'ON N'A JAMAIS RESTAURÉE N'EST PAS UNE SAUVEGARDE.
 * ==================================================================
 * Usage :
 *   php tests/backup_test.php
 *
 * Ce fichier fait le seul essai qui compte : il sauvegarde, DÉTRUIT
 * une donnée, restaure, et vérifie qu'elle est revenue. Tout le reste
 * — la taille de l'archive, l'existence du fichier — ne prouve rien.
 *
 * ------------------------------------------------------------------
 * IL TOURNE SUR LA BASE DE DÉVELOPPEMENT, ET C'EST ASSUMÉ
 *
 * Restaurer écrase. Ces tests ne peuvent donc pas s'exécuter sur une
 * base de production, et ils refusent de le faire. Sur une base de
 * développement, ils la remettent dans l'état qu'elle avait avant —
 * puisque c'est exactement ce qu'une restauration fait.
 */

use Autocare\Core\Database;
use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

$passed = 0;
$failed = 0;

function check(string $d, bool $c, string $x = ''): void {
    global $passed, $failed;
    if ($c) { $passed++; echo "  [OK]     {$d}\n"; }
    else { $failed++; echo "  [ÉCHEC]  {$d}" . ($x !== '' ? " — {$x}" : '') . "\n"; }
}

// ==================================================================
// GARDE-FOU : ce test détruit puis restaure. Jamais en production.
// ==================================================================
if (Env::get('APP_ENV') === 'production') {
    echo "[REFUSÉ] Ces tests écrasent la base : interdits en production.\n";
    exit(1);
}

$root      = dirname(__DIR__);
$db        = Database::connection();
$directory = rtrim((string) Env::get('BACKUP_DIR', $root . '/storage/backups'), '/');

echo "=== LOT 22 — sauvegarde et restauration ===\n\n1. La sauvegarde produit une archive utilisable\n";

// On repère une donnée bien à nous, qu'on saura retrouver.
$temoin = 'Témoin-' . bin2hex(random_bytes(4));

$organisation = (int) $db->query('SELECT id FROM organizations LIMIT 1')->fetchColumn();

if ($organisation === 0) {
    echo "  [ARRÊT] Aucune entreprise en base : lance d'abord tools/seed.php\n";
    exit(1);
}

$db->prepare('INSERT INTO customers (organization_id, first_name, last_name, phone)
              VALUES (:org, :first, :last, :phone)')
   ->execute(['org' => $organisation, 'first' => $temoin, 'last' => 'Sauvegarde',
              'phone' => '770000' . random_int(100, 999)]);

$temoinId = (int) $db->lastInsertId();

exec('cd ' . escapeshellarg($root) . ' && php tools/backup.php --db-only 2>&1', $out, $status);

check('la sauvegarde se termine sans erreur', $status === 0, implode(' | ', $out));

$archives = glob("{$directory}/autocare-*.sql.gz") ?: [];
sort($archives);
$derniere = (string) end($archives);
$nom      = substr(basename($derniere), 0, -strlen('.sql.gz'));

check('une archive a été écrite', is_file($derniere));
check("l'archive n'est pas vide", (int) filesize($derniere) > 1024,
    filesize($derniere) . ' octets');

$manifeste = "{$directory}/{$nom}.json";

check('une empreinte accompagne l\'archive', is_file($manifeste));

$contenu = is_file($manifeste)
    ? json_decode((string) file_get_contents($manifeste), true)
    : [];

check("l'empreinte correspond au fichier",
    ($contenu['sql_sha256'] ?? '') === hash_file('sha256', $derniere));

// Une archive de sauvegarde contient TOUTE la base en clair : si elle
// atterrit dans le dossier exposé au web, elle est téléchargeable.
check("l'archive est hors du dossier exposé au web",
    !str_contains(realpath($derniere) ?: '', '/public/'));

echo "\n2. LE SEUL ESSAI QUI COMPTE : détruire, puis restaurer\n";

$db->prepare('DELETE FROM customers WHERE id = :id')->execute(['id' => $temoinId]);

$verif = $db->prepare('SELECT COUNT(*) FROM customers WHERE id = :id');
$verif->execute(['id' => $temoinId]);

check('le témoin a bien été détruit', (int) $verif->fetchColumn() === 0);

exec('cd ' . escapeshellarg($root) . ' && php tools/restore.php ' . escapeshellarg($nom) . ' 2>&1',
    $restoreOut, $restoreStatus);

check('la restauration se termine sans erreur', $restoreStatus === 0,
    implode(' | ', $restoreOut));

// La connexion précédente peut avoir été coupée par la restauration.
$db = Database::connection();
$verif = $db->prepare('SELECT first_name FROM customers WHERE id = :id');
$verif->execute(['id' => $temoinId]);

check('LE TÉMOIN EST REVENU', $verif->fetchColumn() === $temoin);

check("la restauration vérifie l'état d'après",
    str_contains(implode(' ', $restoreOut), 'tables'));

echo "\n3. Ce que la restauration REFUSE\n";

// Une archive abîmée restaurée sur des données vivantes, c'est deux
// pertes au lieu d'une.
$abimee = "{$directory}/autocare-2000-01-01_000000.sql.gz";
copy($derniere, $abimee);
file_put_contents($abimee, 'ceci-n-est-pas-une-archive', FILE_APPEND);
copy($manifeste, "{$directory}/autocare-2000-01-01_000000.json");

exec('cd ' . escapeshellarg($root) . ' && php tools/restore.php autocare-2000-01-01_000000 2>&1',
    $badOut, $badStatus);

check('une archive dont l\'empreinte ne correspond pas est refusée', $badStatus !== 0);
check('le refus explique pourquoi',
    str_contains(implode(' ', $badOut), 'empreinte'));

@unlink($abimee);
@unlink("{$directory}/autocare-2000-01-01_000000.json");

exec('cd ' . escapeshellarg($root) . ' && php tools/restore.php archive-qui-nexiste-pas 2>&1',
    $missOut, $missStatus);

check('une archive inexistante est refusée', $missStatus !== 0);

echo "\n4. Le contrôle avant mise en ligne\n";

exec('cd ' . escapeshellarg($root) . ' && php tools/preflight.php 2>&1', $preOut, $preStatus);

$preflight = implode("\n", $preOut);

// Sur une machine de développement, il DOIT refuser : c'est sa raison
// d'être. Un contrôle qui laisse passer une base de démonstration et
// APP_DEBUG=true ne sert à rien.
check("le contrôle refuse une machine de développement", $preStatus !== 0);
check('il nomme APP_DEBUG', str_contains($preflight, 'APP_DEBUG'));
check('il nomme le jeu de démonstration', str_contains($preflight, 'démonstration'));
check('il vérifie que .env est hors du dossier web', str_contains($preflight, '.env'));
check('il compte les migrations appliquées', str_contains($preflight, 'migrations'));

echo "\n" . str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
