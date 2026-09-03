<?php

declare(strict_types=1);

/**
 * Tests de l'API — clients et véhicules
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_crm_test.php
 *
 * Ils couvrent le cas d'usage le plus fréquent du produit : retrouver
 * un client ou un véhicule au comptoir, en quelques secondes, quelle
 * que soit la façon dont l'information a été saisie.
 *
 * Le test le plus important est celui des quatre écritures de plaque :
 * « DK-1234-AA », « dk1234aa », « DK 1234 AA » et « dk.1234.aa »
 * doivent retrouver LE MÊME véhicule. Sans cela, la base contiendrait
 * quatre fiches pour une seule voiture, et l'historique — raison
 * d'être du produit — serait éparpillé entre elles.
 */

use Autocare\Core\Database;
use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

const API = 'http://127.0.0.1:8000';
$passed = 0; $failed = 0;

function check(string $d, bool $c, string $x = ''): void {
    global $passed, $failed;
    if ($c) { $passed++; echo "  [OK]     {$d}\n"; }
    else { $failed++; echo "  [ÉCHEC]  {$d}" . ($x ? " — {$x}" : '') . "\n"; }
}
function call(string $m, string $p, ?array $b = null, ?string $t = null): array {
    $h = curl_init(API . $p);
    $hd = ['Content-Type: application/json'];
    if ($t) $hd[] = 'Authorization: Bearer ' . $t;
    curl_setopt_array($h, [CURLOPT_CUSTOMREQUEST => $m, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $hd, CURLOPT_TIMEOUT => 10]);
    if ($b !== null) curl_setopt($h, CURLOPT_POSTFIELDS, json_encode($b, JSON_UNESCAPED_UNICODE));
    $r = curl_exec($h); $s = (int) curl_getinfo($h, CURLINFO_HTTP_CODE); curl_close($h);
    return ['status' => $s, 'body' => is_string($r) ? (json_decode($r, true) ?? []) : []];
}
$sfx = bin2hex(random_bytes(4));
function reg(string $name, string $sfx): array {
    $r = call('POST', '/api/auth/register', [
        'organization_name' => "{$name} {$sfx}", 'first_name' => 'G', 'last_name' => $name,
        'email' => "g-{$sfx}-" . strtolower($name) . "@t.local", 'password' => 'mot-de-passe-de-test',
    ]);
    return ['token' => $r['body']['data']['access_token'], 'station' => $r['body']['data']['user']['station_ids'][0]];
}
if (call('GET', '/api/health')['status'] === 0) {
    echo "[ARRÊT] L'API ne répond pas sur " . API . "\n";
    echo "        Démarre-la : php -S localhost:8000 -t public router.php\n";
    exit(1);
}

$a = reg('Alpha', $sfx); $b = reg('Beta', $sfx);

echo "=== LOT 6 — clients et véhicules ===\n\n1. Clients\n";

$c1 = call('POST', '/api/customers', [
    'first_name' => 'Cheikh', 'last_name' => 'Fall', 'phone' => '+221 77 611 22 33',
], $a['token']);
check("un client se crée", $c1['status'] === 201);
$cid = $c1['body']['data']['id'] ?? 0;

check("le téléphone est obligatoire",
    call('POST', '/api/customers', ['first_name' => 'X', 'last_name' => 'Y'], $a['token'])['status'] === 422);

// Recherche par nom ET par téléphone, y compris sans indicatif.
check("recherche par nom", count(call('GET', '/api/customers?search=Fall', null, $a['token'])['body']['data']) === 1);
check("recherche par téléphone tapé sans espaces ni indicatif",
    count(call('GET', '/api/customers?search=776112233', null, $a['token'])['body']['data']) === 1);
check("recherche sans résultat renvoie une liste vide",
    call('GET', '/api/customers?search=zzzzz', null, $a['token'])['body']['data'] === []);

// Doublon de téléphone : averti, pas bloqué.
$dup = call('GET', '/api/customers/check-phone?phone=776112233', null, $a['token']);
check("un numéro déjà utilisé est signalé", count($dup['body']['data']) === 1);
check("le doublon n'est PAS bloqué (un couple partage un numéro)",
    call('POST', '/api/customers', ['first_name' => 'Awa', 'last_name' => 'Fall',
        'phone' => '+221 77 611 22 33'], $a['token'])['status'] === 201);

echo "\n2. Véhicules\n";

$v1 = call('POST', '/api/vehicles', [
    'plate_number' => 'dk 1234 aa', 'customer_id' => $cid, 'brand' => 'Toyota',
    'model' => 'Corolla', 'color' => 'Gris', 'vehicle_type' => 'CAR',
], $a['token']);
check("un véhicule se crée", $v1['status'] === 201);
$vid = $v1['body']['data']['id'] ?? 0;

check("la plaque est NORMALISÉE en base",
    ($v1['body']['data']['plate_number'] ?? '') === 'DK1234AA',
    'reçu ' . ($v1['body']['data']['plate_number'] ?? '?'));
check("la plaque est renvoyée aussi en forme lisible",
    ($v1['body']['data']['plate_display'] ?? '') === 'DK-1234-AA');

// Le cœur du problème métier : six saisies différentes, un seul véhicule.
$found = 0;
foreach (['DK-1234-AA', 'dk1234aa', 'DK 1234 AA', 'dk.1234.aa'] as $variant) {
    $r = call('GET', '/api/vehicles?search=' . urlencode($variant), null, $a['token']);
    if (count($r['body']['data']) === 1) $found++;
}
check("les 4 façons d'écrire la plaque retrouvent LE MÊME véhicule", $found === 4, "trouvé {$found}/4");

check("réenregistrer la même plaque est refusé",
    call('POST', '/api/vehicles', ['plate_number' => 'DK-1234-AA', 'customer_id' => $cid,
        'brand' => 'X', 'model' => 'Y', 'vehicle_type' => 'CAR'], $a['token'])['status'] === 422);

check("une plaque incomplète est refusée",
    call('POST', '/api/vehicles', ['plate_number' => 'X1', 'customer_id' => $cid,
        'brand' => 'X', 'model' => 'Y', 'vehicle_type' => 'CAR'], $a['token'])['status'] === 422);

check("une plaque étrangère au format inhabituel est ACCEPTÉE",
    call('POST', '/api/vehicles', ['plate_number' => 'BJT4472', 'customer_id' => $cid,
        'brand' => 'Nissan', 'model' => 'Patrol', 'vehicle_type' => 'SUV'], $a['token'])['status'] === 201);

check("recherche par marque", count(call('GET', '/api/vehicles?search=Toyota', null, $a['token'])['body']['data']) === 1);
check("recherche par nom du propriétaire", count(call('GET', '/api/vehicles?search=Fall', null, $a['token'])['body']['data']) === 2);

echo "\n3. Fiches\n";

$detail = call('GET', "/api/vehicles/{$vid}", null, $a['token']);
check("la fiche véhicule renvoie le propriétaire",
    ($detail['body']['data']['vehicle']['customer_name'] ?? '') === 'Cheikh Fall');
check("la fiche véhicule renvoie un historique (vide au lot 6)",
    ($detail['body']['data']['history'] ?? null) === []);

$cust = call('GET', "/api/customers/{$cid}", null, $a['token']);
check("la fiche client liste ses véhicules", count($cust['body']['data']['vehicles'] ?? []) === 2);
check("le compteur de véhicules est correct",
    ($cust['body']['data']['customer']['vehicle_count'] ?? 0) === 2);

echo "\n4. ISOLATION\n";

check("Beta ne voit aucun client d'Alpha",
    call('GET', '/api/customers', null, $b['token'])['body']['data'] === []);
check("Beta ne voit aucun véhicule d'Alpha",
    call('GET', '/api/vehicles', null, $b['token'])['body']['data'] === []);
check("Beta ne peut pas ouvrir la fiche client d'Alpha",
    call('GET', "/api/customers/{$cid}", null, $b['token'])['status'] === 404);
check("Beta ne peut pas ouvrir la fiche véhicule d'Alpha",
    call('GET', "/api/vehicles/{$vid}", null, $b['token'])['status'] === 404);
check("Beta ne peut pas rattacher un véhicule à un client d'Alpha",
    call('POST', '/api/vehicles', ['plate_number' => 'AA-1111-BB', 'customer_id' => $cid,
        'brand' => 'X', 'model' => 'Y', 'vehicle_type' => 'CAR'], $b['token'])['status'] === 422);
check("la MÊME plaque reste enregistrable chez Beta",
    call('POST', '/api/vehicles', ['plate_number' => 'DK-1234-AA',
        'customer_id' => call('POST', '/api/customers', ['first_name' => 'Client', 'last_name' => 'Beta',
            'phone' => '+221770000001'], $b['token'])['body']['data']['id'],
        'brand' => 'Toyota', 'model' => 'Corolla', 'vehicle_type' => 'CAR'], $b['token'])['status'] === 201);

$db = Database::connection();
foreach (['vehicles','customers','audit_logs','refresh_tokens','station_users','services','users','stations'] as $t) {
    $db->exec("DELETE FROM {$t} WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%')");
}
$db->exec("DELETE FROM organizations WHERE slug LIKE '%{$sfx}%'");

echo "\n" . str_repeat('=', 50) . "\n  {$passed} test(s) réussi(s), {$failed} échec(s)\n" . str_repeat('=', 50) . "\n";
exit($failed === 0 ? 0 : 1);
