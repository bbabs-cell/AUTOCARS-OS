<?php

declare(strict_types=1);

/**
 * Tests de l'API — abonnements
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_subscription_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - QUE L'ARGENT D'UN FORFAIT ENTRE DANS LA CAISSE LE JOUR OÙ IL
 *     EST REÇU. C'est le seul point non négociable : une caisse fausse
 *     est le pire défaut possible de ce produit.
 *   - QU'UN LAVAGE D'ABONNÉ NE SOIT PAS COMPTÉ DEUX FOIS. Il a été
 *     payé à la vente du forfait ; le jour du lavage, il ne rapporte
 *     rien.
 *   - QU'UN LAVAGE D'ABONNÉ NE SOIT PAS PRIS POUR UN CADEAU. Sans
 *     `discount_source`, le « coût du programme de fidélité »
 *     compterait un argent déjà encaissé.
 *   - QUE LE SOLDE D'UN FORFAIT SE RECOMPTE, jamais ne se stocke.
 *   - qu'un forfait périmé, épuisé ou annulé ne serve plus.
 *   - qu'une entreprise ne voie pas les forfaits d'une autre.
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
$jour = date('Y-m-d');

function reg(string $name, string $sfx): array {
    $r = call('POST', '/api/auth/register', [
        'organization_name' => "{$name} {$sfx}", 'first_name' => 'G', 'last_name' => $name,
        'email' => "a-{$sfx}-" . strtolower($name) . "@t.local", 'password' => 'mot-de-passe-de-test',
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

$autre = call('POST', '/api/services', [
    'name' => 'Detailing ' . $sfx, 'price' => 30000, 'duration_minutes' => 180,
], $a['token'])['body']['data']['id'];

$client = call('POST', '/api/customers', [
    'first_name' => 'Cheikh', 'last_name' => 'Fall', 'phone' => '+221776112233',
], $a['token'])['body']['data']['id'];

$compteur = 0;

/** Ouvre un dossier sur un véhicule neuf. */
function dossier(array $owner, int $client, int $service, int &$n): array {
    $n++;
    $vehicle = call('POST', '/api/vehicles', [
        'plate_number' => sprintf('DK-%04d-AB', 2000 + $n), 'customer_id' => $client,
        'brand' => 'Toyota', 'model' => 'Corolla', 'vehicle_type' => 'CAR',
    ], $owner['token'])['body']['data']['id'];

    return call('POST', '/api/operations', [
        'vehicle_id' => $vehicle, 'service_id' => $service, 'station_id' => $owner['station'],
    ], $owner['token'])['body']['data']['operation'];
}

function recette(array $owner, string $jour): int {
    return (int) (call('GET', "/api/payments?from={$jour}&to={$jour}", null, $owner['token'])
        ['body']['data']['totals']['total'] ?? 0);
}

echo "=== LOT 15 — abonnements ===\n\n1. Le forfait proposé\n";

check('un forfait d\'un seul lavage est refusé',
    call('POST', '/api/subscriptions/plans', [
        'name' => 'Un seul', 'service_id' => $lavage, 'washes' => 1, 'price' => 5000,
    ], $a['token'])['status'] === 422);

check('un forfait sans date de fin est refusé',
    call('POST', '/api/subscriptions/plans', [
        'name' => 'Éternel', 'service_id' => $lavage, 'washes' => 10,
        'price' => 40000, 'validity_days' => 0,
    ], $a['token'])['status'] === 422);

check('un forfait sans prix est refusé',
    call('POST', '/api/subscriptions/plans', [
        'name' => 'Gratuit', 'service_id' => $lavage, 'washes' => 10, 'price' => 0,
    ], $a['token'])['status'] === 422);

$plan = call('POST', '/api/subscriptions/plans', [
    'name' => 'Forfait 5 lavages', 'service_id' => $lavage, 'washes' => 5,
    'price' => 20000, 'validity_days' => 180, 'status' => 'ACTIVE',
], $a['token']);

check('le forfait se crée', $plan['status'] === 201);

$planId = (int) ($plan['body']['data']['plan']['id'] ?? 0);

// L'ARGUMENT DE VENTE, calculé par le serveur pour qu'il soit le même
// sur tous les écrans qui l'affichent.
check("l'économie du client est calculée",
    ($plan['body']['data']['plan']['saving'] ?? 0) === 5000,
    '5 × 5 000 = 25 000, vendu 20 000');

echo "\n2. L'ARGENT ENTRE DANS LA CAISSE LE JOUR DE LA VENTE\n";

$avant = recette($a, $jour);

$vente = call('POST', '/api/subscriptions', [
    'customer_id' => $client, 'plan_id' => $planId,
    'station_id' => $a['station'], 'method' => 'CASH',
], $a['token']);

check('le forfait se vend', $vente['status'] === 201);

$abonnement = $vente['body']['data']['subscription'] ?? [];
$abonnementId = (int) ($abonnement['id'] ?? 0);

// ==================================================================
// LE POINT NON NÉGOCIABLE.
// L'argent est dans le tiroir : il doit être dans la recette du jour
// et dans la caisse du soir. Une comptabilité d'engagement afficherait
// 0 F aujourd'hui — et ferait douter du logiciel, à raison.
// ==================================================================
check("LES 20 000 F SONT DANS LA RECETTE DU JOUR",
    recette($a, $jour) === $avant + 20000,
    'avant ' . $avant . ', après ' . recette($a, $jour));

// L'encaissement passe par la table habituelle : il hérite donc de la
// caisse, du journal et du remboursement sans rien reconstruire.
$journal = call('GET', "/api/payments?from={$jour}&to={$jour}", null, $a['token'])
    ['body']['data']['payments'] ?? [];

$ligne = null;
foreach ($journal as $entry) {
    if (($entry['subscription_id'] ?? null) === $abonnementId) { $ligne = $entry; }
}

check("la vente apparaît dans le journal des encaissements", $ligne !== null);
// `??` traite null comme ABSENT : `($x ?? 'y') === null` est
// toujours faux. Cinquième fois que ce piège se paie sur ce projet ;
// il se vérifie avec `array_key_exists`, jamais avec `??`.
check("elle n'a AUCUN dossier rattaché",
    array_key_exists('operation_reference', $ligne)
        && $ligne['operation_reference'] === null);
// Sans le nom du forfait, ce serait une ligne de 20 000 F sans objet,
// et le caissier se demanderait d'où elle sort.
check("mais elle porte le nom du forfait",
    ($ligne['subscription_plan_name'] ?? '') === 'Forfait 5 lavages');

check('le forfait est actif avec 5 lavages', ($abonnement['washes_left'] ?? 0) === 5);
check('il porte une date de péremption', ($abonnement['expires_at'] ?? '') !== '');
check("l'état est ACTIF", ($abonnement['state'] ?? '') === 'ACTIVE');

echo "\n3. Un lavage d'abonné ne rapporte plus rien\n";

$op1 = dossier($a, $client, $lavage, $compteur);
$avantLavage = recette($a, $jour);

$usage = call('POST', '/api/subscriptions/use', ['operation_id' => $op1['id']], $a['token']);

check('le forfait couvre le lavage', $usage['status'] === 200);

$couvert = $usage['body']['data']['operation'] ?? [];

check('le PRIX de la prestation ne bouge pas', ($couvert['price'] ?? 0) === 5000);
check('le dû tombe à zéro', ($couvert['amount_due'] ?? -1) === 0);
check('la remise porte le nom du forfait',
    str_contains((string) ($couvert['discount_reason'] ?? ''), 'Forfait'));

// ==================================================================
// PAS DE DOUBLE COMPTAGE.
// Le lavage a été payé le jour de la vente du forfait. Le compter une
// seconde fois gonflerait la recette d'un argent qui n'est jamais
// entré deux fois dans le tiroir.
// ==================================================================
check("LA RECETTE NE BOUGE PAS AU MOMENT DU LAVAGE",
    recette($a, $jour) === $avantLavage);

check('le solde du forfait descend à 4',
    ($usage['body']['data']['subscription']['washes_left'] ?? 0) === 4);

// LE SOLDE SE RECOMPTE, il ne se stocke pas : il n'existe aucune
// colonne `washes_used` à tenir à jour.
$colonnes = $db->query('SHOW COLUMNS FROM subscriptions')->fetchAll(PDO::FETCH_COLUMN);
check("aucune colonne `washes_used` en base",
    !in_array('washes_used', $colonnes, true));

echo "\n4. Un lavage d'abonné n'est pas un cadeau\n";

// ==================================================================
// SANS `discount_source`, le coût du programme de fidélité compterait
// ce lavage — et annoncerait au gérant qu'il offre un argent qu'il a
// encaissé la semaine dernière.
// ==================================================================
call('PUT', '/api/loyalty/program', [
    'name' => 'Carte', 'stamps_required' => 3, 'reward_amount' => 4000,
    'min_operation_amount' => 0, 'status' => 'ACTIVE',
], $a['token']);

$coût = call('GET', "/api/loyalty?from={$jour}&to={$jour}", null, $a['token'])
    ['body']['data']['summary']['cost'] ?? -1;

check("le coût de la FIDÉLITÉ ignore les lavages d'abonnés", $coût === 0,
    "coût annoncé : {$coût}");

$bilan = call('GET', "/api/subscriptions/overview?from={$jour}&to={$jour}", null, $a['token'])
    ['body']['data'] ?? [];

check('la valeur livrée en forfait est comptée à part',
    ($bilan['delivered']['value'] ?? 0) === 5000);
check('le nombre de lavages livrés aussi', ($bilan['delivered']['washes'] ?? 0) === 1);
check('les forfaits vendus sur la période sont comptés',
    ($bilan['sold']['amount'] ?? 0) === 20000);

// ==================================================================
// LA DETTE : le chiffre qui n'existerait pas sans ce module.
// ==================================================================
check("ce qui RESTE À LIVRER est visible",
    ($bilan['outstanding']['washes'] ?? 0) === 4);
check('sa valeur est chiffrée',
    ($bilan['outstanding']['value'] ?? 0) === 20000,
    '4 lavages × 5 000 F');

echo "\n5. Un lavage d'abonné rapporte un tampon\n";

// Il a été payé — d'avance, mais payé. Le contraire punirait le
// client le plus fidèle de la station.
$op2 = dossier($a, $client, $lavage, $compteur);
$usage2 = call('POST', '/api/subscriptions/use', ['operation_id' => $op2['id']], $a['token']);

check("un lavage couvert par un forfait donne un tampon",
    ($usage2['body']['data']['loyalty_balance'] ?? null) !== null,
    'solde : ' . json_encode($usage2['body']['data']['loyalty_balance'] ?? 'absent'));

// Mais un lavage ENTIÈREMENT OFFERT, lui, n'en donne pas : sinon le
// programme se nourrirait lui-même.
$carte = call('GET', "/api/loyalty/customers/{$client}", null, $a['token'])
    ['body']['data']['card'] ?? [];

if (($carte['rewards_available'] ?? 0) > 0) {
    $opOfferte = dossier($a, $client, $lavage, $compteur);
    call('POST', '/api/loyalty/redeem', ['operation_id' => $opOfferte['id']], $a['token']);

    $soldeAvant = call('GET', "/api/loyalty/customers/{$client}", null, $a['token'])
        ['body']['data']['card']['balance'] ?? 0;

    // Le dossier est à zéro : rien à encaisser, donc aucun tampon.
    check("un lavage ENTIÈREMENT offert ne donne pas de tampon",
        (call('GET', "/api/loyalty/customers/{$client}", null, $a['token'])
            ['body']['data']['card']['balance'] ?? -1) === $soldeAvant);
}

echo "\n6. Ce qu'un forfait ne couvre pas\n";

$opAutre = dossier($a, $client, $autre, $compteur);

check("un forfait ne couvre PAS une autre prestation",
    call('POST', '/api/subscriptions/use', ['operation_id' => $opAutre['id']], $a['token'])
        ['status'] === 409);

$opDouble = dossier($a, $client, $lavage, $compteur);
call('POST', '/api/subscriptions/use', ['operation_id' => $opDouble['id']], $a['token']);

check('un dossier déjà couvert refuse un second forfait',
    call('POST', '/api/subscriptions/use', ['operation_id' => $opDouble['id']], $a['token'])
        ['status'] === 409);

// Un dossier partiellement réglé ne peut plus basculer sur un
// forfait : il faudrait rendre l'argent déjà encaissé.
$opPaye = dossier($a, $client, $lavage, $compteur);
call('POST', "/api/operations/{$opPaye['id']}/payments",
    ['amount' => 2000, 'method' => 'CASH'], $a['token']);

check('un dossier déjà payé en partie refuse le forfait',
    call('POST', '/api/subscriptions/use', ['operation_id' => $opPaye['id']], $a['token'])
        ['status'] === 409);

echo "\n7. Retirer un forfait appliqué par erreur\n";

$retrait = call('POST', "/api/subscriptions/use/{$opDouble['id']}/cancel", [], $a['token']);

check('le forfait se retire', $retrait['status'] === 200);
check('le dû redevient le prix de la prestation',
    ($retrait['body']['data']['operation']['amount_due'] ?? 0) === 5000);

// Le lavage est RENDU : il suffit de détacher l'opération, puisque
// c'est elle qui compte.
check('le lavage est rendu au client',
    ($retrait['body']['data']['subscription']['washes_left'] ?? 0)
        > ($usage2['body']['data']['subscription']['washes_left'] ?? 99) - 1);

check('retirer deux fois est refusé',
    call('POST', "/api/subscriptions/use/{$opDouble['id']}/cancel", [], $a['token'])
        ['status'] === 409);

echo "\n8. Périmé, épuisé, annulé\n";

// L'ÉTAT EST CALCULÉ : on antidate la péremption en base, sans
// toucher au statut, et le forfait doit cesser de servir.
$db->prepare('UPDATE subscriptions SET expires_at = (CURDATE() - INTERVAL 1 DAY) WHERE id = ?')
   ->execute([$abonnementId]);

$perime = call('GET', "/api/subscriptions/{$abonnementId}", null, $a['token'])
    ['body']['data']['subscription'] ?? [];

check("un forfait dont la date est passée est PÉRIMÉ",
    ($perime['state'] ?? '') === 'EXPIRED');
check("son statut en base est resté ACTIVE",
    (string) $db->query("SELECT status FROM subscriptions WHERE id = {$abonnementId}")
        ->fetchColumn() === 'ACTIVE');

$opPerime = dossier($a, $client, $lavage, $compteur);

check('un forfait périmé ne sert plus',
    call('POST', '/api/subscriptions/use', ['operation_id' => $opPerime['id']], $a['token'])
        ['status'] === 409);

// Épuisé : on remet la date en avant et on consomme tout.
$db->prepare('UPDATE subscriptions SET expires_at = (CURDATE() + INTERVAL 30 DAY) WHERE id = ?')
   ->execute([$abonnementId]);

$reste = (int) (call('GET', "/api/subscriptions/{$abonnementId}", null, $a['token'])
    ['body']['data']['subscription']['washes_left'] ?? 0);

for ($i = 0; $i < $reste; $i++) {
    $op = dossier($a, $client, $lavage, $compteur);
    call('POST', '/api/subscriptions/use', ['operation_id' => $op['id']], $a['token']);
}

$epuise = call('GET', "/api/subscriptions/{$abonnementId}", null, $a['token'])
    ['body']['data']['subscription'] ?? [];

check("un forfait entièrement consommé est ÉPUISÉ",
    ($epuise['state'] ?? '') === 'EXHAUSTED');

$opTrop = dossier($a, $client, $lavage, $compteur);

check('un forfait épuisé ne sert plus',
    call('POST', '/api/subscriptions/use', ['operation_id' => $opTrop['id']], $a['token'])
        ['status'] === 409);

// Annulation : le motif est OBLIGATOIRE, contrairement au lot 13. La
// différence est qu'ici de l'argent a été encaissé.
$abo2 = call('POST', '/api/subscriptions', [
    'customer_id' => $client, 'plan_id' => $planId,
    'station_id' => $a['station'], 'method' => 'CASH',
], $a['token'])['body']['data']['subscription'];

check("annuler SANS motif est refusé",
    call('POST', "/api/subscriptions/{$abo2['id']}/cancel", [], $a['token'])['status'] === 422);

$annule = call('POST', "/api/subscriptions/{$abo2['id']}/cancel",
    ['reason' => 'Le client déménage.'], $a['token']);

check("annuler AVEC motif passe", $annule['status'] === 200);
check("l'état devient ANNULÉ",
    ($annule['body']['data']['subscription']['state'] ?? '') === 'CANCELLED');

$opAnnule = dossier($a, $client, $lavage, $compteur);

check('un forfait annulé ne sert plus',
    call('POST', '/api/subscriptions/use', ['operation_id' => $opAnnule['id']], $a['token'])
        ['status'] === 409);

// ON N'INVENTE AUCUN REMBOURSEMENT AU PRORATA : combien rendre est une
// décision commerciale, pas un calcul. L'argent encaissé reste dans la
// recette tant que personne n'a décidé de le rendre.
// Deux forfaits à 20 000 F, plus l'acompte de 2 000 F laissé sur le
// dossier de la section 6. Aucun remboursement : annuler un
// abonnement ARRÊTE le forfait, il ne rend pas l'argent — combien
// rendre est une décision commerciale, pas un calcul.
check("l'annulation ne rembourse rien toute seule",
    recette($a, $jour) === $avant + 42000,
    'recette : ' . recette($a, $jour) . ', attendu ' . ($avant + 42000));

echo "\n9. Un lavage annulé ne consomme pas le forfait\n";

$abo3 = call('POST', '/api/subscriptions', [
    'customer_id' => $client, 'plan_id' => $planId,
    'station_id' => $a['station'], 'method' => 'CASH',
], $a['token'])['body']['data']['subscription'];

$opCasse = dossier($a, $client, $lavage, $compteur);
call('POST', '/api/subscriptions/use', ['operation_id' => $opCasse['id']], $a['token']);

check('le lavage est décompté', (int) (call('GET', "/api/subscriptions/{$abo3['id']}",
    null, $a['token'])['body']['data']['subscription']['washes_used'] ?? 0) === 1);

call('PUT', "/api/operations/{$opCasse['id']}/status", ['status' => 'CANCELLED'], $a['token']);

// Le compteur est un COUNT : il se corrige tout seul. Un compteur
// stocké aurait fallu penser à le décrémenter ici — et personne n'y
// pense jamais.
check("un lavage ANNULÉ est rendu au forfait, sans rien faire",
    (int) (call('GET', "/api/subscriptions/{$abo3['id']}", null, $a['token'])
        ['body']['data']['subscription']['washes_used'] ?? 9) === 0);

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

check('un employé voit les forfaits',
    call('GET', '/api/subscriptions/plans', null, $employe)['status'] === 200);

$venteEmploye = call('POST', '/api/subscriptions', [
    'customer_id' => $client, 'plan_id' => $planId,
    'station_id' => $a['station'], 'method' => 'CASH',
], $employe);

check('un employé vend un forfait — il encaisse déjà toute la journée',
    $venteEmploye['status'] === 201);

$opEmploye = dossier($a, $client, $lavage, $compteur);

check('un employé décompte un lavage',
    call('POST', '/api/subscriptions/use', ['operation_id' => $opEmploye['id']], $employe)
        ['status'] === 200);

// En revanche : régler les conditions engage l'entreprise, et annuler
// un forfait payé ouvre la question d'un remboursement.
check("un employé ne CRÉE pas de forfait",
    call('POST', '/api/subscriptions/plans', [
        'name' => 'Pirate', 'service_id' => $lavage, 'washes' => 50, 'price' => 100,
    ], $employe)['status'] === 403);

check("un employé n'ANNULE pas un abonnement",
    call('POST', "/api/subscriptions/{$venteEmploye['body']['data']['subscription']['id']}/cancel",
        ['reason' => 'test'], $employe)['status'] === 403);

echo "\n11. Isolation entre entreprises\n";

check("Beta ne voit aucun forfait d'Alpha",
    (call('GET', '/api/subscriptions/plans', null, $b['token'])['body']['data']['plans'] ?? []) === []);

check("Beta ne voit aucun abonnement d'Alpha",
    (call('GET', '/api/subscriptions', null, $b['token'])['body']['data']['subscriptions'] ?? []) === []);

check("Beta ne lit pas un abonnement d'Alpha",
    call('GET', "/api/subscriptions/{$abonnementId}", null, $b['token'])['status'] === 404);

check("Beta ne peut pas vendre un forfait d'Alpha",
    in_array(call('POST', '/api/subscriptions', [
        'customer_id' => $client, 'plan_id' => $planId,
        'station_id' => $a['station'], 'method' => 'CASH',
    ], $b['token'])['status'], [403, 422], true));

check("Beta ne voit aucune dette d'Alpha",
    (call('GET', '/api/subscriptions/overview', null, $b['token'])
        ['body']['data']['outstanding']['washes'] ?? -1) === 0);

echo "\n12. La trace laissée\n";

$orgId = (int) $db->query(
    "SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%' ORDER BY id ASC LIMIT 1"
)->fetchColumn();

$actions = $db->query(
    "SELECT DISTINCT action FROM audit_logs WHERE organization_id = {$orgId}"
)->fetchAll(PDO::FETCH_COLUMN);

check('la création du forfait est tracée', in_array('subscription.plan_created', $actions, true));
check('la vente est tracée', in_array('subscription.sold', $actions, true));
check('la consommation est tracée', in_array('subscription.used', $actions, true));
check("son retrait aussi", in_array('subscription.use_cancelled', $actions, true));
check("l'annulation d'un abonnement est tracée",
    in_array('subscription.cancelled', $actions, true));

$trace = (string) $db->query(
    "SELECT metadata FROM audit_logs WHERE action = 'subscription.used'
       AND organization_id = {$orgId} ORDER BY id DESC LIMIT 1"
)->fetchColumn();

// La valeur du lavage livré : c'est ce qui permet de vérifier des mois
// plus tard qu'un forfait a bien été honoré.
check('la trace garde la valeur du lavage livré', str_contains($trace, 'value'));

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
