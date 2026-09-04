<?php

declare(strict_types=1);

/**
 * Tests de l'API — statistiques
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_analytics_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - L'IDENTITÉ COMPTABLE DU PRODUIT :
 *
 *         valeur livrée = encaissé + offert + prépayé + impayé
 *
 *     Les quatre termes viennent de quatre modules écrits à des lots
 *     différents (paiements, fidélité, abonnements, prix figé). C'est
 *     le seul test du projet qui les fasse tous parler ensemble — et
 *     le seul endroit où une incohérence entre eux se verrait.
 *   - QUE « ENCAISSÉ » ET « LIVRÉ » NE SOIENT PAS CONFONDUS. Ce ne
 *     sont pas les mêmes périodes ni les mêmes montants, et les
 *     mélanger produirait des chiffres inexplicables.
 *   - qu'un axe du temps ne saute pas les jours vides
 *   - que la semaine commence un lundi, pas un dimanche
 *   - qu'une moyenne ne s'affiche pas sur deux mesures
 *   - qu'un employé ne voie pas les chiffres de l'entreprise
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
        CURLOPT_HTTPHEADER => $hd, CURLOPT_TIMEOUT => 30]);
    if ($b !== null) { curl_setopt($h, CURLOPT_POSTFIELDS, json_encode($b, JSON_UNESCAPED_UNICODE)); }
    $r = curl_exec($h);
    $s = (int) curl_getinfo($h, CURLINFO_HTTP_CODE);
    curl_close($h);
    return ['status' => $s, 'body' => is_string($r) ? (json_decode($r, true) ?? []) : []];
}

if (call('GET', '/api/health')['status'] === 0) {
    echo "[ARRÊT] L'API ne répond pas sur " . API . "\n";
    exit(1);
}

$sfx  = bin2hex(random_bytes(4));
$db   = Database::connection();
$jour = date('Y-m-d');

function reg(string $name, string $sfx): array {
    $r = call('POST', '/api/auth/register', [
        'organization_name' => "{$name} {$sfx}", 'first_name' => 'G', 'last_name' => $name,
        'email' => "s-{$sfx}-" . strtolower($name) . "@t.local", 'password' => 'mot-de-passe-de-test',
    ]);
    return [
        'token'   => $r['body']['data']['access_token'] ?? null,
        'station' => $r['body']['data']['user']['station_ids'][0] ?? 0,
    ];
}

$a = reg('Alpha', $sfx);
$b = reg('Beta', $sfx);

// --- Le décor -------------------------------------------------------
$lavage = call('POST', '/api/services', [
    'name' => 'Lavage ' . $sfx, 'price' => 5000, 'duration_minutes' => 30,
], $a['token'])['body']['data']['id'];

$client = call('POST', '/api/customers', [
    'first_name' => 'Cheikh', 'last_name' => 'Fall', 'phone' => '+221776112233',
], $a['token'])['body']['data']['id'];

$n = 0;

/** Ouvre un dossier sur un véhicule neuf. */
function dossier(array $owner, int $client, int $service, int &$n): array {
    $n++;
    $vehicle = call('POST', '/api/vehicles', [
        'plate_number' => sprintf('DK-%04d-ST', 3000 + $n), 'customer_id' => $client,
        'brand' => 'Toyota', 'model' => 'Corolla', 'vehicle_type' => 'CAR',
    ], $owner['token'])['body']['data']['id'];

    return call('POST', '/api/operations', [
        'vehicle_id' => $vehicle, 'service_id' => $service, 'station_id' => $owner['station'],
    ], $owner['token'])['body']['data']['operation'];
}

/** Amène un dossier jusqu'à « prêt », puis le restitue. */
function restituer(array $op, array $owner, bool $override = false): array {
    foreach (['IN_PROGRESS', 'INSPECTION'] as $etape) {
        call('PUT', "/api/operations/{$op['id']}/status", ['status' => $etape], $owner['token']);
    }

    call('POST', "/api/operations/{$op['id']}/inspections", [
        'type' => 'ENTRY', 'fuel_level' => 'HALF', 'mileage' => 50000,
        'has_damage' => false,
    ], $owner['token']);

    foreach (['WASHING', 'QUALITY_CHECK', 'READY'] as $etape) {
        call('PUT', "/api/operations/{$op['id']}/status", ['status' => $etape], $owner['token']);
    }

    $body = ['reference' => $op['reference'], 'plate_number' => $op['plate_display']];

    if ($override) {
        $body['override_reason'] = 'Client connu, réglera demain.';
    }

    return call('POST', "/api/operations/{$op['id']}/release", $body, $owner['token']);
}

echo "=== LOT 16 — statistiques ===\n\n1. La période\n";

$defaut = call('GET', '/api/analytics', null, $a['token']);

check('la période par défaut couvre 30 jours',
    ($defaut['body']['data']['period']['days'] ?? 0) === 30);

// Des bornes inversées sont une faute de saisie, pas une demande : on
// les remet à l'endroit plutôt que de renvoyer un écran vide que
// l'utilisateur croirait être la réalité.
$inverse = call('GET', "/api/analytics?from={$jour}&to=2026-01-01", null, $a['token']);

check('des bornes inversées sont remises à l\'endroit',
    ($inverse['body']['data']['period']['from'] ?? '') === '2026-01-01');

check('au-delà d\'un an, la période est refusée',
    call('GET', '/api/analytics?from=2020-01-01&to=2026-12-31', null, $a['token'])
        ['status'] === 422);

echo "\n2. L'IDENTITÉ COMPTABLE\n";

// Quatre dossiers restitués, couverts de quatre façons différentes.
// C'est le seul test du projet qui fasse parler ensemble les
// paiements (lot 9), la fidélité (lot 14), les abonnements (lot 15) et
// le prix figé (lot 7).

// --- A. Un lavage payé ---------------------------------------------
$opA = dossier($a, $client, $lavage, $n);
call('POST', "/api/operations/{$opA['id']}/payments",
    ['amount' => 5000, 'method' => 'CASH'], $a['token']);
restituer($opA, $a);

// --- B. Un lavage OFFERT (fidélité) --------------------------------
call('PUT', '/api/loyalty/program', [
    'name' => 'Carte', 'stamps_required' => 3, 'reward_amount' => 5000,
    'min_operation_amount' => 0, 'status' => 'ACTIVE',
], $a['token']);

// Trois lavages payés pour gagner une récompense.
for ($i = 0; $i < 3; $i++) {
    $op = dossier($a, $client, $lavage, $n);
    call('POST', "/api/operations/{$op['id']}/payments",
        ['amount' => 5000, 'method' => 'CASH'], $a['token']);
    restituer($op, $a);
}

$opB = dossier($a, $client, $lavage, $n);
call('POST', '/api/loyalty/redeem', ['operation_id' => $opB['id']], $a['token']);
restituer($opB, $a);

// --- C. Un lavage PRÉPAYÉ (abonnement) -----------------------------
$plan = call('POST', '/api/subscriptions/plans', [
    'name' => 'Forfait', 'service_id' => $lavage, 'washes' => 5,
    'price' => 20000, 'validity_days' => 180, 'status' => 'ACTIVE',
], $a['token'])['body']['data']['plan']['id'];

call('POST', '/api/subscriptions', [
    'customer_id' => $client, 'plan_id' => $plan,
    'station_id' => $a['station'], 'method' => 'CASH',
], $a['token']);

$opC = dossier($a, $client, $lavage, $n);
call('POST', '/api/subscriptions/use', ['operation_id' => $opC['id']], $a['token']);
restituer($opC, $a);

// --- D. Un lavage IMPAYÉ (dérogation) ------------------------------
$opD = dossier($a, $client, $lavage, $n);
$deroge = restituer($opD, $a, true);

check('les quatre dossiers sont restitués', $deroge['status'] === 200,
    json_encode($deroge['body']['message'] ?? ''));

// Les sept lavages viennent d'enchaîner leurs statuts en quelques
// millisecondes : `started_at` et `completed_at` tombent dans la même
// seconde, et la durée mesurée vaut zéro. On antidate les prises en
// charge pour que la mesure ait un sens — le produit, lui, refuse à
// juste titre de moyenner des durées nulles.
$db->prepare(
    "UPDATE operations o
       SET o.started_at = (o.completed_at - INTERVAL 36 MINUTE)
     WHERE o.organization_id = (SELECT id FROM organizations WHERE slug LIKE ? LIMIT 1)
       AND o.started_at IS NOT NULL AND o.completed_at IS NOT NULL"
)->execute(["%{$sfx}%"]);

$stats = call('GET', "/api/analytics?from={$jour}&to={$jour}", null, $a['token'])
    ['body']['data'] ?? [];
$livre = $stats['delivered'] ?? [];

check('les sept lavages livrés sont comptés', ($livre['operations'] ?? 0) === 7);

// 7 lavages × 5 000 F
check('la valeur livrée est le PRIX des prestations, remises comprises',
    ($livre['delivered'] ?? 0) === 35000,
    'annoncé : ' . ($livre['delivered'] ?? '?'));

check('un lavage offert apparaît en OFFERT', ($livre['gifted'] ?? 0) === 5000);
check('un lavage d\'abonné apparaît en PRÉPAYÉ', ($livre['prepaid'] ?? 0) === 5000);
check('les quatre lavages réglés apparaissent en ENCAISSÉ',
    ($livre['paid'] ?? 0) === 20000);
check('la dérogation apparaît en IMPAYÉ', ($livre['unpaid'] ?? 0) === 5000);

// ==================================================================
// LE TEST QUI COMPTE.
// Si cette égalité ne tombe pas juste, c'est qu'un des quatre modules
// ment — et l'écran doit le dire au lieu de le cacher.
// ==================================================================
check("L'IDENTITÉ TOMBE JUSTE : livré = encaissé + offert + prépayé + impayé",
    ($livre['reconciles'] ?? false) === true
        && ($livre['delivered'] ?? 0)
            === ($livre['paid'] ?? 0) + ($livre['gifted'] ?? 0)
                + ($livre['prepaid'] ?? 0) + ($livre['unpaid'] ?? 0),
    json_encode($livre));

echo "\n3. Encaissé et livré ne sont pas la même chose\n";

$encaisse = $stats['collected'] ?? [];

// Quatre lavages à 5 000 F + un forfait à 20 000 F.
check("l'encaissé comprend la vente du forfait",
    ($encaisse['total'] ?? 0) === 40000,
    'annoncé : ' . ($encaisse['total'] ?? '?'));

check('il distingue ce qui porte sur un dossier',
    ($encaisse['on_operations'] ?? 0) === 20000);
check('…de ce qui porte sur un forfait',
    ($encaisse['on_subscriptions'] ?? 0) === 20000);

// LES DEUX CHIFFRES DIFFÈRENT, ET C'EST NORMAL. L'encaissé comprend
// des lavages qui seront livrés plus tard ; le livré comprend des
// lavages offerts et un impayé. Un écran qui les confondrait
// produirait des chiffres que personne ne pourrait expliquer.
check('encaissé et livré diffèrent, et les deux sont vrais',
    ($encaisse['total'] ?? 0) !== ($livre['delivered'] ?? 0));

echo "\n4. Ce qui se vend\n";

$services = $stats['services'] ?? [];

check('les prestations sont listées', count($services) === 1);
check('avec leur volume', ($services[0]['operations'] ?? 0) === 7);
check('et leur valeur', ($services[0]['value'] ?? 0) === 35000);
// Le panier moyen, calculé côté serveur pour être le même partout.
check('et le panier moyen', ($services[0]['average'] ?? 0) === 5000);

echo "\n5. Le temps, sans trous\n";

$sept = call('GET', '/api/analytics?from=' . date('Y-m-d', strtotime('-6 days'))
    . "&to={$jour}", null, $a['token'])['body']['data'] ?? [];

// UN JOUR SANS ACTIVITÉ EST UN ZÉRO AFFICHÉ, PAS UNE LIGNE ABSENTE.
// Un graphique qui saute les dimanches fermés écrase l'axe du temps :
// deux colonnes voisines paraissent consécutives alors qu'une semaine
// les sépare.
check('les jours vides sont renvoyés à zéro', count($sept['daily'] ?? []) === 7);

$aujourdhui = null;
foreach ($sept['daily'] as $ligne) {
    if ($ligne['day'] === $jour) { $aujourdhui = $ligne; }
}

check("l'activité du jour est comptée", ($aujourdhui['vehicles'] ?? 0) === 7);

// Les 24 heures sont toujours présentes : un axe troué se lit de
// travers.
check('les 24 heures sont toujours renvoyées', count($stats['hours'] ?? []) === 24);
check('la première est minuit', ($stats['hours'][0]['hour'] ?? -1) === 0);
check('la dernière est 23 h', ($stats['hours'][23]['hour'] ?? -1) === 23);

// ⚠️ MySQL fait commencer la semaine le DIMANCHE. Une semaine
// française commence le lundi, et le décalage ne se remarque qu'en
// production, quand le gérant dit « mais le samedi n'est pas mon plus
// gros jour ».
check('la semaine commence un LUNDI',
    ($stats['weekdays'][0]['label'] ?? '') === 'Lundi');
check('…et finit un dimanche',
    ($stats['weekdays'][6]['label'] ?? '') === 'Dimanche');
check('les sept jours sont présents', count($stats['weekdays'] ?? []) === 7);

echo "\n6. Le temps annoncé contre le temps réel\n";

// C'est la question que le lot 8 avait laissée ouverte : les seuils
// d'alerte de la file d'attente venaient « du bon sens, pas de
// mesures ». Voici les mesures.
$durees = $stats['durations'] ?? [];

check('la prestation est mesurée', count($durees) === 1, json_encode($durees));
check('la durée ANNONCÉE est celle du catalogue',
    ($durees[0]['announced'] ?? 0) === 30);
check('la durée RÉELLE est mesurée', ($durees[0]['actual'] ?? 0) === 36);

// LE CHIFFRE QUI RÉPOND À LA QUESTION LAISSÉE OUVERTE AU LOT 8 :
// annoncé 30 minutes, mesuré 36. Si toutes les prestations dépassent
// systématiquement, ce n'est pas l'équipe qui est lente — c'est le
// catalogue qui ment aux clients.
check("l'écart avec l'annonce est lisible",
    ($durees[0]['actual'] ?? 0) > ($durees[0]['announced'] ?? 0));
check('le nombre de mesures est indiqué', ($durees[0]['samples'] ?? 0) === 7);

// UNE MOYENNE SUR DEUX PASSAGES EST UNE ANECDOTE. Même règle qu'au
// tableau de bord (lot 10), où le délai moyen n'apparaît qu'au-delà
// de trois dossiers.
$rare = call('POST', '/api/services', [
    'name' => 'Prestation rare ' . $sfx, 'price' => 9000, 'duration_minutes' => 60,
], $a['token'])['body']['data']['id'];

for ($i = 0; $i < 2; $i++) {
    $op = dossier($a, $client, $rare, $n);
    call('POST', "/api/operations/{$op['id']}/payments",
        ['amount' => 9000, 'method' => 'CASH'], $a['token']);
    restituer($op, $a);
}

// Même antidatage, sinon la prestation serait écartée parce que sa
// durée est nulle — et le test passerait pour la mauvaise raison.
$db->prepare(
    "UPDATE operations o
       SET o.started_at = (o.completed_at - INTERVAL 70 MINUTE)
     WHERE o.organization_id = (SELECT id FROM organizations WHERE slug LIKE ? LIMIT 1)
       AND o.service_id = ?
       AND o.started_at IS NOT NULL AND o.completed_at IS NOT NULL"
)->execute(["%{$sfx}%", $rare]);

$apres = call('GET', "/api/analytics?from={$jour}&to={$jour}", null, $a['token'])
    ['body']['data']['durations'] ?? [];

$noms = array_column($apres, 'service');

check("une prestation vue deux fois n'a PAS de moyenne affichée",
    !in_array('Prestation rare ' . $sfx, $noms, true));

echo "\n7. Les clients qui reviennent\n";

$clients = $stats['customers'] ?? [];

check('les clients de la période sont comptés', ($clients['total'] ?? 0) === 1);

// UN CLIENT « QUI REVIENT » EST VENU AVANT LE DÉBUT DE LA PÉRIODE —
// pas deux fois cette semaine. La nuance décide du sens du chiffre :
// la première mesure la fidélité, la seconde mesure surtout la
// longueur de la période qu'on regarde.
check("venu sept fois aujourd'hui, il reste un NOUVEAU client",
    ($clients['new'] ?? 0) === 1 && ($clients['returning'] ?? 0) === 0);

// En antidatant un passage, il devient un client qui revient.
$db->prepare(
    "UPDATE operations SET created_at = (NOW() - INTERVAL 40 DAY)
      WHERE id = ? AND organization_id = (SELECT id FROM organizations WHERE slug LIKE ? LIMIT 1)"
)->execute([$opA['id'], "%{$sfx}%"]);

$revenu = call('GET', "/api/analytics?from={$jour}&to={$jour}", null, $a['token'])
    ['body']['data']['customers'] ?? [];

check('un passage antérieur en fait un client qui REVIENT',
    ($revenu['returning'] ?? 0) === 1 && ($revenu['new'] ?? 1) === 0);

echo "\n8. Qui a le droit de voir les chiffres\n";

// AUCUN NOUVEAU DROIT : `reports.view` existe depuis le lot 4 et veut
// dire exactement cela. En créer un second aurait donné deux droits
// pour une même notion.
$employeEmail = "employe-{$sfx}@t.local";

call('POST', '/api/team', [
    'first_name' => 'Awa', 'last_name' => 'Test', 'email' => $employeEmail,
    'password' => 'mot-de-passe-de-test', 'role' => 'EMPLOYEE',
    'station_id' => $a['station'],
], $a['token']);

$employe = call('POST', '/api/auth/login', [
    'email' => $employeEmail, 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

check("un employé ne voit PAS les statistiques (403)",
    call('GET', '/api/analytics', null, $employe)['status'] === 403);

$managerEmail = "manager-{$sfx}@t.local";

call('POST', '/api/team', [
    'first_name' => 'Modou', 'last_name' => 'Test', 'email' => $managerEmail,
    'password' => 'mot-de-passe-de-test', 'role' => 'MANAGER',
    'station_id' => $a['station'],
], $a['token']);

$manager = call('POST', '/api/auth/login', [
    'email' => $managerEmail, 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

check('un manager les voit', call('GET', '/api/analytics', null, $manager)['status'] === 200);

echo "\n9. Isolation entre entreprises\n";

$vide = call('GET', '/api/analytics', null, $b['token'])['body']['data'] ?? [];

check("Beta ne voit aucune valeur livrée d'Alpha",
    ($vide['delivered']['delivered'] ?? -1) === 0);
check("Beta ne voit aucun encaissement d'Alpha",
    ($vide['collected']['total'] ?? -1) === 0);
check("Beta ne voit aucune prestation d'Alpha", ($vide['services'] ?? ['x']) === []);
check("Beta ne voit aucun client d'Alpha", ($vide['customers']['total'] ?? -1) === 0);

// L'identité tient AUSSI sur une entreprise vide : zéro = zéro.
check("l'identité tient même à vide", ($vide['delivered']['reconciles'] ?? false) === true);

check("filtrer sur la station d'une autre entreprise est refusé",
    call('GET', "/api/analytics?station_id={$a['station']}", null, $b['token'])
        ['status'] === 403);

echo "\n10. Ce lot n'a rien ajouté au modèle\n";

// ==================================================================
// LE LOT 16 N'AJOUTE AUCUNE TABLE, AUCUNE COLONNE, AUCUNE MIGRATION.
// C'est son intérêt : quinze lots ont enregistré honnêtement ce qui
// se passait, et on peut maintenant leur poser des questions
// auxquelles personne n'avait pensé en les écrivant.
//
// Ce test échouera si quelqu'un ajoute une table de statistiques
// pré-calculées — ce qui serait le premier pas vers des chiffres qui
// divergent de ceux qu'ils résument.
// ==================================================================
$tables = $db->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);

check("aucune table d'analyse pré-calculée",
    !in_array('analytics', $tables, true)
        && !in_array('statistics', $tables, true)
        && !in_array('daily_stats', $tables, true));

check('le nombre de tables est inchangé depuis le lot 15',
    count($tables) === 22, 'tables : ' . count($tables));

// --- Ménage --------------------------------------------------------
$orgs = "(SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%')";
$db->exec("UPDATE operations SET subscription_id = NULL WHERE organization_id IN {$orgs}");
$db->exec("DELETE FROM loyalty_entries WHERE organization_id IN {$orgs} AND type = 'REVERSAL'");
$db->exec("DELETE FROM loyalty_entries WHERE organization_id IN {$orgs}");
$db->exec("DELETE FROM loyalty_programs WHERE organization_id IN {$orgs}");
$db->exec("DELETE FROM payments WHERE organization_id IN {$orgs}");
$db->exec("DELETE FROM subscriptions WHERE organization_id IN {$orgs}");
$db->exec("DELETE FROM subscription_plans WHERE organization_id IN {$orgs}");
$db->exec("DELETE FROM bookings WHERE organization_id IN {$orgs}");
$db->exec("DELETE FROM time_entries WHERE organization_id IN {$orgs}");
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
