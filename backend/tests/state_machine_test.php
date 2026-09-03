<?php

declare(strict_types=1);

/**
 * Tests de la machine à états — SANS BASE DE DONNÉES
 * ------------------------------------------------------------------
 * Usage :
 *   php tests/state_machine_test.php
 *
 * Ce fichier ne démarre ni serveur ni base : il vérifie la logique
 * pure du parcours d'un véhicule. C'est justement l'intérêt d'avoir
 * séparé « ce passage existe-t-il ? » (table de transitions) de
 * « la condition est-elle remplie ? » (base de données).
 *
 * Il tourne en quelques millisecondes, donc on le lance souvent —
 * et un test qu'on lance souvent est un test qui sert.
 */

use Autocare\Core\OperationStatus;

require_once dirname(__DIR__) . '/vendor/autoload.php';

$passed = 0;
$failed = 0;

function check(string $description, bool $condition, string $extra = ''): void
{
    global $passed, $failed;

    if ($condition) {
        $passed++;
        echo "  [OK]     {$description}\n";
    } else {
        $failed++;
        echo "  [ÉCHEC]  {$description}" . ($extra !== '' ? " — {$extra}" : '') . "\n";
    }
}

echo "=== LOT 7 — machine à états des opérations ===\n\n1. Le parcours nominal\n";

// Le chemin complet, de l'arrivée à la restitution. Chaque étape doit
// mener à la suivante : c'est le trajet que fera chaque véhicule.
$nominal = ['WAITING', 'IN_PROGRESS', 'INSPECTION', 'WASHING', 'QUALITY_CHECK', 'READY', 'COMPLETED'];

for ($i = 0; $i < count($nominal) - 1; $i++) {
    check(
        "{$nominal[$i]} → {$nominal[$i + 1]}",
        OperationStatus::canTransition($nominal[$i], $nominal[$i + 1])
    );
}

echo "\n2. Les trois règles métier\n";

// RÈGLE 1 — l'inspection d'entrée ne se saute pas.
check(
    "IN_PROGRESS → WASHING est IMPOSSIBLE (inspection d'entrée obligatoire)",
    !OperationStatus::canTransition('IN_PROGRESS', 'WASHING')
);
check(
    "WAITING → WASHING est IMPOSSIBLE (on ne lave pas un véhicule non constaté)",
    !OperationStatus::canTransition('WAITING', 'WASHING')
);
check(
    "INSPECTION → WASHING exige une inspection enregistrée",
    OperationStatus::guardFor('INSPECTION', 'WASHING') === 'entry_inspection_recorded'
);

// RÈGLE 2 — le contrôle qualité ne se saute pas, et peut refuser.
check(
    "WASHING → READY est IMPOSSIBLE (contrôle qualité obligatoire)",
    !OperationStatus::canTransition('WASHING', 'READY')
);
check(
    "QUALITY_CHECK → WASHING est POSSIBLE (le contrôle peut refuser)",
    OperationStatus::canTransition('QUALITY_CHECK', 'WASHING')
);

// RÈGLE 3 — pas de restitution sans règlement.
check(
    "READY → COMPLETED exige le règlement",
    OperationStatus::guardFor('READY', 'COMPLETED') === 'payment_settled'
);

echo "\n3. Les états finaux\n";

check("COMPLETED est un état final", OperationStatus::isFinal('COMPLETED'));
check("CANCELLED est un état final", OperationStatus::isFinal('CANCELLED'));
check("un dossier restitué ne repart pas en lavage",
    !OperationStatus::canTransition('COMPLETED', 'WASHING'));
check("un dossier annulé ne se rouvre pas",
    !OperationStatus::canTransition('CANCELLED', 'WAITING'));

echo "\n4. L'annulation reste possible partout\n";

// Un client peut repartir à tout moment. Un logiciel qui l'interdit
// oblige à mentir sur les statuts.
foreach (['WAITING', 'IN_PROGRESS', 'INSPECTION', 'WASHING', 'QUALITY_CHECK', 'READY'] as $status) {
    check("{$status} → CANCELLED", OperationStatus::canTransition($status, 'CANCELLED'));
}

echo "\n5. Cohérence de la configuration\n";

check("les 8 statuts sont déclarés", count(OperationStatus::all()) === 8);

// Chaque statut cible doit exister : une faute de frappe dans la
// configuration passerait sinon inaperçue jusqu'à la production.
$unknown = [];

foreach (OperationStatus::all() as $status) {
    foreach (OperationStatus::allowedFrom($status) as $target) {
        if (!OperationStatus::exists($target)) {
            $unknown[] = "{$status} → {$target}";
        }
    }
}

check("aucune transition ne pointe vers un statut inexistant",
    $unknown === [], implode(', ', $unknown));

// Chaque statut doit avoir un libellé lisible : sans cela l'interface
// afficherait « QUALITY_CHECK » à un employé.
$missingLabels = array_filter(
    OperationStatus::all(),
    static fn (string $s): bool => OperationStatus::label($s) === $s
);

check("chaque statut a un libellé en français", $missingLabels === [],
    implode(', ', $missingLabels));

// Tout statut non final doit être atteignable depuis WAITING, sinon
// c'est du code mort qu'on croira actif.
$reachable = ['WAITING'];
$queue     = ['WAITING'];

while ($queue !== []) {
    $current = array_shift($queue);

    foreach (OperationStatus::allowedFrom($current) as $next) {
        if (!in_array($next, $reachable, true)) {
            $reachable[] = $next;
            $queue[]     = $next;
        }
    }
}

$unreachable = array_values(array_diff(OperationStatus::all(), $reachable));

check("tous les statuts sont atteignables depuis WAITING",
    $unreachable === [], implode(', ', $unreachable));

check("la file d'attente compte 6 statuts actifs (ni restitué ni annulé)",
    count(OperationStatus::active()) === 6);

echo "\n6. Les messages de refus\n";

$message = OperationStatus::refusalMessage('WAITING', 'WASHING');

check("le refus nomme les étapes réellement possibles",
    str_contains($message, 'Pris en charge'), $message);
check("le refus est écrit en français, sans jargon technique",
    !str_contains($message, 'transition') && !str_contains($message, 'IN_PROGRESS'), $message);
check("un dossier clos donne un message spécifique",
    str_contains(OperationStatus::refusalMessage('COMPLETED', 'WASHING'), 'ne peut plus changer'));

echo "\n" . str_repeat('=', 50) . "\n";
echo "  {$passed} test(s) réussi(s), {$failed} échec(s)\n";
echo str_repeat('=', 50) . "\n";

exit($failed === 0 ? 0 : 1);
