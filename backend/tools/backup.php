<?php

declare(strict_types=1);

/**
 * Sauvegarde de la base et des photos
 * ==================================================================
 * Usage, depuis le dossier backend/ :
 *
 *   php tools/backup.php                sauvegarde base + photos
 *   php tools/backup.php --db-only      la base seule (plus rapide)
 *
 * À placer dans une tâche planifiée. Exemple, toutes les nuits à 2 h :
 *
 *   0 2 * * * cd /var/www/autocare/backend && php tools/backup.php
 *
 * ------------------------------------------------------------------
 * CE QUE CET OUTIL SAUVEGARDE, ET CE QU'IL NE SAUVEGARDE PAS
 *
 * Il sauvegarde ce qu'on ne peut pas refabriquer : la base et les
 * photos d'inspection. Le code, lui, est dans Git — le restaurer
 * depuis une archive de la veille serait même une mauvaise idée.
 *
 * Les photos comptent autant que la base, et c'est facile à oublier.
 * Une inspection sans ses photos ne prouve rien : c'est précisément
 * ce qui sert à la station le jour d'un litige sur une rayure.
 *
 * ------------------------------------------------------------------
 * LE MOT DE PASSE NE PASSE PAS PAR LA LIGNE DE COMMANDE
 *
 * `mysqldump --password=...` affiche le mot de passe dans la liste
 * des processus : n'importe quel utilisateur du serveur peut le lire
 * avec un `ps` pendant que la sauvegarde tourne.
 *
 * On écrit donc un fichier de configuration temporaire, lisible par
 * son seul propriétaire, et on l'efface ensuite — y compris si la
 * commande échoue.
 *
 * ------------------------------------------------------------------
 * UNE EMPREINTE ACCOMPAGNE CHAQUE ARCHIVE
 *
 * Une sauvegarde silencieusement tronquée — disque plein, connexion
 * coupée — ressemble à une bonne sauvegarde jusqu'au jour où on en a
 * besoin. L'empreinte permet à la restauration de refuser une archive
 * abîmée AVANT d'écraser quoi que ce soit.
 */

use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

$root      = dirname(__DIR__);
$options   = array_slice($argv, 1);
$dbOnly    = in_array('--db-only', $options, true);
$directory = rtrim((string) Env::get('BACKUP_DIR', $root . '/storage/backups'), '/');
$keep      = max(1, (int) Env::get('BACKUP_KEEP', '14'));

// Une archive de sauvegarde dans le dossier exposé au web serait
// téléchargeable par n'importe qui : c'est toute la base, en clair.
if (str_contains($directory, '/public/')) {
    echo "[REFUSÉ] BACKUP_DIR est dans le dossier exposé au web.\n";
    exit(1);
}

if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
    echo "[ERREUR] Impossible de créer {$directory}\n";
    exit(1);
}

@chmod($directory, 0700);

$stamp   = date('Y-m-d_His');
$name    = 'autocare-' . $stamp;
$sqlPath = "{$directory}/{$name}.sql.gz";

echo "=== Sauvegarde AUTOCARE OS — {$stamp} ===\n\n";

// ------------------------------------------------------------------
// 1. La base
// ------------------------------------------------------------------
$defaults = tempnam(sys_get_temp_dir(), 'autocare-my');

if ($defaults === false) {
    echo "[ERREUR] Impossible de créer le fichier de configuration temporaire.\n";
    exit(1);
}

// 0600 AVANT d'écrire le mot de passe : entre la création et le
// chmod, le fichier serait lisible par tous.
chmod($defaults, 0600);

file_put_contents($defaults, sprintf(
    "[client]\nhost=%s\nport=%s\nuser=%s\npassword=\"%s\"\n",
    Env::get('DB_HOST', '127.0.0.1'),
    Env::get('DB_PORT', '3306'),
    Env::get('DB_USER', 'root'),
    str_replace('"', '\\"', (string) Env::get('DB_PASSWORD', '')),
));

$database = (string) Env::get('DB_NAME', 'autocare_os');

// --single-transaction : une photographie cohérente sans bloquer les
//   écritures pendant la sauvegarde. Une station qui tourne la nuit
//   n'est pas arrêtée par sa propre sauvegarde.
// --routines --triggers : le schéma complet, pas seulement les tables.
$command = sprintf(
    'mysqldump --defaults-extra-file=%s --single-transaction --quick '
    . '--routines --triggers --default-character-set=utf8mb4 %s 2>&1 | gzip -9 > %s',
    escapeshellarg($defaults),
    escapeshellarg($database),
    escapeshellarg($sqlPath),
);

exec($command, $output, $status);

@unlink($defaults);

if ($status !== 0) {
    @unlink($sqlPath);

    echo "[ERREUR] mysqldump a échoué :\n  " . implode("\n  ", $output) . "\n";
    exit(1);
}

// gzip renvoie 0 même si mysqldump a écrit une erreur dans le flux :
// une archive minuscule est le signe qui ne trompe pas.
$size = (int) filesize($sqlPath);

if ($size < 1024) {
    @unlink($sqlPath);

    echo "[ERREUR] L'archive fait {$size} octets : la sauvegarde a échoué.\n";
    exit(1);
}

printf("  base    %s  (%s)\n", basename($sqlPath), formatSize($size));

// ------------------------------------------------------------------
// 2. Les photos
// ------------------------------------------------------------------
$photosPath = null;

if (!$dbOnly) {
    $uploads = $root . '/storage/uploads';

    if (is_dir($uploads)) {
        $photosPath = "{$directory}/{$name}-photos.tar.gz";

        exec(sprintf(
            'tar -czf %s -C %s . 2>&1',
            escapeshellarg($photosPath),
            escapeshellarg($uploads),
        ), $tarOutput, $tarStatus);

        if ($tarStatus !== 0) {
            @unlink($photosPath);
            $photosPath = null;

            echo "[ATTENTION] La sauvegarde des photos a échoué :\n  "
                . implode("\n  ", $tarOutput) . "\n";
        } else {
            printf("  photos  %s  (%s)\n", basename($photosPath),
                formatSize((int) filesize($photosPath)));
        }
    }
}

// ------------------------------------------------------------------
// 3. L'empreinte
// ------------------------------------------------------------------
$manifest = [
    'created_at' => date('c'),
    'database'   => $database,
    'sql'        => basename($sqlPath),
    'sql_sha256' => hash_file('sha256', $sqlPath),
    'sql_bytes'  => $size,
];

if ($photosPath !== null) {
    $manifest['photos']        = basename($photosPath);
    $manifest['photos_sha256'] = hash_file('sha256', $photosPath);
}

file_put_contents(
    "{$directory}/{$name}.json",
    json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n",
);

@chmod($sqlPath, 0600);

if ($photosPath !== null) {
    @chmod($photosPath, 0600);
}

// ------------------------------------------------------------------
// 4. La rétention
// ------------------------------------------------------------------
$archives = glob("{$directory}/autocare-*.sql.gz") ?: [];
sort($archives);

$excess = max(0, count($archives) - $keep);

foreach (array_slice($archives, 0, $excess) as $old) {
    $base = substr(basename($old), 0, -strlen('.sql.gz'));

    foreach (["{$directory}/{$base}.sql.gz", "{$directory}/{$base}-photos.tar.gz",
              "{$directory}/{$base}.json"] as $file) {
        if (is_file($file)) {
            @unlink($file);
        }
    }

    echo "  retirée {$base} (au-delà des {$keep} conservées)\n";
}

echo "\nTerminé. " . count(glob("{$directory}/autocare-*.sql.gz") ?: [])
    . " sauvegarde(s) dans {$directory}\n";
echo "\nRAPPEL : une sauvegarde qui reste sur le même serveur ne protège\n";
echo "         pas d'un disque perdu. Copiez-la ailleurs.\n";

function formatSize(int $bytes): string
{
    return $bytes > 1048576
        ? round($bytes / 1048576, 1) . ' Mo'
        : round($bytes / 1024) . ' ko';
}
