<?php

declare(strict_types=1);

/**
 * Tests de l'API — multi-stations et paramètres (lot 17)
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_settings_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - QU'ON NE FERME PAS UNE STATION QUI A DES CLÉS DANS SON TIROIR.
 *     Des clients vont revenir chercher ces véhicules ; leur dossier
 *     doit pouvoir aller jusqu'à la restitution.
 *   - qu'une entreprise ne puisse pas se retrouver sans aucune station
 *     ouverte, donc incapable d'enregistrer quoi que ce soit
 *   - qu'une station fermée refuse le NOUVEAU travail mais garde son
 *     PASSÉ lisible — on ferme, on n'efface pas
 *   - qu'un code de station reste unique dans l'entreprise, et pas
 *     au-delà : deux entreprises ont le droit d'avoir toutes les deux
 *     une station « DKR »
 *   - qu'une personne sans station ne puisse pas exister : sans
 *     rattachement, elle n'a aucun rôle, donc aucun droit
 *   - QUE LA DEVISE NE SE CHANGE PAS DEPUIS UN FORMULAIRE. Tous les
 *     montants sont des entiers de francs : basculer en euro
 *     diviserait le chiffre d'affaires par cent, en silence.
 *   - qu'un manager ne puisse ni ouvrir, ni fermer une station, ni
 *     lire les paramètres de l'entreprise
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
    return ['status' => $s, 'body' => is_string($r) ? (json_decode($r, true) ?? []) : []];
}

if (call('GET', '/api/health')['status'] === 0) {
    echo "[ARRÊT] L'API ne répond pas sur " . API . "\n";
    echo "        Démarre-la : php -S localhost:8000 -t public router.php\n";
    exit(1);
}

$sfx = bin2hex(random_bytes(4));
$db  = Database::connection();

function reg(string $name, string $sfx): array {
    $r = call('POST', '/api/auth/register', [
        'organization_name' => "{$name} {$sfx}", 'first_name' => 'G', 'last_name' => $name,
        'email' => "s-{$sfx}-" . strtolower($name) . "@t.local", 'password' => 'mot-de-passe-de-test',
    ]);
    return [
        'token'   => $r['body']['data']['access_token'] ?? null,
        'station' => $r['body']['data']['user']['station_ids'][0] ?? 0,
        'id'      => $r['body']['data']['user']['id'] ?? 0,
    ];
}

$a = reg('Alpha', $sfx);
$b = reg('Beta', $sfx);

echo "=== LOT 17 — multi-stations et paramètres ===\n\n";
echo "1. Ouvrir un second point de service\n";

$created = call('POST', '/api/stations', [
    'name' => 'Station Thiès', 'code' => 'THS', 'city' => 'Thiès',
    'opens_at' => '08:00', 'closes_at' => '19:00',
], $a['token']);

check('une station se crée', $created['status'] === 201, (string) $created['status']);

$thies = (int) ($created['body']['data']['id'] ?? 0);

check('elle naît ouverte', ($created['body']['data']['status'] ?? '') === 'ACTIVE');
check('les horaires reviennent au format HH:MM',
    ($created['body']['data']['opens_at'] ?? '') === '08:00');

check('le code est mis en majuscules',
    (call('POST', '/api/stations', ['name' => 'Minuscule', 'code' => 'mbo'],
        $a['token'])['body']['data']['code'] ?? '') === 'MBO');

check('un code déjà pris dans l\'entreprise est refusé',
    call('POST', '/api/stations', ['name' => 'Doublon', 'code' => 'THS'],
        $a['token'])['status'] === 422);

// La contrainte d'unicité porte sur (organization_id, code) et non
// sur le code seul : deux entreprises différentes ont parfaitement le
// droit d'avoir chacune une station « THS ».
check("le MÊME code chez une AUTRE entreprise est accepté",
    call('POST', '/api/stations', ['name' => 'Thiès bis', 'code' => 'THS'],
        $b['token'])['status'] === 201);

check('un code avec un espace est refusé',
    call('POST', '/api/stations', ['name' => 'Espace', 'code' => 'A B'],
        $a['token'])['status'] === 422);

check('un code d\'une seule lettre est refusé',
    call('POST', '/api/stations', ['name' => 'Court', 'code' => 'X'],
        $a['token'])['status'] === 422);

echo "\n2. Le cloisonnement tient sur les nouvelles routes\n";

check("l'entreprise B ne voit pas les stations de A",
    !in_array($thies, array_column(
        call('GET', '/api/stations', null, $b['token'])['body']['data'] ?? [], 'id'
    ), true));

check("l'entreprise B ne peut pas fermer une station de A",
    call('PUT', "/api/stations/{$thies}/status", ['status' => 'INACTIVE'],
        $b['token'])['status'] === 404);

check("l'entreprise B ne peut pas modifier une station de A",
    call('PUT', "/api/stations/{$thies}", ['name' => 'Volée', 'code' => 'VOL'],
        $b['token'])['status'] === 404);

echo "\n3. On ferme une station, on ne l'efface pas\n";

check("aucune route ne SUPPRIME une station",
    call('DELETE', "/api/stations/{$thies}", null, $a['token'])['status'] === 405);

$closed = call('PUT', "/api/stations/{$thies}/status", ['status' => 'INACTIVE'], $a['token']);
check('une station se ferme', $closed['status'] === 200, (string) $closed['status']);
check('son état est INACTIVE', ($closed['body']['data']['status'] ?? '') === 'INACTIVE');

// Une station fermée reste DANS la liste : la masquer donnerait un
// écran où l'on ne peut pas rouvrir ce qu'on a fermé.
check('elle reste dans la liste des stations',
    in_array($thies, array_column(
        call('GET', '/api/stations', null, $a['token'])['body']['data'] ?? [], 'id'
    ), true));

check('elle reste consultable une par une',
    call('GET', "/api/stations/{$thies}", null, $a['token'])['status'] === 200);

check('elle se rouvre', call('PUT', "/api/stations/{$thies}/status",
    ['status' => 'ACTIVE'], $a['token'])['status'] === 200);

echo "\n4. La dernière station ouverte ne se ferme pas\n";

// L'entreprise A a maintenant plusieurs stations. On ferme tout sauf
// une, puis on essaie de fermer la dernière.
$stations = call('GET', '/api/stations', null, $a['token'])['body']['data'] ?? [];
$ids      = array_column($stations, 'id');
$last     = (int) array_pop($ids);

foreach ($ids as $id) {
    call('PUT', "/api/stations/{$id}/status", ['status' => 'INACTIVE'], $a['token']);
}

$refused = call('PUT', "/api/stations/{$last}/status", ['status' => 'INACTIVE'], $a['token']);

check('fermer la dernière station ouverte est refusé', $refused['status'] === 409,
    (string) $refused['status']);
check('le refus explique quoi faire',
    str_contains($refused['body']['message'] ?? '', 'dernière station ouverte'));

// On rouvre tout pour la suite.
foreach ($ids as $id) {
    call('PUT', "/api/stations/{$id}/status", ['status' => 'ACTIVE'], $a['token']);
}

echo "\n5. Une station fermée refuse le nouveau travail\n";

// Il faut un service et un véhicule pour créer un dossier.
$service = call('POST', '/api/services', [
    'name' => 'Lavage test', 'price' => 5000, 'duration_minutes' => 30,
], $a['token'])['body']['data']['id'] ?? 0;

$customer = call('POST', '/api/customers', [
    'first_name' => 'Client', 'last_name' => 'Test', 'phone' => '770000001',
], $a['token'])['body']['data']['id'] ?? 0;

$vehicle = call('POST', '/api/vehicles', [
    'customer_id' => $customer, 'plate_number' => 'DK-1234-ZZ',
    'brand' => 'Toyota', 'model' => 'Corolla', 'vehicle_type' => 'CAR',
], $a['token'])['body']['data']['id'] ?? 0;

check('le décor de test est en place',
    $service > 0 && $customer > 0 && $vehicle > 0,
    "service={$service} client={$customer} véhicule={$vehicle}");

call('PUT', "/api/stations/{$thies}/status", ['status' => 'INACTIVE'], $a['token']);

$onClosed = call('POST', '/api/operations', [
    'vehicle_id' => $vehicle, 'service_id' => $service, 'station_id' => $thies,
], $a['token']);

check("on n'accueille pas un véhicule dans une station fermée",
    $onClosed['status'] === 422, (string) $onClosed['status']);

$bookingOnClosed = call('POST', '/api/bookings', [
    'customer_id' => $customer, 'service_id' => $service, 'station_id' => $thies,
    'scheduled_at' => date('Y-m-d H:i:s', strtotime('+2 days 10:00')),
], $a['token']);

check("on ne prend pas rendez-vous dans une station fermée",
    $bookingOnClosed['status'] === 422, (string) $bookingOnClosed['status']);

call('PUT', "/api/stations/{$thies}/status", ['status' => 'ACTIVE'], $a['token']);

echo "\n6. Une station avec des véhicules sur place ne se ferme pas\n";

$operation = call('POST', '/api/operations', [
    'vehicle_id' => $vehicle, 'service_id' => $service, 'station_id' => $thies,
], $a['token']);

check('le dossier se crée sur la station rouverte', $operation['status'] === 201,
    (string) $operation['status']);

$operationId = (int) ($operation['body']['data']['operation']['id'] ?? 0);

$busy = call('PUT', "/api/stations/{$thies}/status", ['status' => 'INACTIVE'], $a['token']);

check('fermer une station occupée est refusé', $busy['status'] === 409,
    (string) $busy['status']);
check('le refus dit combien de véhicules sont sur place',
    str_contains($busy['body']['message'] ?? '', 'sur place'));

check("la liste annonce le nombre de véhicules AVANT le clic",
    (int) (array_column(
        call('GET', '/api/stations', null, $a['token'])['body']['data'] ?? [],
        'vehicles_on_site', 'id'
    )[$thies] ?? 0) === 1);

// Le dossier annulé ne compte plus : la station redevient fermable.
call('PUT', "/api/operations/{$operationId}/status", ['status' => 'CANCELLED'], $a['token']);

check('une fois le dossier clos, la station se ferme',
    call('PUT', "/api/stations/{$thies}/status", ['status' => 'INACTIVE'],
        $a['token'])['status'] === 200);

// ...et son passé reste lisible : c'est toute la différence entre
// fermer et effacer.
check("le dossier de la station fermée reste consultable",
    call('GET', "/api/operations/{$operationId}", null, $a['token'])['status'] === 200);

call('PUT', "/api/stations/{$thies}/status", ['status' => 'ACTIVE'], $a['token']);

echo "\n7. Rattacher quelqu'un à plusieurs stations\n";

$email  = "awa-{$sfx}@t.local";
$member = call('POST', '/api/team', [
    'first_name' => 'Awa', 'last_name' => 'Test', 'email' => $email,
    'password' => 'mot-de-passe-de-test', 'role' => 'MANAGER',
    'station_id' => $a['station'],
], $a['token']);

$memberId = (int) ($member['body']['data']['id'] ?? 0);
check('un manager se crée', $member['status'] === 201);

$memberToken = call('POST', '/api/auth/login', [
    'email' => $email, 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

// Avant : une seule station, donc la seconde lui est interdite.
check("il n'accède pas encore à la seconde station",
    call('GET', "/api/queue?station_id={$thies}", null, $memberToken)['status'] === 403);

$assigned = call('PUT', "/api/team/{$memberId}/stations",
    ['station_ids' => [$a['station'], $thies]], $a['token']);

check('on le rattache à deux stations', $assigned['status'] === 200,
    (string) $assigned['status']);

check("il accède maintenant à la seconde",
    call('GET', "/api/queue?station_id={$thies}", null, $memberToken)['status'] === 200);

$listed = call('GET', '/api/team', null, $a['token'])['body']['data'] ?? [];
$row    = array_values(array_filter($listed, fn (array $m): bool => $m['id'] === $memberId))[0] ?? [];

check('la liste compte bien deux stations', ($row['station_count'] ?? 0) === 2);
check('elle renvoie les identifiants des stations',
    count($row['station_ids'] ?? []) === 2);
check('une seule ligne par personne malgré les deux rattachements',
    count(array_filter($listed, fn (array $m): bool => $m['id'] === $memberId)) === 1);

// On le retire de la seconde : l'accès doit tomber immédiatement.
call('PUT', "/api/team/{$memberId}/stations", ['station_ids' => [$a['station']]], $a['token']);

check("retiré d'une station, il en perd l'accès à la seconde",
    call('GET', "/api/queue?station_id={$thies}", null, $memberToken)['status'] === 403);

echo "\n8. Personne ne reste sans station\n";

$empty = call('PUT', "/api/team/{$memberId}/stations", ['station_ids' => []], $a['token']);

check('une liste vide est refusée', $empty['status'] === 422, (string) $empty['status']);
check('le refus indique la bonne action (désactiver le compte)',
    str_contains(json_encode($empty['body'], JSON_UNESCAPED_UNICODE) ?: '', 'sactivez'));

check("la station d'une AUTRE entreprise est refusée",
    call('PUT', "/api/team/{$memberId}/stations",
        ['station_ids' => [$a['station'], 999999]], $a['token'])['status'] === 422);

check('il garde son rattachement d\'origine après ces refus',
    count(call('GET', '/api/team', null, $a['token'])['body']['data'][0]['station_ids'] ?? []) >= 1);

echo "\n9. Les paramètres de l'entreprise\n";

$settings = call('GET', '/api/organization', null, $a['token']);

check('les paramètres se lisent', $settings['status'] === 200);
check('la raison sociale est présente',
    str_contains($settings['body']['data']['name'] ?? '', 'Alpha'));
check('le nombre de stations est donné',
    ($settings['body']['data']['station_count'] ?? 0) >= 2);

$renamed = call('PUT', '/api/organization', [
    'name' => 'Alpha Lavage SARL', 'phone' => '770000002', 'email' => 'contact@alpha.test',
], $a['token']);

check('la raison sociale se modifie', $renamed['status'] === 200);
check('le nouveau nom est renvoyé',
    ($renamed['body']['data']['name'] ?? '') === 'Alpha Lavage SARL');

echo "\n10. Ce que les paramètres REFUSENT de changer\n";

// ==================================================================
// LE TEST LE PLUS IMPORTANT DE CE LOT.
// ==================================================================
// Tous les montants sont des entiers dans la plus petite unité de la
// devise. En franc CFA, c'est le franc : 5000 se lit « 5 000 F ».
// Accepter « EUR » ne convertirait rien — les 5000 déjà en base
// deviendraient « 50,00 € », et le chiffre d'affaires de la station
// serait divisé par cent d'un seul clic.
$attack = call('PUT', '/api/organization', [
    'name' => 'Alpha Lavage SARL',
    'currency_code' => 'EUR',
    'timezone' => 'Europe/Paris',
    'country_code' => 'FR',
    'slug' => 'vole',
    'status' => 'SUSPENDED',
], $a['token']);

$after = $attack['body']['data'] ?? [];

check('la devise reste XOF', ($after['currency_code'] ?? '') === 'XOF',
    (string) ($after['currency_code'] ?? '?'));
check('le fuseau reste inchangé', ($after['timezone'] ?? '') === 'Africa/Dakar');
check('le pays reste inchangé', ($after['country_code'] ?? '') === 'SN');
check('le slug ne se réécrit pas', ($after['slug'] ?? '') !== 'vole');

$row = $db->prepare('SELECT status FROM organizations WHERE id = :id');
$row->execute(['id' => (int) ($after['id'] ?? 0)]);
check("le statut de l'entreprise ne se change pas depuis l'API",
    $row->fetchColumn() === 'ACTIVE');

echo "\n11. Ce qu'un manager ne peut pas faire\n";

$managerToken = $memberToken;

check("un manager voit la liste des stations",
    call('GET', '/api/stations', null, $managerToken)['status'] === 200);

check("un manager n'ouvre pas de station",
    call('POST', '/api/stations', ['name' => 'Interdite', 'code' => 'INT'],
        $managerToken)['status'] === 403);

check("un manager ne ferme pas de station",
    call('PUT', "/api/stations/{$thies}/status", ['status' => 'INACTIVE'],
        $managerToken)['status'] === 403);

check("un manager ne lit pas les paramètres de l'entreprise",
    call('GET', '/api/organization', null, $managerToken)['status'] === 403);

check("un manager ne modifie pas les paramètres de l'entreprise",
    call('PUT', '/api/organization', ['name' => 'Renommée'], $managerToken)['status'] === 403);

// ------------------------------------------------------------------
// Nettoyage — dans l'ordre des dépendances.
// ------------------------------------------------------------------
$orgIds = [];
foreach (['Alpha', 'Beta'] as $name) {
    $s = $db->prepare('SELECT id FROM organizations WHERE name LIKE :name');
    $s->execute(['name' => "{$name} {$sfx}%"]);
    $orgIds = array_merge($orgIds, $s->fetchAll(PDO::FETCH_COLUMN));
}

foreach ($orgIds as $orgId) {
    foreach ([
        'DELETE FROM audit_logs WHERE organization_id = :id',
        'DELETE FROM payments WHERE organization_id = :id',
        'DELETE FROM inspections WHERE organization_id = :id',
        'DELETE FROM bookings WHERE organization_id = :id',
        'DELETE FROM operations WHERE organization_id = :id',
        'DELETE FROM vehicles WHERE organization_id = :id',
        'DELETE FROM customers WHERE organization_id = :id',
        'DELETE FROM services WHERE organization_id = :id',
        'DELETE FROM refresh_tokens WHERE user_id IN '
            . '(SELECT id FROM users WHERE organization_id = :id)',
        'DELETE FROM station_users WHERE organization_id = :id',
        'DELETE FROM users WHERE organization_id = :id',
        'DELETE FROM stations WHERE organization_id = :id',
        'DELETE FROM organizations WHERE id = :id',
    ] as $sql) {
        try {
            $db->prepare($sql)->execute(['id' => $orgId]);
        } catch (Throwable) {
            // Une table vide ou une dépendance déjà nettoyée n'est pas
            // une erreur de test.
        }
    }
}

echo "\n" . str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
