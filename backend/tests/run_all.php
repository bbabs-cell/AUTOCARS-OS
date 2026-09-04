<?php

declare(strict_types=1);

/**
 * Lanceur de tous les tests
 * ------------------------------------------------------------------
 * Usage, depuis le dossier backend/ :
 *
 *   php tests/run_all.php
 *
 * Les tests d'API ont besoin du serveur démarré dans un autre
 * terminal ; ils sont ignorés proprement s'il ne répond pas, plutôt
 * que de faire échouer l'ensemble.
 *
 * POURQUOI UN LANCEUR ?
 * Parce qu'à huit fichiers, on finit par n'en lancer que deux — et
 * ce sont toujours les deux mêmes. Une seule commande, et on sait où
 * on en est.
 */

$tests = [
    'schema_test.php'        => 'Schéma de base de données',
    'security_test.php'      => 'Isolation et permissions',
    // Sans base ni serveur : quelques millisecondes, donc on le lance
    // à chaque modification du parcours.
    'state_machine_test.php' => 'Machine à états des opérations',
    'api_test.php'            => 'API — installation et prestations',
    'api_crm_test.php'        => 'API — clients et véhicules',
    'api_operations_test.php' => 'API — opérations et inspections',
    'api_queue_test.php'      => "API — file d'attente",
    'api_payment_test.php'    => 'API — encaissements et caisse',
];

$directory = __DIR__;
$results   = [];
$anyFailed = false;

foreach ($tests as $file => $label) {
    echo str_repeat('=', 60) . "\n";
    echo "  {$label}\n";
    echo str_repeat('=', 60) . "\n";

    $output   = [];
    $exitCode = 0;

    exec('php ' . escapeshellarg($directory . '/' . $file) . ' 2>&1', $output, $exitCode);

    $text = implode("\n", $output);
    echo $text . "\n\n";

    // On extrait le décompte de la dernière ligne de résumé.
    $summary = 'résultat inconnu';

    if (preg_match('/(\d+) test\(s\) réussi\(s\), (\d+) échec/u', $text, $matches) === 1) {
        $summary = "{$matches[1]} réussis, {$matches[2]} échecs";
    } elseif (str_contains($text, '[ARRÊT]')) {
        $summary = 'ignoré (API non démarrée)';
        $exitCode = 0;
    }

    $results[$label] = ['summary' => $summary, 'ok' => $exitCode === 0];

    if ($exitCode !== 0) {
        $anyFailed = true;
    }
}

echo str_repeat('=', 60) . "\n";
echo "  RÉCAPITULATIF\n";
echo str_repeat('=', 60) . "\n";

foreach ($results as $label => $result) {
    printf("  %-4s %-38s %s\n", $result['ok'] ? '[OK]' : '[KO]', $label, $result['summary']);
}

echo str_repeat('=', 60) . "\n";

exit($anyFailed ? 1 : 0);
