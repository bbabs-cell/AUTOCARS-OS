<?php

declare(strict_types=1);

/**
 * Tests de l'API — file d'attente
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_queue_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - la composition et l'ordre des colonnes, qui viennent du serveur
 *   - le calcul du temps passé à une étape et le déclenchement des
 *     alertes : c'est ce qui distingue une file utile d'une liste
 *   - l'ordre de la file, où une erreur ferait passer un client
 *     devant un autre sans raison
 *   - les deux actions réservées aux responsables
 *
 * Certains tests DÉPLACENT LA DATE de changement de statut
 * directement en base. C'est le seul moyen de vérifier un seuil de
 * 45 minutes sans attendre 45 minutes.
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

if (call('GET', '/api/health')['status'] === 0) {
    echo "[ARRÊT] L'API ne répond pas sur " . API . "\n";
    echo "        Démarre-la : php -S localhost:8000 -t public router.php\n";
    exit(1);
}

$a = reg('Alpha', $sfx);
$b = reg('Beta', $sfx);
$db = Database::connection();

/** Recule la date de changement de statut, pour simuler une attente. */
function ageOperation(int $id, int $minutes): void {
    global $db;
    $db->prepare(
        'UPDATE operations SET status_changed_at = NOW() - INTERVAL :m MINUTE WHERE id = :id'
    )->execute(['m' => $minutes, 'id' => $id]);
}

// --- Jeu de données ------------------------------------------------
$customerId = call('POST', '/api/customers', [
    'first_name' => 'Moussa', 'last_name' => 'Diop', 'phone' => '+221 77 400 55 66',
], $a['token'])['body']['data']['id'];

// Une prestation courte : le seuil du lavage en dépend directement.
$serviceId = call('POST', '/api/services', [
    'name' => 'Lavage express ' . $sfx, 'price' => 3000, 'duration_minutes' => 30,
], $a['token'])['body']['data']['id'];

/** Ouvre un dossier sur un véhicule neuf et renvoie son identifiant. */
function openOperation(string $plate, array $owner, int $customerId, int $serviceId, int $priority = 0): array {
    $vehicleId = call('POST', '/api/vehicles', [
        'plate_number' => $plate, 'customer_id' => $customerId,
        'brand' => 'Toyota', 'model' => 'Yaris', 'vehicle_type' => 'CAR',
    ], $owner['token'])['body']['data']['id'];

    $r = call('POST', '/api/operations', [
        'vehicle_id' => $vehicleId, 'service_id' => $serviceId,
        'station_id' => $owner['station'], 'priority' => $priority,
    ], $owner['token']);

    return [
        'id'        => (int) ($r['body']['data']['operation']['id'] ?? 0),
        'reference' => (string) ($r['body']['data']['operation']['reference'] ?? ''),
        'vehicle'   => $vehicleId,
    ];
}

$op1 = openOperation('DK-1001-QA', $a, $customerId, $serviceId);
$op2 = openOperation('DK-1002-QA', $a, $customerId, $serviceId);
$op3 = openOperation('DK-1003-QA', $a, $customerId, $serviceId);

echo "=== LOT 8 — file d'attente ===\n\n1. Les colonnes viennent du serveur\n";

$board = call('GET', '/api/queue', null, $a['token']);
check("le tableau se charge", $board['status'] === 200);

$columns = $board['body']['data']['columns'] ?? [];
check("cinq colonnes", count($columns) === 5, (string) count($columns));

$labels = array_column($columns, 'label');
check("elles sont dans l'ordre du parcours",
    $labels === ['En attente', 'Inspection', 'Lavage', 'Contrôle', 'Prêts'],
    implode(' | ', $labels));

check("chaque colonne annonce le statut appliqué au dépôt",
    count(array_filter($columns, static fn (array $c): bool => isset($c['drop_status']))) === 5);

check("les trois dossiers sont dans « En attente »", (int) $columns[0]['count'] === 3);

// Une colonne vide reste présente : sinon la mise en page sauterait à
// chaque rafraîchissement, et l'utilisateur devrait relire les
// en-têtes pour se repérer.
check("les colonnes vides restent affichées",
    (int) $columns[3]['count'] === 0 && $columns[3]['operations'] === []);

check("aucune colonne ne montre les dossiers clos",
    !in_array('Restitué', $labels, true) && !in_array('Annulé', $labels, true));

echo "\n2. Le regroupement d'affichage\n";

// « Pris en charge » ne dure que quelques secondes dans la réalité :
// sur le tableau, il partage la colonne de l'inspection.
call('PUT', "/api/operations/{$op1['id']}/status", ['status' => 'IN_PROGRESS'], $a['token']);

$columns = call('GET', '/api/queue', null, $a['token'])['body']['data']['columns'];

check("un dossier IN_PROGRESS apparaît dans la colonne « Inspection »",
    (int) $columns[1]['count'] === 1
    && $columns[1]['operations'][0]['status'] === 'IN_PROGRESS');

check("mais son statut réel n'est PAS réécrit",
    $columns[1]['operations'][0]['status'] === 'IN_PROGRESS'
    && $columns[1]['operations'][0]['status_label'] === 'Pris en charge');

check("le dépôt sur cette colonne vise l'inspection",
    $columns[1]['drop_status'] === 'INSPECTION');

echo "\n3. Le temps passé à l'étape\n";

// 50 minutes d'attente sur un seuil de 20 : le dossier doit sortir.
ageOperation($op2['id'], 50);
$columns = call('GET', '/api/queue', null, $a['token'])['body']['data']['columns'];

$aged = null;
foreach ($columns[0]['operations'] as $operation) {
    if ((int) $operation['id'] === $op2['id']) { $aged = $operation; }
}

check("le temps passé à l'étape est calculé", ($aged['minutes_in_status'] ?? null) === 50);
check("le seuil d'attente est annoncé", ($aged['alert_after_minutes'] ?? null) === 20);
check("le dossier est signalé en retard", ($aged['is_overdue'] ?? false) === true);
check("la colonne compte ses dossiers en retard", (int) $columns[0]['overdue'] === 1);

// Un dossier tout juste ouvert ne doit rien déclencher.
$fresh = null;
foreach ($columns[0]['operations'] as $operation) {
    if ((int) $operation['id'] === $op3['id']) { $fresh = $operation; }
}
check("un dossier récent n'est pas signalé", ($fresh['is_overdue'] ?? true) === false);

// Le seuil du lavage vient de la DURÉE DE LA PRESTATION, pas d'une
// constante : dépasser 45 minutes n'a pas le même sens sur un lavage
// express que sur un detailing de trois heures.
call('PUT', "/api/operations/{$op1['id']}/status", ['status' => 'INSPECTION'], $a['token']);
call('POST', "/api/operations/{$op1['id']}/inspections", ['type' => 'ENTRY'], $a['token']);
call('PUT', "/api/operations/{$op1['id']}/status", ['status' => 'WASHING'], $a['token']);
ageOperation($op1['id'], 35);

$columns = call('GET', '/api/queue', null, $a['token'])['body']['data']['columns'];
$washing = $columns[2]['operations'][0] ?? [];

check("le seuil du lavage est la durée de la prestation",
    ($washing['alert_after_minutes'] ?? null) === 30, (string) ($washing['alert_after_minutes'] ?? '?'));
check("35 minutes sur une prestation de 30 : en retard",
    ($washing['is_overdue'] ?? false) === true);

echo "\n4. L'ordre de la file\n";

// Priorité d'abord, ancienneté ensuite. Se tromper d'ordre, c'est
// faire passer un client devant un autre sans raison.
ageOperation($op3['id'], 5);
$waiting = call('GET', '/api/queue', null, $a['token'])['body']['data']['columns'][0]['operations'];

check("à priorité égale, le plus ancien passe devant",
    (int) $waiting[0]['id'] === $op2['id'], 'premier = ' . ($waiting[0]['reference'] ?? '?'));

$prioritized = call('PUT', "/api/operations/{$op3['id']}/priority", ['priority' => 2], $a['token']);
check("un responsable peut faire passer un véhicule devant", $prioritized['status'] === 200);

$waiting = call('GET', '/api/queue', null, $a['token'])['body']['data']['columns'][0]['operations'];
check("le prioritaire remonte en tête, malgré son ancienneté moindre",
    (int) $waiting[0]['id'] === $op3['id'], 'premier = ' . ($waiting[0]['reference'] ?? '?'));

check("la priorité est bornée à 3",
    (int) (call('PUT', "/api/operations/{$op3['id']}/priority", ['priority' => 99], $a['token'])
        ['body']['data']['operation']['priority'] ?? 0) === 3);

check("une priorité non numérique est refusée",
    call('PUT', "/api/operations/{$op3['id']}/priority", ['priority' => 'urgent'], $a['token'])['status'] === 422);

echo "\n5. Le bandeau\n";

$metrics = call('GET', '/api/queue', null, $a['token'])['body']['data']['metrics'];

check("il compte les dossiers en attente", (int) $metrics['waiting'] === 2);
check("il compte les dossiers en cours", (int) $metrics['in_progress'] === 1);
check("il compte les dossiers en retard", (int) $metrics['overdue'] >= 2);
check("il donne la PLUS LONGUE attente, pas une moyenne",
    (int) $metrics['longest_wait_minutes'] === 50, (string) $metrics['longest_wait_minutes']);
check("l'heure du serveur accompagne le tableau",
    isset(call('GET', '/api/queue', null, $a['token'])['body']['data']['generated_at']));

echo "\n6. Ce qui est réservé aux responsables\n";

$employee = call('POST', '/api/team', [
    'first_name' => 'Fatou', 'last_name' => 'Ndiaye', 'email' => "file-{$sfx}@t.local",
    'password' => 'mot-de-passe-de-test', 'role' => 'EMPLOYEE', 'station_id' => $a['station'],
], $a['token']);
check("un employé peut être créé pour le test", $employee['status'] === 201);

$employeeId = (int) ($employee['body']['data']['id'] ?? 0);
$employeeToken = call('POST', '/api/auth/login', [
    'email' => "file-{$sfx}@t.local", 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

check("un employé VOIT la file d'attente",
    call('GET', '/api/queue', null, $employeeToken)['status'] === 200);

check("un employé ne peut PAS réorganiser la file (403)",
    call('PUT', "/api/operations/{$op2['id']}/priority", ['priority' => 3], $employeeToken)['status'] === 403);

check("un employé ne peut PAS confier un dossier à un collègue (403)",
    call('PUT', "/api/operations/{$op2['id']}/assign",
        ['assigned_user_id' => $employeeId], $employeeToken)['status'] === 403);

// Mais il reste maître de son propre travail : prendre un véhicule en
// charge l'inscrit dessus, sans passer par ces routes.
$taken = call('PUT', "/api/operations/{$op2['id']}/status", ['status' => 'IN_PROGRESS'], $employeeToken);
check("un employé peut se charger d'un véhicule lui-même",
    $taken['status'] === 200
    && (int) ($taken['body']['data']['operation']['assigned_user_id'] ?? 0) === $employeeId);

echo "\n7. L'affectation\n";

$assigned = call('PUT', "/api/operations/{$op3['id']}/assign",
    ['assigned_user_id' => $employeeId], $a['token']);
check("un responsable confie un dossier", $assigned['status'] === 200);
check("le nom de l'employé apparaît sur la carte",
    ($assigned['body']['data']['operation']['assigned_name'] ?? '') === 'Fatou Ndiaye');

// Attention au piège : `?? 'x'` renverrait 'x' pour une valeur NULLE
// autant que pour une clé absente. On vérifie donc que la clé existe
// ET qu'elle vaut null — c'est exactement ce qu'on veut prouver.
$unassigned = call('PUT', "/api/operations/{$op3['id']}/assign",
    ['assigned_user_id' => null], $a['token'])['body']['data']['operation'] ?? [];

check("on peut remettre le dossier dans la file commune",
    array_key_exists('assigned_user_id', $unassigned) && $unassigned['assigned_user_id'] === null);

check("confier un dossier à quelqu'un d'une AUTRE entreprise est refusé",
    call('PUT', "/api/operations/{$op3['id']}/assign",
        ['assigned_user_id' => 999999], $a['token'])['status'] === 422);

echo "\n8. Dossiers clos et isolation\n";

call('PUT', "/api/operations/{$op3['id']}/status", ['status' => 'CANCELLED'], $a['token']);

// À ce stade : op1 est au lavage, op2 pris en charge, op3 annulé.
// La colonne « En attente » doit donc être vide — un dossier annulé
// n'occupe plus la station et n'a rien à faire sur le tableau.
$afterCancel = call('GET', '/api/queue', null, $a['token'])['body']['data'];

check("un dossier annulé disparaît de la file",
    $afterCancel['columns'][0]['operations'] === []);
check("et il n'apparaît dans AUCUNE colonne",
    array_sum(array_column($afterCancel['columns'], 'count')) === 2,
    'total = ' . array_sum(array_column($afterCancel['columns'], 'count')));

check("on ne réorganise pas un dossier clos (409)",
    call('PUT', "/api/operations/{$op3['id']}/priority", ['priority' => 1], $a['token'])['status'] === 409);

check("on ne confie pas un dossier clos (409)",
    call('PUT', "/api/operations/{$op3['id']}/assign",
        ['assigned_user_id' => $employeeId], $a['token'])['status'] === 409);

$betaBoard = call('GET', '/api/queue', null, $b['token'])['body']['data']['columns'];
check("Beta voit un tableau VIDE, pas celui d'Alpha",
    array_sum(array_column($betaBoard, 'count')) === 0);
check("Beta a quand même ses cinq colonnes", count($betaBoard) === 5);

check("Beta ne peut pas réorganiser un dossier d'Alpha",
    call('PUT', "/api/operations/{$op2['id']}/priority", ['priority' => 3], $b['token'])['status'] === 404);

check("filtrer sur la station d'une autre entreprise est refusé",
    in_array(
        call('GET', "/api/queue?station_id={$b['station']}", null, $a['token'])['status'],
        [403, 404],
        true
    ));

echo "\n9. La trace laissée\n";

$trace = $db->query(
    "SELECT action FROM audit_logs WHERE entity_type = 'operation'
       AND entity_id IN ({$op2['id']}, {$op3['id']})"
)->fetchAll();
$actions = array_column($trace, 'action');

check("faire passer un véhicule devant est tracé",
    in_array('operation.prioritized', $actions, true));
check("confier un dossier est tracé",
    in_array('operation.assigned', $actions, true));

// --- Ménage --------------------------------------------------------
foreach (['inspection_photos', 'inspections', 'operations', 'vehicles', 'customers',
          'audit_logs', 'refresh_tokens', 'station_users', 'services', 'users', 'stations'] as $table) {
    $db->exec("DELETE FROM {$table} WHERE organization_id IN
               (SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%')");
}
$db->exec("DELETE FROM organizations WHERE slug LIKE '%{$sfx}%'");

echo "\n" . str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
