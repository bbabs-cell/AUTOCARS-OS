<?php

declare(strict_types=1);

/**
 * Mesure du temps de réponse des écrans
 * ==================================================================
 * Usage, depuis le dossier backend/ :
 *
 *   1) php tools/benchmark_seed.php      fabrique le volume
 *   2) php -S localhost:8000 -t public router.php
 *   3) php tools/benchmark.php           mesure
 *
 * ------------------------------------------------------------------
 * ON MESURE DES ÉCRANS, PAS DES REQUÊTES SQL
 *
 * Chronométrer un `SELECT` isolé donne un chiffre juste et inutile :
 * un écran, c'est une requête HTTP qui traverse le routeur, le
 * contrôle du jeton, la vérification des permissions, plusieurs
 * requêtes, puis la mise en forme de la réponse. C'est ce total-là
 * que quelqu'un attend devant son comptoir.
 *
 * ------------------------------------------------------------------
 * LE 95e CENTILE, PAS LA MOYENNE
 *
 * Une moyenne cache exactement ce qui gêne. Dix-neuf réponses à 40 ms
 * et une à 2 secondes font une moyenne de 138 ms — un chiffre
 * rassurant qui décrit une expérience que personne n'a vécue. Le 95e
 * centile dit « une fois sur vingt, c'est au moins aussi lent que
 * ça », et c'est cette fois-là qui fait douter du logiciel.
 *
 * ------------------------------------------------------------------
 * LES BUDGETS SONT DES DÉCISIONS, PAS DES CONSTATS
 *
 * Chaque écran porte un budget écrit à la main, d'après ce qu'il sert
 * à faire — et non d'après ce qu'il mesure aujourd'hui. Un budget
 * calé sur la mesure du jour ne peut jamais échouer, donc ne protège
 * de rien.
 *
 *   200 ms  ce qu'on ouvre au comptoir, un client devant soi
 *   400 ms  ce qu'on consulte assis, une ou deux fois par jour
 *   800 ms  ce qui balaie des mois de données, le dimanche soir
 */

use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

const API   = 'http://127.0.0.1:8000';
const ROUNDS = 20;

$email    = 'mesure-0@banc.local';
$password = 'mot-de-passe-de-mesure';

function call(string $path, ?string $token = null, ?array $body = null): array
{
    $handle  = curl_init(API . $path);
    $headers = ['Content-Type: application/json'];

    if ($token !== null) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }

    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 60,
    ]);

    if ($body !== null) {
        curl_setopt($handle, CURLOPT_POST, true);
        curl_setopt($handle, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }

    $started  = microtime(true);
    $response = curl_exec($handle);
    $elapsed  = (microtime(true) - $started) * 1000;
    $status   = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);

    curl_close($handle);

    return [
        'ms'     => $elapsed,
        'status' => $status,
        'bytes'  => is_string($response) ? strlen($response) : 0,
        'body'   => is_string($response) ? (json_decode($response, true) ?? []) : [],
    ];
}

if (call('/api/health')['status'] === 0) {
    echo "[ARRÊT] L'API ne répond pas sur " . API . "\n";
    echo "        Démarre-la : php -S localhost:8000 -t public router.php\n";
    exit(1);
}

$login = call('/api/auth/login', null, ['email' => $email, 'password' => $password]);
$token = $login['body']['data']['access_token'] ?? null;

if ($token === null) {
    echo "[ARRÊT] Connexion impossible au banc de mesure.\n";
    echo "        Fabrique-le : php tools/benchmark_seed.php\n";
    exit(1);
}

$stationId = $login['body']['data']['user']['station_ids'][0] ?? 0;
$from      = date('Y-m-d', strtotime('-90 days'));
$to        = date('Y-m-d');

// ------------------------------------------------------------------
// LES ÉCRANS MESURÉS, AVEC LEUR BUDGET ET LA RAISON DE CE BUDGET
// ------------------------------------------------------------------
$screens = [
    ["File d'attente",        '/api/queue', 200,
        'Ouvert en permanence sur un écran de la station.'],
    ['Tableau de bord',       '/api/dashboard', 400,
        'Premier écran de la journée, une fois le matin.'],
    ['Accueil (dossiers)',    '/api/operations?active=1', 200,
        'Ouvert avec un client devant soi.'],
    ['Recherche client',      '/api/customers?search=Diallo', 200,
        'Tapé pendant que le client donne son nom.'],
    ['Recherche plaque',      '/api/vehicles?search=BM0042', 200,
        'Tapé pendant que le client tend ses clés.'],
    ['Journal des recettes',  "/api/payments?from={$from}&to={$to}", 400,
        'Consulté assis, en fin de journée.'],
    ['Caisse du jour',        '/api/cash/current', 200,
        'Ouvert à chaque encaissement en espèces.'],
    ['Carnet du jour',        '/api/bookings?from=' . $to . '&to=' . $to, 200,
        'Ouvert au téléphone, pendant que le client attend.'],
    ['Équipe',                '/api/team', 400,
        'Consulté de temps en temps.'],
    ['Registre de pointage',  "/api/attendance?from={$from}&to={$to}", 400,
        'Relu à la préparation de la paie.'],
    ['Abonnements',           '/api/subscriptions/overview', 400,
        'Consulté assis.'],
    ['Statistiques 90 jours', "/api/analytics?from={$from}&to={$to}", 800,
        'Balaie trois mois de données, le dimanche soir.'],
    ['Statistiques 1 an',     '/api/analytics?from=' . date('Y-m-d', strtotime('-365 days'))
                              . "&to={$to}", 800,
        'Le cas le plus lourd du produit.'],
];

if ($stationId > 0) {
    $screens[] = ["File d'attente (1 station)", "/api/queue?station_id={$stationId}", 200,
        'Le même écran, filtré sur une station.'];
}

echo "=== Banc de mesure — " . ROUNDS . " appels par écran ===\n\n";

$results = [];

foreach ($screens as [$label, $path, $budget, $why]) {
    $timings = [];
    $status  = 0;
    $bytes   = 0;

    // Un premier appel hors mesure : il paie le démarrage du processus
    // PHP et le remplissage des caches de MySQL, ce qu'un utilisateur
    // ne paie qu'une fois par jour.
    call($path, $token);

    for ($i = 0; $i < ROUNDS; $i++) {
        $result    = call($path, $token);
        $timings[] = $result['ms'];
        $status    = $result['status'];
        $bytes     = $result['bytes'];
    }

    sort($timings);

    $results[] = [
        'label'  => $label,
        'status' => $status,
        'p50'    => $timings[(int) floor(count($timings) * 0.50)],
        'p95'    => $timings[(int) floor(count($timings) * 0.95) - 1],
        'max'    => end($timings),
        'bytes'  => $bytes,
        'budget' => $budget,
        'why'    => $why,
    ];
}

printf("%-28s %6s %8s %8s %8s %9s   %s\n",
    'Écran', 'code', 'p50', 'p95', 'max', 'poids', 'budget');
echo str_repeat('-', 100) . "\n";

$over = 0;

foreach ($results as $row) {
    $exceeded = $row['p95'] > $row['budget'] || $row['status'] >= 400;

    if ($exceeded) {
        $over++;
    }

    printf(
        "%-28s %6d %7.0fms %7.0fms %7.0fms %8s   %4d ms %s\n",
        $row['label'],
        $row['status'],
        $row['p50'],
        $row['p95'],
        $row['max'],
        $row['bytes'] > 1024
            ? round($row['bytes'] / 1024) . ' ko'
            : $row['bytes'] . ' o',
        $row['budget'],
        $exceeded ? '  ← DÉPASSÉ' : '',
    );
}

echo "\n";

foreach ($results as $row) {
    if ($row['p95'] > $row['budget'] || $row['status'] >= 400) {
        echo "  {$row['label']} — {$row['why']}\n";
    }
}

echo $over === 0
    ? "Tous les écrans tiennent leur budget.\n"
    : "\n{$over} écran(s) hors budget.\n";

exit($over === 0 ? 0 : 1);
