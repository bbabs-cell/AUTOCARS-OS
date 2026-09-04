<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\BookingStatus;
use Autocare\Core\Database;
use Autocare\Core\PlateNumber;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Http\Presenters\OperationPresenter;
use Autocare\Models\BookingRepository;
use Autocare\Models\OperationRepository;
use Autocare\Models\ServiceRepository;
use Autocare\Models\StationRepository;
use Autocare\Models\VehicleRepository;
use DateTimeImmutable;
use PDOException;

/**
 * Les rendez-vous
 * ==================================================================
 * LE CARNET DE RENDEZ-VOUS, PAS UN MOTEUR DE RÉSERVATION EN LIGNE.
 * ==================================================================
 *
 * Ce module remplace le cahier posé à côté du téléphone. Le client
 * appelle, quelqu'un note. C'est tout, et c'est déjà beaucoup : un
 * cahier ne dit pas qui reste à rappeler, ne signale pas les
 * rendez-vous dépassés, et disparaît quand il tombe dans un seau.
 *
 * ------------------------------------------------------------------
 * CE QUE CE MODULE NE FAIT PAS, VOLONTAIREMENT
 *
 * 1. AUCUN SMS, AUCUN RAPPEL AUTOMATIQUE.
 *    Envoyer un SMS suppose un compte chez un opérateur, un budget et
 *    un numéro d'expéditeur déclaré. Coder un envoi « simulé » en
 *    attendant donnerait l'illusion d'un produit branché, et il
 *    faudrait tout défaire le jour de la vraie intégration — après
 *    avoir peut-être laissé croire à un gérant que ses clients
 *    recevaient des rappels. C'est la même règle qu'au lot 9 pour les
 *    paiements, et le même test la vérifie : il relit tout `src/` à la
 *    recherche d'un appel HTTP sortant.
 *
 *    Ce que le produit fait à la place : la liste de ceux qu'il reste
 *    à rappeler. Le téléphone, c'est l'employé qui le compose.
 *
 * 2. AUCUNE RÉSERVATION PAR LE CLIENT LUI-MÊME.
 *    Un formulaire public suppose de gérer des créneaux réellement
 *    disponibles, donc une capacité. Voir ci-dessous : on ne l'a pas.
 *
 * 3. AUCUN REFUS POUR CAUSE DE CRÉNEAU PLEIN.
 *    ================================================================
 *    LA DÉCISION LA PLUS DISCUTABLE DE CE LOT — donc celle qu'il faut
 *    expliquer le plus.
 *
 *    Le réflexe serait de donner une capacité à la station (« 3
 *    postes ») et de refuser la quatrième réservation à 10 h. Le
 *    logiciel se croirait rigoureux. Il aurait tort :
 *
 *      · Un « poste » n'est pas une unité stable. Trois laveurs sur
 *        un lavage simple, c'est six voitures à l'heure ; sur un
 *        detailing, c'est une.
 *      · Un gérant sait des choses que la base ignore : un employé de
 *        renfort le samedi, un client fidèle qu'on fera passer, une
 *        voiture qu'on garde sur le parking en attendant.
 *      · Un refus qu'on juge injuste ne fait pas renoncer : il fait
 *        contourner. On note « 10 h 05 », ou on reprend le cahier —
 *        et les données du logiciel deviennent fausses.
 *
 *    On MONTRE donc la charge (« 3 véhicules déjà attendus sur ce
 *    créneau ») et on laisse trancher celui qui connaît sa station.
 *    C'est le même principe qu'au lot 12 pour les pointages oubliés :
 *    le logiciel signale, l'humain décide.
 */
final class BookingController
{
    /**
     * GET /api/bookings/statuses
     *
     * Expose le parcours au frontend pour qu'il n'affiche que les
     * boutons utilisables. CONFORT D'AFFICHAGE : le serveur revérifie
     * chaque passage.
     */
    public function statuses(Request $request): void
    {
        $statuses = [];

        foreach (BookingStatus::all() as $status) {
            $statuses[] = [
                'value' => $status,
                'label' => BookingStatus::label($status),
                'allowed_next' => BookingStatus::directlySettableFrom($status),
                'is_final' => BookingStatus::isFinal($status),
                'is_open' => in_array($status, BookingStatus::open(), true),
            ];
        }

        Response::success([
            'statuses' => $statuses,
            'no_show_grace_minutes' => BookingStatus::noShowGraceMinutes(),
            'max_days_ahead' => BookingStatus::maxDaysAhead(),
        ]);
    }

    /**
     * GET /api/bookings?from=&to=&station_id=&status=&open=1&search=
     *
     * L'écran d'une journée, en une seule requête.
     */
    public function index(Request $request): void
    {
        $from = $this->readDate($request->query('from')) ?? date('Y-m-d');
        $to   = $this->readDate($request->query('to')) ?? $from;

        $stationId = $request->query('station_id');
        $stationId = $stationId === null || $stationId === '' ? null : (int) $stationId;

        if ($stationId !== null && !AuthContext::current()->canAccessStation($stationId)) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        $filters = ['from' => $from, 'to' => $to];

        if ($stationId !== null) {
            $filters['station_id'] = $stationId;
        }

        foreach (['status', 'search'] as $key) {
            $value = $request->query($key);

            if ($value !== null && $value !== '') {
                $filters[$key] = $value;
            }
        }

        if ($request->query('open') === '1') {
            $filters['open'] = true;
        }

        $repository = new BookingRepository();

        $payload = [
            'bookings' => array_map($this->present(...), $repository->listDetailed($filters)),
            'counts'   => $repository->countByStatus($from, $to, $stationId),
            // EN TÊTE DE L'ÉCRAN, comme les pointages oubliés au lot 12 :
            // ce qui demande une action passe devant ce qui informe.
            // Cette liste ignore volontairement les bornes de dates :
            // un rendez-vous d'avant-hier jamais soldé reste à traiter,
            // même quand on regarde la journée de demain.
            'overdue'  => array_map($this->present(...), $repository->overdue($stationId)),
            'period'   => ['from' => $from, 'to' => $to],
        ];

        // La charge n'a de sens que pour UNE station : additionner les
        // créneaux de deux stations donnerait un chiffre qui ne
        // correspond à aucune réalité.
        $payload['load'] = $stationId !== null && $from === $to
            ? $repository->loadByHour($stationId, $from)
            : [];

        Response::success($payload);
    }

    /** GET /api/bookings/{id} */
    public function show(Request $request, string $id): void
    {
        $booking = (new BookingRepository())->findDetailed((int) $id);

        if ($booking === null) {
            Response::notFound("Ce rendez-vous n'existe pas.");
        }

        Response::success(['booking' => $this->present($booking)]);
    }

    /**
     * POST /api/bookings
     * Le client est au téléphone.
     */
    public function store(Request $request): void
    {
        $validator = Validator::make($request->body())
            ->required('customer_name', 'Le nom du client')
            ->required('customer_phone', 'Le téléphone')
            ->phone('customer_phone')
            ->required('service_id', 'La prestation')
            ->required('station_id', 'La station')
            ->required('scheduled_at', 'La date et l\'heure')
            ->maxLength('customer_name', 160)
            ->maxLength('notes', 1000);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $stationId = (int) $validator->string('station_id');
        $serviceId = (int) $validator->string('service_id');

        $station = (new StationRepository())->find($stationId);

        if ($station === null) {
            Response::validationFailed(['station_id' => "Cette station n'existe pas."]);
        }

        if (!AuthContext::current()->canAccessStation($stationId)) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        $service = (new ServiceRepository())->find($serviceId);

        if ($service === null) {
            Response::validationFailed(['service_id' => "Cette prestation n'existe pas."]);
        }

        // À la PRISE de rendez-vous, on refuse une prestation retirée
        // du catalogue : promettre ce qu'on ne fait plus, c'est
        // organiser une déception. À l'ARRIVÉE, en revanche, on
        // l'honore — voir `arrive()`.
        if (($service['status'] ?? '') !== 'ACTIVE') {
            Response::validationFailed([
                'service_id' => "Cette prestation n'est plus proposée. Choisissez-en une autre.",
            ]);
        }

        $scheduledAt = $this->readScheduledAt($validator->string('scheduled_at'));

        $vehicle = $this->readVehicle($request);

        $repository = new BookingRepository();
        $duration   = (int) ($service['duration_minutes'] ?? 30);

        $bookingId = $repository->create([
            'station_id' => $stationId,
            'service_id' => $serviceId,
            // Le client et le véhicule sont FACULTATIFS : au téléphone,
            // un nom et un numéro suffisent.
            'vehicle_id'  => $vehicle === null ? null : (int) $vehicle['id'],
            // Comme pour les opérations, le client est DÉDUIT du
            // véhicule et jamais lu dans la requête : un formulaire
            // modifié ne peut pas rattacher un rendez-vous au client
            // de quelqu'un d'autre.
            'customer_id' => $vehicle === null ? null : (int) $vehicle['customer_id'],
            'customer_name'  => $validator->string('customer_name'),
            'customer_phone' => $validator->string('customer_phone'),
            'plate_number'   => $this->readPlate($request, $vehicle),
            'scheduled_at'   => $scheduledAt->format('Y-m-d H:i:s'),
            // Durée ET prix recopiés du catalogue : c'est ce qui a été
            // annoncé au client au téléphone. Voir la note de la
            // migration 019.
            'duration_minutes' => $duration,
            'price'  => (int) $service['price'],
            'status' => 'SCHEDULED',
            'notes'  => $validator->stringOrNull('notes'),
            'created_by_user_id' => AuthContext::current()->userId,
        ]);

        AuditLogger::record(
            action: 'booking.created',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'booking',
            entityId: $bookingId,
            metadata: [
                'scheduled_at' => $scheduledAt->format('Y-m-d H:i'),
                'customer' => $validator->string('customer_name'),
                'service' => $service['name'] ?? '',
                'price' => (int) $service['price'],
            ],
        );

        Response::success(
            [
                'booking' => $this->present($repository->findDetailed($bookingId) ?? []),
                // Le serveur ne refuse pas, il prévient. Le frontend
                // affiche ces phrases sous le formulaire, après
                // l'enregistrement : le rendez-vous est pris, et la
                // personne au comptoir sait ce qu'elle vient de faire.
                'warnings' => $this->warnings(
                    $station,
                    $scheduledAt,
                    $duration,
                    $repository->overlappingCount($stationId, $scheduledAt->format('Y-m-d H:i:s'), $duration, $bookingId),
                ),
            ],
            sprintf(
                'Rendez-vous noté pour le %s à %s.',
                $scheduledAt->format('d/m/Y'),
                $scheduledAt->format('H:i')
            ),
            201
        );
    }

    /**
     * PUT /api/bookings/{id}
     * Déplacer l'heure, corriger un numéro, changer la prestation.
     */
    public function update(Request $request, string $id): void
    {
        $bookingId  = (int) $id;
        $repository = new BookingRepository();
        $booking    = $repository->findDetailed($bookingId);

        if ($booking === null) {
            Response::notFound("Ce rendez-vous n'existe pas.");
        }

        // UN RENDEZ-VOUS TERMINÉ NE SE MODIFIE PLUS.
        // Déplacer l'heure d'un client déjà venu réécrirait ce qui
        // s'est passé ; déplacer celle d'une absence la ferait
        // disparaître.
        if (BookingStatus::isFinal((string) $booking['status'])) {
            Response::error(
                sprintf(
                    'Ce rendez-vous est « %s » : il ne se modifie plus. '
                    . 'Si le client reprend un créneau, notez un nouveau rendez-vous.',
                    BookingStatus::label((string) $booking['status'])
                ),
                [],
                409
            );
        }

        if (!AuthContext::current()->canAccessStation((int) $booking['station_id'])) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        $body    = $request->body();
        $changes = [];
        $before  = [];

        if (array_key_exists('customer_name', $body)) {
            $name = trim((string) $body['customer_name']);

            if ($name === '') {
                Response::validationFailed(['customer_name' => 'Le nom du client est obligatoire.']);
            }

            $changes['customer_name'] = mb_substr($name, 0, 160);
        }

        if (array_key_exists('customer_phone', $body)) {
            $validator = Validator::make($body)->required('customer_phone', 'Le téléphone')->phone('customer_phone');

            if ($validator->fails()) {
                Response::validationFailed($validator->errors());
            }

            $changes['customer_phone'] = $validator->string('customer_phone');
        }

        if (array_key_exists('notes', $body)) {
            $notes = trim((string) ($body['notes'] ?? ''));
            $changes['notes'] = $notes === '' ? null : mb_substr($notes, 0, 1000);
        }

        $service  = null;
        $duration = (int) $booking['duration_minutes'];

        if (!empty($body['service_id']) && (int) $body['service_id'] !== (int) $booking['service_id']) {
            $service = (new ServiceRepository())->find((int) $body['service_id']);

            if ($service === null) {
                Response::validationFailed(['service_id' => "Cette prestation n'existe pas."]);
            }

            if (($service['status'] ?? '') !== 'ACTIVE') {
                Response::validationFailed([
                    'service_id' => "Cette prestation n'est plus proposée. Choisissez-en une autre.",
                ]);
            }

            $duration = (int) ($service['duration_minutes'] ?? 30);

            // CHANGER LA PRESTATION REFIXE LE PRIX.
            // Ce n'est pas contradictoire avec « le prix est figé » :
            // ce qui est figé, c'est le prix DE CE QUI A ÉTÉ PROMIS.
            // Un client qui passe du lavage simple au complet accepte
            // le tarif du complet — celui d'aujourd'hui, puisque c'est
            // aujourd'hui qu'on le lui annonce.
            $changes['service_id'] = (int) $service['id'];
            $changes['duration_minutes'] = $duration;
            $changes['price'] = (int) $service['price'];
            $before['service'] = $booking['service_name'];
        }

        $scheduledAt = null;

        if (!empty($body['scheduled_at'])) {
            $scheduledAt = $this->readScheduledAt((string) $body['scheduled_at']);

            if ($scheduledAt->format('Y-m-d H:i:s') !== (string) $booking['scheduled_at']) {
                $changes['scheduled_at'] = $scheduledAt->format('Y-m-d H:i:s');
                $before['scheduled_at'] = $booking['scheduled_at'];
            }
        }

        if ($changes === []) {
            Response::error('Aucune modification à enregistrer.', [], 422);
        }

        $repository->update($bookingId, $changes);

        AuditLogger::record(
            action: 'booking.updated',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $booking['station_id'],
            entityType: 'booking',
            entityId: $bookingId,
            // L'avant ET l'après, comme pour la correction d'un
            // pointage : un déplacement d'heure se conteste, et une
            // trace qui ne garde que la nouvelle valeur ne prouve rien.
            metadata: ['from' => $before, 'to' => $changes],
        );

        $updated = $repository->findDetailed($bookingId) ?? [];
        $moment  = $scheduledAt ?? new DateTimeImmutable((string) $booking['scheduled_at']);

        Response::success(
            [
                'booking' => $this->present($updated),
                'warnings' => $this->warnings(
                    (new StationRepository())->find((int) $booking['station_id']) ?? [],
                    $moment,
                    $duration,
                    $repository->overlappingCount(
                        (int) $booking['station_id'],
                        $moment->format('Y-m-d H:i:s'),
                        $duration,
                        $bookingId,
                    ),
                ),
            ],
            'Rendez-vous modifié.'
        );
    }

    /**
     * PUT /api/bookings/{id}/status
     * Confirmé, absent, annulé.
     */
    public function changeStatus(Request $request, string $id): void
    {
        $bookingId  = (int) $id;
        $repository = new BookingRepository();
        $booking    = $repository->findDetailed($bookingId);

        if ($booking === null) {
            Response::notFound("Ce rendez-vous n'existe pas.");
        }

        $validator = Validator::make($request->body())
            ->required('status', 'Le statut')
            ->maxLength('reason', 255);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $current = (string) $booking['status'];
        $target  = strtoupper($validator->string('status'));

        if (!BookingStatus::exists($target)) {
            Response::validationFailed(['status' => "Ce statut n'existe pas."]);
        }

        // ARRIVED a sa propre route, parce qu'il ouvre un dossier.
        if (BookingStatus::isRouteOnly($target)) {
            Response::error(BookingStatus::refusalMessage($current, $target), [], 422);
        }

        if (!BookingStatus::canTransition($current, $target)) {
            Response::error(BookingStatus::refusalMessage($current, $target), [], 409);
        }

        if (!AuthContext::current()->canAccessStation((int) $booking['station_id'])) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        // ==============================================================
        // ON NE DÉCLARE PAS UNE ABSENCE AVANT L'HEURE
        // ==============================================================
        // Marquer « absent » un rendez-vous qui n'a pas encore eu lieu
        // n'est pas une information : c'est une erreur de saisie, ou
        // un employé qui solde sa journée d'avance. Le délai de grâce
        // évite l'autre extrême — un client à 10 h 05 n'est pas absent.
        if ($target === 'NO_SHOW') {
            $grace = BookingStatus::noShowGraceMinutes();
            $limit = (new DateTimeImmutable((string) $booking['scheduled_at']))
                ->modify("+{$grace} minutes");

            if ($limit > new DateTimeImmutable()) {
                Response::error(
                    sprintf(
                        'Ce rendez-vous est prévu à %s : on ne déclare une absence qu\'au bout de %d minutes d\'attente.',
                        (new DateTimeImmutable((string) $booking['scheduled_at']))->format('H:i'),
                        $grace
                    ),
                    [],
                    422
                );
            }
        }

        // LE MOTIF N'EST PAS OBLIGATOIRE, ET C'EST VOLONTAIRE.
        //
        // Au lot 12, corriger un pointage EXIGE un motif : la
        // modification change ce qu'on doit à quelqu'un. Ici, rien de
        // tel — un client annule, cela arrive.
        //
        // Exiger une justification partout apprend à taper « x » pour
        // passer l'écran, et le champ ne vaut alors plus rien là où il
        // compte vraiment.
        $reason = $validator->stringOrNull('reason');

        $repository->update($bookingId, [
            'status' => $target,
            'outcome_at' => date('Y-m-d H:i:s'),
            'outcome_by_user_id' => AuthContext::current()->userId,
            'outcome_reason' => $reason,
        ]);

        AuditLogger::record(
            action: 'booking.status_changed',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $booking['station_id'],
            entityType: 'booking',
            entityId: $bookingId,
            metadata: ['from' => $current, 'to' => $target, 'reason' => $reason],
        );

        Response::success(
            ['booking' => $this->present($repository->findDetailed($bookingId) ?? [])],
            $this->confirmationFor($target)
        );
    }

    /**
     * POST /api/bookings/{id}/arrive
     * ==================================================================
     * LE CLIENT EST LÀ : LE RENDEZ-VOUS DEVIENT UN DOSSIER.
     * ==================================================================
     *
     * Deux écritures, une seule transaction. Ouvrir le dossier sans
     * solder le rendez-vous laisserait le client dans la liste des
     * gens à rappeler alors que sa voiture est en train d'être lavée ;
     * solder le rendez-vous sans ouvrir le dossier ferait disparaître
     * un véhicule présent sur le parking.
     */
    public function arrive(Request $request, string $id): void
    {
        $bookingId  = (int) $id;
        $repository = new BookingRepository();
        $booking    = $repository->findDetailed($bookingId);

        if ($booking === null) {
            Response::notFound("Ce rendez-vous n'existe pas.");
        }

        if (BookingStatus::isFinal((string) $booking['status'])) {
            Response::error(
                sprintf(
                    'Ce rendez-vous est déjà « %s ».',
                    BookingStatus::label((string) $booking['status'])
                ),
                [],
                409
            );
        }

        $stationId = (int) $booking['station_id'];

        if (!AuthContext::current()->canAccessStation($stationId)) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        // Le véhicule vient du rendez-vous quand il y était rattaché,
        // sinon de l'écran d'accueil : au téléphone on note une
        // plaque, au comptoir on ouvre une fiche véhicule.
        $vehicle = $this->readVehicle($request) ?? (
            $booking['vehicle_id'] === null
                ? null
                : (new VehicleRepository())->find((int) $booking['vehicle_id'])
        );

        if ($vehicle === null) {
            Response::validationFailed([
                'vehicle_id' => 'Indiquez le véhicule : c\'est lui qui porte le dossier.',
            ]);
        }

        $operations = new OperationRepository();
        $open       = $operations->openOperationFor((int) $vehicle['id']);

        if ($open !== null) {
            Response::error(
                sprintf(
                    'Ce véhicule a déjà un dossier en cours (%s). Ouvrez-le plutôt que d\'en créer un second.',
                    $open['reference']
                ),
                ['vehicle_id' => 'Dossier déjà ouvert : ' . $open['reference']],
                409
            );
        }

        $station = (new StationRepository())->find($stationId);

        if ($station === null) {
            Response::error("La station de ce rendez-vous n'existe plus.", [], 409);
        }

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $created = $operations->createWithReference((string) $station['code'], [
                'station_id'  => $stationId,
                'vehicle_id'  => (int) $vehicle['id'],
                'customer_id' => (int) $vehicle['customer_id'],
                'service_id'  => (int) $booking['service_id'],
                'status'      => 'WAITING',
                // ==================================================
                // LE PRIX VIENT DU RENDEZ-VOUS, PAS DU CATALOGUE.
                // ==================================================
                // C'est toute la raison d'être de la colonne `price`
                // sur `bookings`. Le client a réservé à 5 000 F il y a
                // trois semaines ; le tarif est passé à 6 000 F depuis.
                // Il paie 5 000 F : c'est ce qu'on lui a dit.
                //
                // Pour la même raison, on ne vérifie PAS ici que la
                // prestation est toujours au catalogue. Retirer une
                // prestation n'annule pas les rendez-vous déjà pris.
                'price'    => (int) $booking['price'],
                'priority' => 0,
                'notes'    => $this->arrivalNotes($booking),
                'created_by_user_id' => AuthContext::current()->userId,
            ]);

            $repository->update($bookingId, [
                'status' => 'ARRIVED',
                'operation_id' => $created['id'],
                'vehicle_id' => (int) $vehicle['id'],
                'customer_id' => (int) $vehicle['customer_id'],
                'outcome_at' => date('Y-m-d H:i:s'),
                'outcome_by_user_id' => AuthContext::current()->userId,
            ]);

            $connection->commit();
        } catch (PDOException $exception) {
            $connection->rollBack();

            throw $exception;
        }

        AuditLogger::record(
            action: 'booking.arrived',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'booking',
            entityId: $bookingId,
            metadata: [
                'operation_id' => $created['id'],
                'reference' => $created['reference'],
                'plate' => $vehicle['plate_number'],
                // Le prix honoré, et celui du jour : c'est la trace de
                // ce qu'on a choisi de ne pas facturer.
                'price_honoured' => (int) $booking['price'],
            ],
        );

        Response::success(
            [
                'booking' => $this->present($repository->findDetailed($bookingId) ?? []),
                'operation' => OperationPresenter::present($operations->findDetailed($created['id']) ?? []),
            ],
            'Dossier ' . $created['reference'] . ' ouvert.',
            201
        );
    }

    // ==================================================================

    /**
     * Les phrases que le serveur renvoie sans rien refuser.
     *
     * @param array<string,mixed> $station
     * @return list<string>
     */
    private function warnings(
        array $station,
        DateTimeImmutable $scheduledAt,
        int $durationMinutes,
        int $alreadyBooked,
    ): array {
        $warnings = [];

        if ($alreadyBooked > 0) {
            $warnings[] = sprintf(
                '%d véhicule%s déjà attendu%s sur ce créneau.',
                $alreadyBooked,
                $alreadyBooked > 1 ? 's' : '',
                $alreadyBooked > 1 ? 's' : '',
            );
        }

        // Hors des horaires d'ouverture : le plus souvent une faute de
        // frappe (14 h saisi 04 h), parfois un choix assumé pour un
        // habitué. On le dit, on ne l'empêche pas.
        $opens  = $station['opens_at']  ?? null;
        $closes = $station['closes_at'] ?? null;

        if (is_string($opens) && is_string($closes) && $opens !== '' && $closes !== '') {
            $start = $scheduledAt->format('H:i:s');
            $end   = $scheduledAt->modify("+{$durationMinutes} minutes")->format('H:i:s');

            if ($start < $opens || $start > $closes) {
                $warnings[] = sprintf(
                    'La station ouvre de %s à %s.',
                    substr($opens, 0, 5),
                    substr($closes, 0, 5),
                );
            } elseif ($end > $closes) {
                $warnings[] = sprintf(
                    'La prestation finirait après la fermeture (%s).',
                    substr($closes, 0, 5),
                );
            }
        }

        return $warnings;
    }

    /**
     * Lit et vérifie l'heure du rendez-vous.
     *
     * Accepte « 2026-09-10 10:00 » et « 2026-09-10T10:00 », la seconde
     * forme étant celle qu'envoie un champ `datetime-local`.
     */
    private function readScheduledAt(string $raw): DateTimeImmutable
    {
        $normalized = str_replace('T', ' ', trim($raw));

        try {
            $moment = new DateTimeImmutable($normalized);
        } catch (\Exception) {
            Response::validationFailed(['scheduled_at' => "Cette date n'est pas lisible."]);
        }

        $now = new DateTimeImmutable();

        // Un rendez-vous dans le passé est une faute de frappe, pas un
        // projet. On tolère la minute en cours : le client peut
        // arriver pendant qu'on note.
        if ($moment < $now->modify('-2 minutes')) {
            Response::validationFailed([
                'scheduled_at' => 'Un rendez-vous se prend pour plus tard, pas pour hier.',
            ]);
        }

        $maxDays = BookingStatus::maxDaysAhead();

        if ($moment > $now->modify("+{$maxDays} days")) {
            Response::validationFailed([
                'scheduled_at' => sprintf(
                    'Au-delà de %d jours, les tarifs et les horaires auront changé : le prix annoncé ne tiendrait plus.',
                    $maxDays
                ),
            ]);
        }

        return $moment;
    }

    /**
     * Le véhicule, s'il a été indiqué.
     *
     * @return array<string,mixed>|null
     */
    private function readVehicle(Request $request): ?array
    {
        $vehicleId = $request->input('vehicle_id');

        if ($vehicleId === null || $vehicleId === '') {
            return null;
        }

        $vehicle = (new VehicleRepository())->find((int) $vehicleId);

        if ($vehicle === null) {
            Response::validationFailed(['vehicle_id' => "Ce véhicule n'existe pas."]);
        }

        return $vehicle;
    }

    /**
     * La plaque annoncée, normalisée comme partout ailleurs.
     *
     * @param array<string,mixed>|null $vehicle
     */
    private function readPlate(Request $request, ?array $vehicle): ?string
    {
        if ($vehicle !== null) {
            return (string) $vehicle['plate_number'];
        }

        $plate = trim((string) ($request->input('plate_number') ?? ''));

        return $plate === '' ? null : PlateNumber::normalize($plate);
    }

    /**
     * Ce qu'on recopie sur le dossier à l'ouverture.
     *
     * @param array<string,mixed> $booking
     */
    private function arrivalNotes(array $booking): ?string
    {
        $parts = ['Sur rendez-vous du ' . substr((string) $booking['scheduled_at'], 0, 16) . '.'];

        $notes = trim((string) ($booking['notes'] ?? ''));

        if ($notes !== '') {
            $parts[] = $notes;
        }

        return implode(' ', $parts);
    }

    private function confirmationFor(string $status): string
    {
        return match ($status) {
            'CONFIRMED' => 'Rendez-vous confirmé.',
            'NO_SHOW'   => 'Absence enregistrée.',
            'CANCELLED' => 'Rendez-vous annulé.',
            default     => 'Rendez-vous mis à jour.',
        };
    }

    private function readDate(?string $value): ?string
    {
        if ($value === null || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return null;
        }

        return $value;
    }

    /**
     * La forme envoyée au frontend.
     *
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function present(array $row): array
    {
        if ($row === []) {
            return [];
        }

        $scheduledAt = (string) $row['scheduled_at'];
        $status      = (string) $row['status'];

        return [
            'id' => (int) $row['id'],
            'station_id'   => (int) $row['station_id'],
            'station_name' => $row['station_name'] ?? null,
            'service_id'   => (int) $row['service_id'],
            'service_name' => $row['service_name'] ?? null,

            'customer_id'    => $row['customer_id'] === null ? null : (int) $row['customer_id'],
            'customer_name'  => (string) $row['customer_name'],
            'customer_phone' => (string) $row['customer_phone'],
            'vehicle_id'     => $row['vehicle_id'] === null ? null : (int) $row['vehicle_id'],
            'plate_number'   => $row['plate_number'] === null
                ? null
                : PlateNumber::format((string) $row['plate_number']),
            'vehicle_label'  => $this->vehicleLabel($row),

            // Format ISO pour la machine, découpé pour l'écran : le
            // frontend n'a pas à savoir découper une date.
            'scheduled_at'   => $scheduledAt,
            'scheduled_date' => substr($scheduledAt, 0, 10),
            'scheduled_time' => substr($scheduledAt, 11, 5),
            'duration_minutes' => (int) $row['duration_minutes'],
            'price' => (int) $row['price'],

            'status' => $status,
            'status_label' => BookingStatus::label($status),
            'is_open' => in_array($status, BookingStatus::open(), true),
            'allowed_next' => BookingStatus::directlySettableFrom($status),

            'operation_id' => $row['operation_id'] === null ? null : (int) $row['operation_id'],
            'operation_reference' => $row['operation_reference'] ?? null,

            'outcome_at' => $row['outcome_at'],
            'outcome_by_name' => $row['outcome_by_name'] ?? null,
            'outcome_reason' => $row['outcome_reason'] ?? null,

            'notes' => $row['notes'],
            'created_by_name' => $row['created_by_name'] ?? null,
            'created_at' => $row['created_at'],
        ];
    }

    /** @param array<string,mixed> $row */
    private function vehicleLabel(array $row): ?string
    {
        $brand = trim((string) ($row['vehicle_brand'] ?? ''));
        $model = trim((string) ($row['vehicle_model'] ?? ''));
        $label = trim($brand . ' ' . $model);

        return $label === '' ? null : $label;
    }
}
