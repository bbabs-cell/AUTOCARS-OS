<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\OperationStatus;
use Autocare\Core\PlateNumber;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Http\Presenters\OperationPresenter;
use Autocare\Models\InspectionRepository;
use Autocare\Models\OperationRepository;
use Autocare\Models\ServiceRepository;
use Autocare\Models\StationRepository;
use Autocare\Models\VehicleRepository;

/**
 * Les opérations : prise en charge, parcours, restitution
 * ------------------------------------------------------------------
 * Ce contrôleur applique la machine à états déclarée dans
 * config/operation_status.php. C'est ici, et nulle part ailleurs,
 * qu'une opération change de statut.
 *
 * POURQUOI CE MODULE ARRIVE AU LOT 7 ALORS QU'IL ÉTAIT PRÉVU AU 8 ?
 * Parce qu'une inspection se rattache obligatoirement à une opération
 * (inspections.operation_id NOT NULL). Sans opération, il n'y a rien
 * à inspecter. On monte donc ici le strict nécessaire — création,
 * parcours, restitution. Le Kanban et la gestion de file restent au
 * lot 8.
 */
final class OperationController
{
    /**
     * GET /api/operations/statuses
     *
     * Expose la machine à états au frontend : libellés, transitions
     * possibles, statuts actifs.
     *
     * POURQUOI L'ENVOYER AU CLIENT ?
     * Pour que l'interface n'affiche que les boutons utilisables, sans
     * recopier les règles en TypeScript. Une règle recopiée est une
     * règle qui divergera. C'est un CONFORT D'AFFICHAGE : le serveur
     * revérifie chaque transition, quoi qu'ait affiché l'écran.
     */
    public function statuses(Request $request): void
    {
        $statuses = [];

        foreach (OperationStatus::all() as $status) {
            $statuses[] = [
                'value'       => $status,
                'label'       => OperationStatus::label($status),
                'allowed_next' => OperationStatus::allowedFrom($status),
                'is_final'    => OperationStatus::isFinal($status),
                'is_active'   => in_array($status, OperationStatus::active(), true),
            ];
        }

        Response::success(['statuses' => $statuses]);
    }

    /** GET /api/operations?active=1&status=&station_id=&vehicle_id=&search= */
    public function index(Request $request): void
    {
        $filters = [
            'active'  => $request->query('active') === '1',
            'search'  => $request->query('search') ?? '',
        ];

        foreach (['status'] as $key) {
            $value = $request->query($key);

            if ($value !== null && $value !== '') {
                $filters[$key] = $value;
            }
        }

        foreach (['station_id', 'vehicle_id', 'customer_id', 'assigned_user_id'] as $key) {
            $value = $request->query($key);

            if ($value !== null && $value !== '') {
                $filters[$key] = (int) $value;
            }
        }

        $repository = new OperationRepository();

        Response::success([
            'operations' => array_map(OperationPresenter::present(...), $repository->listDetailed($filters)),
            'counts'     => $repository->countByStatus(
                isset($filters['station_id']) ? (int) $filters['station_id'] : null
            ),
        ]);
    }

    /** GET /api/operations/{id} */
    public function show(Request $request, string $id): void
    {
        $operation = (new OperationRepository())->findDetailed((int) $id);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        Response::success([
            'operation'   => OperationPresenter::present($operation),
            'inspections' => array_map(
                $this->presentInspection(...),
                (new InspectionRepository())->forOperation((int) $id),
            ),
        ]);
    }

    /**
     * POST /api/operations
     * L'accueil d'un véhicule au comptoir.
     */
    public function store(Request $request): void
    {
        $validator = Validator::make($request->body())
            ->required('vehicle_id', 'Le véhicule')
            ->required('service_id', 'La prestation')
            ->required('station_id', 'La station')
            ->maxLength('notes', 1000);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $vehicleId = (int) $validator->string('vehicle_id');
        $serviceId = (int) $validator->string('service_id');
        $stationId = (int) $validator->string('station_id');

        $vehicle = (new VehicleRepository())->find($vehicleId);

        if ($vehicle === null) {
            Response::validationFailed(['vehicle_id' => "Ce véhicule n'existe pas."]);
        }

        $service = (new ServiceRepository())->find($serviceId);

        if ($service === null) {
            Response::validationFailed(['service_id' => "Cette prestation n'existe pas."]);
        }

        if (($service['status'] ?? '') !== 'ACTIVE') {
            Response::validationFailed([
                'service_id' => "Cette prestation n'est plus proposée. Choisissez-en une autre.",
            ]);
        }

        $station = (new StationRepository())->find($stationId);

        if ($station === null) {
            Response::validationFailed(['station_id' => "Cette station n'existe pas."]);
        }

        // Un manager d'une station ne crée pas de dossier dans une
        // autre : le filtre d'organisation ne suffit pas ici, la
        // séparation se joue à l'intérieur d'une même entreprise.
        if (!AuthContext::current()->canAccessStation($stationId)) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        // UNE STATION FERMÉE N'ACCUEILLE PLUS DE VÉHICULE (lot 17).
        //
        // Sans ce refus, « fermer une station » ne serait qu'une
        // étiquette : le travail continuerait d'y être enregistré, et
        // le gérant découvrirait des dossiers ouverts sur un site
        // qu'il croyait clos. Le passé de la station reste consultable
        // — c'est l'avenir qu'on ferme.
        if (($station['status'] ?? 'ACTIVE') !== 'ACTIVE') {
            Response::validationFailed([
                'station_id' => 'Cette station est fermée. Choisissez-en une autre.',
            ]);
        }

        $repository = new OperationRepository();
        $open       = $repository->openOperationFor($vehicleId);

        if ($open !== null) {
            // Deux dossiers ouverts sur un même véhicule, c'est deux
            // inspections contradictoires et un litige garanti sur
            // « laquelle des deux fait foi ».
            Response::error(
                sprintf(
                    'Ce véhicule a déjà un dossier en cours (%s). Ouvrez-le plutôt que d\'en créer un second.',
                    $open['reference']
                ),
                ['vehicle_id' => 'Dossier déjà ouvert : ' . $open['reference']],
                409
            );
        }

        $created = $repository->createWithReference((string) $station['code'], [
            'station_id'  => $stationId,
            'vehicle_id'  => $vehicleId,
            // Le client N'EST PAS lu dans la requête : il est déduit du
            // véhicule. Un formulaire modifié ne peut donc pas
            // rattacher un dossier au client de quelqu'un d'autre.
            'customer_id' => (int) $vehicle['customer_id'],
            'service_id'  => $serviceId,
            'status'      => 'WAITING',
            // PRIX FIGÉ : recopié du catalogue au moment de l'accueil.
            // Si le tarif change le mois prochain, ce dossier continue
            // d'afficher ce qui a réellement été annoncé au client.
            'price'         => (int) $service['price'],
            // currency_code n'est pas fourni : la colonne vaut XOF par
            // défaut, la devise de toute la zone visée. Le jour où une
            // entreprise facturera dans une autre devise, la valeur
            // viendra de son paramétrage — pas avant, ce serait une
            // complication sans utilisateur.
            'priority'      => $this->readPriority($request),
            'notes'         => $validator->stringOrNull('notes'),
            'created_by_user_id' => AuthContext::current()->userId,
        ]);

        AuditLogger::record(
            action: 'operation.created',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'operation',
            entityId: $created['id'],
            metadata: [
                'reference' => $created['reference'],
                'plate'     => $vehicle['plate_number'],
                'price'     => (int) $service['price'],
            ],
        );

        Response::success(
            ['operation' => OperationPresenter::present($repository->findDetailed($created['id']) ?? [])],
            'Dossier ' . $created['reference'] . ' ouvert.',
            201
        );
    }

    /**
     * PUT /api/operations/{id}/status
     * LE POINT LE PLUS SENSIBLE DU PARCOURS.
     */
    public function changeStatus(Request $request, string $id): void
    {
        $operationId = (int) $id;
        $repository  = new OperationRepository();
        $operation   = $repository->findDetailed($operationId);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        $validator = Validator::make($request->body())
            ->required('status', 'Le statut')
            ->in('status', OperationStatus::all());

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $from = (string) $operation['status'];
        $to   = $validator->string('status');

        // La restitution ne passe PAS par ici : elle a sa propre route
        // avec sa procédure de vérification. Autoriser un simple
        // changement de statut vers COMPLETED contournerait tous les
        // contrôles du comptoir.
        if ($to === 'COMPLETED') {
            Response::forbidden(
                'La restitution suit une procédure de vérification : '
                . 'utilisez l\'écran de remise du véhicule.'
            );
        }

        if (!OperationStatus::canTransition($from, $to)) {
            Response::error(OperationStatus::refusalMessage($from, $to), [], 409);
        }

        $guard = OperationStatus::guardFor($from, $to);

        if ($guard === 'entry_inspection_recorded') {
            $inspection = (new InspectionRepository())->findForOperation($operationId, 'ENTRY');

            if ($inspection === null) {
                Response::error(
                    "L'inspection d'entrée doit être enregistrée avant de commencer le lavage. "
                    . "C'est elle qui protège la station en cas de litige sur l'état du véhicule.",
                    ['inspection' => 'Inspection d\'entrée manquante.'],
                    409
                );
            }
        }

        $extra = [];

        // Prendre un véhicule en charge, c'est s'en déclarer
        // responsable : on inscrit l'employé sur le dossier si
        // personne ne l'est encore.
        if ($to === 'IN_PROGRESS' && ($operation['assigned_user_id'] ?? null) === null) {
            $extra['assigned_user_id'] = AuthContext::current()->userId;
        }

        $repository->applyStatus($operationId, $to, $extra);

        AuditLogger::record(
            action: 'operation.status_changed',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $operation['station_id'],
            entityType: 'operation',
            entityId: $operationId,
            metadata: [
                'reference' => $operation['reference'],
                'from'      => $from,
                'to'        => $to,
            ],
        );

        Response::success(
            ['operation' => OperationPresenter::present($repository->findDetailed($operationId) ?? [])],
            OperationStatus::label($to) . '.'
        );
    }

    /**
     * GET /api/operations/{id}/release-check
     *
     * L'état de la liste de vérification AVANT la remise du véhicule.
     * L'écran de restitution l'affiche pour que l'employé sache ce
     * qui bloque, plutôt que de découvrir le refus après avoir
     * ramené la voiture devant le comptoir.
     */
    public function releaseCheck(Request $request, string $id): void
    {
        $operation = (new OperationRepository())->findDetailed((int) $id);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        Response::success([
            'operation' => OperationPresenter::present($operation),
            'checklist' => $this->buildChecklist($operation),
        ]);
    }

    /**
     * POST /api/operations/{id}/release
     * LA REMISE DU VÉHICULE AU CLIENT.
     * ==============================================================
     *
     * C'est le moment où la station se dessaisit du bien de quelqu'un
     * d'autre. Quatre vérifications, dans cet ordre :
     *
     *   1. Le dossier est bien PRÊT (contrôle qualité passé).
     *   2. La référence présentée correspond au dossier.
     *   3. La plaque saisie correspond au véhicule qu'on va sortir.
     *   4. La prestation est réglée — ou un responsable lève le
     *      blocage, nominativement et avec un motif.
     *
     * POURQUOI RESSAISIR LA PLAQUE ALORS QU'ELLE EST À L'ÉCRAN ?
     * Parce que c'est le seul contrôle qui porte sur le MONDE RÉEL et
     * non sur la base. Il oblige à regarder la voiture avant de
     * remettre les clés. Deux Toyota blanches le même matin, ça
     * arrive tous les jours ; rendre la mauvaise, une seule fois,
     * suffit à perdre un client.
     */
    public function release(Request $request, string $id): void
    {
        $operationId = (int) $id;
        $repository  = new OperationRepository();
        $operation   = $repository->findDetailed($operationId);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        $validator = Validator::make($request->body())
            ->required('reference', 'La référence du dossier')
            ->required('plate_number', 'La plaque')
            ->maxLength('override_reason', 255);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        // --- 1. Le dossier est-il prêt ? ---------------------------
        $from = (string) $operation['status'];

        if ($from !== 'READY') {
            Response::error(OperationStatus::refusalMessage($from, 'COMPLETED'), [], 409);
        }

        // --- 2. La référence présentée -----------------------------
        $typedReference = strtoupper(preg_replace('/\s+/', '', $validator->string('reference')) ?? '');

        // hash_equals plutôt que !== : la référence est ce qui autorise
        // à repartir avec un véhicule. Comparer en temps constant coûte
        // le même effort et ferme la porte à une devinette par mesure
        // du temps de réponse.
        if (!hash_equals((string) $operation['reference'], $typedReference)) {
            Response::validationFailed([
                'reference' => 'Cette référence ne correspond pas à ce dossier.',
            ]);
        }

        // --- 3. La plaque du véhicule ------------------------------
        $typedPlate = PlateNumber::normalize($validator->string('plate_number'));

        if ($typedPlate !== (string) $operation['plate_number']) {
            Response::validationFailed([
                'plate_number' => 'Cette plaque ne correspond pas au véhicule du dossier. Vérifiez avant de remettre les clés.',
            ]);
        }

        // --- 4. Le règlement ---------------------------------------
        // `amountDue()` et non `price` : depuis le lot 14, une remise
        // de fidélité peut diminuer ce qui reste dû. La formule est
        // écrite une seule fois, dans le dépôt.
        $due  = OperationRepository::amountDue($operation);
        $paid = (int) $operation['paid_amount'];

        $overrideReason = $validator->stringOrNull('override_reason');
        $overridden     = false;

        if ($paid < $due) {
            if ($overrideReason === null) {
                Response::error(
                    sprintf(
                        'Cette prestation n\'est pas réglée (%s réglés sur %s). '
                        . 'Un responsable peut lever le blocage en indiquant un motif.',
                        number_format($paid, 0, ',', ' '),
                        number_format($due, 0, ',', ' ')
                    ),
                    ['payment' => 'Paiement incomplet.'],
                    402 // Payment Required : le code existe, c'est exactement ce cas.
                );
            }

            // La dérogation est un droit distinct : un employé ne peut
            // pas s'autoriser lui-même à rendre un véhicule impayé.
            if (!AuthContext::current()->can('operations.override_payment')) {
                Response::forbidden(
                    'Seul un responsable peut restituer un véhicule non réglé.'
                );
            }

            $overridden = true;
        }

        $repository->applyStatus($operationId, 'COMPLETED', [
            'released_by_user_id' => AuthContext::current()->userId,
        ]);

        // La dérogation est tracée NOMINATIVEMENT. C'est la raison
        // d'être du journal d'audit : trois mois plus tard, on doit
        // pouvoir dire qui a laissé partir ce véhicule sans paiement,
        // et pourquoi.
        AuditLogger::record(
            action: $overridden ? 'operation.released_unpaid' : 'operation.released',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $operation['station_id'],
            entityType: 'operation',
            entityId: $operationId,
            metadata: array_filter([
                'reference'       => $operation['reference'],
                'plate'           => $operation['plate_number'],
                'amount_due'      => $due,
                'amount_paid'     => $paid,
                'override_reason' => $overridden ? $overrideReason : null,
            ], static fn (mixed $value): bool => $value !== null),
        );

        Response::success(
            ['operation' => OperationPresenter::present($repository->findDetailed($operationId) ?? [])],
            'Véhicule restitué.'
        );
    }

    // ==================================================================

    /**
     * La priorité dans la file. Bornée volontairement : au-delà de
     * quelques niveaux, plus personne ne sait ce que « priorité 47 »
     * veut dire.
     */
    private function readPriority(Request $request): int
    {
        $priority = $request->input('priority', 0);

        return max(0, min(is_numeric($priority) ? (int) $priority : 0, 3));
    }

    /**
     * @param array<string,mixed> $operation
     * @return list<array<string,mixed>>
     */
    private function buildChecklist(array $operation): array
    {
        $due  = OperationRepository::amountDue($operation);
        $paid = (int) ($operation['paid_amount'] ?? 0);

        $exitInspection = (new InspectionRepository())
            ->findForOperation((int) $operation['id'], 'EXIT');

        return [
            [
                'key'      => 'status',
                'label'    => 'Le dossier est prêt à être restitué',
                'passed'   => ($operation['status'] ?? '') === 'READY',
                'blocking' => true,
                'detail'   => OperationStatus::label((string) ($operation['status'] ?? '')),
            ],
            [
                'key'      => 'identity',
                'label'    => 'Référence et plaque à confirmer au comptoir',
                'passed'   => false, // Se vérifie à la saisie, pas avant.
                'blocking' => true,
                'detail'   => PlateNumber::format((string) ($operation['plate_number'] ?? '')),
            ],
            [
                'key'      => 'payment',
                'label'    => 'La prestation est réglée',
                'passed'   => $paid >= $due,
                'blocking' => true,
                // Le montant est mis en forme ici et non côté client :
                // c'est un texte d'explication, pas une donnée à
                // recalculer. Le frontend n'a qu'à l'afficher.
                'detail'   => $paid >= $due
                    ? number_format($due, 0, ',', ' ') . ' FCFA encaissés'
                    : sprintf(
                        'Reste %s FCFA sur %s FCFA',
                        number_format($due - $paid, 0, ',', ' '),
                        number_format($due, 0, ',', ' ')
                    ),
            ],
            [
                'key'      => 'exit_inspection',
                // Non bloquante : le contrôle qualité a déjà eu lieu,
                // et bloquer une remise sur une seconde inspection
                // ferait attendre un client dont la voiture est prête.
                'label'    => 'Inspection de sortie enregistrée',
                'passed'   => $exitInspection !== null,
                'blocking' => false,
                'detail'   => $exitInspection === null ? 'Recommandée en cas de doute' : 'Enregistrée',
            ],
        ];
    }

    /**
     * @param array<string,mixed> $inspection
     * @return array<string,mixed>
     */
    private function presentInspection(array $inspection): array
    {
        return [
            'id'   => (int) $inspection['id'],
            'type' => $inspection['type'],
            'performed_by_name' => $inspection['performed_by_name'] ?? '',
            'performed_at'      => $inspection['performed_at'],
            'has_damage'        => (int) $inspection['has_damage'] === 1,
        ];
    }
}
