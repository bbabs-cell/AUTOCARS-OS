<?php

declare(strict_types=1);

/**
 * Tests de l'API — rendez-vous
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/api_booking_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - LE PRIX PROMIS AU CLIENT. Un rendez-vous pris à 5 000 F reste à
 *     5 000 F même si le tarif a augmenté depuis : c'est la règle
 *     métier la plus importante de ce lot, et la plus facile à casser
 *     par inadvertance en « simplifiant » la création du dossier.
 *   - QU'AUCUN SMS NE SOIT ENVOYÉ. Même promesse qu'au lot 9 sur les
 *     paiements, et vérifiée de la même façon : par une relecture du
 *     code source, pas par la bonne volonté.
 *   - qu'une absence ne se déclare pas avant l'heure du rendez-vous
 *   - qu'un rendez-vous terminé ne se rouvre ni ne se modifie
 *   - que l'arrivée ouvre un dossier ET solde le rendez-vous, ou
 *     aucun des deux
 *   - qu'une entreprise ne voie pas le carnet d'une autre
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
        'email' => "b-{$sfx}-" . strtolower($name) . "@t.local", 'password' => 'mot-de-passe-de-test',
    ]);
    return [
        'token'   => $r['body']['data']['access_token'] ?? null,
        'station' => $r['body']['data']['user']['station_ids'][0] ?? 0,
        'id'      => $r['body']['data']['user']['id'] ?? 0,
    ];
}

$a = reg('Alpha', $sfx);
$b = reg('Beta', $sfx);

/** Une date/heure relative à maintenant, au format attendu par l'API. */
function at(string $modifier): string {
    return (new DateTimeImmutable())->modify($modifier)->format('Y-m-d H:i');
}

// --- Le décor : une prestation, un client, deux véhicules ----------
$serviceId = call('POST', '/api/services', [
    'name' => 'Lavage standard ' . $sfx, 'price' => 5000, 'duration_minutes' => 30,
], $a['token'])['body']['data']['id'];

$customerId = call('POST', '/api/customers', [
    'first_name' => 'Cheikh', 'last_name' => 'Fall', 'phone' => '+221776112233',
], $a['token'])['body']['data']['id'];

$vehicleId = call('POST', '/api/vehicles', [
    'plate_number' => 'DK-4411-ZZ', 'customer_id' => $customerId,
    'brand' => 'Toyota', 'model' => 'Corolla', 'vehicle_type' => 'CAR',
], $a['token'])['body']['data']['id'];

// Une SECONDE prestation, qui restera active jusqu'au bout : la
// première est retirée du catalogue en section 7, et les sections
// suivantes testeraient ce retrait au lieu de ce qu'elles visent.
$expressService = call('POST', '/api/services', [
    'name' => 'Lavage express ' . $sfx, 'price' => 3000, 'duration_minutes' => 20,
], $a['token'])['body']['data']['id'];

$secondVehicle = call('POST', '/api/vehicles', [
    'plate_number' => 'DK-4412-ZZ', 'customer_id' => $customerId,
    'brand' => 'Toyota', 'model' => 'Hilux', 'vehicle_type' => 'PICKUP',
], $a['token'])['body']['data']['id'];

echo "=== LOT 13 — rendez-vous ===\n\n1. Noter un rendez-vous au téléphone\n";

// Le cas le plus fréquent : un nom, un numéro, une heure. Pas de
// fiche client, pas de véhicule — c'est ce qu'on a au téléphone.
$created = call('POST', '/api/bookings', [
    'customer_name' => 'Moussa Diop',
    'customer_phone' => '+221775998877',
    'service_id' => $serviceId,
    'station_id' => $a['station'],
    'scheduled_at' => at('+2 days 10:00'),
], $a['token']);

check('un rendez-vous se note avec un nom et un numéro', $created['status'] === 201);

$booking = $created['body']['data']['booking'] ?? [];

// `??` traite `null` comme une valeur ABSENTE : écrire
// `($b['customer_id'] ?? 'x') === null` est toujours faux, alors que
// c'est exactement ce qu'on veut vérifier ici. Le piège s'est déjà
// payé deux fois sur ce projet — d'où `array_key_exists`.
check("il n'exige PAS de fiche client",
    array_key_exists('customer_id', $booking) && $booking['customer_id'] === null);
check("il n'exige PAS de véhicule",
    array_key_exists('vehicle_id', $booking) && $booking['vehicle_id'] === null);
check('il est « Prévu »', ($booking['status'] ?? '') === 'SCHEDULED');
check('la durée vient du catalogue', ($booking['duration_minutes'] ?? 0) === 30);
check('le prix vient du catalogue', ($booking['price'] ?? 0) === 5000);
check("l'heure est découpée pour l'écran", ($booking['scheduled_time'] ?? '') === '10:00');

$bookingId = (int) ($booking['id'] ?? 0);

echo "\n2. Ce que le serveur refuse\n";

$past = call('POST', '/api/bookings', [
    'customer_name' => 'Hier', 'customer_phone' => '+221770000001',
    'service_id' => $serviceId, 'station_id' => $a['station'],
    'scheduled_at' => at('-1 day 10:00'),
], $a['token']);

check('un rendez-vous dans le passé est refusé', $past['status'] === 422);

$far = call('POST', '/api/bookings', [
    'customer_name' => 'Dans deux ans', 'customer_phone' => '+221770000002',
    'service_id' => $serviceId, 'station_id' => $a['station'],
    'scheduled_at' => at('+2 years'),
], $a['token']);

check('un rendez-vous à deux ans est refusé', $far['status'] === 422);

$noPhone = call('POST', '/api/bookings', [
    'customer_name' => 'Sans numéro',
    'service_id' => $serviceId, 'station_id' => $a['station'],
    'scheduled_at' => at('+1 day 10:00'),
], $a['token']);

// Sans numéro, on ne peut ni rappeler, ni retrouver le rendez-vous
// quand le client appelle : c'est la seule donnée vraiment
// indispensable après l'heure.
check('un rendez-vous sans téléphone est refusé', $noPhone['status'] === 422);

echo "\n3. La charge d'un créneau : on prévient, on ne refuse pas\n";

// Trois véhicules sur le même créneau, ce qui ressemble à un
// « créneau plein ». Le logiciel ne connaît pas la capacité réelle
// d'une station : il le signale et laisse décider.
$slot = at('+3 days 09:00');

$first = call('POST', '/api/bookings', [
    'customer_name' => 'SENEGAL LOGISTIQUE', 'customer_phone' => '+221338224466',
    'service_id' => $serviceId, 'station_id' => $a['station'], 'scheduled_at' => $slot,
], $a['token']);

$second = call('POST', '/api/bookings', [
    'customer_name' => 'SENEGAL LOGISTIQUE', 'customer_phone' => '+221338224466',
    'service_id' => $serviceId, 'station_id' => $a['station'], 'scheduled_at' => $slot,
], $a['token']);

check('un second véhicule sur le même créneau est ACCEPTÉ', $second['status'] === 201);

// Le même numéro, la même heure, la même station : c'est exactement
// ce qu'une contrainte d'unicité « évidente » aurait refusé. C'est le
// gestionnaire de flotte qui envoie deux voitures.
check('…même avec le même numéro de téléphone (flotte)',
    ($second['body']['data']['booking']['customer_phone'] ?? '') === '+221338224466');

check('mais le serveur PRÉVIENT de la charge',
    ($second['body']['data']['warnings'] ?? []) !== []);

// Un créneau qui ne chevauche rien ne déclenche aucune alerte : une
// alerte permanente n'est plus une alerte.
$quiet = call('POST', '/api/bookings', [
    'customer_name' => 'Créneau calme', 'customer_phone' => '+221770000003',
    'service_id' => $serviceId, 'station_id' => $a['station'],
    'scheduled_at' => at('+4 days 06:30'),
], $a['token']);

$quietWarnings = $quiet['body']['data']['warnings'] ?? [];

check("un créneau libre ne déclenche aucune alerte de charge",
    !in_array(true, array_map(
        static fn (string $w): bool => str_contains($w, 'attendu'),
        $quietWarnings
    ), true));

echo "\n4. Confirmer, annuler, déclarer une absence\n";

$confirmed = call('PUT', "/api/bookings/{$bookingId}/status", ['status' => 'CONFIRMED'], $a['token']);

check('un rendez-vous se confirme', $confirmed['status'] === 200);
check('il porte le nom de qui l\'a confirmé',
    ($confirmed['body']['data']['booking']['outcome_by_name'] ?? '') !== '');

// ==============================================================
// ON NE DÉCLARE PAS UNE ABSENCE AVANT L'HEURE.
// ==============================================================
$tooEarly = call('PUT', "/api/bookings/{$bookingId}/status", ['status' => 'NO_SHOW'], $a['token']);

check('une absence AVANT l\'heure du rendez-vous est refusée', $tooEarly['status'] === 422);

// Un rendez-vous dont l'heure est passée : on l'écrit directement en
// base, l'API refusant (avec raison) de le créer dans le passé.
$overdueId = (int) call('POST', '/api/bookings', [
    'customer_name' => 'Client dépassé', 'customer_phone' => '+221770000004',
    'service_id' => $serviceId, 'station_id' => $a['station'],
    'scheduled_at' => at('+1 hour'),
], $a['token'])['body']['data']['booking']['id'];

$db->prepare('UPDATE bookings SET scheduled_at = (NOW() - INTERVAL 2 HOUR) WHERE id = ?')
   ->execute([$overdueId]);

$noShow = call('PUT', "/api/bookings/{$overdueId}/status",
    ['status' => 'NO_SHOW', 'reason' => 'Injoignable au téléphone.'], $a['token']);

check('une absence APRÈS le délai de grâce est acceptée', $noShow['status'] === 200);
check('elle porte le motif quand il est donné',
    ($noShow['body']['data']['booking']['outcome_reason'] ?? '') !== '');

// Le motif est FACULTATIF : exiger une justification partout apprend
// à taper « x » pour passer l'écran.
$cancelId = (int) call('POST', '/api/bookings', [
    'customer_name' => 'À annuler', 'customer_phone' => '+221770000005',
    'service_id' => $serviceId, 'station_id' => $a['station'],
    'scheduled_at' => at('+5 days 10:00'),
], $a['token'])['body']['data']['booking']['id'];

$cancelled = call('PUT', "/api/bookings/{$cancelId}/status", ['status' => 'CANCELLED'], $a['token']);

check('une annulation SANS motif est acceptée', $cancelled['status'] === 200);

echo "\n5. Les trois fins sont définitives\n";

$reopen = call('PUT', "/api/bookings/{$cancelId}/status", ['status' => 'SCHEDULED'], $a['token']);

check('un rendez-vous annulé ne se rouvre pas', $reopen['status'] === 409);

$editClosed = call('PUT', "/api/bookings/{$cancelId}",
    ['scheduled_at' => at('+6 days 10:00')], $a['token']);

check('un rendez-vous annulé ne se déplace plus', $editClosed['status'] === 409);

$noShowAgain = call('PUT', "/api/bookings/{$overdueId}/status", ['status' => 'CANCELLED'], $a['token']);

check("une absence ne se transforme pas en annulation", $noShowAgain['status'] === 409);

echo "\n6. L'arrivée du client : deux écritures ou aucune\n";

// ARRIVED n'est pas atteignable par la route générique : il ouvre un
// dossier, et un rendez-vous « arrivé » sans dossier serait un
// véhicule pris en charge que personne ne verrait dans la file.
$byGenericRoute = call('PUT', "/api/bookings/{$bookingId}/status", ['status' => 'ARRIVED'], $a['token']);

check("« arrivé » n'est pas atteignable par la route générique",
    $byGenericRoute['status'] === 422);

$noVehicle = call('POST', "/api/bookings/{$bookingId}/arrive", [], $a['token']);

check("l'arrivée sans véhicule est refusée", $noVehicle['status'] === 422);

$arrived = call('POST', "/api/bookings/{$bookingId}/arrive",
    ['vehicle_id' => $vehicleId], $a['token']);

check("l'arrivée ouvre un dossier", $arrived['status'] === 201);

$arrivedBooking  = $arrived['body']['data']['booking'] ?? [];
$arrivedOperation = $arrived['body']['data']['operation'] ?? [];

check('le rendez-vous est soldé', ($arrivedBooking['status'] ?? '') === 'ARRIVED');
check('il pointe vers le dossier ouvert',
    ($arrivedBooking['operation_reference'] ?? '') !== '');
check('le dossier entre dans la file', ($arrivedOperation['status'] ?? '') === 'WAITING');
check('le véhicule est rattaché au rendez-vous',
    ((int) ($arrivedBooking['vehicle_id'] ?? 0)) === (int) $vehicleId);
check('le client aussi, déduit du véhicule',
    ((int) ($arrivedBooking['customer_id'] ?? 0)) === (int) $customerId);

// Le dossier reprend la note du rendez-vous : celui qui ouvre le
// capot doit savoir que la voiture était attendue.
check("le dossier rappelle qu'il vient d'un rendez-vous",
    str_contains((string) ($arrivedOperation['notes'] ?? ''), 'rendez-vous'));

$twice = call('POST', "/api/bookings/{$bookingId}/arrive", ['vehicle_id' => $vehicleId], $a['token']);

check("un rendez-vous déjà arrivé ne rouvre pas un second dossier", $twice['status'] === 409);

echo "\n7. LE PRIX PROMIS EST LE PRIX FACTURÉ\n";

// ==================================================================
// LA RÈGLE MÉTIER LA PLUS IMPORTANTE DU LOT.
// Un client réserve à 5 000 F. Le tarif passe à 9 000 F. Il paie
// 5 000 F : c'est ce qu'on lui a dit au téléphone.
// ==================================================================
$promised = call('POST', '/api/bookings', [
    'customer_name' => 'Client du tarif ancien', 'customer_phone' => '+221770000006',
    'service_id' => $serviceId, 'station_id' => $a['station'],
    'scheduled_at' => at('+7 days 10:00'),
], $a['token'])['body']['data']['booking'];

check('le rendez-vous fige le tarif du jour', ($promised['price'] ?? 0) === 5000);

call('PUT', "/api/services/{$serviceId}", [
    'name' => 'Lavage standard ' . $sfx, 'price' => 9000, 'duration_minutes' => 30,
], $a['token']);

$newPrice = call('GET', "/api/services/{$serviceId}", null, $a['token'])['body']['data']['price'] ?? 0;
check('le tarif du catalogue a bien augmenté', (int) $newPrice === 9000);

$honoured = call('POST', "/api/bookings/{$promised['id']}/arrive",
    ['vehicle_id' => $secondVehicle], $a['token']);

check("le dossier est facturé au prix PROMIS, pas au tarif du jour",
    ((int) ($honoured['body']['data']['operation']['price'] ?? 0)) === 5000,
    'prix appliqué : ' . ($honoured['body']['data']['operation']['price'] ?? '?'));

// Une prestation retirée du catalogue n'annule pas les rendez-vous
// déjà pris : on honore ce qui a été promis.
$pendingId = (int) call('POST', '/api/bookings', [
    'customer_name' => 'Prestation retirée', 'customer_phone' => '+221770000007',
    'service_id' => $serviceId, 'station_id' => $a['station'],
    'scheduled_at' => at('+8 days 10:00'),
], $a['token'])['body']['data']['booking']['id'];

call('PUT', "/api/services/{$serviceId}/status", ['status' => 'INACTIVE'], $a['token']);

$newOnRetired = call('POST', '/api/bookings', [
    'customer_name' => 'Trop tard', 'customer_phone' => '+221770000008',
    'service_id' => $serviceId, 'station_id' => $a['station'],
    'scheduled_at' => at('+9 days 10:00'),
], $a['token']);

check("on ne PREND plus de rendez-vous sur une prestation retirée",
    $newOnRetired['status'] === 422);

$thirdVehicle = call('POST', '/api/vehicles', [
    'plate_number' => 'DK-4413-ZZ', 'customer_id' => $customerId,
    'brand' => 'Toyota', 'model' => 'Yaris', 'vehicle_type' => 'CAR',
], $a['token'])['body']['data']['id'];

$stillHonoured = call('POST', "/api/bookings/{$pendingId}/arrive",
    ['vehicle_id' => $thirdVehicle], $a['token']);

check("mais on HONORE ceux qui étaient déjà pris", $stillHonoured['status'] === 201);

echo "\n8. L'écran d'une journée\n";

$day = call('GET', '/api/bookings?station_id=' . $a['station']
    . '&from=' . (new DateTimeImmutable())->modify('+3 days')->format('Y-m-d')
    . '&to=' . (new DateTimeImmutable())->modify('+3 days')->format('Y-m-d'),
    null, $a['token']);

$dayData = $day['body']['data'] ?? [];

check('la journée se lit en une seule requête', $day['status'] === 200);
check('elle porte les rendez-vous', count($dayData['bookings'] ?? []) >= 2);
check('elle porte le compte par statut', isset($dayData['counts']['SCHEDULED']));
check('tous les statuts sont présents, même à zéro',
    count($dayData['counts'] ?? []) === 5);
check('elle porte la charge heure par heure', ($dayData['load'] ?? []) !== []);

// « À traiter » ignore les bornes de dates : un rendez-vous
// d'avant-hier jamais soldé reste à traiter quand on regarde demain.
//
// Celui de la section 4 a été soldé en absence : il ne compte plus.
// On en laisse donc un ouvert, dans le passé, et on redemande la
// journée de dans trois jours.
$forgottenId = (int) call('POST', '/api/bookings', [
    'customer_name' => 'Jamais soldé', 'customer_phone' => '+221770000011',
    'service_id' => $expressService, 'station_id' => $a['station'],
    'scheduled_at' => at('+1 hour'),
], $a['token'])['body']['data']['booking']['id'];

$db->prepare('UPDATE bookings SET scheduled_at = (NOW() - INTERVAL 3 HOUR) WHERE id = ?')
   ->execute([$forgottenId]);

$dayAgain = call('GET', '/api/bookings?station_id=' . $a['station']
    . '&from=' . (new DateTimeImmutable())->modify('+3 days')->format('Y-m-d')
    . '&to=' . (new DateTimeImmutable())->modify('+3 days')->format('Y-m-d'),
    null, $a['token'])['body']['data'] ?? [];

check("les rendez-vous dépassés remontent hors de la période demandée",
    ($dayAgain['overdue'] ?? []) !== []);

check("…et ils ne sont PAS soldés automatiquement",
    ($dayAgain['overdue'][0]['status'] ?? '') === 'SCHEDULED');

$statuses = call('GET', '/api/bookings/statuses', null, $a['token'])['body']['data'] ?? [];

check('le parcours est exposé au frontend', count($statuses['statuses'] ?? []) === 5);

// Le frontend ne doit PAS proposer « arrivé » comme un simple
// changement de statut : ce bouton-là ouvre un dossier.
$scheduled = null;
foreach ($statuses['statuses'] as $entry) {
    if ($entry['value'] === 'SCHEDULED') { $scheduled = $entry; }
}

check("« arrivé » n'est pas proposé comme un simple statut",
    !in_array('ARRIVED', $scheduled['allowed_next'] ?? [], true));

echo "\n9. Isolation entre entreprises\n";

check("Beta ne voit aucun rendez-vous d'Alpha",
    (call('GET', '/api/bookings?from=2020-01-01&to=2030-12-31', null, $b['token'])
        ['body']['data']['bookings'] ?? []) === []);

check("Beta ne peut pas lire un rendez-vous d'Alpha",
    call('GET', "/api/bookings/{$bookingId}", null, $b['token'])['status'] === 404);

check("Beta ne peut pas modifier un rendez-vous d'Alpha",
    call('PUT', "/api/bookings/{$overdueId}", ['customer_name' => 'Piraté'], $b['token'])
        ['status'] === 404);

check("Beta ne peut pas annuler un rendez-vous d'Alpha",
    call('PUT', "/api/bookings/{$overdueId}/status", ['status' => 'CANCELLED'], $b['token'])
        ['status'] === 404);

check("Beta ne peut pas réserver sur une station d'Alpha",
    in_array(call('POST', '/api/bookings', [
        'customer_name' => 'Intrus', 'customer_phone' => '+221770000009',
        'service_id' => $serviceId, 'station_id' => $a['station'],
        'scheduled_at' => at('+3 days 10:00'),
    ], $b['token'])['status'], [403, 422], true));

echo "\n10. Le carnet est ouvert à tout le comptoir\n";

// Le seul module du produit où les trois rôles peuvent tout faire :
// c'est l'employé qui décroche le téléphone. Voir la note dans
// config/permissions.php.
$employeeEmail = "employe-{$sfx}@t.local";

call('POST', '/api/team', [
    'first_name' => 'Awa', 'last_name' => 'Test', 'email' => $employeeEmail,
    'password' => 'mot-de-passe-de-test', 'role' => 'EMPLOYEE',
    'station_id' => $a['station'],
], $a['token']);

$employeeToken = call('POST', '/api/auth/login', [
    'email' => $employeeEmail, 'password' => 'mot-de-passe-de-test',
])['body']['data']['access_token'] ?? null;

check('un employé lit le carnet',
    call('GET', '/api/bookings', null, $employeeToken)['status'] === 200);

$byEmployee = call('POST', '/api/bookings', [
    'customer_name' => 'Appel reçu au comptoir', 'customer_phone' => '+221770000010',
    'service_id' => $expressService, 'station_id' => $a['station'],
    'scheduled_at' => at('+10 days 10:00'),
], $employeeToken);

check('un employé note un rendez-vous', $byEmployee['status'] === 201);

check('un employé annule un rendez-vous',
    call('PUT', "/api/bookings/{$byEmployee['body']['data']['booking']['id']}/status",
        ['status' => 'CANCELLED'], $employeeToken)['status'] === 200);

echo "\n11. Aucune intégration de messagerie\n";

// ==================================================================
// MÊME PROMESSE QU'AU LOT 9 SUR LES PAIEMENTS.
// Un rappel par SMS suppose un compte opérateur et un budget. Coder
// un envoi « simulé » en attendant donnerait l'illusion d'un produit
// branché — et il faudrait tout défaire le jour venu, après avoir
// peut-être laissé croire à un gérant que ses clients étaient
// prévenus.
// ==================================================================
$sources = '';

foreach (['/src', '/config'] as $directory) {
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator(dirname(__DIR__) . $directory)
    );

    foreach ($iterator as $file) {
        if ($file->isFile() && $file->getExtension() === 'php') {
            $sources .= file_get_contents($file->getPathname());
        }
    }
}

check("aucun envoi de SMS n'est codé",
    !preg_match('/twilio|orange\.sn\/sms|infobip|nexmo|vonage|africastalking/i', $sources));

check("aucun appel HTTP sortant n'a été ajouté",
    !preg_match('/curl_init|fsockopen|stream_socket_client/i', $sources));

$env = file_get_contents(dirname(__DIR__) . '/.env.example') ?: '';

check("aucune clé d'API de messagerie dans .env.example",
    !preg_match('/SMS_|TWILIO|INFOBIP|MESSAGING_/i', $env));

echo "\n12. La trace laissée\n";

$orgId = (int) $db->query(
    "SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%' ORDER BY id ASC LIMIT 1"
)->fetchColumn();

$actions = $db->query(
    "SELECT DISTINCT action FROM audit_logs WHERE organization_id = {$orgId}"
)->fetchAll(PDO::FETCH_COLUMN);

check('la prise de rendez-vous est tracée', in_array('booking.created', $actions, true));
check('le changement de statut est tracé', in_array('booking.status_changed', $actions, true));
check("l'arrivée est tracée", in_array('booking.arrived', $actions, true));

// Le prix honoré est dans la trace : c'est ce qui permet, des mois
// plus tard, d'expliquer pourquoi ce dossier a été facturé moins cher
// que le tarif affiché ce jour-là.
$arrival = (string) $db->query(
    "SELECT metadata FROM audit_logs WHERE action = 'booking.arrived'
       AND organization_id = {$orgId} ORDER BY id DESC LIMIT 1"
)->fetchColumn();

check('la trace de l\'arrivée garde le prix honoré',
    str_contains($arrival, 'price_honoured'));

// --- Ménage --------------------------------------------------------
$orgs = "(SELECT id FROM organizations WHERE slug LIKE '%{$sfx}%')";
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
