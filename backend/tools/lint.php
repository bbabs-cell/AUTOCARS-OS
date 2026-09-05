<?php

declare(strict_types=1);

/**
 * Vérification de syntaxe de tout le code PHP
 * ------------------------------------------------------------------
 * Usage, depuis le dossier backend/ :
 *
 *   php tools/lint.php
 *
 * ------------------------------------------------------------------
 * POURQUOI PAS UN ANALYSEUR STATIQUE ?
 *
 * PHPStan ou Psalm trouveraient bien plus de choses. Ils ajouteraient
 * aussi une dépendance, un fichier de configuration, un niveau de
 * sévérité à négocier et plusieurs centaines d'avertissements à
 * trier au premier lancement — sur un code qui n'en a jamais eu.
 *
 * Ce projet a une règle : aucune abstraction avant son deuxième cas
 * d'usage réel. Le besoin d'aujourd'hui est étroit et précis —
 * qu'AUCUN fichier poussé ne contienne une erreur de syntaxe, parce
 * qu'un tel fichier casse l'API entière et pas seulement la
 * fonctionnalité qu'il porte.
 *
 * `php -l` répond exactement à cette question, en quelques
 * millisecondes, sans rien installer. L'analyseur statique viendra
 * quand une erreur qu'il aurait attrapée nous aura coûté quelque
 * chose.
 *
 * ------------------------------------------------------------------
 * IL PARCOURT AUSSI tests/ ET tools/
 *
 * Un test qui ne s'analyse pas ne s'exécute pas, et son échec
 * ressemble alors à un test qui échoue — on cherche le bogue dans le
 * code testé pendant un quart d'heure.
 */

$roots = ['src', 'tests', 'tools', 'config', 'public', 'database'];
$base  = dirname(__DIR__);

$checked = 0;
$failed  = [];

foreach ($roots as $root) {
    $directory = $base . '/' . $root;

    if (!is_dir($directory)) {
        continue;
    }

    /** @var SplFileInfo $file */
    foreach (new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)
    ) as $file) {
        if ($file->getExtension() !== 'php') {
            continue;
        }

        $path = $file->getPathname();
        $checked++;

        // `php -l` écrit sur la sortie standard et rend un code de
        // sortie non nul en cas d'erreur. On capture les deux.
        exec(
            'php -l ' . escapeshellarg($path) . ' 2>&1',
            $output,
            $status,
        );

        if ($status !== 0) {
            $failed[$path] = implode("\n", $output);
        }

        $output = [];
    }
}

echo "=== Syntaxe PHP ===\n\n";

foreach ($failed as $path => $message) {
    echo '  [ÉCHEC]  ' . str_replace($base . '/', '', $path) . "\n";
    echo '           ' . str_replace("\n", "\n           ", trim($message)) . "\n";
}

echo sprintf(
    "\n  %d fichier(s) analysé(s), %d en erreur\n",
    $checked,
    count($failed),
);

exit($failed === [] ? 0 : 1);
