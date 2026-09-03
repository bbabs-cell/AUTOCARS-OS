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

echo "\n6. Les colonnes du tableau\n";

$board = OperationStatus::board();

check("le tableau déclare 5 colonnes", count($board) === 5, (string) count($board));

// Chaque statut actif doit apparaître dans EXACTEMENT une colonne.
// Zéro fois, il devient invisible : un véhicule disparaîtrait du
// tableau sans que personne ne s'en aperçoive. Deux fois, il
// s'afficherait en double.
$placed = [];

foreach ($board as $column) {
    foreach ($column['statuses'] as $status) {
        $placed[] = $status;
    }
}

$missing   = array_values(array_diff(OperationStatus::active(), $placed));
$duplicate = array_values(array_diff_assoc($placed, array_unique($placed)));

check("aucun statut actif n'est absent du tableau", $missing === [], implode(', ', $missing));
check("aucun statut n'apparaît dans deux colonnes", $duplicate === [], implode(', ', $duplicate));

check("aucune colonne ne montre un statut final",
    array_intersect($placed, ['COMPLETED', 'CANCELLED']) === []);

// Le statut appliqué au dépôt doit faire partie de la colonne, sinon
// déposer une carte dans « Lavage » la mettrait ailleurs.
$inconsistent = [];

foreach ($board as $column) {
    if (!in_array($column['drop'], $column['statuses'], true)) {
        $inconsistent[] = $column['label'];
    }

    if (!OperationStatus::exists($column['drop'])) {
        $inconsistent[] = $column['label'] . ' (statut inconnu)';
    }
}

check("le statut de dépôt appartient bien à sa colonne",
    $inconsistent === [], implode(', ', $inconsistent));

echo "\n7. Les seuils d'alerte\n";

check("un lavage hérite de la durée de la prestation",
    OperationStatus::alertThreshold('WASHING', 45) === 45);
check("sans durée connue, le lavage ne déclenche AUCUNE alerte",
    OperationStatus::alertThreshold('WASHING', null) === null);
check("une durée de zéro ne produit pas un seuil de zéro",
    OperationStatus::alertThreshold('WASHING', 0) === null);
check("l'attente a un seuil fixe", OperationStatus::alertThreshold('WAITING') === 20);
check("un dossier restitué n'a pas de seuil",
    OperationStatus::alertThreshold('COMPLETED', 45) === null);

echo "\n8. Les messages de refus\n";

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
