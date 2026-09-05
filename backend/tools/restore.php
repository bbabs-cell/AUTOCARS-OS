<?php

declare(strict_types=1);

/**
 * Restauration d'une sauvegarde
 * ==================================================================
 * UNE SAUVEGARDE QU'ON N'A JAMAIS RESTAURÉE N'EST PAS UNE SAUVEGARDE.
 * ==================================================================
 * Usage, depuis le dossier backend/ :
 *
 *   php tools/restore.php --list
 *   php tools/restore.php --latest
 *   php tools/restore.php autocare-2026-09-05_020000
 *
 * Ajouter `--photos` pour restaurer aussi les images d'inspection.
 *
 * ------------------------------------------------------------------
 * CET OUTIL EXISTE POUR ÊTRE ESSAYÉ, PAS SEULEMENT POUR LES DRAMES
 *
 * Le jour où l'on en a réellement besoin est le pire moment pour
 * découvrir qu'une archive était tronquée, qu'il manque une
 * permission, ou que la commande ne s'appelle pas comme on croyait.
 *
 * Une restauration d'essai devrait être faite tous les trimestres,
 * sur une base de test — jamais sur la production. C'est pourquoi
 * l'outil REFUSE de tourner quand APP_ENV vaut « production » sans
 * `--je-sais-ce-que-je-fais` : restaurer écrase, et une restauration
 * lancée dans le mauvais terminal détruit la journée en cours.
 *
 * ------------------------------------------------------------------
 * L'EMPREINTE EST VÉRIFIÉE AVANT D'ÉCRASER QUOI QUE CE SOIT
 *
 * Une archive abîmée restaurée par-dessus des données vivantes, c'est
 * deux pertes au lieu d'une.
 */

use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

$root      = dirname(__DIR__);
$options   = array_slice($argv, 1);
$directory = rtrim((string) Env::get('BACKUP_DIR', $root . '/storage/backups'), '/');
$database  = (string) Env::get('DB_NAME', 'autocare_os');

$archives = glob("{$directory}/autocare-*.sql.gz") ?: [];
sort($archives);

// ------------------------------------------------------------------
// --list : ce qu'on a sous la main
// ------------------------------------------------------------------
if (in_array('--list', $options, true) || $options === []) {
    echo "=== Sauvegardes disponibles ===\n\n";

    if ($archives === []) {
        echo "  (aucune dans {$directory})\n";
        exit(0);
    }

    foreach ($archives as $archive) {
        $name     = substr(basename($archive), 0, -strlen('.sql.gz'));
        $manifest = "{$directory}/{$name}.json";
        $photos   = is_file("{$directory}/{$name}-photos.tar.gz") ? ' + photos' : '';

        printf(
            "  %-28s %8s%s%s\n",
            $name,
            round(((int) filesize($archive)) / 1048576, 1) . ' Mo',
            $photos,
            is_file($manifest) ? '' : '   (SANS EMPREINTE)',
        );
    }

    echo "\nPour restaurer :  php tools/restore.php --latest\n";
    exit(0);
}

// ------------------------------------------------------------------
// Quelle archive ?
// ------------------------------------------------------------------
$name = null;

if (in_array('--latest', $options, true)) {
    $name = $archives === []
        ? null
        : substr(basename((string) end($archives)), 0, -strlen('.sql.gz'));
} else {
    foreach ($options as $option) {
        if (!str_starts_with($option, '--')) {
            $name = basename($option);
            break;
        }
    }
}

if ($name === null) {
    echo "[ERREUR] Aucune archive indiquée. `php tools/restore.php --list`\n";
    exit(1);
}

$sqlPath      = "{$directory}/{$name}.sql.gz";
$photosPath   = "{$directory}/{$name}-photos.tar.gz";
$manifestPath = "{$directory}/{$name}.json";

if (!is_file($sqlPath)) {
    echo "[ERREUR] Introuvable : {$sqlPath}\n";
    exit(1);
}

echo "=== Restauration de {$name} ===\n\n";

// ------------------------------------------------------------------
// Le garde-fou de production
// ------------------------------------------------------------------
if (Env::get('APP_ENV') === 'production'
    && !in_array('--je-sais-ce-que-je-fais', $options, true)) {
    echo "[REFUSÉ] APP_ENV vaut « production ».\n\n";
    echo "  Restaurer ÉCRASE la base : tout ce qui a été enregistré depuis\n";
    echo "  cette sauvegarde disparaît — les dossiers ouverts ce matin, les\n";
    echo "  encaissements de la journée.\n\n";
    echo "  Si c'est bien ce que vous voulez, relancez avec :\n";
    echo "      php tools/restore.php {$name} --je-sais-ce-que-je-fais\n\n";
    echo "  Et faites d'abord une sauvegarde de l'état actuel :\n";
    echo "      php tools/backup.php\n";
    exit(1);
}

// ------------------------------------------------------------------
// L'empreinte, AVANT d'écraser
// ------------------------------------------------------------------
if (is_file($manifestPath)) {
    $manifest = json_decode((string) file_get_contents($manifestPath), true) ?: [];
    $expected = (string) ($manifest['sql_sha256'] ?? '');
    $actual   = (string) hash_file('sha256', $sqlPath);

    if ($expected !== '' && !hash_equals($expected, $actual)) {
        echo "[REFUSÉ] L'empreinte ne correspond pas : l'archive est abîmée.\n";
        echo "  attendue : {$expected}\n";
        echo "  trouvée  : {$actual}\n\n";
        echo "  Une archive abîmée restaurée par-dessus des données vivantes,\n";
        echo "  c'est deux pertes au lieu d'une.\n";
        exit(1);
    }

    echo "  empreinte vérifiée\n";
} else {
    echo "  [ATTENTION] Pas d'empreinte pour cette archive : impossible de\n";
    echo "              vérifier qu'elle est complète.\n";
}

// ------------------------------------------------------------------
// La restauration
// ------------------------------------------------------------------
$defaults = tempnam(sys_get_temp_dir(), 'autocare-my');

if ($defaults === false) {
    echo "[ERREUR] Fichier temporaire impossible.\n";
    exit(1);
}

chmod($defaults, 0600);

file_put_contents($defaults, sprintf(
    "[client]\nhost=%s\nport=%s\nuser=%s\npassword=\"%s\"\n",
    Env::get('DB_HOST', '127.0.0.1'),
    Env::get('DB_PORT', '3306'),
    Env::get('DB_USER', 'root'),
    str_replace('"', '\\"', (string) Env::get('DB_PASSWORD', '')),
));

exec(sprintf(
    'gunzip -c %s | mysql --defaults-extra-file=%s %s 2>&1',
    escapeshellarg($sqlPath),
    escapeshellarg($defaults),
    escapeshellarg($database),
), $output, $status);

@unlink($defaults);

if ($status !== 0) {
    echo "[ERREUR] La restauration a échoué :\n  " . implode("\n  ", $output) . "\n";
    exit(1);
}

echo "  base restaurée\n";

// ------------------------------------------------------------------
// Les photos
// ------------------------------------------------------------------
if (in_array('--photos', $options, true) && is_file($photosPath)) {
    $uploads = $root . '/storage/uploads';

    if (!is_dir($uploads)) {
        mkdir($uploads, 0770, true);
    }

    exec(sprintf(
        'tar -xzf %s -C %s 2>&1',
        escapeshellarg($photosPath),
        escapeshellarg($uploads),
    ), $tarOutput, $tarStatus);

    echo $tarStatus === 0
        ? "  photos restaurées\n"
        : "  [ATTENTION] Photos non restaurées : " . implode(' ', $tarOutput) . "\n";
}

// ------------------------------------------------------------------
// LA VÉRIFICATION D'APRÈS — sans elle, on ne sait pas si ça a marché
// ------------------------------------------------------------------
try {
    $db = \Autocare\Core\Database::connection();

    $tables = (int) $db->query(
        'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
    )->fetchColumn();

    $organisations = (int) $db->query('SELECT COUNT(*) FROM organizations')->fetchColumn();
    $operations    = (int) $db->query('SELECT COUNT(*) FROM operations')->fetchColumn();

    printf("\n  %d tables, %d entreprise(s), %d opération(s)\n",
        $tables, $organisations, $operations);

    if ($tables < 20) {
        echo "\n[ATTENTION] Moins de tables qu'attendu : vérifiez l'archive.\n";
        exit(1);
    }
} catch (Throwable $exception) {
    echo "\n[ERREUR] La base ne répond pas après restauration : "
        . $exception->getMessage() . "\n";
    exit(1);
}

echo "\nRestauration terminée.\n";
