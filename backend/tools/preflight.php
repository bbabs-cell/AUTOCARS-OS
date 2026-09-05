<?php

declare(strict_types=1);

/**
 * Contrôle avant mise en production
 * ==================================================================
 * « EST-CE QU'ON A PENSÉ À TOUT ? » DEVIENT UNE COMMANDE.
 * ==================================================================
 * Usage, sur le serveur, depuis le dossier backend/ :
 *
 *   php tools/preflight.php
 *
 * Il sort en erreur si un point BLOQUANT n'est pas satisfait, ce qui
 * permet de le placer dans un script de déploiement : la mise en
 * ligne s'arrête plutôt que de partir avec les erreurs affichées à
 * tout internet.
 *
 * ------------------------------------------------------------------
 * POURQUOI CET OUTIL PLUTÔT QU'UNE LISTE DANS LA DOCUMENTATION
 *
 * Une liste se lit la première fois, puis on la connaît par cœur —
 * et c'est précisément à ce moment qu'on saute une ligne. Les points
 * vérifiés ici sont ceux qu'on oublie en étant pressé, et dont
 * l'oubli ne se voit pas tout de suite :
 *
 *   - APP_DEBUG resté à true expose les chemins de fichiers et la
 *     structure du code à chaque erreur ;
 *   - la clé de signature du modèle `.env.example` laisse fabriquer
 *     de faux jetons à qui a lu le dépôt ;
 *   - le jeu de démonstration oublié en base met « Groupe Diallo
 *     Auto » dans les données d'un vrai client.
 *
 * Aucun de ces trois-là ne fait planter quoi que ce soit. C'est ce
 * qui les rend dangereux.
 */

use Autocare\Core\Database;
use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

/** @var list<array{level:string, label:string, detail:string}> */
$results = [];

// CHAQUE CONTRÔLE S'AFFICHE, RÉUSSI OU NON.
//
// Un outil qui ne montre que les problèmes laisse croire qu'il n'a
// rien regardé quand tout va bien. Celui qui déploie a besoin de voir
// la liste de ce qui a été vérifié — c'est elle qui le rassure, et
// c'est elle qui lui fait remarquer un contrôle manquant.
function afficher(string $level, string $label, bool $ok, string $detail): void
{
    global $results;

    $results[] = ['level' => $ok ? 'OK' : $level, 'label' => $label, 'detail' => $detail];

    printf(
        "  [%-8s] %s%s\n",
        $ok ? 'OK' : $level,
        $label,
        $detail !== '' && !$ok ? ' — ' . $detail : '',
    );
}

function bloquant(string $label, bool $ok, string $detail = ''): void
{
    afficher('BLOQUANT', $label, $ok, $detail);
}

function avertissement(string $label, bool $ok, string $detail = ''): void
{
    afficher('AVERTIR', $label, $ok, $detail);
}

$isProduction = Env::get('APP_ENV') === 'production';
$root         = dirname(__DIR__);

echo "=== AUTOCARE OS — contrôle avant mise en production ===\n\n";
echo '  APP_ENV = ' . (Env::get('APP_ENV') ?? '(absent)') . "\n\n";

// ------------------------------------------------------------------
echo "1. Configuration\n";
// ------------------------------------------------------------------

bloquant(
    "APP_ENV vaut « production »",
    $isProduction,
    'trouvé : ' . (Env::get('APP_ENV') ?? '(absent)')
);

// Le plus important de tous. Avec APP_DEBUG à true, la moindre erreur
// affiche le chemin des fichiers, la trace d'appel et parfois une
// requête SQL — c'est-à-dire une carte du code offerte à qui la
// demande.
bloquant(
    'APP_DEBUG est désactivé',
    !Env::bool('APP_DEBUG', false)
);

$secret = (string) Env::get('JWT_SECRET', '');

bloquant('JWT_SECRET est renseigné', $secret !== '');
bloquant(
    'JWT_SECRET fait au moins 64 caractères',
    strlen($secret) >= 64,
    strlen($secret) . ' caractères'
);

// Une clé recopiée du modèle est une clé publique : elle est dans
// Git, donc chez tout le monde. Quiconque l'a peut se fabriquer un
// jeton pour n'importe quel compte.
$exemple = @file_get_contents($root . '/.env.example') ?: '';
preg_match('/^JWT_SECRET=(.*)$/m', $exemple, $m);
$secretModele = trim($m[1] ?? '');

bloquant(
    "JWT_SECRET n'est pas celui du modèle",
    $secretModele === '' || $secret !== $secretModele
);

$frontend = (string) Env::get('APP_FRONTEND_URL', '');

bloquant(
    'APP_FRONTEND_URL est en HTTPS',
    str_starts_with($frontend, 'https://'),
    $frontend === '' ? '(absent)' : $frontend
);

// Le transport `log` écrit les messages dans un fichier au lieu de
// les envoyer : personne ne recevrait son lien de mot de passe
// oublié, et le fichier accumulerait des liens valides.
avertissement(
    "MAIL_DRIVER n'est pas « log »",
    mb_strtolower((string) Env::get('MAIL_DRIVER', 'log')) !== 'log',
    'trouvé : ' . (Env::get('MAIL_DRIVER') ?? 'log')
);

// ------------------------------------------------------------------
echo "\n2. PHP\n";
// ------------------------------------------------------------------

bloquant('PHP 8.2 ou plus récent', PHP_VERSION_ID >= 80200, PHP_VERSION);

foreach (['pdo_mysql', 'mbstring', 'json', 'fileinfo', 'gd'] as $extension) {
    bloquant("extension {$extension}", extension_loaded($extension));
}

// display_errors est posé par le contrôleur d'entrée d'après
// APP_DEBUG, mais un php.ini peut le forcer : on vérifie ce que PHP
// fait vraiment, pas ce qu'on lui a demandé.
avertissement(
    "display_errors est désactivé dans php.ini",
    !filter_var(ini_get('display_errors'), FILTER_VALIDATE_BOOL),
    'ini : ' . var_export(ini_get('display_errors'), true)
);

// ------------------------------------------------------------------
echo "\n3. Fichiers et permissions\n";
// ------------------------------------------------------------------

// LE POINT LE PLUS GRAVE QU'UN DÉPLOIEMENT PUISSE RATER.
// Si la racine du site pointe sur backend/ au lieu de backend/public/,
// alors `.env` est téléchargeable : identifiants de base de données et
// clé de signature, en une requête.
bloquant(
    "`.env` est HORS du dossier exposé au web",
    !is_file($root . '/public/.env'),
    'un .env dans public/ serait téléchargeable'
);

bloquant(
    'le dossier des photos est hors du dossier web',
    !str_contains(realpath($root . '/storage/uploads') ?: '', '/public/')
);

foreach (['storage/uploads', 'storage/logs'] as $directory) {
    $path = $root . '/' . $directory;

    bloquant("{$directory} existe", is_dir($path));
    bloquant("{$directory} est accessible en écriture", is_writable($path));
}

// Le dépôt lui-même n'a rien à faire sur un serveur de production :
// `.git` contient tout l'historique, y compris d'anciens fichiers de
// configuration si quelqu'un en a commité un par accident.
avertissement(
    "le dossier .git n'est pas déployé",
    !is_dir($root . '/../.git'),
    'présent : déploie une archive, pas un clone'
);

// ------------------------------------------------------------------
echo "\n4. Base de données\n";
// ------------------------------------------------------------------

try {
    $db = Database::connection();

    bloquant('la base répond', true);

    // Une migration en attente veut dire que le code déployé attend
    // une colonne qui n'existe pas : les écrans concernés tomberont en
    // erreur à la première utilisation, pas au déploiement.
    $applied = $db->query('SELECT COUNT(*) FROM migrations')->fetchColumn();
    $files   = glob($root . '/database/migrations/*.sql') ?: [];

    bloquant(
        'toutes les migrations sont appliquées',
        (int) $applied === count($files),
        (int) $applied . ' appliquées sur ' . count($files) . ' fichiers'
    );

    // Le jeu de démonstration et le banc de mesure sont des données
    // de développement. Les laisser mélange « Groupe Diallo Auto » et
    // 76 000 opérations fictives aux données d'un vrai client.
    foreach (['diallo-auto' => 'jeu de démonstration',
              'banc-de-mesure' => 'banc de mesure'] as $slug => $quoi) {
        $statement = $db->prepare('SELECT COUNT(*) FROM organizations WHERE slug = :slug');
        $statement->execute(['slug' => $slug]);

        bloquant("le {$quoi} est absent de la base", (int) $statement->fetchColumn() === 0);
    }

    // Un compte sans mot de passe haché n'existe pas dans ce produit,
    // mais une restauration mal faite pourrait en créer.
    $clair = $db->query(
        "SELECT COUNT(*) FROM users WHERE password_hash NOT LIKE '\$2y\$%'
                                       AND password_hash NOT LIKE '\$argon2%'"
    )->fetchColumn();

    bloquant('aucun mot de passe non haché', (int) $clair === 0, "{$clair} compte(s)");
} catch (Throwable $exception) {
    bloquant('la base répond', false, $exception->getMessage());
}

// ------------------------------------------------------------------
echo "\n5. Sauvegarde\n";
// ------------------------------------------------------------------

// UNE SAUVEGARDE QU'ON N'A JAMAIS RESTAURÉE N'EST PAS UNE SAUVEGARDE.
// On ne peut pas vérifier ici qu'une restauration a été essayée ; on
// vérifie au moins que l'outil est là et qu'il a déjà tourné.
$backupDirectory = (string) Env::get('BACKUP_DIR', $root . '/storage/backups');

avertissement(
    'un dossier de sauvegarde existe',
    is_dir($backupDirectory),
    $backupDirectory
);

if (is_dir($backupDirectory)) {
    $archives = glob($backupDirectory . '/autocare-*.sql.gz') ?: [];
    $latest   = $archives === [] ? 0 : max(array_map('filemtime', $archives));

    avertissement(
        'une sauvegarde date de moins de 48 heures',
        $latest > 0 && (time() - $latest) < 172800,
        $latest === 0 ? 'aucune archive' : 'dernière : ' . date('Y-m-d H:i', $latest)
    );
}

// ------------------------------------------------------------------
// Résultat
// ------------------------------------------------------------------
$bloquants     = 0;
$avertissements = 0;

echo "\n" . str_repeat('=', 62) . "\n";

foreach ($results as $result) {
    if ($result['level'] === 'OK') {
        continue;
    }

    $result['level'] === 'BLOQUANT' ? $bloquants++ : $avertissements++;

    printf(
        "  [%s] %s%s\n",
        $result['level'],
        $result['label'],
        $result['detail'] !== '' ? ' — ' . $result['detail'] : ''
    );
}

if ($bloquants + $avertissements === 0) {
    echo "  (rien à signaler)\n";
}

$total = count($results);
$ok    = $total - $bloquants - $avertissements;

printf("\n  %d contrôle(s) : %d au vert, %d avertissement(s), %d bloquant(s)\n",
    $total, $ok, $avertissements, $bloquants);

echo str_repeat('=', 62) . "\n";

if ($bloquants > 0) {
    echo "\nNE PAS METTRE EN LIGNE tant que les points bloquants ne sont pas levés.\n";
    exit(1);
}

if ($avertissements > 0) {
    echo "\nMise en ligne possible. Les avertissements méritent une réponse consciente.\n";
    exit(0);
}

echo "\nTout est au vert.\n";
