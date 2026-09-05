<?php

declare(strict_types=1);

/**
 * Tests de l'API — encaissements et caisse
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_payment_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - QU'AUCUN FOURNISSEUR DE PAIEMENT N'EST APPELÉ. Le premier test
 *     du fichier lit le code source pour s'en assurer : c'est une
 *     promesse faite au client, elle mérite mieux qu'un commentaire.
 *   - qu'un encaissement ne se modifie ni ne s'efface
 *   - que seules les ESPÈCES entrent dans le tiroir
 *   - que l'écart de caisse est calculé, enregistré, et jamais corrigé
 *     en silence
 *   - qui a le droit d'encaisser, et qui a le droit de voir la recette
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

// ==================================================================
echo "=== LOT 9 — encaissements et caisse ===\n\n";
echo "0. LA PROMESSE : aucune intégration de paiement\n";
// ==================================================================
//
// Cette vérification ne passe pas par l'API : elle lit le code. Une
// promesse commerciale — « nous ne simulons aucun paiement » — se
// vérifie mieux par un test que par la bonne volonté de celui qui
// relira le code dans six mois.

$sources = [];

foreach (['src', 'config'] as $directory) {
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(dirname(__DIR__) . '/' . $directory)
    );

    foreach ($iterator as $file) {
        if ($file->isFile() && $file->getExtension() === 'php') {
            $sources[$file->getPathname()] = (string) file_get_contents($file->getPathname());
        }
    }
}

check('le code source est bien lu', count($sources) > 20, count($sources) . ' fichiers');

// Un appel HTTP sortant est le signe qu'une passerelle est contactée.
$httpCallers = [];

foreach ($sources as $path => $code) {
    if (preg_match('/\b(curl_init|file_get_contents\s*\(\s*[\'"]https?:|fsockopen|stream_socket_client)\b/i', $code) === 1) {
        $httpCallers[] = basename($path);
    }
}

check("aucun fichier du backend n'émet d'appel HTTP sortant",
    $httpCallers === [], implode(', ', $httpCallers));

// Les noms des fournisseurs ne doivent apparaître que dans des
// commentaires ou des libellés, jamais dans une URL.
$providerUrls = [];

foreach ($sources as $path => $code) {
    if (preg_match('#https?://[^\s\'"]*(wave|orange|paydunya|stripe|paypal|cinetpay)#i', $code) === 1) {
        $providerUrls[] = basename($path);
    }
}

check("aucune URL de fournisseur de paiement n'est présente",
    $providerUrls === [], implode(', ', $providerUrls));

// Pas de clé d'API de paiement dans la configuration d'exemple.
$envExample = (string) @file_get_contents(dirname(__DIR__) . '/.env.example');

check("le fichier .env.example ne réserve aucune clé de paiement",
    preg_match('/(WAVE|ORANGE_MONEY|STRIPE|PAYPAL|PAYDUNYA|CINETPAY)_/i', $envExample) !== 1);

if (call('GET', '/api/health')['status'] === 0) {
    echo "\n[ARRÊT] L'API ne répond pas sur " . API . "\n";
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
        'token'        => $r['body']['data']['access_token'] ?? null,
        'station'      => $r['body']['data']['user']['station_ids'][0] ?? 0,
        'id'           => $r['body']['data']['user']['id'] ?? 0,
        'organization' => $r['body']['data']['user']['organization_id'] ?? 0,
    ];
}

$a = reg('Alpha', $sfx);
$b = reg('Beta', $sfx);
$db = Database::connection();

// --- Jeu de données ------------------------------------------------
$customerId = call('POST', '/api/customers', [
    'first_name' => 'Seynabou', 'last_name' => 'Ba', 'phone' => '+221 77 800 22 11',
], $a['token'])['body']['data']['id'];

$serviceId = call('POST', '/api/services', [
    'name' => 'Lavage caisse ' . $sfx, 'price' => 10000, 'duration_minutes' => 40,
], $a['token'])['body']['data']['id'];

function openOperation(string $plate, array $owner, int $customerId, int $serviceId): int {
    $vehicleId = call('POST', '/api/vehicles', [
        'plate_number' => $plate, 'customer_id' => $customerId,
        'brand' => 'Kia', 'model' => 'Picanto', 'vehicle_type' => 'CAR',
    ], $owner['token'])['body']['data']['id'];

    return (int) (call('POST', '/api/operations', [
        'vehicle_id' => $vehicleId, 'service_id' => $serviceId, 'station_id' => $owner['station'],
    ], $owner['token'])['body']['data']['operation']['id'] ?? 0);
}

$op1 = openOperation('DK-2001-PA', $a, $customerId, $serviceId);
$op2 = openOperation('DK-2002-PA', $a, $customerId, $serviceId);

echo "\n1. L'encaissement\n";

$paid = call('POST', "/api/operations/{$op1}/payments",
    ['amount' => 4000, 'method' => 'CASH'], $a['token']);

check("un paiement partiel s'enregistre", $paid['status'] === 201);
check("le reste dû est renvoyé", (int) ($paid['body']['data']['remaining'] ?? 0) === 6000);
check("le dossier n'est pas encore réglé", ($paid['body']['data']['is_settled'] ?? true) === false);
check("l'encaissement en espèces hors caisse est SIGNALÉ",
    ($paid['body']['data']['outside_cash_session'] ?? false) === true);

// Un trop-perçu est presque toujours une faute de frappe : 60 000 au
// lieu de 6 000. Une fois enregistrée, elle fausse la caisse du soir.
check("un trop-perçu est refusé",
    call('POST', "/api/operations/{$op1}/payments",
        ['amount' => 60000, 'method' => 'CASH'], $a['token'])['status'] === 422);

check("un montant à virgule est refusé",
    call('POST', "/api/operations/{$op1}/payments",
        ['amount' => '5000,50', 'method' => 'CASH'], $a['token'])['status'] === 422);

check("un montant nul est refusé",
    call('POST', "/api/operations/{$op1}/payments",
        ['amount' => 0, 'method' => 'CASH'], $a['token'])['status'] === 422);

check("un moyen de paiement inventé est refusé",
    call('POST', "/api/operations/{$op1}/payments",
        ['amount' => 100, 'method' => 'BITCOIN'], $a['token'])['status'] === 422);

$settled = call('POST', "/api/operations/{$op1}/payments", [
    'amount' => 6000, 'method' => 'MOBILE_MONEY',
    'provider' => 'Wave', 'external_reference' => 'TX-77123',
], $a['token']);

check("le solde peut être réglé par un autre moyen",
    ($settled['body']['data']['is_settled'] ?? false) === true);

$list = call('GET', "/api/operations/{$op1}/payments", null, $a['token']);
check("les deux écritures sont conservées", count($list['body']['data']['payments'] ?? []) === 2);
check("le service saisi à la main est restitué tel quel",
    ($list['body']['data']['payments'][1]['provider'] ?? '') === 'Wave');

echo "\n2. On n'efface pas, on contre-passe\n";

// Aucune route ne modifie ni ne supprime un encaissement : le chemin
// existe en lecture, seuls les verbes d'écriture sont absents.
$paymentId = (int) ($list['body']['data']['payments'][0]['id'] ?? 0);

check("aucune route ne MODIFIE un encaissement",
    call('PUT', "/api/payments/{$paymentId}", ['amount' => 1], $a['token'])['status'] === 404);
check("aucune route ne SUPPRIME un encaissement",
    call('DELETE', "/api/payments/{$paymentId}", null, $a['token'])['status'] === 404);

check("un remboursement exige un motif",
    call('POST', "/api/payments/{$paymentId}/refund", [], $a['token'])['status'] === 422);

$refund = call('POST', "/api/payments/{$paymentId}/refund",
    ['reason' => 'Prestation annulée, client remboursé en espèces.'], $a['token']);

check("le remboursement est enregistré", $refund['status'] === 201);

$after = call('GET', "/api/operations/{$op1}/payments", null, $a['token']);
check("LES DEUX écritures restent visibles après remboursement",
    count($after['body']['data']['payments'] ?? []) === 3);
check("l'écriture d'origine est marquée remboursée",
    ($after['body']['data']['payments'][0]['status'] ?? '') === 'REFUNDED');
check("le dossier redevient non réglé, ce qui rebloque sa restitution",
    ($after['body']['data']['is_settled'] ?? true) === false);

check("on ne rembourse pas deux fois le même encaissement",
    call('POST', "/api/payments/{$paymentId}/refund", ['reason' => 'encore'], $a['token'])['status'] === 409);

echo "\n3. La caisse\n";

check("aucune caisse n'est ouverte au départ",
    call('GET', '/api/cash/current', null, $a['token'])['body']['data']['session'] === null);

check("on ne ferme pas une caisse qui n'est pas ouverte",
    call('POST', '/api/cash/close', ['counted_amount' => 1000], $a['token'])['status'] === 409);

$opened = call('POST', '/api/cash/open', ['opening_float' => 20000], $a['token']);
check("la caisse s'ouvre avec un fond", $opened['status'] === 201);
check("le montant attendu part du fond de caisse",
    (int) ($opened['body']['data']['session']['expected_amount'] ?? 0) === 20000);

check("une seconde caisse sur la même station est refusée (409)",
    call('POST', '/api/cash/open', ['opening_float' => 5000], $a['token'])['status'] === 409);

// Testé sur Beta, dont la caisse est encore fermée : chez Alpha, le
// contrôle « une seule caisse ouverte » répondrait 409 avant même
// que la validation du format ne soit atteinte.
check("un fond de caisse à virgule est refusé",
    call('POST', '/api/cash/open', ['opening_float' => '10,5'], $b['token'])['status'] === 422);

echo "\n4. Seules les espèces entrent dans le tiroir\n";

call('POST', "/api/operations/{$op2}/payments", ['amount' => 3000, 'method' => 'CASH'], $a['token']);
call('POST', "/api/operations/{$op2}/payments",
    ['amount' => 7000, 'method' => 'MOBILE_MONEY', 'provider' => 'Orange Money'], $a['token']);

$state = call('GET', '/api/cash/current', null, $a['token'])['body']['data'];

check("le montant attendu ne compte QUE les espèces",
    (int) ($state['session']['expected_amount'] ?? 0) === 23000,
    'attendu = ' . ($state['session']['expected_amount'] ?? '?'));

// La session rattache TOUTE la vacation, pas seulement le tiroir :
// « ce matin nous avons fait 10 000 F, dont 3 000 en espèces ».
check("les mouvements de la session couvrent aussi les autres moyens",
    (int) ($state['movements']['MOBILE_MONEY']['total'] ?? 0) === 7000,
    'mobile money = ' . ($state['movements']['MOBILE_MONEY']['total'] ?? '?'));
check("…sans que ces moyens n'entrent dans le tiroir",
    (int) ($state['session']['expected_amount'] ?? 0) === 23000);

// Les 4 000 F encaissés avant l'ouverture ont été REMBOURSÉS plus
// haut : ils ne sont plus de l'argent reçu, donc plus rien à
// expliquer au moment de recompter le tiroir. Un compteur qui les
// afficherait encore enverrait le caissier chercher un billet qui
// n'existe pas.
check("un encaissement hors caisse REMBOURSÉ ne pèse plus sur la clôture",
    (int) ($state['cash_outside_session'] ?? 0) === 0,
    'hors caisse = ' . ($state['cash_outside_session'] ?? '?'));

echo "\n5. L'écart de caisse\n";

check("un écart important SANS explication est refusé",
    call('POST', '/api/cash/close', ['counted_amount' => 20000], $a['token'])['status'] === 422);

// Un petit écart passe sans justification : exiger une phrase à
// 300 F près ferait écrire « RAS » tous les soirs.
$small = call('POST', '/api/cash/close', ['counted_amount' => 22800], $a['token']);
check("un petit écart passe sans justification", $small['status'] === 200);
check("l'écart est calculé et SIGNÉ",
    (int) ($small['body']['data']['session']['difference'] ?? 0) === -200,
    (string) ($small['body']['data']['session']['difference'] ?? '?'));
check("le montant attendu est FIGÉ dans la clôture",
    (int) ($small['body']['data']['session']['expected_amount'] ?? 0) === 23000);
check("la caisse est fermée", ($small['body']['data']['session']['status'] ?? '') === 'CLOSED');

// Une clôture est une PHOTO : un encaissement postérieur ne doit pas
// réécrire un écart déjà constaté.
$sessionId = (int) ($small['body']['data']['session']['id'] ?? 0);

// Sur op1, qui reste dû après le remboursement — op2 est entièrement
// réglé et un encaissement de plus y serait refusé comme trop-perçu.
$afterClose = call('POST', "/api/operations/{$op1}/payments",
    ['amount' => 1, 'method' => 'CASH'], $a['token']);

check("un encaissement reste possible caisse fermée", $afterClose['status'] === 201);
check("…et il est signalé comme hors caisse",
    ($afterClose['body']['data']['outside_cash_session'] ?? false) === true);
check("le compteur « hors caisse » le reprend",
    (int) (call('GET', '/api/cash/current', null, $a['token'])
        ['body']['data']['cash_outside_session'] ?? 0) === 1);

$history = call('GET', '/api/cash/sessions', null, $a['token'])['body']['data']['sessions'];
$closed = null;
foreach ($history as $row) { if ((int) $row['id'] === $sessionId) { $closed = $row; } }

check("un encaissement postérieur ne réécrit PAS l'écart constaté",
    (int) ($closed['expected_amount'] ?? 0) === 23000 && (int) ($closed['difference'] ?? 0) === -200);

check("la caisse peut être rouverte après clôture",
    call('POST', '/api/cash/open', ['opening_float' => 0], $a['token'])['status'] === 201);

echo "\n6. Le journal\n";

$journal = call('GET', '/api/payments', null, $a['token']);
check("le journal s'ouvre sur AUJOURD'HUI sans qu'on le demande",
    ($journal['body']['data']['period']['from'] ?? '') === date('Y-m-d'));

check("les totaux sont ventilés par moyen de paiement",
    isset($journal['body']['data']['totals']['by_method']['CASH'])
    && isset($journal['body']['data']['totals']['by_method']['MOBILE_MONEY']));

// Un remboursement n'est pas de l'argent reçu : il ne doit pas
// gonfler la recette.
$totals = $journal['body']['data']['totals'];
check("les remboursements ne sont PAS comptés dans la recette",
    (int) $totals['by_method']['CASH'] === 3001,
    'espèces = ' . $totals['by_method']['CASH']);

check("filtrer par moyen fonctionne",
    count(call('GET', '/api/payments?method=MOBILE_MONEY', null, $a['token'])
        ['body']['data']['payments'] ?? []) === 2);

// ==================================================================
// LE TOTAL NE S'ARRÊTE PAS À LA PREMIÈRE PAGE (lot 20).
// ==================================================================
// La version d'origine calculait les totaux en additionnant les
// lignes du journal — limité à cinq cents. Au-delà, le montant
// affiché sous le journal était SILENCIEUSEMENT inférieur à la
// recette réelle.
//
// Le défaut était invisible sur quinze encaissements de test. On en
// écrit donc six cents, directement en base : les créer par l'API
// prendrait des minutes et ne testerait rien de plus.
$today = date('Y-m-d');

$avant = (int) (call('GET', "/api/payments?from={$today}&to={$today}",
    null, $a['token'])['body']['data']['totals']['total'] ?? 0);

$insert = $db->prepare(
    "INSERT INTO payments
        (organization_id, station_id, customer_id, amount, method, status,
         paid_at, recorded_by_user_id)
     VALUES (:org, :station, NULL, 100, 'CASH', 'PAID', NOW(), :user)"
);

$db->beginTransaction();

for ($i = 0; $i < 600; $i++) {
    $insert->execute([
        'org'     => $a['organization'],
        'station' => $a['station'],
        'user'    => $a['id'],
    ]);
}

$db->commit();
$insert->closeCursor();

$apres = call('GET', "/api/payments?from={$today}&to={$today}", null, $a['token']);
$total = (int) ($apres['body']['data']['totals']['total'] ?? 0);

check(
    "le total compte les 600 encaissements, pas seulement les 500 premiers",
    $total === $avant + 60000,
    "attendu " . ($avant + 60000) . ", reçu {$total}"
);

check(
    "le compte annoncé suit le même chemin",
    (int) ($apres['body']['data']['totals']['count'] ?? 0) > 500,
    'compte = ' . ($apres['body']['data']['totals']['count'] ?? '?')
);

// La LISTE, elle, reste bornée : un journal n'affiche pas six cents
// lignes d'un coup. C'est le total qui devait cesser de l'être.
check(
    "la liste affichée reste bornée",
    count($apres['body']['data']['payments'] ?? []) <= 500
);

$db->prepare("DELETE FROM payments WHERE organization_id = :org AND amount = 100 AND customer_id IS NULL")
   ->execute(['org' => $a['organization']]);

echo "\n7. Qui a le droit de quoi\n";

$employee = call('POST', '/api/team', [
    'first_name' => 'Modou', 'last_name' => 'Fall', 'email' => "caisse-{$sfx}@t.local",
    'password' => 'mot-de-passe-de-test', 'role' => 'EMPLOYEE', 'station_id' => $a['station'],
], $a['token']);
check("un employé peut être créé pour le test", $employee['status'] === 201);

$employeeToken = call('POST', '/api/auth/login', [
    'email' => "caisse-{$sfx}@t.local", 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

// L'employé est au comptoir quand le client règle : lui refuser la
// saisie obligerait à déranger un responsable à chaque véhicule.
check("un EMPLOYÉ peut encaisser",
    call('POST', "/api/operations/{$op1}/payments",
        ['amount' => 1, 'method' => 'CASH'], $employeeToken)['status'] === 201);

check("un EMPLOYÉ voit ce qui a été réglé sur le dossier qu'il rend",
    call('GET', "/api/operations/{$op1}/payments", null, $employeeToken)['status'] === 200);

check("un EMPLOYÉ ne voit PAS la recette de la journée (403)",
    call('GET', '/api/payments', null, $employeeToken)['status'] === 403);

check("un EMPLOYÉ ne rembourse PAS (403)",
    call('POST', "/api/payments/{$paymentId}/refund",
        ['reason' => 'test'], $employeeToken)['status'] === 403);

check("un EMPLOYÉ ne voit PAS la caisse (403)",
    call('GET', '/api/cash/current', null, $employeeToken)['status'] === 403);

check("un EMPLOYÉ ne ferme PAS la caisse (403)",
    call('POST', '/api/cash/close', ['counted_amount' => 0], $employeeToken)['status'] === 403);

echo "\n8. Isolation entre entreprises\n";

check("Beta ne voit aucun encaissement d'Alpha",
    (call('GET', '/api/payments', null, $b['token'])['body']['data']['payments'] ?? null) === []);

check("Beta ne voit pas les paiements d'un dossier d'Alpha",
    call('GET', "/api/operations/{$op1}/payments", null, $b['token'])['status'] === 404);

check("Beta ne peut pas encaisser sur un dossier d'Alpha",
    call('POST', "/api/operations/{$op1}/payments",
        ['amount' => 500, 'method' => 'CASH'], $b['token'])['status'] === 404);

check("Beta ne peut pas rembourser un encaissement d'Alpha",
    call('POST', "/api/payments/{$paymentId}/refund", ['reason' => 'x'], $b['token'])['status'] === 404);

check("Beta a sa propre caisse, indépendante",
    call('GET', '/api/cash/current', null, $b['token'])['body']['data']['session'] === null);

check("Beta peut ouvrir SA caisse alors que celle d'Alpha est ouverte",
    call('POST', '/api/cash/open', ['opening_float' => 1000], $b['token'])['status'] === 201);

echo "\n9. La trace laissée\n";

$actions = array_column($db->query(
    "SELECT action FROM audit_logs WHERE action LIKE 'payment.%' OR action LIKE 'cash.%'"
)->fetchAll(), 'action');

check("chaque encaissement est tracé", in_array('payment.recorded', $actions, true));
check("chaque remboursement est tracé", in_array('payment.refunded', $actions, true));
check("l'ouverture de caisse est tracée", in_array('cash.opened', $actions, true));
check("une clôture AVEC écart porte une action distincte",
    in_array('cash.closed_with_difference', $actions, true));

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
