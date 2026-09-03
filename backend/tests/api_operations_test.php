<?php

declare(strict_types=1);

/**
 * Tests de l'API — opérations, inspections et restitution
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_operations_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - le parcours complet d'un véhicule, de l'accueil à la remise
 *   - les trois règles qui ne doivent JAMAIS pouvoir être contournées
 *     depuis l'API, même en appelant curl à la main
 *   - le traitement des photos : type réel, ré-encodage, cloisonnement
 *   - la restitution, seul moment où la station se dessaisit du bien
 *     de quelqu'un d'autre
 *
 * Un test d'interface ne suffirait pas : cacher un bouton n'empêche
 * personne d'appeler l'API directement. C'est le serveur qu'on teste.
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

/** Envoi multipart : le seul endroit de l'API qui ne reçoit pas du JSON. */
function upload(string $path, string $file, string $position, ?string $token, string $filename = 'photo.jpg'): array {
    $h = curl_init(API . $path);
    curl_setopt_array($h, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $token !== null ? ['Authorization: Bearer ' . $token] : [],
        CURLOPT_TIMEOUT => 30,
        CURLOPT_POSTFIELDS => [
            'photo'    => new CURLFile($file, mime_content_type($file) ?: 'application/octet-stream', $filename),
            'position' => $position,
        ],
    ]);
    $r = curl_exec($h);
    $s = (int) curl_getinfo($h, CURLINFO_HTTP_CODE);
    curl_close($h);
    return ['status' => $s, 'body' => is_string($r) ? (json_decode($r, true) ?? []) : []];
}

/** Télécharge une photo en renvoyant les octets bruts. */
function fetchRaw(string $path, ?string $token): array {
    $h = curl_init(API . $path);
    curl_setopt_array($h, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => $token !== null ? ['Authorization: Bearer ' . $token] : []]);
    $r = curl_exec($h);
    $s = (int) curl_getinfo($h, CURLINFO_HTTP_CODE);
    $t = (string) curl_getinfo($h, CURLINFO_CONTENT_TYPE);
    curl_close($h);
    return ['status' => $s, 'type' => $t, 'bytes' => is_string($r) ? $r : ''];
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

// ------------------------------------------------------------------
// Jeu de données : un client, son véhicule, une prestation
// ------------------------------------------------------------------
$customerId = call('POST', '/api/customers', [
    'first_name' => 'Ndèye', 'last_name' => 'Sarr', 'phone' => '+221 77 900 11 22',
], $a['token'])['body']['data']['id'];

$vehicleId = call('POST', '/api/vehicles', [
    'plate_number' => 'DK-7788-CC', 'customer_id' => $customerId,
    'brand' => 'Hyundai', 'model' => 'Tucson', 'color' => 'Blanc', 'vehicle_type' => 'SUV',
], $a['token'])['body']['data']['id'];

$serviceId = call('POST', '/api/services', [
    'name' => 'Lavage complet ' . $sfx, 'price' => 5000, 'duration_minutes' => 45,
], $a['token'])['body']['data']['id'];

echo "=== LOT 7 — opérations, inspections, restitution ===\n\n1. Accueil d'un véhicule\n";

$created = call('POST', '/api/operations', [
    'vehicle_id' => $vehicleId, 'service_id' => $serviceId, 'station_id' => $a['station'],
    'notes' => 'Client pressé',
], $a['token']);

check("un dossier s'ouvre", $created['status'] === 201, json_encode($created['body']));

$operation   = $created['body']['data']['operation'] ?? [];
$operationId = (int) ($operation['id'] ?? 0);
$reference   = (string) ($operation['reference'] ?? '');

check("la référence suit le format CODE-AAMM-NNNN",
    preg_match('/^[A-Z0-9]{1,10}-\d{4}-\d{4}$/', $reference) === 1, $reference);
check("le dossier démarre en attente", ($operation['status'] ?? '') === 'WAITING');
check("le PRIX EST FIGÉ à l'ouverture", (int) ($operation['price'] ?? 0) === 5000);
check("le client est déduit du véhicule, pas de la requête",
    (int) ($operation['customer_id'] ?? 0) === $customerId);

// Le prix du catalogue change : le dossier déjà ouvert ne bouge pas.
call('PUT', "/api/services/{$serviceId}", [
    'name' => 'Lavage complet ' . $sfx, 'price' => 9000, 'duration_minutes' => 45,
], $a['token']);

check("changer le tarif ne réécrit PAS le prix d'un dossier ouvert",
    (int) (call('GET', "/api/operations/{$operationId}", null, $a['token'])
        ['body']['data']['operation']['price'] ?? 0) === 5000);

check("un second dossier sur le même véhicule est refusé (409)",
    call('POST', '/api/operations', ['vehicle_id' => $vehicleId, 'service_id' => $serviceId,
        'station_id' => $a['station']], $a['token'])['status'] === 409);

check("un véhicule inexistant est refusé",
    call('POST', '/api/operations', ['vehicle_id' => 999999, 'service_id' => $serviceId,
        'station_id' => $a['station']], $a['token'])['status'] === 422);

// La station de Beta appartient à une autre entreprise : elle doit
// être invisible, pas « interdite ».
check("on ne peut pas ouvrir un dossier dans la station d'une autre entreprise",
    call('POST', '/api/operations', ['vehicle_id' => $vehicleId, 'service_id' => $serviceId,
        'station_id' => $b['station']], $a['token'])['status'] === 422);

echo "\n2. Les règles du parcours, côté serveur\n";

// Ces appels sautent délibérément des étapes : c'est exactement ce
// que ferait quelqu'un appelant l'API sans passer par l'interface.
check("WAITING → WASHING est refusé (409)",
    call('PUT', "/api/operations/{$operationId}/status", ['status' => 'WASHING'], $a['token'])['status'] === 409);

check("un statut inventé est refusé (422)",
    call('PUT', "/api/operations/{$operationId}/status", ['status' => 'PARTI'], $a['token'])['status'] === 422);

check("la restitution ne passe PAS par le changement de statut (403)",
    call('PUT', "/api/operations/{$operationId}/status", ['status' => 'COMPLETED'], $a['token'])['status'] === 403);

$taken = call('PUT', "/api/operations/{$operationId}/status", ['status' => 'IN_PROGRESS'], $a['token']);
check("prise en charge acceptée", $taken['status'] === 200);
check("l'employé qui prend en charge est inscrit sur le dossier",
    ($taken['body']['data']['operation']['assigned_user_id'] ?? null) !== null);
check("le jalon de démarrage est horodaté",
    ($taken['body']['data']['operation']['started_at'] ?? null) !== null);

call('PUT', "/api/operations/{$operationId}/status", ['status' => 'INSPECTION'], $a['token']);

check("INSPECTION → WASHING est BLOQUÉ tant que rien n'est constaté",
    call('PUT', "/api/operations/{$operationId}/status", ['status' => 'WASHING'], $a['token'])['status'] === 409);

echo "\n3. L'inspection d'entrée\n";

check("cocher « dommage » sans le décrire est refusé",
    call('POST', "/api/operations/{$operationId}/inspections",
        ['type' => 'ENTRY', 'has_damage' => true], $a['token'])['status'] === 422);

check("dire « client présent » sans son nom est refusé",
    call('POST', "/api/operations/{$operationId}/inspections",
        ['type' => 'ENTRY', 'customer_present' => true], $a['token'])['status'] === 422);

$inspection = call('POST', "/api/operations/{$operationId}/inspections", [
    'type' => 'ENTRY', 'fuel_level' => 'HALF', 'mileage' => 84500,
    'has_damage' => true, 'damage_notes' => 'Rayure de 10 cm sur la portière arrière droite.',
    'items_left' => 'Siège enfant', 'customer_present' => true, 'signature_name' => 'Ndèye Sarr',
], $a['token']);

check("l'inspection d'entrée s'enregistre", $inspection['status'] === 201, json_encode($inspection['body']));
$inspectionId = (int) ($inspection['body']['data']['inspection']['id'] ?? 0);

check("une seconde inspection d'entrée est refusée (un constat ne se réécrit pas)",
    call('POST', "/api/operations/{$operationId}/inspections", ['type' => 'ENTRY'], $a['token'])['status'] === 409);

// 405 et non 404 : le chemin existe en lecture, c'est le VERBE qui
// n'est pas autorisé. Aucune route PUT ni DELETE n'est déclarée sur
// une inspection, et c'est délibéré — un constat réécrivable après
// coup ne prouverait rien.
check("aucune route ne permet de MODIFIER une inspection",
    call('PUT', "/api/inspections/{$inspectionId}", ['observations' => 'réécrit'], $a['token'])['status'] === 405);
check("aucune route ne permet de SUPPRIMER une inspection",
    call('DELETE', "/api/inspections/{$inspectionId}", null, $a['token'])['status'] === 405);

check("le lavage devient possible une fois l'état constaté",
    call('PUT', "/api/operations/{$operationId}/status", ['status' => 'WASHING'], $a['token'])['status'] === 200);

echo "\n4. Les photos — les preuves\n";

// Une vraie image, produite ici : les tests ne dépendent d'aucun
// fichier extérieur qui pourrait manquer sur une autre machine.
$jpeg = sys_get_temp_dir() . "/autocare-{$sfx}.jpg";
$img  = imagecreatetruecolor(3000, 2000);
imagefilledrectangle($img, 0, 0, 2999, 1999, imagecolorallocate($img, 200, 40, 40));
imagejpeg($img, $jpeg, 92);
imagedestroy($img);

$photo = upload("/api/inspections/{$inspectionId}/photos", $jpeg, 'DAMAGE', $a['token']);
check("une photo s'envoie", $photo['status'] === 201, json_encode($photo['body']));

$photoData = $photo['body']['data']['photo'] ?? [];
$photoId   = (int) ($photoData['id'] ?? 0);

check("l'image est REDIMENSIONNÉE à 2048 px maximum",
    (int) ($photoData['width'] ?? 0) === 2048, 'largeur ' . ($photoData['width'] ?? '?'));
check("la photo pèse moins que l'originale",
    (int) ($photoData['file_size'] ?? PHP_INT_MAX) < (int) filesize($jpeg));
check("l'API ne divulgue PAS le chemin du fichier sur le disque",
    !isset($photoData['file_path']) && str_starts_with((string) ($photoData['url'] ?? ''), '/api/photos/'));

// Un fichier PHP déguisé en image : le cas d'école de l'attaque par
// envoi de fichier. finfo lit le contenu, pas l'extension.
$fake = sys_get_temp_dir() . "/autocare-{$sfx}-piege.jpg";
file_put_contents($fake, "<?php echo 'compromis'; ?>\n" . str_repeat('A', 400));

check("un fichier PHP renommé en .jpg est REFUSÉ",
    upload("/api/inspections/{$inspectionId}/photos", $fake, 'OTHER', $a['token'])['status'] === 422);

// Ré-encodage : le commentaire piégé de l'originale ne doit pas
// survivre dans le fichier stocké.
$tainted = sys_get_temp_dir() . "/autocare-{$sfx}-exif.jpg";
$img2 = imagecreatetruecolor(300, 200);
imagejpeg($img2, $tainted, 90);
imagedestroy($img2);
// On insère une charge dans les métadonnées du JPEG (segment COM).
$bytes = file_get_contents($tainted);
$payload = "<?php system(\$_GET['c']); ?>";
$segment = "\xFF\xFE" . pack('n', strlen($payload) + 2) . $payload;
file_put_contents($tainted, substr($bytes, 0, 2) . $segment . substr($bytes, 2));

$reencoded = upload("/api/inspections/{$inspectionId}/photos", $tainted, 'OTHER', $a['token']);
check("une image porteuse d'une charge dans ses métadonnées est acceptée…",
    $reencoded['status'] === 201);

$storedBytes = fetchRaw('/api/photos/' . (int) ($reencoded['body']['data']['photo']['id'] ?? 0), $a['token']);
check("…mais LE RÉ-ENCODAGE A DÉTRUIT la charge",
    !str_contains($storedBytes['bytes'], $payload) && !str_contains($storedBytes['bytes'], '<?php'));
check("le fichier servi est bien une image WebP",
    str_starts_with($storedBytes['type'], 'image/webp'), $storedBytes['type']);

check("une photo ne se télécharge PAS sans jeton",
    fetchRaw("/api/photos/{$photoId}", null)['status'] === 401);

echo "\n5. Cloisonnement des preuves\n";

check("Beta ne voit pas le dossier d'Alpha",
    call('GET', "/api/operations/{$operationId}", null, $b['token'])['status'] === 404);
check("Beta ne voit pas l'inspection d'Alpha",
    call('GET', "/api/inspections/{$inspectionId}", null, $b['token'])['status'] === 404);
check("Beta ne peut PAS télécharger une photo d'Alpha",
    fetchRaw("/api/photos/{$photoId}", $b['token'])['status'] === 404);
check("Beta ne peut pas ajouter de photo à une inspection d'Alpha",
    upload("/api/inspections/{$inspectionId}/photos", $jpeg, 'FRONT', $b['token'])['status'] === 404);
check("Beta ne peut pas faire avancer le dossier d'Alpha",
    call('PUT', "/api/operations/{$operationId}/status", ['status' => 'QUALITY_CHECK'], $b['token'])['status'] === 404);
check("Beta ne voit aucune opération dans sa liste",
    (call('GET', '/api/operations', null, $b['token'])['body']['data']['operations'] ?? null) === []);

echo "\n6. Le contrôle qualité\n";

check("le contrôle peut RENVOYER au lavage",
    call('PUT', "/api/operations/{$operationId}/status", ['status' => 'QUALITY_CHECK'], $a['token'])['status'] === 200
    && call('PUT', "/api/operations/{$operationId}/status", ['status' => 'WASHING'], $a['token'])['status'] === 200);

call('PUT', "/api/operations/{$operationId}/status", ['status' => 'QUALITY_CHECK'], $a['token']);
$ready = call('PUT', "/api/operations/{$operationId}/status", ['status' => 'READY'], $a['token']);
check("le dossier passe à PRÊT", $ready['status'] === 200);
check("le jalon de fin de prestation est horodaté",
    ($ready['body']['data']['operation']['completed_at'] ?? null) !== null);

echo "\n7. La restitution\n";

$checklist = call('GET', "/api/operations/{$operationId}/release-check", null, $a['token']);
check("la liste de vérification est consultable avant la remise",
    count($checklist['body']['data']['checklist'] ?? []) === 4);
check("elle signale que la prestation n'est pas réglée",
    ($checklist['body']['data']['checklist'][2]['passed'] ?? true) === false);

check("une référence erronée bloque la remise",
    call('POST', "/api/operations/{$operationId}/release",
        ['reference' => 'XXX-0000-0001', 'plate_number' => 'DK-7788-CC'], $a['token'])['status'] === 422);

check("une plaque qui ne correspond pas bloque la remise",
    call('POST', "/api/operations/{$operationId}/release",
        ['reference' => $reference, 'plate_number' => 'DK-0000-ZZ'], $a['token'])['status'] === 422);

check("sans règlement, la remise est refusée (402)",
    call('POST', "/api/operations/{$operationId}/release",
        ['reference' => $reference, 'plate_number' => 'DK-7788-CC'], $a['token'])['status'] === 402);

// Un employé ne peut pas s'autoriser lui-même la dérogation.
$employee = call('POST', '/api/team', [
    'first_name' => 'Aliou', 'last_name' => 'Sow', 'email' => "employe-{$sfx}@t.local",
    'password' => 'mot-de-passe-de-test', 'role' => 'EMPLOYEE', 'station_id' => $a['station'],
], $a['token']);
check("un employé peut être créé pour le test", $employee['status'] === 201, json_encode($employee['body']));

$employeeToken = call('POST', '/api/auth/login', [
    'email' => "employe-{$sfx}@t.local", 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

check("un EMPLOYÉ ne peut pas lever le blocage de paiement (403)",
    call('POST', "/api/operations/{$operationId}/release",
        ['reference' => $reference, 'plate_number' => 'DK-7788-CC',
         'override_reason' => 'le patron a dit oui'], $employeeToken)['status'] === 403);

$released = call('POST', "/api/operations/{$operationId}/release", [
    'reference' => strtolower($reference), // la casse ne doit pas gêner
    'plate_number' => 'dk 7788 cc',        // ni l'écriture de la plaque
    'override_reason' => 'Client habituel, règlement en fin de mois.',
], $a['token']);

check("un RESPONSABLE peut lever le blocage, motif à l'appui", $released['status'] === 200,
    json_encode($released['body']));
check("le dossier est restitué", ($released['body']['data']['operation']['status'] ?? '') === 'COMPLETED');
check("la remise est horodatée",
    ($released['body']['data']['operation']['released_at'] ?? null) !== null);

check("un dossier restitué ne bouge plus (409)",
    call('PUT', "/api/operations/{$operationId}/status", ['status' => 'WASHING'], $a['token'])['status'] === 409);

echo "\n8. La trace laissée\n";

$db = Database::connection();
$trace = $db->prepare(
    "SELECT action, metadata FROM audit_logs
      WHERE entity_type = 'operation' AND entity_id = :id ORDER BY id"
);
$trace->execute(['id' => $operationId]);
$rows = $trace->fetchAll();

$actions = array_column($rows, 'action');

check("l'ouverture du dossier est tracée", in_array('operation.created', $actions, true));
check("chaque changement de statut est tracé",
    count(array_filter($actions, static fn (string $a): bool => $a === 'operation.status_changed')) === 7,
    implode(', ', $actions));
check("la restitution SANS PAIEMENT porte une action distincte",
    in_array('operation.released_unpaid', $actions, true));

$override = array_values(array_filter($rows,
    static fn (array $r): bool => $r['action'] === 'operation.released_unpaid'))[0] ?? [];

check("le motif de la dérogation est conservé nominativement",
    str_contains((string) ($override['metadata'] ?? ''), 'règlement en fin de mois'));

echo "\n9. L'historique du véhicule\n";

$history = call('GET', "/api/vehicles/{$vehicleId}", null, $a['token'])['body']['data']['history'] ?? [];
check("le dossier apparaît dans l'historique du véhicule", count($history) === 1);
check("l'historique porte la référence", ($history[0]['reference'] ?? '') === $reference);

$inspections = call('GET', "/api/vehicles/{$vehicleId}/inspections", null, $a['token']);
check("l'historique des états constatés est consultable",
    count($inspections['body']['data']['inspections'] ?? []) === 1);
check("il compte les photos attachées",
    (int) ($inspections['body']['data']['inspections'][0]['photo_count'] ?? 0) === 2);
check("il rappelle QUI a constaté",
    ($inspections['body']['data']['inspections'][0]['performed_by_name'] ?? '') !== '');

echo "\n10. La machine à états exposée au frontend\n";

$statuses = call('GET', '/api/operations/statuses', null, $a['token']);
check("le frontend reçoit les 8 statuts", count($statuses['body']['data']['statuses'] ?? []) === 8);
check("« statuses » n'est pas confondu avec un identifiant de dossier",
    ($statuses['body']['data']['statuses'][0]['label'] ?? '') === 'En attente');

// ------------------------------------------------------------------
// Ménage : on retire les données du test, dans l'ordre des clés
// étrangères. Les photos écrites sur le disque partent aussi : elles
// n'ont rien à faire dans le dossier de stockage d'un développeur.
// ------------------------------------------------------------------
$paths = $db->query(
    "SELECT p.file_path FROM inspection_photos p
       JOIN inspections i ON i.id = p.inspection_id
      WHERE i.operation_id = {$operationId}"
)->fetchAll();

foreach ($paths as $row) {
    $file = dirname(__DIR__) . '/storage/uploads/' . $row['file_path'];
    if (is_file($file)) { unlink($file); }
}

foreach (['inspection_photos', 'inspections', 'operations', 'vehicles', 'customers',
          'audit_logs', 'refresh_tokens', 'station_users', 'services', 'users', 'stations'] as $table) {
    $db->exec("DELETE FROM {$table} WHERE organization_id IN
               (SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%')");
}
$db->exec("DELETE FROM organizations WHERE slug LIKE '%{$sfx}%'");

@unlink($jpeg);
@unlink($fake);
@unlink($tainted);

echo "\n" . str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
