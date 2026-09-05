<?php

declare(strict_types=1);

/**
 * Tests de l'audit de sécurité (lot 21)
 * ==================================================================
 * CE FICHIER EXISTE PARCE QUE L'AUDIT A TROUVÉ CES CHOSES-LÀ.
 * ==================================================================
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/security_audit_test.php
 *
 * Les tests de `security_test.php` vérifient les règles POSÉES aux
 * lots 4 et suivants — isolation, permissions, jetons. Ceux-ci
 * vérifient les défauts TROUVÉS en attaquant l'API du lot 21, et leur
 * correction.
 *
 * Ils sont séparés exprès : le jour où quelqu'un relira ce dépôt, la
 * différence entre « ce qu'on a conçu » et « ce qu'on a découvert »
 * est une information utile.
 *
 * Rapport complet : docs/audit-securite.md
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

/** Renvoie le corps ET les en-têtes : plusieurs défauts se lisent dans les en-têtes. */
function call(string $m, string $p, ?array $b = null, ?string $t = null, array $extra = []): array {
    $h  = curl_init(API . $p);
    $hd = array_merge(['Content-Type: application/json'], $extra);

    if ($t !== null) { $hd[] = 'Authorization: Bearer ' . $t; }

    curl_setopt_array($h, [CURLOPT_CUSTOMREQUEST => $m, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $hd, CURLOPT_TIMEOUT => 20, CURLOPT_HEADER => true]);

    if ($b !== null) { curl_setopt($h, CURLOPT_POSTFIELDS, json_encode($b, JSON_UNESCAPED_UNICODE)); }

    $r    = curl_exec($h);
    $size = (int) curl_getinfo($h, CURLINFO_HEADER_SIZE);
    $s    = (int) curl_getinfo($h, CURLINFO_HTTP_CODE);
    curl_close($h);

    return [
        'status'  => $s,
        'headers' => substr((string) $r, 0, $size),
        'body'    => json_decode(substr((string) $r, $size), true) ?? [],
    ];
}

if (call('GET', '/api/health')['status'] === 0) {
    echo "[ARRÊT] L'API ne répond pas sur " . API . "\n";
    exit(1);
}

$sfx = bin2hex(random_bytes(4));
$db  = Database::connection();

function reg(string $name, string $sfx): array {
    $email = "audit-{$sfx}-" . strtolower($name) . '@t.local';
    $r = call('POST', '/api/auth/register', [
        'organization_name' => "{$name} {$sfx}", 'first_name' => 'G', 'last_name' => $name,
        'email' => $email, 'password' => 'mot-de-passe-de-test',
    ]);
    return [
        'token'   => $r['body']['data']['access_token'] ?? null,
        'station' => $r['body']['data']['user']['station_ids'][0] ?? 0,
        'id'      => $r['body']['data']['user']['id'] ?? 0,
        'org'     => $r['body']['data']['user']['organization_id'] ?? 0,
        'email'   => $email,
    ];
}

$a = reg('Alpha', $sfx);
$b = reg('Beta', $sfx);

echo "=== LOT 21 — ce que l'audit a trouvé ===\n\n";
echo "1. Les réponses authentifiées ne se mettent pas en cache\n";

// TROUVÉ : aucune réponse ne portait d'en-tête de cache. Sur le poste
// PARTAGÉ d'un comptoir, la liste des clients et la recette du jour
// restaient dans le cache disque du navigateur après déconnexion.
$listing = call('GET', '/api/customers', null, $a['token']);

check('la liste des clients porte « no-store »',
    stripos($listing['headers'], 'Cache-Control: no-store') !== false,
    'en-têtes : ' . trim(preg_replace('/\s+/', ' ', $listing['headers']) ?? ''));

check('même chose sur une réponse qui contient de l\'argent',
    stripos(call('GET', '/api/payments', null, $a['token'])['headers'],
        'Cache-Control: no-store') !== false);

// L'EXCEPTION EST VOULUE : une photo d'inspection peut rester dans le
// navigateur de l'employé (« private »), jamais dans un cache partagé.
// La recharger à chaque ouverture d'un dossier coûterait cher sur une
// connexion lente.
$photo = $db->query('SELECT id FROM inspection_photos LIMIT 1')->fetchColumn();

if ($photo !== false) {
    $served = call('GET', "/api/photos/{$photo}", null, $a['token']);

    check("une photo d'une AUTRE entreprise reste introuvable", $served['status'] === 404);
}

echo "\n2. « Mot de passe oublié » est limité en débit\n";

// TROUVÉ : la connexion était limitée depuis le lot 4, pas celle-ci.
// Six appels fabriquaient six jetons VALIDES et six messages.
$db->prepare("DELETE FROM audit_logs WHERE action LIKE 'auth.password_reset%'
               AND user_id = :id")->execute(['id' => $a['id']]);
$db->prepare('DELETE FROM password_resets WHERE user_id = :id')->execute(['id' => $a['id']]);

$codes = [];

for ($i = 0; $i < 6; $i++) {
    $codes[] = call('POST', '/api/auth/forgot-password', ['email' => $a['email']])['status'];
}

$statement = $db->prepare('SELECT COUNT(*) FROM password_resets WHERE user_id = :id');
$statement->execute(['id' => $a['id']]);
$tokens = (int) $statement->fetchColumn();

check('six demandes ne fabriquent plus six jetons', $tokens <= 3, "jetons créés : {$tokens}");

// LE REFUS EST SILENCIEUX, ET C'EST LE POINT LE PLUS IMPORTANT.
// Répondre « trop de demandes » distinguerait une adresse connue
// d'une adresse inconnue — l'énumération que la réponse unique de
// cette route existe précisément pour empêcher.
check('les six réponses sont identiques (aucun oracle)',
    count(array_unique($codes)) === 1 && $codes[0] === 200,
    implode(' ', $codes));

$inconnue = call('POST', '/api/auth/forgot-password', ['email' => "personne-{$sfx}@t.local"]);
$connue   = call('POST', '/api/auth/forgot-password', ['email' => $a['email']]);

check("une adresse inconnue reçoit la même réponse qu'une adresse limitée",
    $inconnue['status'] === $connue['status']
    && ($inconnue['body']['message'] ?? '') === ($connue['body']['message'] ?? ''));

echo "\n3. Un jeton de session rejoué ferme TOUTES les sessions\n";

// TROUVÉ : un jeton de rafraîchissement déjà consommé recevait un
// simple 401. Or s'il réapparaît, le porteur légitime a forcément
// reçu le suivant : celui qui présente celui-ci en a une COPIE.
function loginRaw(string $email): string {
    $h = curl_init(API . '/api/auth/login');
    curl_setopt_array($h, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true, CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode(['email' => $email, 'password' => 'mot-de-passe-de-test'])]);
    $r = curl_exec($h);
    curl_close($h);

    preg_match('/autocare_refresh=([a-f0-9]+)/', (string) $r, $m);

    return $m[1] ?? '';
}

$vole = loginRaw($b['email']);

check('la connexion pose bien un cookie de session', $vole !== '');

$rotation = call('POST', '/api/auth/refresh', null, null, ["Cookie: autocare_refresh={$vole}"]);
preg_match('/autocare_refresh=([a-f0-9]+)/', $rotation['headers'], $m);
$legitime = $m[1] ?? '';

check('la rotation renouvelle la session', $rotation['status'] === 200);
check('elle délivre un jeton DIFFÉRENT', $legitime !== '' && $legitime !== $vole);

$rejeu = call('POST', '/api/auth/refresh', null, null, ["Cookie: autocare_refresh={$vole}"]);

check("rejouer l'ancien jeton échoue", $rejeu['status'] === 401);

// LA CORRECTION EST ICI : le jeton du porteur légitime meurt aussi.
// On ne sait pas lequel des deux est l'imposteur ; on ferme tout, et
// l'utilisateur se reconnecte.
$apres = call('POST', '/api/auth/refresh', null, null, ["Cookie: autocare_refresh={$legitime}"]);

check('le rejeu ferme AUSSI la session légitime', $apres['status'] === 401,
    'reçu ' . $apres['status']);

$trace = $db->prepare("SELECT COUNT(*) FROM audit_logs
                        WHERE action = 'auth.refresh_reuse_detected' AND user_id = :id");
$trace->execute(['id' => $b['id']]);

check('le rejeu laisse une trace nominative', (int) $trace->fetchColumn() > 0);

echo "\n4. Ce que l'audit a VÉRIFIÉ sans rien trouver\n";

// Ces contrôles n'ont rien corrigé. Ils sont là pour que la
// prochaine relecture n'ait pas à les refaire — et pour qu'une
// régression les rallume.
$intrus = call('POST', '/api/customers', [
    'first_name' => 'Intrus', 'last_name' => 'Test', 'phone' => '770000199',
    // On tente d'écrire chez le voisin par le formulaire.
    'organization_id' => $b['org'],
    'id' => 424242,
], $a['token']);

$created = (int) ($intrus['body']['data']['id'] ?? 0);
$owner   = $db->prepare('SELECT organization_id FROM customers WHERE id = :id');
$owner->execute(['id' => $created]);

check("« organization_id » envoyé par le formulaire est ignoré",
    (int) $owner->fetchColumn() === (int) $a['org']);
check("« id » envoyé par le formulaire est ignoré", $created !== 424242);

$employe = call('POST', '/api/team', [
    'first_name' => 'Emp', 'last_name' => 'Loye', 'email' => "emp-{$sfx}@t.local",
    'password' => 'mot-de-passe-de-test', 'role' => 'EMPLOYEE', 'station_id' => $a['station'],
], $a['token']);

$employeId  = (int) ($employe['body']['data']['id'] ?? 0);
$employeTok = call('POST', '/api/auth/login', [
    'email' => "emp-{$sfx}@t.local", 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

check("un employé ne peut pas se promouvoir administrateur",
    call('PUT', "/api/team/{$employeId}", ['role' => 'ADMIN', 'status' => 'ACTIVE'],
        $employeTok)['status'] === 403);

call('PUT', "/api/team/{$employeId}", ['role' => 'EMPLOYEE', 'status' => 'DISABLED'], $a['token']);

check("le jeton d'un compte désactivé cesse de fonctionner à la seconde",
    call('GET', '/api/operations', null, $employeTok)['status'] === 401);

// L'injection reste bloquée par les requêtes préparées. Le terme
// ci-dessous contient les chiffres « 11 » : la recherche par
// téléphone peut donc légitimement remonter une ligne. On vérifie ce
// qui compte — que la table est toujours là et que rien d'une autre
// entreprise n'est renvoyé.
$injection = call('GET', '/api/customers?search=' . urlencode("x' OR '1'='1"), null, $b['token']);

check("une charge d'injection SQL ne casse rien", $injection['status'] === 200);
check("et ne fait fuir aucune donnée d'une autre entreprise",
    array_reduce($injection['body']['data'] ?? [], static function (bool $ok, array $row) use ($db, $b): bool {
        $s = $db->prepare('SELECT organization_id FROM customers WHERE id = :id');
        $s->execute(['id' => $row['id']]);

        return $ok && (int) $s->fetchColumn() === (int) $b['org'];
    }, true));

check("la table des clients est toujours là",
    (int) $db->query('SELECT COUNT(*) FROM customers')->fetchColumn() > 0);

$entetes = call('GET', '/api/health')['headers'];

foreach (['X-Content-Type-Options: nosniff', 'X-Frame-Options: DENY',
          'Referrer-Policy: no-referrer'] as $entete) {
    check("en-tête « {$entete} »", stripos($entetes, $entete) !== false);
}

check("PHP n'annonce pas sa version", stripos($entetes, 'X-Powered-By') === false);

// ------------------------------------------------------------------
// Nettoyage
// ------------------------------------------------------------------
foreach ([$a['org'], $b['org']] as $org) {
    foreach ([
        'audit_logs', 'password_resets', 'refresh_tokens', 'operations',
        'vehicles', 'customers', 'services', 'station_users', 'stations',
        'users', 'organizations',
    ] as $table) {
        try {
            $column = in_array($table, ['refresh_tokens', 'password_resets'], true)
                ? 'user_id IN (SELECT id FROM users WHERE organization_id = :id)'
                : ($table === 'organizations' ? 'id = :id' : 'organization_id = :id');

            $db->prepare("DELETE FROM {$table} WHERE {$column}")->execute(['id' => $org]);
        } catch (Throwable) {
            // Une dépendance déjà nettoyée n'est pas une erreur.
        }
    }
}

echo "\n" . str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
