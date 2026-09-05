<?php

declare(strict_types=1);

/**
 * Tests de l'API par HTTP réel
 * ==================================================================
 * Usage :
 *
 *   1) dans un terminal :  php -S localhost:8000 -t public router.php
 *   2) dans un autre    :  php tests/api_test.php
 *
 * POURQUOI DES TESTS PAR HTTP, PUISQU'ON TESTE DÉJÀ LES CLASSES ?
 *
 * Parce que les tests unitaires vérifient les pièces, pas la chaîne.
 * Ici on passe par le vrai routeur, le vrai middleware, les vraies
 * permissions et les vrais jetons — exactement comme le ferait un
 * attaquant avec curl, sans jamais ouvrir le navigateur.
 *
 * C'est le seul niveau où l'on peut prouver qu'un employé ne peut pas
 * créer une prestation, ou qu'une entreprise ne voit pas le catalogue
 * d'une autre, MÊME en fabriquant la requête à la main.
 */

use Autocare\Core\Database;
use Autocare\Core\Env;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

const API = 'http://127.0.0.1:8000';

$passed = 0;
$failed = 0;

function check(string $description, bool $condition, string $detail = ''): void
{
    global $passed, $failed;

    if ($condition) {
        $passed++;
        echo "  [OK]     {$description}\n";
    } else {
        $failed++;
        echo "  [ÉCHEC]  {$description}" . ($detail !== '' ? " — {$detail}" : '') . "\n";
    }
}

/**
 * Appel HTTP. Retourne le code et le corps décodé.
 *
 * @param array<string,mixed>|null $body
 * @return array{status:int, body:array<string,mixed>}
 */
function call(string $method, string $path, ?array $body = null, ?string $token = null): array
{
    $handle = curl_init(API . $path);

    $headers = ['Content-Type: application/json'];

    if ($token !== null) {
        $headers[] = 'Authorization: Bearer ' . $token;
    }

    curl_setopt_array($handle, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 10,
    ]);

    if ($body !== null) {
        curl_setopt($handle, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }

    $response = curl_exec($handle);
    $status   = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);

    curl_close($handle);

    return [
        'status' => $status,
        'body'   => is_string($response) ? (json_decode($response, true) ?? []) : [],
    ];
}

echo "=== AUTOCARE OS — tests de l'API ===\n\n";

// Le serveur tourne-t-il ?
if (call('GET', '/api/health')['status'] === 0) {
    echo "[ARRÊT] L'API ne répond pas sur " . API . "\n\n";
    echo "        Démarre-la dans un autre terminal :\n";
    echo "          php -S localhost:8000 -t public router.php\n";
    exit(1);
}

// ==================================================================
// Préparation : deux entreprises, chacune avec son gérant
// ==================================================================

$connection = Database::connection();
$suffix     = bin2hex(random_bytes(4));

/** @return array{token:string, email:string, station_id:int} */
function registerCompany(string $name, string $suffix): array
{
    $email = "gerant-{$suffix}-" . mb_strtolower(substr($name, 0, 3)) . '@test.local';

    $response = call('POST', '/api/auth/register', [
        'organization_name' => $name . ' ' . $suffix,
        'first_name'        => 'Gerant',
        'last_name'         => $name,
        'email'             => $email,
        'password'          => 'un-mot-de-passe-de-test',
    ]);

    if ($response['status'] !== 201) {
        echo "[ARRÊT] Inscription impossible : " . json_encode($response['body']) . "\n";
        exit(1);
    }

    return [
        'token'      => $response['body']['data']['access_token'],
        'email'      => $email,
        'station_id' => $response['body']['data']['user']['station_ids'][0],
    ];
}

$alpha = registerCompany('Alpha', $suffix);
$beta  = registerCompany('Beta', $suffix);

// ==================================================================
echo "1. Installation guidée\n";
// ==================================================================

$status = call('GET', '/api/onboarding/status', null, $alpha['token']);

check("le statut d'installation est accessible", $status['status'] === 200);
check("l'installation n'est pas encore terminée", $status['body']['data']['completed'] === false);
check("une station a été créée à l'inscription", $status['body']['data']['station'] !== null);
check("aucune prestation au départ", $status['body']['data']['services_count'] === 0);

// Terminer sans catalogue doit être refusé : le gérant arriverait sur
// un produit dans lequel il ne peut rien faire.
$tooEarly = call('POST', '/api/onboarding/complete', null, $alpha['token']);
check("terminer sans prestation est refusé", $tooEarly['status'] === 422);

// ==================================================================
echo "\n2. Station\n";
// ==================================================================

$updated = call('PUT', '/api/stations/' . $alpha['station_id'], [
    'name'      => 'Station Dakar Plateau',
    'code'      => 'DKP',
    'address'   => 'Avenue Léopold Sédar Senghor',
    'city'      => 'Dakar',
    'phone'     => '+221338211234',
    'opens_at'  => '07:30',
    'closes_at' => '20:00',
], $alpha['token']);

check("la station se met à jour", $updated['status'] === 200);
check("le nom est enregistré", ($updated['body']['data']['name'] ?? '') === 'Station Dakar Plateau');
check("les horaires reviennent au format HH:MM", ($updated['body']['data']['opens_at'] ?? '') === '07:30');

$badCode = call('PUT', '/api/stations/' . $alpha['station_id'], [
    'name' => 'Test', 'code' => 'code invalide !',
], $alpha['token']);

check("un code de station invalide est refusé", $badCode['status'] === 422);

// ==================================================================
echo "\n3. Prestations\n";
// ==================================================================

$created = call('POST', '/api/services', [
    'name'             => 'Lavage premium',
    'description'      => 'Extérieur, intérieur, cire.',
    'category'         => 'Lavage',
    'price'            => 10000,
    'duration_minutes' => 60,
], $alpha['token']);

check("une prestation se crée", $created['status'] === 201);

$serviceId = $created['body']['data']['id'] ?? 0;

check("le prix est bien un entier", ($created['body']['data']['price'] ?? null) === 10000);

$duplicate = call('POST', '/api/services', [
    'name' => 'Lavage premium', 'price' => 5000, 'duration_minutes' => 30,
], $alpha['token']);

check("deux prestations de même nom sont refusées", $duplicate['status'] === 422);

$badPrice = call('POST', '/api/services', [
    'name' => 'Prix douteux', 'price' => '10 000 FCFA', 'duration_minutes' => 30,
], $alpha['token']);

check("un prix mal formaté est refusé", $badPrice['status'] === 422);

// Désactivation plutôt que suppression : l'historique doit rester
// lisible même quand une prestation n'est plus proposée.
$toggled = call('PUT', "/api/services/{$serviceId}/status", null, $alpha['token']);

check("une prestation se désactive", ($toggled['body']['data']['status'] ?? '') === 'INACTIVE');

call('PUT', "/api/services/{$serviceId}/status", null, $alpha['token']);

// ==================================================================
echo "\n4. ISOLATION AU NIVEAU HTTP\n";
// ==================================================================
// Le test le plus important de ce lot : jusqu'ici l'isolation était
// prouvée au niveau des dépôts. On la vérifie maintenant de bout en
// bout, avec de vrais jetons et de vraies requêtes.

$betaServices = call('GET', '/api/services', null, $beta['token']);

check(
    "Beta ne voit AUCUNE prestation d'Alpha",
    ($betaServices['body']['data'] ?? []) === []
);

$stolen = call('GET', "/api/services/{$serviceId}", null, $beta['token']);

check(
    "Beta ne peut pas lire une prestation d'Alpha par son identifiant",
    $stolen['status'] === 404,
    "reçu {$stolen['status']}"
);

$hijack = call('PUT', "/api/services/{$serviceId}", [
    'name' => 'Piraté', 'price' => 1, 'duration_minutes' => 1,
], $beta['token']);

check("Beta ne peut pas modifier une prestation d'Alpha", $hijack['status'] === 404);

$stillFine = call('GET', "/api/services/{$serviceId}", null, $alpha['token']);

check(
    "la prestation d'Alpha est intacte après ces tentatives",
    ($stillFine['body']['data']['name'] ?? '') === 'Lavage premium'
);

$betaStation = call('GET', '/api/stations/' . $alpha['station_id'], null, $beta['token']);

check("Beta ne peut pas lire la station d'Alpha", $betaStation['status'] === 404);

// ==================================================================
echo "\n5. Permissions vérifiées par l'API\n";
// ==================================================================

// Alpha ajoute un employé, puis on se connecte AVEC ce compte pour
// vérifier que ses droits sont réellement limités côté serveur.
$employeeEmail = "employe-{$suffix}@test.local";

$addMember = call('POST', '/api/team', [
    'first_name' => 'Aliou',
    'last_name'  => 'Sow',
    'email'      => $employeeEmail,
    'password'   => 'mot-de-passe-employe',
    'role'       => 'EMPLOYEE',
    'station_id' => $alpha['station_id'],
], $alpha['token']);

check("un employé peut être ajouté à l'équipe", $addMember['status'] === 201);

$employeeLogin = call('POST', '/api/auth/login', [
    'email' => $employeeEmail, 'password' => 'mot-de-passe-employe',
]);

check("l'employé peut se connecter", $employeeLogin['status'] === 200);
check("son rôle est bien EMPLOYEE", ($employeeLogin['body']['data']['user']['role'] ?? '') === 'EMPLOYEE');

$employeeToken = $employeeLogin['body']['data']['access_token'] ?? '';

check(
    "l'employé PEUT lire le catalogue",
    call('GET', '/api/services', null, $employeeToken)['status'] === 200
);

// Le point essentiel : même en fabriquant la requête à la main,
// l'employé ne peut pas créer de prestation. Cacher le bouton dans
// Angular n'aurait rien empêché.
$forbidden = call('POST', '/api/services', [
    'name' => 'Prestation interdite', 'price' => 1000, 'duration_minutes' => 10,
], $employeeToken);

check("l'employé NE PEUT PAS créer une prestation (403)", $forbidden['status'] === 403);

check(
    "l'employé NE PEUT PAS ajouter un membre d'équipe (403)",
    call('POST', '/api/team', [
        'first_name' => 'X', 'last_name' => 'Y', 'email' => "x-{$suffix}@test.local",
        'password' => 'mot-de-passe-long', 'role' => 'ADMIN', 'station_id' => $alpha['station_id'],
    ], $employeeToken)['status'] === 403
);

check(
    "l'employé NE PEUT PAS modifier la station (403)",
    call('PUT', '/api/stations/' . $alpha['station_id'], [
        'name' => 'Renommée', 'code' => 'XXX',
    ], $employeeToken)['status'] === 403
);

check(
    "sans jeton, tout est refusé (401)",
    call('GET', '/api/services')['status'] === 401
);

// ==================================================================
echo "\n6. Fin de l'installation\n";
// ==================================================================

$complete = call('POST', '/api/onboarding/complete', null, $alpha['token']);

check("l'installation se termine une fois le catalogue rempli", $complete['status'] === 200);

$after = call('GET', '/api/onboarding/status', null, $alpha['token']);

check("le statut passe à « terminé »", $after['body']['data']['completed'] === true);

$profile = call('GET', '/api/auth/me', null, $alpha['token']);

check(
    "le profil indique que l'installation est terminée",
    ($profile['body']['data']['onboarding_completed'] ?? null) === true
);

// ==================================================================
echo "\n7. Ce que l'API répond quand la route n'existe pas\n";
// ==================================================================
// Ces deux messages sont les seuls du produit qu'aucun écran ne met
// en forme : ils sortent bruts, dans la console d'un développeur ou
// dans un journal. Ils doivent quand même dire quoi que ce soit
// d'utile — et le dire en français correct.

$unknown = call('GET', '/api/inconnue', null, $alpha['token']);

check("une route inconnue répond 404", $unknown['status'] === 404);
check("elle nomme la route demandée",
    str_contains($unknown['body']['message'] ?? '', '/api/inconnue'));

// 405 et non 404 : le chemin EXISTE, c'est le verbe qui ne convient
// pas. Répondre 404 enverrait chercher une faute de frappe dans une
// URL parfaitement correcte.
$wrongMethod = call('DELETE', '/api/health');

check("un verbe non autorisé répond 405, pas 404", $wrongMethod['status'] === 405);
check("le message est en français correct, accents compris",
    str_contains($wrongMethod['body']['message'] ?? '', 'méthode')
    && str_contains($wrongMethod['body']['message'] ?? '', 'autorisée'));

check("aucune trace de PHP ne fuit dans la réponse",
    !str_contains(json_encode($unknown['body']) ?: '', 'Autocare\\'));

// ==================================================================
// Nettoyage : on retire les entreprises créées par ce test.
// ==================================================================
$connection->exec("DELETE FROM audit_logs WHERE organization_id IN
    (SELECT id FROM organizations WHERE slug LIKE '%{$suffix}%')");
$connection->exec("DELETE FROM refresh_tokens WHERE organization_id IN
    (SELECT id FROM organizations WHERE slug LIKE '%{$suffix}%')");
$connection->exec("DELETE FROM station_users WHERE organization_id IN
    (SELECT id FROM organizations WHERE slug LIKE '%{$suffix}%')");
$connection->exec("DELETE FROM services WHERE organization_id IN
    (SELECT id FROM organizations WHERE slug LIKE '%{$suffix}%')");
$connection->exec("DELETE FROM users WHERE organization_id IN
    (SELECT id FROM organizations WHERE slug LIKE '%{$suffix}%')");
$connection->exec("DELETE FROM stations WHERE organization_id IN
    (SELECT id FROM organizations WHERE slug LIKE '%{$suffix}%')");
$connection->exec("DELETE FROM organizations WHERE slug LIKE '%{$suffix}%'");

echo "\n" . str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
