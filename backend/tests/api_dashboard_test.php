<?php

declare(strict_types=1);

/**
 * Tests de l'API — tableau de bord
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_dashboard_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - LE POINT LE PLUS IMPORTANT : qu'un employé ne reçoive AUCUN
 *     montant. Pas un bloc masqué par l'interface — un bloc absent de
 *     la réponse. C'est la différence entre une protection et une
 *     décoration, et elle se vérifie en lisant le JSON brut.
 *   - que les compteurs comptent ce qu'ils prétendent compter
 *   - que les alertes disparaissent quand le problème est réglé
 *   - que les seuils viennent de la MÊME source que la file d'attente
 */

use Autocare\Core\Database;
use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

const API = 'http://127.0.0.1:8000';

$passed = 0;
$failed = 0;

function check(string $d, bool $c, string $x = ''): void {
    global $passed, $failed;
    if ($c) { $passed++; echo "  [OK]     {$d}\n"; }
    else { $failed++; echo "  [ÉCHEC]  {$d}" . ($x !== '' ? " — {$x}" : '') . "\n"; }
}

function call(string $m, string $p, ?array $b = null, ?string $t = null): array {
    $h  = curl_init(API . $p);
    $hd = ['Content-Type: application/json'];
    if ($t !== null) { $hd[] = 'Authorization: Bearer ' . $t; }
    curl_setopt_array($h, [CURLOPT_CUSTOMREQUEST => $m, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $hd, CURLOPT_TIMEOUT => 20]);
    if ($b !== null) { curl_setopt($h, CURLOPT_POSTFIELDS, json_encode($b, JSON_UNESCAPED_UNICODE)); }
    $r = curl_exec($h);
    $s = (int) curl_getinfo($h, CURLINFO_HTTP_CODE);
    curl_close($h);
    return ['status' => $s, 'raw' => is_string($r) ? $r : '',
            'body' => is_string($r) ? (json_decode($r, true) ?? []) : []];
}

if (call('GET', '/api/health')['status'] === 0) {
    echo "[ARRÊT] L'API ne répond pas sur " . API . "\n";
    echo "        Démarre-la : php -S localhost:8000 -t public router.php\n";
    exit(1);
}

$sfx = bin2hex(random_bytes(4));

function reg(string $name, string $sfx): array {
    $r = call('POST', '/api/auth/register', [
        'organization_name' => "{$name} {$sfx}", 'first_name' => 'G', 'last_name' => $name,
        'email' => "g-{$sfx}-" . strtolower($name) . "@t.local", 'password' => 'mot-de-passe-de-test',
    ]);
    return [
        'token'   => $r['body']['data']['access_token'] ?? null,
        'station' => $r['body']['data']['user']['station_ids'][0] ?? 0,
    ];
}

$a = reg('Alpha', $sfx);
$b = reg('Beta', $sfx);
$db = Database::connection();

echo "=== LOT 10 — tableau de bord ===\n\n1. Un tableau vide reste lisible\n";

$empty = call('GET', '/api/dashboard', null, $a['token']);

check("le tableau de bord se charge sur une station neuve", $empty['status'] === 200);
check("aucune alerte quand tout va bien", ($empty['body']['data']['alerts'] ?? null) === []);
check("les compteurs valent zéro, pas null",
    ($empty['body']['data']['today']['vehicles_in'] ?? null) === 0);
// LE PIÈGE DU `??` : il traite une valeur NULLE comme une clé
// absente, donc `null ?? 'x'` vaut 'x'. Ici on veut prouver que la
// clé EXISTE et vaut null — deux choses différentes.
$vide = $empty['body']['data'];

check("la durée moyenne est null tant qu'il n'y a pas assez de dossiers",
    array_key_exists('average_turnaround_minutes', $vide)
    && $vide['average_turnaround_minutes'] === null);
check("la série de recette couvre 7 jours même sans recette",
    count($empty['body']['data']['revenue_series'] ?? []) === 7);
check("chaque jour porte son libellé, calculé par le serveur",
    ($empty['body']['data']['revenue_series'][0]['label'] ?? '') !== '');

// --- Jeu de données ------------------------------------------------
$customerId = call('POST', '/api/customers', [
    'first_name' => 'Awa', 'last_name' => 'Ndao', 'phone' => '+221 77 300 44 55',
], $a['token'])['body']['data']['id'];

$serviceId = call('POST', '/api/services', [
    'name' => 'Lavage tableau ' . $sfx, 'price' => 6000, 'duration_minutes' => 30,
], $a['token'])['body']['data']['id'];

function openOperation(string $plate, array $owner, int $customerId, int $serviceId): int {
    $vehicleId = call('POST', '/api/vehicles', [
        'plate_number' => $plate, 'customer_id' => $customerId,
        'brand' => 'Suzuki', 'model' => 'Swift', 'vehicle_type' => 'CAR',
    ], $owner['token'])['body']['data']['id'];

    return (int) (call('POST', '/api/operations', [
        'vehicle_id' => $vehicleId, 'service_id' => $serviceId, 'station_id' => $owner['station'],
    ], $owner['token'])['body']['data']['operation']['id'] ?? 0);
}

$op1 = openOperation('DK-3001-TB', $a, $customerId, $serviceId);
$op2 = openOperation('DK-3002-TB', $a, $customerId, $serviceId);

echo "\n2. Les compteurs du jour\n";

$d = call('GET', '/api/dashboard', null, $a['token'])['body']['data'];

check("les véhicules accueillis sont comptés", (int) $d['today']['vehicles_in'] === 2);
check("ceux en station aussi", (int) $d['today']['in_progress'] === 2);
check("dont ceux qui attendent", (int) $d['today']['waiting'] === 2);
check("aucun restitué pour l'instant", (int) $d['today']['released'] === 0);
check("la recette du jour est à zéro", (int) $d['today']['revenue'] === 0);

echo "\n3. Les alertes n'apparaissent QUE s'il y a un problème\n";

check("un véhicule qui vient d'arriver ne déclenche rien",
    !in_array('waiting_too_long', array_column($d['alerts'], 'key'), true));

// On vieillit un dossier : l'alerte doit apparaître, avec le MÊME
// seuil que la file d'attente (config/operation_status.php).
$db->prepare('UPDATE operations SET status_changed_at = NOW() - INTERVAL 45 MINUTE WHERE id = :id')
   ->execute(['id' => $op1]);

$d = call('GET', '/api/dashboard', null, $a['token'])['body']['data'];
$keys = array_column($d['alerts'], 'key');

check("un dossier en dépassement déclenche l'alerte", in_array('overdue', $keys, true));
check("un client qui attend depuis 45 minutes est signalé",
    in_array('waiting_too_long', $keys, true));
check("chaque alerte dit OÙ aller pour la régler",
    count(array_filter($d['alerts'], static fn (array $a): bool => ($a['route'] ?? '') !== ''))
        === count($d['alerts']));

// Le dossier avance : l'alerte doit DISPARAÎTRE. Une alerte qui
// survit au problème cesse d'être lue au bout d'une semaine.
call('PUT', "/api/operations/{$op1}/status", ['status' => 'IN_PROGRESS'], $a['token']);

$keys = array_column(
    call('GET', '/api/dashboard', null, $a['token'])['body']['data']['alerts'],
    'key'
);

check("l'alerte d'attente disparaît une fois le véhicule pris en charge",
    !in_array('waiting_too_long', $keys, true));

echo "\n4. La recette\n";

call('POST', "/api/operations/{$op2}/payments",
    ['amount' => 6000, 'method' => 'CASH'], $a['token']);
call('POST', "/api/operations/{$op1}/payments",
    ['amount' => 4000, 'method' => 'MOBILE_MONEY', 'provider' => 'Wave'], $a['token']);

$d = call('GET', '/api/dashboard', null, $a['token'])['body']['data'];

check("la recette du jour additionne tous les moyens",
    (int) $d['today']['revenue'] === 10000, (string) $d['today']['revenue']);

$today = end($d['revenue_series']);
check("le dernier point de la série est aujourd'hui",
    ($today['date'] ?? '') === date('Y-m-d') && (int) $today['total'] === 10000);

$split = [];
foreach ($d['payment_split'] as $row) { $split[$row['method']] = (int) $row['total']; }

check("la ventilation par moyen est juste",
    ($split['CASH'] ?? 0) === 6000 && ($split['MOBILE_MONEY'] ?? 0) === 4000);

echo "\n5. LE POINT CENTRAL : un employé ne reçoit AUCUN montant\n";

$employee = call('POST', '/api/team', [
    'first_name' => 'Ndeye', 'last_name' => 'Diop', 'email' => "tb-{$sfx}@t.local",
    'password' => 'mot-de-passe-de-test', 'role' => 'EMPLOYEE', 'station_id' => $a['station'],
], $a['token']);
check("un employé peut être créé pour le test", $employee['status'] === 201);

$employeeToken = call('POST', '/api/auth/login', [
    'email' => "tb-{$sfx}@t.local", 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

$asEmployee = call('GET', '/api/dashboard', null, $employeeToken);
$e = $asEmployee['body']['data'];

check("un employé PEUT ouvrir le tableau de bord", $asEmployee['status'] === 200);
check("il voit le travail : véhicules en station", isset($e['today']['in_progress']));
check("le serveur annonce lui-même qu'il n'a pas droit aux montants",
    ($e['can_see_money'] ?? true) === false);

// Les blocs ne sont pas masqués : ils sont ABSENTS.
check("aucune recette du jour", !array_key_exists('revenue', $e['today']));
check("aucune série de recette", !array_key_exists('revenue_series', $e));
check("aucune ventilation par moyen de paiement", !array_key_exists('payment_split', $e));
check("aucun bloc caisse", !array_key_exists('cash', $e));
check("aucun montant impayé", !array_key_exists('ready_unpaid', $e));

// Le classement des prestations reste visible — le VOLUME est une
// information de travail — mais sans les montants.
check("le classement des prestations reste visible", ($e['top_services'] ?? null) !== null);
check("…mais sans chiffre d'affaires par prestation",
    count(array_filter($e['top_services'], static fn (array $s): bool => isset($s['total']))) === 0);

// La vérification qui compte vraiment : lire le JSON BRUT. Un champ
// oublié dans un sous-objet passerait à travers les tests ci-dessus.
check("AUCUN montant nulle part dans la réponse brute",
    preg_match('/"(revenue|amount|expected|outside_session)"/', $asEmployee['raw']) !== 1,
    'un champ monétaire a échappé au filtrage');

echo "\n6. Les droits envoyés au frontend\n";

$me = call('GET', '/api/auth/me', null, $employeeToken)['body']['data'];

check("la liste des droits accompagne le profil", is_array($me['permissions'] ?? null));
check("elle contient bien ceux de l'employé",
    in_array('payments.create', $me['permissions'], true));
check("et pas ceux qu'il n'a pas",
    !in_array('payments.journal', $me['permissions'], true)
    && !in_array('cash.view', $me['permissions'], true));

$adminMe = call('GET', '/api/auth/me', null, $a['token'])['body']['data'];
check("un administrateur reçoit l'étoile plutôt que deux cents chaînes",
    $adminMe['permissions'] === ['*']);

echo "\n7. Isolation entre entreprises\n";

$betaDashboard = call('GET', '/api/dashboard', null, $b['token'])['body']['data'];

check("Beta ne voit aucun véhicule d'Alpha",
    (int) $betaDashboard['today']['vehicles_in'] === 0);
check("Beta ne voit aucune recette d'Alpha",
    (int) $betaDashboard['today']['revenue'] === 0);
check("Beta n'hérite d'aucune alerte d'Alpha", $betaDashboard['alerts'] === []);
check("Beta ne voit aucune prestation d'Alpha", $betaDashboard['top_services'] === []);

check("filtrer sur la station d'une autre entreprise est refusé",
    in_array(
        call('GET', "/api/dashboard?station_id={$b['station']}", null, $a['token'])['status'],
        [403, 404],
        true
    ));

// --- Ménage --------------------------------------------------------
$orgs = "(SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%')";
$db->exec("DELETE FROM payments WHERE organization_id IN {$orgs}");
$db->exec("DELETE FROM cash_sessions WHERE organization_id IN {$orgs}");

foreach (['inspection_photos', 'inspections', 'operations', 'vehicles', 'customers',
          'audit_logs', 'refresh_tokens', 'station_users', 'services', 'users', 'stations'] as $table) {
    $db->exec("DELETE FROM {$table} WHERE organization_id IN {$orgs}");
}
$db->exec("DELETE FROM organizations WHERE slug LIKE '%{$sfx}%'");

echo "\n" . str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
