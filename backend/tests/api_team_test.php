<?php

declare(strict_types=1);

/**
 * Tests de l'API — équipe et pointage
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_team_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - QU'UN EMPLOYÉ NE POINTE QUE POUR LUI. Pointer à la place d'un
 *     collègue est le premier détournement d'un registre de présence.
 *   - qu'on ne puisse pas s'enfermer dehors en désactivant le dernier
 *     administrateur
 *   - qu'un compte désactivé perde l'accès à la SECONDE, pas au
 *     prochain redémarrage
 *   - qu'un pointage oublié soit signalé, jamais fermé tout seul
 *   - qu'une correction laisse une trace lisible par la personne
 *     concernée
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
        'email' => "g-{$sfx}-" . strtolower($name) . "@t.local", 'password' => 'mot-de-passe-de-test',
    ]);
    return [
        'token'   => $r['body']['data']['access_token'] ?? null,
        'station' => $r['body']['data']['user']['station_ids'][0] ?? 0,
        'id'      => $r['body']['data']['user']['id'] ?? 0,
    ];
}

$a = reg('Alpha', $sfx);
$b = reg('Beta', $sfx);

/** Crée un membre et renvoie son identifiant + son jeton. */
function addMember(string $prenom, string $role, array $owner, string $sfx): array {
    $email = strtolower($prenom) . "-{$sfx}@t.local";

    $created = call('POST', '/api/team', [
        'first_name' => $prenom, 'last_name' => 'Test', 'email' => $email,
        'password' => 'mot-de-passe-de-test', 'role' => $role,
        'station_id' => $owner['station'],
    ], $owner['token']);

    $token = call('POST', '/api/auth/login', [
        'email' => $email, 'password' => 'mot-de-passe-de-test',
    ])['body']['data']['access_token'] ?? null;

    return [
        'id'     => (int) ($created['body']['data']['id'] ?? 0),
        'token'  => $token,
        'status' => $created['status'],
        'email'  => $email,
    ];
}

echo "=== LOT 12 — équipe et pointage ===\n\n1. La liste de l'équipe\n";

$employe = addMember('Awa', 'EMPLOYEE', $a, $sfx);
$manager = addMember('Modou', 'MANAGER', $a, $sfx);

check('un employé se crée', $employe['status'] === 201);
check('un manager se crée', $manager['status'] === 201);

$team = call('GET', '/api/team', null, $a['token'])['body']['data'];
check("l'équipe compte trois personnes", count($team) === 3, (string) count($team));

// Une ligne PAR PERSONNE, pas par rattachement. Le défaut est resté
// invisible jusqu'ici parce que personne n'avait plus d'une station.
$ids = array_column($team, 'id');
check('aucun doublon dans la liste', count($ids) === count(array_unique($ids)));

check('les rôles sont triés du plus élevé au moins élevé',
    ($team[0]['role'] ?? '') === 'ADMIN');
check('la station est indiquée', ($team[0]['station_name'] ?? '') !== '');

echo "\n2. On désactive, on ne supprime pas\n";

check("aucune route ne SUPPRIME un membre",
    call('DELETE', "/api/team/{$employe['id']}", null, $a['token'])['status'] === 405);

$disabled = call('PUT', "/api/team/{$employe['id']}",
    ['role' => 'EMPLOYEE', 'status' => 'DISABLED'], $a['token']);

check('un compte se désactive', $disabled['status'] === 200);

// L'accès doit tomber à la SECONDE, pas au prochain redémarrage :
// c'est tout l'intérêt de relire l'utilisateur en base à chaque
// requête plutôt que de se fier au jeton.
check("le compte désactivé ne peut plus se connecter",
    call('POST', '/api/auth/login', [
        'email' => $employe['email'], 'password' => 'mot-de-passe-de-test',
    ])['status'] === 403);

check("son jeton EN COURS cesse aussi de fonctionner",
    call('GET', '/api/auth/me', null, $employe['token'])['status'] === 401);

check("son nom reste dans la liste de l'équipe",
    count(call('GET', '/api/team', null, $a['token'])['body']['data']) === 3);

// On le réactive pour la suite des tests.
call('PUT', "/api/team/{$employe['id']}",
    ['role' => 'EMPLOYEE', 'status' => 'ACTIVE'], $a['token']);

$employe['token'] = call('POST', '/api/auth/login', [
    'email' => $employe['email'], 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

check('un compte réactivé peut se reconnecter', $employe['token'] !== null);

echo "\n3. On ne s'enferme pas dehors\n";

check("on ne peut pas se rétrograder soi-même",
    call('PUT', "/api/team/{$a['id']}",
        ['role' => 'EMPLOYEE', 'status' => 'ACTIVE'], $a['token'])['status'] === 409);

check("on ne peut pas se désactiver soi-même",
    call('PUT', "/api/team/{$a['id']}",
        ['role' => 'ADMIN', 'status' => 'DISABLED'], $a['token'])['status'] === 409);

// Avec un second administrateur, la contrainte se relâche.
$secondAdmin = addMember('Fatou', 'ADMIN', $a, $sfx);

check("le second administrateur peut désactiver le premier",
    call('PUT', "/api/team/{$a['id']}",
        ['role' => 'ADMIN', 'status' => 'DISABLED'], $secondAdmin['token'])['status'] === 200);

// …mais il ne peut plus se retirer lui-même : il est désormais seul.
check("le dernier administrateur actif est protégé",
    call('PUT', "/api/team/{$secondAdmin['id']}",
        ['role' => 'EMPLOYEE', 'status' => 'ACTIVE'], $secondAdmin['token'])['status'] === 409);

// On rétablit le premier pour la suite.
call('PUT', "/api/team/{$a['id']}",
    ['role' => 'ADMIN', 'status' => 'ACTIVE'], $secondAdmin['token']);
$a['token'] = call('POST', '/api/auth/login', [
    'email' => "g-{$sfx}-alpha@t.local", 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'];

echo "\n4. Le pointage — chacun pour soi\n";

$me = call('GET', '/api/attendance/me', null, $employe['token']);
check("un employé consulte son propre pointage", $me['status'] === 200);
check("il n'est pas pointé au départ", ($me['body']['data']['is_clocked_in'] ?? true) === false);

$in = call('POST', '/api/attendance/clock-in', [], $employe['token']);
check("il pointe son arrivée", $in['status'] === 201);
check("le pointage est ouvert", ($in['body']['data']['entry']['is_open'] ?? false) === true);

check("un double pointage est refusé (409)",
    call('POST', '/api/attendance/clock-in', [], $employe['token'])['status'] === 409);

// LE POINT CENTRAL : l'employé n'a AUCUNE route pour agir sur le
// pointage de quelqu'un d'autre.
check("un employé ne voit PAS le registre de l'équipe (403)",
    call('GET', '/api/attendance', null, $employe['token'])['status'] === 403);

$entryId = (int) ($in['body']['data']['entry']['id'] ?? 0);

check("un employé ne peut PAS corriger un pointage (403)",
    call('PUT', "/api/attendance/{$entryId}",
        ['clock_in_at' => date('Y-m-d H:i:s'), 'reason' => 'test'],
        $employe['token'])['status'] === 403);

$out = call('POST', '/api/attendance/clock-out', [], $employe['token']);
check("il pointe son départ", $out['status'] === 200);
check("la durée est figée à la fermeture",
    ($out['body']['data']['entry']['duration_minutes'] ?? null) !== null);

check("on ne pointe pas un départ sans arrivée (409)",
    call('POST', '/api/attendance/clock-out', [], $employe['token'])['status'] === 409);

echo "\n5. Le pointage oublié\n";

// On simule quelqu'un parti sans pointer, il y a deux jours.
call('POST', '/api/attendance/clock-in', [], $manager['token']);
$oublie = (int) $db->query(
    "SELECT id FROM time_entries WHERE clock_out_at IS NULL ORDER BY id DESC LIMIT 1"
)->fetchColumn();

$db->prepare('UPDATE time_entries SET clock_in_at = NOW() - INTERVAL 48 HOUR WHERE id = :id')
   ->execute(['id' => $oublie]);

$register = call('GET', '/api/attendance', null, $a['token'])['body']['data'];

check("le pointage oublié est SIGNALÉ",
    count(array_filter($register['stale'], static fn (array $e): bool => (int) $e['id'] === $oublie)) === 1);

// Il n'est PAS compté comme une présence : quelqu'un « présent depuis
// 48 h » ferait douter de tout le panneau.
check("il n'apparaît PAS parmi les présents",
    count(array_filter($register['present'], static fn (array $e): bool => (int) $e['id'] === $oublie)) === 0);

// Et surtout : le logiciel ne l'a pas fermé tout seul. Inventer une
// heure de sortie fabriquerait une donnée de paie.
check("le logiciel ne l'a PAS fermé automatiquement",
    $db->query("SELECT clock_out_at FROM time_entries WHERE id = {$oublie}")->fetchColumn() === null);

check("il n'est pas compté dans les totaux",
    count(array_filter(
        $register['totals'],
        static fn (array $t): bool => (int) $t['user_id'] === $manager['id'],
    )) === 0);

echo "\n6. La correction, et sa trace\n";

$corrected = call('PUT', "/api/attendance/{$oublie}", [
    'clock_in_at'  => date('Y-m-d 08:00:00', strtotime('-2 day')),
    'clock_out_at' => date('Y-m-d 17:00:00', strtotime('-2 day')),
    'reason'       => 'Parti à 17 h sans pointer, confirmé par le chef d\'équipe.',
], $a['token']);

check('un responsable corrige un pointage', $corrected['status'] === 200);
check('la durée est recalculée',
    (int) ($corrected['body']['data']['entry']['duration_minutes'] ?? 0) === 540,
    (string) ($corrected['body']['data']['entry']['duration_minutes'] ?? '?'));

// UNE CORRECTION NE SE CACHE PAS : sans cela, un employé payé sur des
// heures qu'il n'a pas reconnues n'aurait aucun moyen de s'en
// apercevoir.
check('la correction est VISIBLE sur la ligne',
    ($corrected['body']['data']['entry']['is_corrected'] ?? false) === true);
check('elle porte le nom de qui l\'a faite',
    ($corrected['body']['data']['entry']['corrected_by_name'] ?? '') !== '');
check('elle porte le motif',
    str_contains((string) ($corrected['body']['data']['entry']['correction_reason'] ?? ''), 'chef d\'équipe'));

check('un motif est obligatoire',
    call('PUT', "/api/attendance/{$oublie}",
        ['clock_in_at' => date('Y-m-d H:i:s')], $a['token'])['status'] === 422);

check('un départ antérieur à l\'arrivée est refusé',
    call('PUT', "/api/attendance/{$oublie}", [
        'clock_in_at' => date('Y-m-d 10:00:00'),
        'clock_out_at' => date('Y-m-d 08:00:00'),
        'reason' => 'test',
    ], $a['token'])['status'] === 422);

// Plus de 16 heures est presque toujours une faute de saisie — ou un
// pointage oublié qu'on rattrape au jugé.
check('une journée de plus de 16 heures est refusée',
    call('PUT', "/api/attendance/{$oublie}", [
        'clock_in_at'  => date('Y-m-d 02:00:00', strtotime('-1 day')),
        'clock_out_at' => date('Y-m-d 23:00:00', strtotime('-1 day')),
        'reason' => 'test',
    ], $a['token'])['status'] === 422);

check('un pointage dans le futur est refusé',
    call('PUT', "/api/attendance/{$oublie}", [
        'clock_in_at' => date('Y-m-d H:i:s', strtotime('+2 day')),
        'reason' => 'test',
    ], $a['token'])['status'] === 422);

echo "\n7. L'activité de chacun\n";

$activity = call('GET', '/api/team/activity', null, $a['token'])['body']['data'];

check("l'activité liste toute l'équipe", count($activity['members']) >= 3);
check("un administrateur voit le chiffre d'affaires",
    ($activity['can_see_money'] ?? false) === true
    && array_key_exists('revenue', $activity['members'][0]));

$asEmployee = call('GET', '/api/team/activity', null, $employe['token']);
check("un employé ne voit PAS l'activité de l'équipe (403)", $asEmployee['status'] === 403);

$asManager = call('GET', '/api/team/activity', null, $manager['token'])['body']['data'];
check("un manager voit l'activité", $asManager !== null);
check("…avec les montants, puisqu'il a reports.view",
    ($asManager['can_see_money'] ?? false) === true);

echo "\n8. Isolation entre entreprises\n";

check("Beta ne voit pas l'équipe d'Alpha",
    count(call('GET', '/api/team', null, $b['token'])['body']['data']) === 1);

check("Beta ne peut pas modifier un membre d'Alpha",
    call('PUT', "/api/team/{$employe['id']}",
        ['role' => 'ADMIN', 'status' => 'ACTIVE'], $b['token'])['status'] === 404);

check("Beta ne voit aucun pointage d'Alpha",
    call('GET', '/api/attendance', null, $b['token'])['body']['data']['entries'] === []);

check("Beta ne peut pas corriger un pointage d'Alpha",
    call('PUT', "/api/attendance/{$oublie}",
        ['clock_in_at' => date('Y-m-d H:i:s'), 'reason' => 'x'], $b['token'])['status'] === 404);

echo "\n9. La trace laissée\n";

$actions = array_column($db->query(
    "SELECT action FROM audit_logs WHERE action LIKE 'attendance.%' OR action LIKE 'team.%'"
)->fetchAll(), 'action');

check("l'arrivée est tracée", in_array('attendance.clock_in', $actions, true));
check("le départ est tracé", in_array('attendance.clock_out', $actions, true));
check("la correction est tracée", in_array('attendance.corrected', $actions, true));
check("la désactivation d'un compte est tracée",
    in_array('team.member_disabled', $actions, true));

// Le journal garde l'AVANT et l'APRÈS d'une correction : c'est ce qui
// permet de reconstituer une heure contestée des mois plus tard.
$trace = $db->query(
    "SELECT metadata FROM audit_logs WHERE action = 'attendance.corrected' ORDER BY id DESC LIMIT 1"
)->fetchColumn();

check("le journal garde l'avant ET l'après de la correction",
    str_contains((string) $trace, '"from"') && str_contains((string) $trace, '"to"'));

// --- Ménage --------------------------------------------------------
$orgs = "(SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%')";
$db->exec("DELETE FROM time_entries WHERE organization_id IN {$orgs}");
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
