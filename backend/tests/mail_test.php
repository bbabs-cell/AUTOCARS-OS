<?php

declare(strict_types=1);

/**
 * Tests du courrier (lot 19)
 * ------------------------------------------------------------------
 * Usage :
 *   1) php -S localhost:8000 -t public router.php
 *   2) php tests/mail_test.php
 *
 * CE QUE CES TESTS PROTÈGENT :
 *
 *   - QUE LE LIEN DE RÉINITIALISATION PARTE VRAIMENT. Pendant quinze
 *     lots, le parcours « mot de passe oublié » a fonctionné à
 *     moitié : jeton généré, stocké, vérifié — et rien d'envoyé.
 *     C'est le genre de trou qu'aucun test ne voyait, parce qu'aucun
 *     test ne regardait la sortie.
 *   - qu'un échec d'envoi ne change RIEN à la réponse de l'API :
 *     elle est volontairement identique que le compte existe ou non,
 *     et une erreur affichée trahirait ce qu'on cherche à taire
 *   - qu'un changement de mot de passe réussi prévienne le
 *     propriétaire du compte — le seul signal que reçoit une victime
 *     dont la messagerie a été détournée
 *   - qu'aucun message ne parte vers une adresse invalide
 */

use Autocare\Core\Env;
use Autocare\Core\Mailer;

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

function call(string $m, string $p, ?array $b = null): array {
    $h = curl_init(API . $p);
    curl_setopt_array($h, [CURLOPT_CUSTOMREQUEST => $m, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_TIMEOUT => 20]);
    if ($b !== null) { curl_setopt($h, CURLOPT_POSTFIELDS, json_encode($b, JSON_UNESCAPED_UNICODE)); }
    $r = curl_exec($h);
    $s = (int) curl_getinfo($h, CURLINFO_HTTP_CODE);
    curl_close($h);
    return ['status' => $s, 'body' => is_string($r) ? (json_decode($r, true) ?? []) : []];
}

$logFile = dirname(__DIR__) . '/storage/logs/mail.log';

echo "=== LOT 19 — le courrier ===\n\n1. Le transport de développement\n";

// On repart d'un fichier vide pour lire sans ambiguïté ce que ce
// test a produit.
@unlink($logFile);

$sujet = 'Sujet de test ' . bin2hex(random_bytes(3));

check('un message est accepté', Mailer::send('gerant@station.test', $sujet, 'Corps du message.'));
check('le fichier de journal est créé', is_file($logFile));

$contenu = is_file($logFile) ? (string) file_get_contents($logFile) : '';

check('le destinataire y figure', str_contains($contenu, 'gerant@station.test'));
check('le sujet y figure', str_contains($contenu, $sujet));
check('le corps y figure', str_contains($contenu, 'Corps du message.'));

// Le fichier contient des liens de réinitialisation : de quoi
// prendre la main sur un compte. Il n'a rien à faire dans le dossier
// exposé au web, ni dans Git.
check("le journal est hors du dossier public",
    !str_contains(realpath($logFile) ?: '', '/public/'));

echo "\n2. Ce que le courrier REFUSE\n";

check('une adresse invalide est refusée', !Mailer::send('pas-une-adresse', 'X', 'Y'));
check('une adresse vide est refusée', !Mailer::send('', 'X', 'Y'));
check("rien n'a été écrit pour ces deux tentatives",
    substr_count((string) file_get_contents($logFile), 'Sujet : X') === 0);

echo "\n3. Le lien de réinitialisation part vraiment\n";

if (call('GET', '/api/health')['status'] === 0) {
    echo "  [IGNORÉ] L'API ne répond pas : la suite demande le serveur.\n";
} else {
    $sfx   = bin2hex(random_bytes(4));
    $email = "oubli-{$sfx}@t.local";

    $inscription = call('POST', '/api/auth/register', [
        'organization_name' => "Oubli {$sfx}", 'first_name' => 'G', 'last_name' => 'Oubli',
        'email' => $email, 'password' => 'mot-de-passe-de-test',
    ]);

    check("le compte de test est créé", $inscription['status'] === 201,
        (string) $inscription['status']);

    @unlink($logFile);

    $demande = call('POST', '/api/auth/forgot-password', ['email' => $email]);

    check('la demande est acceptée', $demande['status'] === 200);

    $journal = is_file($logFile) ? (string) file_get_contents($logFile) : '';

    check("un message est parti vers l'adresse demandée", str_contains($journal, $email));
    check('il contient un lien de réinitialisation', str_contains($journal, 'reset-password?token='));
    check("il dit que le lien ne vaut qu'une heure et qu'une fois",
        str_contains($journal, 'une heure') && str_contains($journal, 'une fois'));

    // ==============================================================
    // LA RÉPONSE EST LA MÊME POUR UNE ADRESSE INCONNUE.
    // ==============================================================
    // Sinon ce formulaire devient un moyen commode de découvrir
    // quelles adresses sont enregistrées : on en essaie mille, et on
    // garde celles qui répondent différemment.
    @unlink($logFile);

    $inconnue = call('POST', '/api/auth/forgot-password', [
        'email' => "personne-{$sfx}@t.local",
    ]);

    check("une adresse inconnue reçoit la MÊME réponse",
        $inconnue['status'] === $demande['status']
        && ($inconnue['body']['message'] ?? '') === ($demande['body']['message'] ?? ''));

    check("mais aucun message n'est parti",
        !is_file($logFile) || trim((string) file_get_contents($logFile)) === '');

    echo "\n4. Le changement de mot de passe prévient son propriétaire\n";

    // On relit le jeton depuis la base : il n'est jamais renvoyé en
    // clair par l'API hors mode développement, et ce test ne doit pas
    // dépendre de APP_DEBUG.
    $db = \Autocare\Core\Database::connection();

    $statement = $db->prepare(
        'SELECT pr.id FROM password_resets pr
           JOIN users u ON u.id = pr.user_id
          WHERE u.email = :email
       ORDER BY pr.id DESC LIMIT 1'
    );
    $statement->execute(['email' => $email]);

    check('une demande a bien été enregistrée', $statement->fetchColumn() !== false);

    // Le jeton en clair n'existe que dans le message : c'est
    // exactement le but. On le relit donc là où il est arrivé.
    @unlink($logFile);
    call('POST', '/api/auth/forgot-password', ['email' => $email]);

    $journal = is_file($logFile) ? (string) file_get_contents($logFile) : '';
    preg_match('/reset-password\?token=([a-f0-9]+)/', $journal, $parts);

    $token = $parts[1] ?? '';

    check('le jeton est lisible dans le message', $token !== '');

    @unlink($logFile);

    $changement = call('POST', '/api/auth/reset-password', [
        'token' => $token, 'password' => 'nouveau-mot-de-passe-solide',
    ]);

    check('le mot de passe se change avec ce jeton', $changement['status'] === 200,
        (string) $changement['status']);

    $confirmation = is_file($logFile) ? (string) file_get_contents($logFile) : '';

    check("une confirmation part vers le propriétaire du compte",
        str_contains($confirmation, $email));
    check("elle dit quoi faire si ce n'est pas lui",
        str_contains($confirmation, "SI CE N'EST PAS VOUS"));

    check('le nouveau mot de passe fonctionne',
        call('POST', '/api/auth/login', [
            'email' => $email, 'password' => 'nouveau-mot-de-passe-solide',
        ])['status'] === 200);

    check("le jeton ne fonctionne pas deux fois",
        call('POST', '/api/auth/reset-password', [
            'token' => $token, 'password' => 'encore-un-autre-mot-de-passe',
        ])['status'] === 400);

    // Nettoyage.
    foreach ([
        'DELETE FROM password_resets WHERE user_id IN (SELECT id FROM users WHERE email = :e)',
        'DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email = :e)',
        'DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = :e)',
        'DELETE FROM station_users WHERE user_id IN (SELECT id FROM users WHERE email = :e)',
        'DELETE FROM stations WHERE organization_id IN
            (SELECT organization_id FROM users WHERE email = :e)',
        'DELETE FROM organizations WHERE id IN
            (SELECT organization_id FROM users WHERE email = :e)',
        'DELETE FROM users WHERE email = :e',
    ] as $sql) {
        try { $db->prepare($sql)->execute(['e' => $email]); } catch (Throwable) {}
    }
}

@unlink($logFile);

echo "\n" . str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
