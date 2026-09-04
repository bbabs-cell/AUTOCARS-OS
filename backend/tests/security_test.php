<?php

declare(strict_types=1);

/**
 * Tests de sécurité — isolation et permissions
 * ==================================================================
 * LES TESTS LES PLUS IMPORTANTS DU PROJET.
 * ==================================================================
 *
 * Usage, depuis le dossier backend/ :
 *
 *   php tools/migrate.php --fresh
 *   php tools/seed.php
 *   php tests/security_test.php
 *
 * Ils répondent à une seule question, mais la plus grave :
 * « une entreprise peut-elle voir les données d'une autre ? »
 *
 * Pour un SaaS, une réponse positive tue le produit. Ces tests
 * tentent donc VOLONTAIREMENT l'accès interdit, et vérifient qu'il
 * échoue — de la même façon qu'un attaquant s'y prendrait.
 */

use Autocare\Core\Database;
use Autocare\Core\Env;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Security\Permissions;
use Autocare\Core\Security\TokenService;
use Autocare\Core\TenantRepository;

require_once dirname(__DIR__) . '/vendor/autoload.php';

Env::load(dirname(__DIR__) . '/.env');

$connection = Database::connection();

$passed = 0;
$failed = 0;

function check(string $description, bool $condition): void
{
    global $passed, $failed;

    if ($condition) {
        $passed++;
        echo "  [OK]     {$description}\n";
    } else {
        $failed++;
        echo "  [ÉCHEC]  {$description}\n";
    }
}

/**
 * Dépôt de test. On l'écrit ici plutôt que dans src/ : les vrais
 * dépôts métier arrivent au lot 6, et on ne crée pas de fichier de
 * production dont personne n'a encore besoin.
 */
final class TestVehicleRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'vehicles';
    }

    protected function usesSoftDeletes(): bool
    {
        return true;
    }
}

echo "=== AUTOCARE OS — tests de sécurité ===\n\n";

// ==================================================================
// Préparation : deux entreprises concurrentes
// ==================================================================

function cleanUp(PDO $connection): void
{
    foreach ([9001, 9002] as $organizationId) {
        $connection->exec("DELETE FROM vehicles   WHERE organization_id = {$organizationId}");
        $connection->exec("DELETE FROM customers  WHERE organization_id = {$organizationId}");
        $connection->exec("DELETE FROM station_users WHERE organization_id = {$organizationId}");
        $connection->exec("DELETE FROM refresh_tokens WHERE organization_id = {$organizationId}");
        $connection->exec("DELETE FROM users      WHERE organization_id = {$organizationId}");
        $connection->exec("DELETE FROM stations   WHERE organization_id = {$organizationId}");
        $connection->exec("DELETE FROM audit_logs WHERE organization_id = {$organizationId}");
        $connection->exec("DELETE FROM organizations WHERE id = {$organizationId}");
    }
}

cleanUp($connection);

// Entreprise A — « Diallo Lavage », et entreprise B — « Sarr Auto ».
// Deux stations concurrentes, sur la même installation d'AUTOCARE OS.
foreach ([[9001, 'Diallo Lavage', 'diallo-lavage-test'], [9002, 'Sarr Auto', 'sarr-auto-test']] as [$id, $name, $slug]) {
    $connection->prepare('INSERT INTO organizations (id, name, slug) VALUES (:id, :name, :slug)')
        ->execute(['id' => $id, 'name' => $name, 'slug' => $slug]);

    $connection->prepare(
        'INSERT INTO stations (id, organization_id, name, code) VALUES (:id, :org, :name, :code)'
    )->execute(['id' => $id, 'org' => $id, 'name' => $name, 'code' => 'T' . $id]);

    $connection->prepare(
        'INSERT INTO users (id, organization_id, first_name, last_name, email, password_hash)
         VALUES (:id, :org, :first, :last, :email, :hash)'
    )->execute([
        'id'    => $id,
        'org'   => $id,
        'first' => 'Gerant',
        'last'  => $name,
        'email' => "gerant{$id}@test.local",
        'hash'  => password_hash('mot-de-passe-de-test', PASSWORD_DEFAULT),
    ]);

    $connection->prepare(
        "INSERT INTO station_users (organization_id, station_id, user_id, role)
         VALUES (:org, :station, :user, 'ADMIN')"
    )->execute(['org' => $id, 'station' => $id, 'user' => $id]);

    $connection->prepare(
        'INSERT INTO customers (id, organization_id, first_name, last_name, phone)
         VALUES (:id, :org, :first, :last, :phone)'
    )->execute([
        'id' => $id, 'org' => $id, 'first' => 'Client', 'last' => $name, 'phone' => '+22177000' . $id,
    ]);
}

// Chaque entreprise enregistre un véhicule. Volontairement la MÊME
// plaque : c'est légitime, deux stations peuvent servir le même
// véhicule, et cela rend le test plus proche du réel.
$connection->prepare(
    'INSERT INTO vehicles (id, organization_id, customer_id, plate_number, brand, model)
     VALUES (9001, 9001, 9001, :plate, :brand, :model)'
)->execute(['plate' => 'DK7777ZZ', 'brand' => 'Toyota', 'model' => 'Corolla']);

$connection->prepare(
    'INSERT INTO vehicles (id, organization_id, customer_id, plate_number, brand, model)
     VALUES (9002, 9002, 9002, :plate, :brand, :model)'
)->execute(['plate' => 'DK7777ZZ', 'brand' => 'Toyota', 'model' => 'Corolla']);

// ==================================================================
echo "1. Isolation en LECTURE\n";
// ==================================================================

// On se place dans la peau du gérant de l'entreprise A.
AuthContext::set(
    userId: 9001, organizationId: 9001,
    email: 'gerant9001@test.local', fullName: 'Gerant A',
    role: 'ADMIN', stationIds: [9001],
);

$vehicles = new TestVehicleRepository();

check(
    "A voit bien SON véhicule",
    $vehicles->find(9001) !== null
);

check(
    "A ne voit PAS le véhicule de B (find retourne null)",
    $vehicles->find(9002) === null
);

$all = $vehicles->all();

check(
    "la liste de A ne contient que ses véhicules",
    count($all) === 1 && (int) $all[0]['id'] === 9001
);

check(
    "le comptage de A ignore les données de B",
    $vehicles->count() === 1
);

// Même en filtrant sur un critère qui correspondrait au véhicule de B.
$byPlate = $vehicles->all(['plate_number' => 'DK7777ZZ']);

check(
    "rechercher une plaque partagée ne remonte que le véhicule de A",
    count($byPlate) === 1 && (int) $byPlate[0]['organization_id'] === 9001
);

// ==================================================================
echo "\n2. Isolation en ÉCRITURE\n";
// ==================================================================

check(
    "A ne peut pas modifier le véhicule de B",
    $vehicles->update(9002, ['color' => 'Piraté']) === false
);

$victim = $connection->query('SELECT color FROM vehicles WHERE id = 9002')->fetchColumn();

check(
    "le véhicule de B est resté intact",
    $victim === null || $victim === false
);

check(
    "A ne peut pas supprimer le véhicule de B",
    $vehicles->softDelete(9002) === false
);

// Tentative la plus sournoise : forcer organization_id à la création
// pour écrire directement dans les données du concurrent.
$forgedId = $vehicles->create([
    'organization_id' => 9002,          // ← tentative d'injection
    'customer_id'     => 9001,
    'plate_number'    => 'DK8888ZZ',
    'brand'           => 'Test',
    'model'           => 'Injection',
]);

$forged = $connection->prepare('SELECT organization_id FROM vehicles WHERE id = :id');
$forged->execute(['id' => $forgedId]);

check(
    "forcer organization_id à la création est ignoré : la ligne reste chez A",
    (int) $forged->fetchColumn() === 9001
);

$connection->exec("DELETE FROM vehicles WHERE id = {$forgedId}");

// ==================================================================
echo "\n3. Le point de vue de B\n";
// ==================================================================

AuthContext::set(
    userId: 9002, organizationId: 9002,
    email: 'gerant9002@test.local', fullName: 'Gerant B',
    role: 'ADMIN', stationIds: [9002],
);

$vehiclesB = new TestVehicleRepository();

check(
    "B voit son véhicule",
    $vehiclesB->find(9002) !== null
);

check(
    "B ne voit pas celui de A",
    $vehiclesB->find(9001) === null
);

// ==================================================================
echo "\n4. Protection contre l'injection SQL\n";
// ==================================================================

$injectionRejected = false;

try {
    // Un nom de colonne ne peut pas être passé en paramètre préparé.
    // On vérifie donc que la couche refuse tout ce qui n'est pas un
    // identifiant valide.
    $vehiclesB->all(['1=1 OR organization_id' => 1]);
} catch (InvalidArgumentException) {
    $injectionRejected = true;
}

check("un nom de colonne malveillant est rejeté", $injectionRejected);

$orderByRejected = false;

try {
    $vehiclesB->all([], 'id; DROP TABLE vehicles');
} catch (InvalidArgumentException) {
    $orderByRejected = true;
}

check("une clause de tri malveillante est rejetée", $orderByRejected);

// Une valeur contenant du SQL est traitée comme du TEXTE, jamais
// comme du code : c'est ce que garantissent les requêtes préparées.
$sqlInValue = $vehiclesB->all(['plate_number' => "' OR '1'='1"]);

check(
    "une valeur contenant du SQL ne renvoie rien (traitée comme du texte)",
    $sqlInValue === []
);

check(
    "la table vehicles existe toujours après ces tentatives",
    $connection->query("SHOW TABLES LIKE 'vehicles'")->fetchColumn() !== false
);

// ==================================================================
echo "\n5. Permissions par rôle\n";
// ==================================================================

check("ADMIN peut tout faire",                 Permissions::allows('ADMIN', 'payments.delete'));
check("MANAGER peut voir le tableau de bord",  Permissions::allows('MANAGER', 'dashboard.view'));
check("MANAGER peut gérer les véhicules",      Permissions::allows('MANAGER', 'vehicles.create'));
check("MANAGER ne gère PAS les employés",      !Permissions::allows('MANAGER', 'employees.create'));
check("MANAGER ne touche PAS aux paramètres",  !Permissions::allows('MANAGER', 'settings.update'));

check("EMPLOYE peut consulter un véhicule",    Permissions::allows('EMPLOYEE', 'vehicles.view'));
check("EMPLOYE peut faire une inspection",     Permissions::allows('EMPLOYEE', 'inspections.create'));
check("EMPLOYE peut changer un statut",        Permissions::allows('EMPLOYEE', 'operations.update_status'));

// ------------------------------------------------------------------
// ENCAISSER N'EST PAS VOIR LA RECETTE (précisé au lot 9)
// ------------------------------------------------------------------
// Le lot 4 posait « l'employé ne voit pas les paiements ». À l'usage,
// c'était trop large : c'est lui qui est au comptoir quand le client
// règle, et lui refuser la saisie obligerait à déranger un
// responsable à chaque véhicule rendu. Un logiciel qu'on doit
// contourner pour travailler finit par ne plus être utilisé.
//
// La règle exacte est : il manipule l'argent D'UN DOSSIER, il ne voit
// jamais le CUMUL. Le principe du moindre privilège est respecté —
// un compte employé volé ne donne toujours pas accès au chiffre
// d'affaires de la station.
check("EMPLOYE peut encaisser au comptoir",
    Permissions::allows('EMPLOYEE', 'payments.create'));
check("EMPLOYE voit ce qui est réglé sur UN dossier",
    Permissions::allows('EMPLOYEE', 'payments.view'));

check("EMPLOYE ne voit PAS le journal des encaissements",
    !Permissions::allows('EMPLOYEE', 'payments.journal'));
check("EMPLOYE ne rembourse PAS",
    !Permissions::allows('EMPLOYEE', 'payments.refund'));
check("EMPLOYE ne voit PAS la caisse",
    !Permissions::allows('EMPLOYEE', 'cash.view'));
check("EMPLOYE ne clôture PAS la caisse",
    !Permissions::allows('EMPLOYEE', 'cash.close'));

check("EMPLOYE ne voit PAS les statistiques",  !Permissions::allows('EMPLOYEE', 'reports.view'));
check("EMPLOYE ne supprime PAS un véhicule",   !Permissions::allows('EMPLOYEE', 'vehicles.delete'));

$unknownRole = Permissions::allows('SUPER_ADMIN_INVENTE', 'vehicles.view');
check("un rôle inconnu n'a aucun droit",       !$unknownRole);

// ==================================================================
echo "\n6. Accès aux stations\n";
// ==================================================================

// ------------------------------------------------------------------
// Une SECONDE station pour l'entreprise A.
//
// Jusqu'au lot 16, ce bloc travaillait sur des identifiants inventés :
// la règle « un administrateur voit tout » ne consultait rien, elle
// répondait `true` sans regarder. Elle vérifie désormais À QUI
// APPARTIENT la station — il faut donc de vraies lignes, et cela
// permet enfin de tester le cas qui manquait.
//
// On réutilise les deux entreprises déjà en place plus haut : A
// (9001) et B (9002).
// ------------------------------------------------------------------
$connection->prepare(
    "INSERT INTO stations (id, organization_id, name, code)
     VALUES (9003, 9001, 'Seconde station de A', 'T9003')"
)->execute();

AuthContext::set(
    userId: 9001, organizationId: 9001, email: 'e@test.local',
    fullName: 'Employe', role: 'EMPLOYEE', stationIds: [9001],
);

check(
    "un employé accède à SA station",
    AuthContext::current()->canAccessStation(9001)
);
check(
    "un employé n'accède pas à une autre station",
    !AuthContext::current()->canAccessStation(9003)
);

AuthContext::set(
    userId: 9001, organizationId: 9001, email: 'a@test.local',
    fullName: 'Admin', role: 'ADMIN', stationIds: [9001],
);

check(
    "un administrateur accède à toutes les stations de son entreprise",
    AuthContext::current()->canAccessStation(9003)
);

// ==================================================================
// LE CAS QUI MANQUAIT, ET QUI PASSAIT AVANT LE LOT 16.
// ==================================================================
// La règle renvoyait `true` pour TOUT administrateur, sans regarder
// l'entreprise propriétaire de la station : l'administrateur de B qui
// passait l'identifiant d'une station de A franchissait ce contrôle.
//
// AUCUNE DONNÉE NE FUYAIT POUR AUTANT — toutes les requêtes portent
// `organization_id`, et le filtre d'isolation renvoyait zéro ligne.
// C'est exactement le rôle d'une défense en profondeur : la première
// barrière avait cédé, la seconde a tenu. Les deux doivent tenir.
//
// Le défaut était réel : l'API répondait « 200, rien à voir ici » là
// où elle devait répondre « cette station n'est pas la vôtre ».
check(
    "un administrateur n'accède PAS à la station d'une AUTRE entreprise",
    !AuthContext::current()->canAccessStation(9002)
);

// ==================================================================
echo "\n7. Jetons\n";
// ==================================================================

$token  = TokenService::issueAccessToken(9001, 9001);
$claims = TokenService::readAccessToken($token);

check(
    "un jeton valide se relit correctement",
    $claims !== null && $claims['sub'] === 9001 && $claims['org'] === 9001
);

// On modifie un caractère de la signature : elle ne correspond plus.
$tampered = substr($token, 0, -3) . 'AAA';

check(
    "un jeton dont la signature est modifiée est rejeté",
    TokenService::readAccessToken($tampered) === null
);

check(
    "un jeton qui n'en est pas un est rejeté",
    TokenService::readAccessToken('nimportequoi') === null
);

// « alg: none » est la faille classique des implémentations JWT
// maison : un jeton non signé accepté comme valide.
$noneAlgorithm = base64_encode('{"alg":"none","typ":"JWT"}') . '.'
    . base64_encode('{"sub":9002,"org":9002}') . '.';

check(
    "un jeton non signé (alg: none) est rejeté",
    TokenService::readAccessToken($noneAlgorithm) === null
);

$refresh = TokenService::issueRefreshToken(9001, 9001);
$stored  = TokenService::readRefreshToken($refresh);

check(
    "un jeton de rafraîchissement valide est reconnu",
    $stored !== null && $stored['user_id'] === 9001
);

// On vérifie deux choses : le jeton en clair n'apparaît nulle part,
// et ce qui est stocké est bien son empreinte SHA-256.
//
// Note : avec ATTR_EMULATE_PREPARES => false, PDO renvoie de VRAIS
// entiers, pas des chaînes. Comparer avec === '0' échouerait alors
// que la valeur est correcte.
$clearTextCount = $connection->prepare(
    'SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = :token'
);
$clearTextCount->execute(['token' => $refresh]);

check(
    "le jeton de rafraîchissement n'apparaît nulle part en clair",
    (int) $clearTextCount->fetchColumn() === 0
);

$hashedCount = $connection->prepare(
    'SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = :hash'
);
$hashedCount->execute(['hash' => hash('sha256', $refresh)]);

check(
    "c'est bien son empreinte SHA-256 qui est stockée",
    (int) $hashedCount->fetchColumn() === 1
);

TokenService::revokeRefreshToken($stored['id']);

check(
    "un jeton révoqué n'est plus accepté",
    TokenService::readRefreshToken($refresh) === null
);

// ==================================================================
echo "\n8. Mots de passe\n";
// ==================================================================

$hash = password_hash('mot-de-passe-de-test', PASSWORD_DEFAULT);

check("le mot de passe n'apparaît pas dans son empreinte",
    !str_contains($hash, 'mot-de-passe-de-test'));
check("l'empreinte se vérifie",   password_verify('mot-de-passe-de-test', $hash));
check("un mauvais mot de passe échoue", !password_verify('autre-chose', $hash));

// Deux empreintes du MÊME mot de passe diffèrent grâce au sel
// aléatoire : impossible de repérer les comptes partageant un mot de
// passe en comparant les empreintes.
check(
    "deux empreintes du même mot de passe sont différentes (sel aléatoire)",
    password_hash('mot-de-passe-de-test', PASSWORD_DEFAULT) !== $hash
);

$storedHashes = $connection->query(
    'SELECT password_hash FROM users LIMIT 10'
)->fetchAll(PDO::FETCH_COLUMN);

$allHashed = true;

foreach ($storedHashes as $stored) {
    if (!str_starts_with((string) $stored, '$2y$') && !str_starts_with((string) $stored, '$argon')) {
        $allHashed = false;
    }
}

check("aucun mot de passe n'est stocké en clair en base", $allHashed);

// ==================================================================
cleanUp($connection);
AuthContext::clear();

echo "\n" . str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
