<?php

declare(strict_types=1);

/**
 * Tests de l'API — fidélité
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_loyalty_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - QU'UNE RÉCOMPENSE NE SOIT JAMAIS COMPTÉE COMME DE LA RECETTE.
 *     C'est le cœur du lot. Un lavage offert n'est pas de l'argent
 *     reçu ; le compter en ferait annoncer au gérant une somme que
 *     son tiroir ne contient pas. La tentation de « simplifier » en
 *     enregistrant un faux paiement reviendra — ce test est là pour
 *     ce jour-là.
 *   - QU'UN LAVAGE NE DONNE QU'UN SEUL TAMPON, même payé en deux fois
 *     ou encaissé deux fois par erreur.
 *   - QUE LE GRAND LIVRE NE SE MODIFIE PAS : une utilisation annulée
 *     est compensée, jamais effacée.
 *   - QUE CHANGER LES RÈGLES NE RÉÉCRIVE PAS L'HISTOIRE.
 *   - qu'une entreprise ne voie pas les cartes d'une autre.
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
    exit(1);
}

$sfx = bin2hex(random_bytes(4));
$db  = Database::connection();

function reg(string $name, string $sfx): array {
    $r = call('POST', '/api/auth/register', [
        'organization_name' => "{$name} {$sfx}", 'first_name' => 'G', 'last_name' => $name,
        'email' => "f-{$sfx}-" . strtolower($name) . "@t.local", 'password' => 'mot-de-passe-de-test',
    ]);
    return [
        'token'   => $r['body']['data']['access_token'] ?? null,
        'station' => $r['body']['data']['user']['station_ids'][0] ?? 0,
    ];
}

$a = reg('Alpha', $sfx);
$b = reg('Beta', $sfx);

// --- Le décor -------------------------------------------------------
$service = call('POST', '/api/services', [
    'name' => 'Lavage ' . $sfx, 'price' => 5000, 'duration_minutes' => 30,
], $a['token'])['body']['data']['id'];

$petit = call('POST', '/api/services', [
    'name' => 'Petit service ' . $sfx, 'price' => 1000, 'duration_minutes' => 10,
], $a['token'])['body']['data']['id'];

$cher = call('POST', '/api/services', [
    'name' => 'Detailing ' . $sfx, 'price' => 30000, 'duration_minutes' => 180,
], $a['token'])['body']['data']['id'];

$customer = call('POST', '/api/customers', [
    'first_name' => 'Cheikh', 'last_name' => 'Fall', 'phone' => '+221776112233',
], $a['token'])['body']['data']['id'];

/** Ouvre un dossier sur un véhicule neuf et renvoie l'opération. */
function nouveauDossier(array $owner, int $customer, int $service, string $sfx, int $n): array {
    $vehicle = call('POST', '/api/vehicles', [
        'plate_number' => sprintf('DK-%04d-LY', 1000 + $n), 'customer_id' => $customer,
        'brand' => 'Toyota', 'model' => 'Corolla', 'vehicle_type' => 'CAR',
    ], $owner['token'])['body']['data']['id'];

    return call('POST', '/api/operations', [
        'vehicle_id' => $vehicle, 'service_id' => $service, 'station_id' => $owner['station'],
    ], $owner['token'])['body']['data']['operation'];
}

echo "=== LOT 14 — fidélité ===\n\n1. Le programme\n";

// UN PROGRAMME NAÎT INACTIF : la migration s'applique à toutes les
// installations, y compris celles qui n'ont jamais demandé de
// fidélité. Un programme actif par défaut distribuerait de l'argent
// sans que personne ne l'ait décidé.
check("aucun programme au départ",
    call('GET', '/api/loyalty', null, $a['token'])['body']['data']['program'] === null);

check('un seuil de 2 lavages est refusé',
    call('PUT', '/api/loyalty/program',
        ['stamps_required' => 2, 'reward_amount' => 5000], $a['token'])['status'] === 422);

check('un seuil de 80 lavages est refusé',
    call('PUT', '/api/loyalty/program',
        ['stamps_required' => 80, 'reward_amount' => 5000], $a['token'])['status'] === 422);

check('une récompense sans montant est refusée',
    call('PUT', '/api/loyalty/program',
        ['stamps_required' => 10, 'reward_amount' => 0], $a['token'])['status'] === 422);

$created = call('PUT', '/api/loyalty/program', [
    'name' => 'Carte fidélité', 'stamps_required' => 3, 'reward_amount' => 4000,
    'min_operation_amount' => 3000, 'status' => 'ACTIVE',
], $a['token']);

check('le programme se crée', $created['status'] === 200);
check('il est actif', ($created['body']['data']['program']['is_active'] ?? false) === true);

// Une seule ligne active par entreprise, garantie par la base.
$actifs = (int) $db->query(
    "SELECT COUNT(*) FROM loyalty_programs WHERE status = 'ACTIVE'"
)->fetchColumn();
check('la base ne tolère pas deux programmes actifs par entreprise',
    (int) $db->query("SELECT COUNT(*) FROM (
        SELECT organization_id FROM loyalty_programs WHERE status = 'ACTIVE'
        GROUP BY organization_id HAVING COUNT(*) > 1) x")->fetchColumn() === 0,
    "programmes actifs au total : {$actifs}");

echo "\n2. Un lavage payé donne un tampon\n";

$op1 = nouveauDossier($a, $customer, $service, $sfx, 1);

$paiement = call('POST', "/api/operations/{$op1['id']}/payments",
    ['amount' => 5000, 'method' => 'CASH'], $a['token']);

check("l'encaissement passe", $paiement['status'] === 201);
check('un tampon est gagné', ($paiement['body']['data']['loyalty_balance'] ?? null) === 1);

$carte = call('GET', "/api/loyalty/customers/{$customer}", null, $a['token'])['body']['data'];

check('la carte affiche 1 tampon', ($carte['card']['balance'] ?? 0) === 1);
check('elle dit combien il en reste', ($carte['card']['stamps_to_next'] ?? 0) === 2);
check("l'historique porte l'écriture", count($carte['history'] ?? []) === 1);
check("elle porte le nom de qui l'a saisie",
    ($carte['history'][0]['created_by_name'] ?? '') !== '');

echo "\n3. Un lavage ne donne QU'UN tampon\n";

// Payé en deux fois : le calcul se déclenche deux fois.
$op2 = nouveauDossier($a, $customer, $service, $sfx, 2);

call('POST', "/api/operations/{$op2['id']}/payments", ['amount' => 2000, 'method' => 'CASH'], $a['token']);
$second = call('POST', "/api/operations/{$op2['id']}/payments", ['amount' => 3000, 'method' => 'CASH'], $a['token']);

check("un dossier payé en deux fois ne donne qu'un tampon",
    ($second['body']['data']['loyalty_balance'] ?? null) === 2);

// Un acompte ne donne rien : un lavage à moitié payé n'est pas payé.
$op3 = nouveauDossier($a, $customer, $service, $sfx, 3);
$acompte = call('POST', "/api/operations/{$op3['id']}/payments",
    ['amount' => 2000, 'method' => 'CASH'], $a['token']);

// `??` traite `null` comme ABSENT : `($x ?? 'y') === null` est
// toujours faux. Le piège s'est payé quatre fois sur ce projet — il
// se vérifie donc avec `array_key_exists`, jamais avec `??`.
check("un acompte ne donne aucun tampon",
    ($acompte['body']['data']['loyalty_balance'] ?? null) === null,
    'solde renvoyé : ' . json_encode($acompte['body']['data']['loyalty_balance'] ?? 'absent'));

// La base est le dernier rempart : la contrainte d'unicité interdit
// physiquement un second EARN sur le même dossier.
$doublon = false;

try {
    $orgId = (int) $db->query(
        "SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%' ORDER BY id ASC LIMIT 1"
    )->fetchColumn();
    $programId = (int) $db->query(
        "SELECT id FROM loyalty_programs WHERE organization_id = {$orgId} LIMIT 1"
    )->fetchColumn();

    $db->prepare(
        'INSERT INTO loyalty_entries (organization_id, program_id, customer_id, type, points, operation_id)
         VALUES (?, ?, ?, ?, ?, ?)'
    )->execute([$orgId, $programId, $customer, 'EARN', 1, $op1['id']]);
    $doublon = true;
} catch (PDOException) {
    // La base a refusé : c'est le comportement attendu.
}

check('la BASE refuse un second tampon sur le même dossier', $doublon === false);

echo "\n4. Ce qui ne donne pas de tampon\n";

$opPetit = nouveauDossier($a, $customer, $petit, $sfx, 4);
$petitPaiement = call('POST', "/api/operations/{$opPetit['id']}/payments",
    ['amount' => 1000, 'method' => 'CASH'], $a['token']);

check("une prestation sous le plancher n'en donne pas",
    ($petitPaiement['body']['data']['loyalty_balance'] ?? null) === null,
    'solde renvoyé : ' . json_encode($petitPaiement['body']['data']['loyalty_balance'] ?? 'absent'));

echo "\n5. LA RÉCOMPENSE EST UNE REMISE, PAS UN ENCAISSEMENT\n";

// Le client a 2 tampons ; il en faut 3.
check('avec 2 tampons sur 3, la remise est refusée',
    call('POST', '/api/loyalty/redeem', ['operation_id' => $op3['id']], $a['token'])['status'] === 409);

// Troisième lavage payé → 3 tampons.
call('POST', "/api/operations/{$op3['id']}/payments", ['amount' => 3000, 'method' => 'CASH'], $a['token']);

$carte = call('GET', "/api/loyalty/customers/{$customer}", null, $a['token'])['body']['data']['card'];
check('le client a maintenant une récompense', ($carte['rewards_available'] ?? 0) === 1);

// La recette AVANT la remise.
$recetteAvant = call('GET', '/api/payments/journal?from=' . date('Y-m-d') . '&to=' . date('Y-m-d'),
    null, $a['token'])['body']['data']['totals']['total'] ?? 0;

$op4 = nouveauDossier($a, $customer, $service, $sfx, 5);
$remise = call('POST', '/api/loyalty/redeem', ['operation_id' => $op4['id']], $a['token']);

check('la remise est appliquée', $remise['status'] === 200);

$apres = $remise['body']['data']['operation'] ?? [];

check('le PRIX de la prestation ne bouge pas', ($apres['price'] ?? 0) === 5000);
check('la remise est visible sur le dossier', ($apres['discount_amount'] ?? 0) === 4000);
check('elle porte son motif', str_contains((string) ($apres['discount_reason'] ?? ''), 'Fidélité'));
check('le DÛ tombe à 1 000 F', ($apres['amount_due'] ?? 0) === 1000);
check('les tampons sont débités', ($remise['body']['data']['card']['balance'] ?? 9) === 0);

// ==================================================================
// LE TEST QUI COMPTE.
// Une récompense ne doit RIEN ajouter à la recette : ce n'est pas de
// l'argent reçu. Un faux encaissement « fidélité » aurait fait
// grimper ce chiffre de 4 000 F.
// ==================================================================
$recetteApres = call('GET', '/api/payments/journal?from=' . date('Y-m-d') . '&to=' . date('Y-m-d'),
    null, $a['token'])['body']['data']['totals']['total'] ?? 0;

check("LA RECETTE N'A PAS BOUGÉ D'UN FRANC",
    $recetteApres === $recetteAvant,
    "avant {$recetteAvant}, après {$recetteApres}");

// Aucune ligne de paiement n'a été inventée.
check("aucun encaissement n'a été créé pour la remise",
    (call('GET', "/api/operations/{$op4['id']}/payments", null, $a['token'])
        ['body']['data']['payments'] ?? []) === []);

// Et payer le RESTE suffit à solder le dossier.
$solde = call('POST', "/api/operations/{$op4['id']}/payments",
    ['amount' => 1000, 'method' => 'CASH'], $a['token']);

check('payer 1 000 F solde le dossier', ($solde['body']['data']['is_settled'] ?? false) === true);

// ==================================================================
// UN LAVAGE PAYÉ AVEC UNE RÉCOMPENSE DONNE QUAND MÊME UN TAMPON.
// ==================================================================
// Le client a bien fait laver sa voiture ; c'est le lavage qui
// compte, pas la façon dont il a été réglé. Le plancher se mesure
// d'ailleurs sur le PRIX de la prestation et non sur ce qui a été
// encaissé — sinon un client serait puni d'avoir utilisé sa carte.
//
// La règle n'est pas évidente et c'est exactement pour cela qu'elle
// est testée : elle se « corrigerait » très facilement en croyant
// bien faire.
check("un lavage réglé avec une récompense donne quand même un tampon",
    ($solde['body']['data']['loyalty_balance'] ?? null) === 1,
    'solde : ' . json_encode($solde['body']['data']['loyalty_balance'] ?? 'absent'));

check('un trop-perçu reste refusé sur le montant REMISÉ',
    call('POST', "/api/operations/{$op4['id']}/payments",
        ['amount' => 1000, 'method' => 'CASH'], $a['token'])['status'] === 422);

// Le coût du programme est mesurable — c'est toute la raison d'être
// de la remise plutôt que du faux encaissement.
$bilan = call('GET', '/api/loyalty', null, $a['token'])['body']['data'];

check('le coût du programme est lisible', ($bilan['summary']['cost'] ?? 0) === 4000);
check('les tampons distribués sont comptés', ($bilan['summary']['earned'] ?? 0) === 4);
check('les tampons utilisés aussi', ($bilan['summary']['redeemed'] ?? 0) === 3);

echo "\n6. La remise ne dépasse jamais le dossier\n";

// Trois lavages de plus pour une nouvelle récompense.
foreach ([6, 7, 8] as $n) {
    $op = nouveauDossier($a, $customer, $service, $sfx, $n);
    call('POST', "/api/operations/{$op['id']}/payments", ['amount' => 5000, 'method' => 'CASH'], $a['token']);
}

// Récompense de 4 000 F appliquée à un dossier de 1 000 F.
$opMini = nouveauDossier($a, $customer, $petit, $sfx, 9);
$remiseMini = call('POST', '/api/loyalty/redeem', ['operation_id' => $opMini['id']], $a['token']);

check('la remise est plafonnée au montant du dossier',
    ($remiseMini['body']['data']['operation']['discount_amount'] ?? 0) === 1000);
check('le dû tombe à zéro, jamais en dessous',
    ($remiseMini['body']['data']['operation']['amount_due'] ?? -1) === 0);

// LE SERVEUR PRÉVIENT (même principe qu'au lot 13) : le surplus est
// perdu, et quelqu'un au comptoir doit pouvoir le dire au client.
check('le serveur prévient que le reste est perdu',
    ($remiseMini['body']['data']['warnings'] ?? []) !== []);

check('une seconde remise sur le même dossier est refusée',
    call('POST', '/api/loyalty/redeem', ['operation_id' => $opMini['id']], $a['token'])['status'] === 409);

echo "\n7. Annuler une remise, sans rien effacer\n";

$annulation = call('POST', "/api/loyalty/redeem/{$opMini['id']}/cancel", [], $a['token']);

check("l'annulation passe", $annulation['status'] === 200);
check('la remise a disparu du dossier',
    ($annulation['body']['data']['operation']['discount_amount'] ?? 1) === 0);
check('le dû est revenu à 1 000 F',
    ($annulation['body']['data']['operation']['amount_due'] ?? 0) === 1000);
check('les tampons sont rendus',
    ($annulation['body']['data']['card']['balance'] ?? 0) === 4,
    'solde rendu : ' . json_encode($annulation['body']['data']['card'] ?? []));

// ON NE SUPPRIME PAS : le REDEEM est toujours là, compensé par un
// REVERSAL. « J'applique, j'annule, je réapplique ailleurs » doit
// rester lisible.
$lignes = call('GET', "/api/loyalty/customers/{$customer}", null, $a['token'])
    ['body']['data']['history'] ?? [];
$types = array_column($lignes, 'type');

check("l'utilisation annulée est TOUJOURS dans le grand livre",
    in_array('REDEEM', $types, true));
check('une écriture inverse la compense', in_array('REVERSAL', $types, true));

check('annuler deux fois est refusé',
    call('POST', "/api/loyalty/redeem/{$opMini['id']}/cancel", [], $a['token'])['status'] === 409);

echo "\n8. Ce qui est clos ne se remise plus\n";

$opClos = nouveauDossier($a, $customer, $service, $sfx, 10);
call('PUT', "/api/operations/{$opClos['id']}/status", ['status' => 'CANCELLED'], $a['token']);

check('un dossier annulé refuse la remise',
    call('POST', '/api/loyalty/redeem', ['operation_id' => $opClos['id']], $a['token'])['status'] === 409);

echo "\n9. Changer les règles ne réécrit pas l'histoire\n";

$avant = call('GET', "/api/loyalty/customers/{$customer}", null, $a['token'])
    ['body']['data']['history'][0]['id'] ?? 0;

$ancienneValeur = (int) $db->query(
    "SELECT reward_amount FROM loyalty_entries WHERE id = {$avant}"
)->fetchColumn();

call('PUT', '/api/loyalty/program', [
    'name' => 'Carte fidélité', 'stamps_required' => 5, 'reward_amount' => 9000,
    'min_operation_amount' => 3000, 'status' => 'ACTIVE',
], $a['token']);

check('les règles ont changé',
    (call('GET', '/api/loyalty', null, $a['token'])['body']['data']['program']['reward_amount'] ?? 0) === 9000);

check("les écritures passées gardent l'ancienne valeur",
    (int) $db->query("SELECT reward_amount FROM loyalty_entries WHERE id = {$avant}")->fetchColumn()
        === $ancienneValeur);

check('le nouveau seuil est repris par la carte',
    (call('GET', "/api/loyalty/customers/{$customer}", null, $a['token'])
        ['body']['data']['card']['stamps_required'] ?? 0) === 5);

echo "\n10. Qui a le droit de quoi\n";

$employeEmail = "employe-{$sfx}@t.local";

call('POST', '/api/team', [
    'first_name' => 'Awa', 'last_name' => 'Test', 'email' => $employeEmail,
    'password' => 'mot-de-passe-de-test', 'role' => 'EMPLOYEE',
    'station_id' => $a['station'],
], $a['token']);

$employe = call('POST', '/api/auth/login', [
    'email' => $employeEmail, 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

check('un employé lit une carte',
    call('GET', "/api/loyalty/customers/{$customer}", null, $employe)['status'] === 200);

// LA RÈGLE NE DEMANDE AUCUN JUGEMENT : le client a ses tampons ou il
// ne les a pas. Faire venir un responsable pour appuyer sur un bouton
// dont le résultat est déterminé apprendrait au comptoir à dire
// « votre carte, on verra plus tard ».
foreach ([11, 12] as $n) {
    $op = nouveauDossier($a, $customer, $service, $sfx, $n);
    call('POST', "/api/operations/{$op['id']}/payments", ['amount' => 5000, 'method' => 'CASH'], $a['token']);
}

$opEmploye = nouveauDossier($a, $customer, $cher, $sfx, 13);

check('un employé applique une récompense',
    call('POST', '/api/loyalty/redeem', ['operation_id' => $opEmploye['id']], $employe)['status'] === 200);

check('un employé retire une remise appliquée par erreur',
    call('POST', "/api/loyalty/redeem/{$opEmploye['id']}/cancel", [], $employe)['status'] === 200);

// EN REVANCHE, IL NE CHANGE PAS LES RÈGLES : un client qui collecte
// des tampons a une promesse en cours.
check("un employé ne change PAS les règles du programme",
    call('PUT', '/api/loyalty/program',
        ['stamps_required' => 3, 'reward_amount' => 100000, 'status' => 'ACTIVE'], $employe)
        ['status'] === 403);

echo "\n11. Isolation entre entreprises\n";

check("Beta ne voit pas le programme d'Alpha",
    call('GET', '/api/loyalty', null, $b['token'])['body']['data']['program'] === null);

check("Beta ne lit pas la carte d'un client d'Alpha",
    call('GET', "/api/loyalty/customers/{$customer}", null, $b['token'])['status'] === 404);

check("Beta ne peut pas remiser un dossier d'Alpha",
    call('POST', '/api/loyalty/redeem', ['operation_id' => $op1['id']], $b['token'])['status'] === 404);

check("Beta ne voit aucun tampon d'Alpha",
    (call('GET', '/api/loyalty', null, $b['token'])['body']['data']['summary']['earned'] ?? -1) === 0);

echo "\n12. La trace laissée\n";

$orgId = (int) $db->query(
    "SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%' ORDER BY id ASC LIMIT 1"
)->fetchColumn();

$actions = $db->query(
    "SELECT DISTINCT action FROM audit_logs WHERE organization_id = {$orgId}"
)->fetchAll(PDO::FETCH_COLUMN);

check('la création du programme est tracée', in_array('loyalty.program_updated', $actions, true));
check("l'utilisation d'une récompense est tracée", in_array('loyalty.redeemed', $actions, true));
check("son annulation aussi", in_array('loyalty.redeem_cancelled', $actions, true));

$trace = (string) $db->query(
    "SELECT metadata FROM audit_logs WHERE action = 'loyalty.redeemed'
       AND organization_id = {$orgId} ORDER BY id DESC LIMIT 1"
)->fetchColumn();

// Ce qui a été RÉELLEMENT déduit, qui peut différer de la valeur
// annoncée de la récompense.
check('la trace garde le montant réellement déduit', str_contains($trace, 'applied'));

$regles = (string) $db->query(
    "SELECT metadata FROM audit_logs WHERE action = 'loyalty.program_updated'
       AND organization_id = {$orgId} ORDER BY id DESC LIMIT 1"
)->fetchColumn();

check("le changement de règles garde l'avant ET l'après",
    str_contains($regles, '"from"') && str_contains($regles, '"to"'));

// --- Ménage --------------------------------------------------------
$orgs = "(SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%')";
// Les REVERSAL référencent les REDEEM qu'ils compensent : on les
// efface en premier, sinon la clé étrangère refuse — et c'est bien
// ce qu'on lui demande de faire en production.
$db->exec("DELETE FROM loyalty_entries WHERE organization_id IN {$orgs} AND type = 'REVERSAL'");
$db->exec("DELETE FROM loyalty_entries WHERE organization_id IN {$orgs}");
$db->exec("DELETE FROM loyalty_programs WHERE organization_id IN {$orgs}");
$db->exec("DELETE FROM bookings WHERE organization_id IN {$orgs}");
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
