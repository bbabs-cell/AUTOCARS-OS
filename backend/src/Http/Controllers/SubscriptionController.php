<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Database;
use Autocare\Core\LoyaltyLedger;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Http\Presenters\OperationPresenter;
use Autocare\Models\CashSessionRepository;
use Autocare\Models\CustomerRepository;
use Autocare\Models\OperationRepository;
use Autocare\Models\PaymentRepository;
use Autocare\Models\ServiceRepository;
use Autocare\Models\SubscriptionPlanRepository;
use Autocare\Models\SubscriptionRepository;
use DateTimeImmutable;
use PDOException;

/**
 * Les abonnements
 * ==================================================================
 * DES LAVAGES PAYÉS D'AVANCE.
 * ==================================================================
 *
 * « 10 lavages standard pour 40 000 F, valables 6 mois. »
 *
 * ------------------------------------------------------------------
 * LA QUESTION COMPTABLE, ET LA RÉPONSE
 *
 * Un client paie 40 000 F aujourd'hui pour des lavages qu'il prendra
 * sur six mois. Est-ce la recette d'aujourd'hui ?
 *
 * En comptabilité d'engagement, non : ce sont des produits constatés
 * d'avance. Ce produit ne fait PAS cette comptabilité, et c'est un
 * choix assumé :
 *
 *   · L'ARGENT EST BIEN ENTRÉ DANS LE TIROIR AUJOURD'HUI. Il doit
 *     être dans la caisse du soir, et la clôture doit tomber juste.
 *     Une caisse fausse est le pire défaut possible de ce produit.
 *   · Un gérant de station à Dakar ne tient pas une comptabilité
 *     d'engagement. Lui afficher « 4 000 F encaissés » un jour où il
 *     en a reçu 40 000 le ferait douter du logiciel, à raison.
 *
 * La vente d'un forfait est donc un ENCAISSEMENT ORDINAIRE : même
 * table, même route, même caisse, même journal. Les lavages qui
 * suivent ne rapportent rien — ils ont déjà été payés.
 *
 * EN ÉCHANGE, ce module apporte le chiffre qui manquerait sinon :
 * CE QUI RESTE À LIVRER. Une station qui a vendu 200 lavages d'avance
 * doit 200 lavages. C'est une dette, et elle se voit.
 *
 * ------------------------------------------------------------------
 * UN LAVAGE D'ABONNÉ N'EST PAS UN CADEAU
 *
 * Le lot 14 a créé la remise (`discount_amount`) pour la fidélité.
 * Un lavage couvert par un forfait ramène lui aussi le dû à zéro et
 * emprunte la même colonne — mais `discount_source` les distingue, et
 * ce n'est pas un détail :
 *
 *   FIDÉLITÉ     la station DONNE. C'est un coût.
 *   ABONNEMENT   le client a DÉJÀ PAYÉ. C'est une dette qu'on solde.
 *
 * Sans cette distinction, l'écran de fidélité annoncerait au gérant
 * qu'il offre un argent qu'il a en réalité encaissé six mois plus
 * tôt.
 */
final class SubscriptionController
{
    // ==================================================================
    // LES FORFAITS PROPOSÉS
    // ==================================================================

    /** GET /api/subscriptions/plans?active=1 */
    public function plans(Request $request): void
    {
        $plans = (new SubscriptionPlanRepository())
            ->listDetailed($request->query('active') === '1');

        Response::success(['plans' => array_map($this->presentPlan(...), $plans)]);
    }

    /** POST /api/subscriptions/plans */
    public function storePlan(Request $request): void
    {
        $data = $this->readPlan($request);

        $repository = new SubscriptionPlanRepository();
        $id = $repository->create($data + ['created_by_user_id' => AuthContext::current()->userId]);

        AuditLogger::record(
            action: 'subscription.plan_created',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: null,
            entityType: 'subscription_plan',
            entityId: $id,
            metadata: $data,
        );

        Response::success(
            ['plan' => $this->presentPlan($repository->findDetailed($id) ?? [])],
            'Forfait créé.',
            201
        );
    }

    /** PUT /api/subscriptions/plans/{id} */
    public function updatePlan(Request $request, string $id): void
    {
        $planId     = (int) $id;
        $repository = new SubscriptionPlanRepository();
        $existing   = $repository->findDetailed($planId);

        if ($existing === null) {
            Response::notFound("Ce forfait n'existe pas.");
        }

        $data = $this->readPlan($request);

        $repository->update($planId, $data);

        AuditLogger::record(
            action: 'subscription.plan_updated',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: null,
            entityType: 'subscription_plan',
            entityId: $planId,
            // L'avant ET l'après : modifier un forfait ne change RIEN
            // aux abonnements déjà vendus, mais il faut pouvoir
            // expliquer pourquoi deux clients ont des droits
            // différents sur le même produit.
            metadata: [
                'from' => [
                    'washes' => (int) $existing['washes'],
                    'price' => (int) $existing['price'],
                    'validity_days' => (int) $existing['validity_days'],
                    'status' => $existing['status'],
                ],
                'to' => $data,
            ],
        );

        Response::success(
            ['plan' => $this->presentPlan($repository->findDetailed($planId) ?? [])],
            'Forfait modifié. Les abonnements déjà vendus ne changent pas.'
        );
    }

    // ==================================================================
    // LES ABONNEMENTS VENDUS
    // ==================================================================

    /** GET /api/subscriptions?customer_id=&usable=1&search= */
    public function index(Request $request): void
    {
        $filters = [];

        foreach (['customer_id', 'station_id', 'plan_id'] as $key) {
            $value = $request->query($key);

            if ($value !== null && $value !== '') {
                $filters[$key] = (int) $value;
            }
        }

        if ($request->query('usable') === '1') {
            $filters['usable'] = true;
        }

        $search = $request->query('search');

        if ($search !== null && $search !== '') {
            $filters['search'] = $search;
        }

        $repository = new SubscriptionRepository();

        Response::success([
            'subscriptions' => array_map($this->present(...), $repository->listDetailed($filters)),
        ]);
    }

    /**
     * GET /api/subscriptions/overview?from=&to=
     *
     * Le bilan : ce qui a été vendu, ce qui a été livré, et surtout
     * CE QUI RESTE À LIVRER.
     */
    public function overview(Request $request): void
    {
        $from = $this->readDate($request->query('from')) ?? date('Y-m-01');
        $to   = $this->readDate($request->query('to')) ?? date('Y-m-d');

        $repository = new SubscriptionRepository();

        Response::success([
            'sold' => $repository->soldBetween($from, $to),
            'delivered' => [
                'washes' => $repository->deliveredBetween($from, $to),
                // La VALEUR de ce qui a été livré, au prix des
                // prestations. Ce n'est pas de la recette — elle a été
                // encaissée le jour de la vente — c'est de la dette
                // soldée. Les deux chiffres côte à côte disent si la
                // station livre plus vite qu'elle ne vend.
                'value' => (new OperationRepository())
                    ->discountTotal($from, $to, null, 'SUBSCRIPTION'),
            ],
            // ==============================================================
            // LA DETTE. Le chiffre qui n'existerait pas sans ce module.
            // ==============================================================
            'outstanding' => $repository->outstanding(),
            // Ceux dont le forfait se périme bientôt : un appel, et le
            // client vient user ce qu'il a payé. C'est le seul bloc
            // actionnable de l'écran.
            'expiring' => array_map(
                $this->present(...),
                array_filter(
                    $repository->listDetailed(['usable' => true]),
                    static fn (array $row): bool =>
                        (new DateTimeImmutable((string) $row['expires_at']))
                            <= (new DateTimeImmutable())->modify('+30 days'),
                ),
            ),
            'period' => ['from' => $from, 'to' => $to],
        ]);
    }

    /** GET /api/subscriptions/{id} */
    public function show(Request $request, string $id): void
    {
        $subscription = (new SubscriptionRepository())->findDetailed((int) $id);

        if ($subscription === null) {
            Response::notFound("Cet abonnement n'existe pas.");
        }

        Response::success([
            'subscription' => $this->present($subscription),
            // Les lavages déjà pris : c'est ce que le client demande
            // quand il conteste son solde.
            'operations' => array_map(
                OperationPresenter::present(...),
                (new OperationRepository())->listDetailed(['subscription_id' => (int) $id]),
            ),
        ]);
    }

    /**
     * POST /api/subscriptions
     * ==================================================================
     * VENDRE UN FORFAIT.
     * ==================================================================
     * Deux écritures, une seule transaction : l'abonnement et
     * l'encaissement. L'un sans l'autre, et soit le client a payé sans
     * rien recevoir, soit la station a donné dix lavages sans
     * contrepartie dans la caisse.
     */
    public function store(Request $request): void
    {
        $validator = Validator::make($request->body())
            ->required('customer_id', 'Le client')
            ->required('plan_id', 'Le forfait')
            ->required('station_id', 'La station')
            ->required('method', 'Le moyen de paiement')
            ->in('method', ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER'])
            ->maxLength('notes', 1000);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $customerId = (int) $validator->string('customer_id');
        $planId     = (int) $validator->string('plan_id');
        $stationId  = (int) $validator->string('station_id');
        $method     = $validator->string('method');

        if (!AuthContext::current()->canAccessStation($stationId)) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        $customer = (new CustomerRepository())->find($customerId);

        if ($customer === null) {
            Response::validationFailed(['customer_id' => "Ce client n'existe pas."]);
        }

        $plan = (new SubscriptionPlanRepository())->findDetailed($planId);

        if ($plan === null) {
            Response::validationFailed(['plan_id' => "Ce forfait n'existe pas."]);
        }

        if ((string) $plan['status'] !== 'ACTIVE') {
            Response::validationFailed([
                'plan_id' => "Ce forfait n'est plus proposé. Choisissez-en un autre.",
            ]);
        }

        // La prestation couverte doit exister encore : vendre dix
        // lavages d'une prestation retirée du catalogue, c'est vendre
        // quelque chose qu'on ne sait plus faire.
        if ((string) ($plan['service_status'] ?? '') !== 'ACTIVE') {
            Response::validationFailed([
                'plan_id' => "La prestation de ce forfait n'est plus proposée.",
            ]);
        }

        $today   = new DateTimeImmutable();
        $expires = $today->modify('+' . max(1, (int) $plan['validity_days']) . ' days');

        $subscriptions = new SubscriptionRepository();
        $payments      = new PaymentRepository();

        $cashSessionId = $this->currentCashSessionId($stationId);

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $subscriptionId = $subscriptions->create([
                'customer_id' => $customerId,
                'plan_id'     => $planId,
                'station_id'  => $stationId,
                // TOUT EST RECOPIÉ : modifier le forfait le mois
                // prochain ne doit rien retirer à ce client.
                'service_id'   => (int) $plan['service_id'],
                'washes_total' => (int) $plan['washes'],
                'price_paid'   => (int) $plan['price'],
                'starts_at'    => $today->format('Y-m-d'),
                'expires_at'   => $expires->format('Y-m-d'),
                'status'       => 'ACTIVE',
                'notes'        => $validator->stringOrNull('notes'),
                'sold_by_user_id' => AuthContext::current()->userId,
            ]);

            // L'ENCAISSEMENT PASSE PAR LA TABLE HABITUELLE. Il entre
            // donc dans la caisse, dans le journal et dans la recette
            // du jour sans qu'on ait rien à ajouter — et il pourra
            // être remboursé par la route existante.
            $paymentId = $payments->create([
                'station_id'      => $stationId,
                'cash_session_id' => $cashSessionId,
                'operation_id'    => null,
                'subscription_id' => $subscriptionId,
                'customer_id'     => $customerId,
                'amount'          => (int) $plan['price'],
                'method'          => $method,
                'provider'        => $validator->stringOrNull('provider'),
                'external_reference' => $validator->stringOrNull('external_reference'),
                'status'          => 'PAID',
                'paid_at'         => date('Y-m-d H:i:s'),
                'recorded_by_user_id' => AuthContext::current()->userId,
                'notes'           => sprintf('Forfait « %s »', $plan['name']),
            ]);

            $connection->commit();
        } catch (PDOException $exception) {
            $connection->rollBack();

            throw $exception;
        }

        AuditLogger::record(
            action: 'subscription.sold',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'subscription',
            entityId: $subscriptionId,
            metadata: [
                'customer_id' => $customerId,
                'plan' => $plan['name'],
                'washes' => (int) $plan['washes'],
                'amount' => (int) $plan['price'],
                'method' => $method,
                'payment_id' => $paymentId,
                'expires_at' => $expires->format('Y-m-d'),
            ],
        );

        $warnings = [];

        // Même avertissement qu'au lot 9 : un encaissement en espèces
        // hors session de caisse ne sera pas dans la clôture du soir.
        if ($method === 'CASH' && $cashSessionId === null) {
            $warnings[] = 'La caisse n\'est pas ouverte : cet encaissement ne sera pas dans la clôture du soir.';
        }

        Response::success(
            [
                'subscription' => $this->present($subscriptions->findDetailed($subscriptionId) ?? []),
                'warnings' => $warnings,
            ],
            sprintf(
                '%s vendu : %d lavages jusqu\'au %s.',
                $plan['name'],
                (int) $plan['washes'],
                $expires->format('d/m/Y')
            ),
            201
        );
    }

    /**
     * POST /api/subscriptions/{id}/cancel
     *
     * ON N'INVENTE AUCUN REMBOURSEMENT AU PRORATA. Combien rendre à un
     * client qui a pris trois lavages sur dix est une décision
     * commerciale, pas un calcul : le forfait était vendu moins cher
     * que trois lavages à l'unité, et la station peut vouloir garder
     * la différence, ou pas.
     *
     * L'annulation ARRÊTE le forfait. Le remboursement éventuel passe
     * par la route de remboursement existante, sur l'encaissement
     * d'origine — là où il est tracé comme n'importe quelle sortie
     * d'argent.
     */
    public function cancel(Request $request, string $id): void
    {
        $subscriptionId = (int) $id;
        $repository     = new SubscriptionRepository();
        $subscription   = $repository->findDetailed($subscriptionId);

        if ($subscription === null) {
            Response::notFound("Cet abonnement n'existe pas.");
        }

        if ((string) $subscription['status'] === 'CANCELLED') {
            Response::error('Cet abonnement est déjà annulé.', [], 409);
        }

        $validator = Validator::make($request->body())
            ->required('reason', 'Le motif')
            ->maxLength('reason', 255);

        // LE MOTIF EST OBLIGATOIRE ICI, contrairement à l'annulation
        // d'un rendez-vous (lot 13). La différence : de l'argent a été
        // encaissé. Un client qui réclame six mois plus tard doit
        // trouver une explication, pas une ligne muette.
        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $repository->update($subscriptionId, [
            'status' => 'CANCELLED',
            'cancelled_at' => date('Y-m-d H:i:s'),
            'cancelled_by_user_id' => AuthContext::current()->userId,
            'cancellation_reason' => $validator->string('reason'),
        ]);

        AuditLogger::record(
            action: 'subscription.cancelled',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $subscription['station_id'],
            entityType: 'subscription',
            entityId: $subscriptionId,
            metadata: [
                'reason' => $validator->string('reason'),
                'washes_used' => (int) $subscription['washes_used'],
                'washes_total' => (int) $subscription['washes_total'],
                'price_paid' => (int) $subscription['price_paid'],
            ],
        );

        $remaining = max(0, (int) $subscription['washes_total'] - (int) $subscription['washes_used']);

        Response::success(
            ['subscription' => $this->present($repository->findDetailed($subscriptionId) ?? [])],
            $remaining > 0
                ? sprintf(
                    'Abonnement annulé. Il restait %d lavage(s) : un remboursement éventuel se fait depuis le journal des encaissements.',
                    $remaining
                )
                : 'Abonnement annulé.'
        );
    }

    // ==================================================================
    // CONSOMMER UN LAVAGE
    // ==================================================================

    /**
     * POST /api/subscriptions/use
     *
     * Le client présente son forfait au comptoir. Le serveur choisit
     * lui-même lequel utiliser : celui qui expire le plus tôt.
     */
    public function useForOperation(Request $request): void
    {
        $validator = Validator::make($request->body())
            ->required('operation_id', 'Le dossier');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $operationId = (int) $validator->string('operation_id');
        $operations  = new OperationRepository();
        $operation   = $operations->findDetailed($operationId);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        if (!AuthContext::current()->canAccessStation((int) $operation['station_id'])) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        if (in_array((string) $operation['status'], ['COMPLETED', 'CANCELLED'], true)) {
            Response::error(
                'Ce dossier est clos : le forfait ne peut plus y être appliqué.',
                [],
                409
            );
        }

        if (($operation['subscription_id'] ?? null) !== null) {
            Response::error('Ce dossier est déjà couvert par un forfait.', [], 409);
        }

        // Un dossier déjà remisé par la fidélité ne peut pas être
        // couvert en plus par un forfait : les deux ramènent le dû à
        // zéro, et le client perdrait des tampons pour rien.
        if ((int) ($operation['discount_amount'] ?? 0) > 0) {
            Response::error(
                'Une remise est déjà appliquée à ce dossier. Retirez-la avant d\'utiliser un forfait.',
                [],
                409
            );
        }

        if ((int) ($operation['paid_amount'] ?? 0) > 0) {
            Response::error(
                'Ce dossier a déjà été réglé en partie : le forfait ne peut plus s\'y appliquer.',
                [],
                409
            );
        }

        $subscriptions = new SubscriptionRepository();
        $subscription  = $subscriptions->usableFor(
            (int) $operation['customer_id'],
            (int) $operation['service_id'],
        );

        if ($subscription === null) {
            Response::error(
                sprintf(
                    'Ce client n\'a pas de forfait utilisable pour « %s ».',
                    $operation['service_name'] ?? 'cette prestation'
                ),
                [],
                409
            );
        }

        $price = (int) $operation['price'];

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $operations->update($operationId, [
                'subscription_id' => (int) $subscription['id'],
                // La remise couvre TOUT le dossier : le lavage est
                // payé depuis le jour de la vente du forfait.
                'discount_amount' => $price,
                'discount_source' => 'SUBSCRIPTION',
                'discount_reason' => sprintf(
                    'Forfait « %s » — lavage %d sur %d',
                    $subscription['plan_name'],
                    (int) $subscription['washes_used'] + 1,
                    (int) $subscription['washes_total'],
                ),
                'discount_by_user_id' => AuthContext::current()->userId,
                'discounted_at' => date('Y-m-d H:i:s'),
            ]);

            $connection->commit();
        } catch (PDOException $exception) {
            $connection->rollBack();

            throw $exception;
        }

        // ==============================================================
        // UN LAVAGE D'ABONNÉ RAPPORTE UN TAMPON DE FIDÉLITÉ
        // ==============================================================
        // Il a été payé — d'avance, mais payé. Le contraire punirait
        // le client le plus fidèle de la station.
        //
        // C'est aussi une lacune du lot 14 que ce lot corrige : le
        // tampon était attribué depuis le contrôleur des paiements
        // uniquement, donc jamais sur un dossier soldé sans
        // encaissement. Voir `LoyaltyLedger::awardIfSettled()`.
        $refreshed = $operations->findDetailed($operationId) ?? [];
        $loyalty   = LoyaltyLedger::awardIfSettled($refreshed);

        AuditLogger::record(
            action: 'subscription.used',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $operation['station_id'],
            entityType: 'operation',
            entityId: $operationId,
            metadata: [
                'subscription_id' => (int) $subscription['id'],
                'reference' => $operation['reference'],
                // La VALEUR du lavage livré : c'est ce qui permet de
                // mesurer la dette soldée, et de vérifier des mois
                // plus tard qu'un forfait a bien été honoré.
                'value' => $price,
                'wash' => (int) $subscription['washes_used'] + 1,
                'of' => (int) $subscription['washes_total'],
            ],
        );

        $updated = $subscriptions->findDetailed((int) $subscription['id']) ?? [];
        $left    = max(0, (int) $updated['washes_total'] - (int) $updated['washes_used']);

        Response::success(
            [
                'operation' => OperationPresenter::present($refreshed),
                'subscription' => $this->present($updated),
                'loyalty_balance' => $loyalty['awarded'] ? $loyalty['balance'] : null,
            ],
            $left > 0
                ? sprintf('Lavage décompté du forfait. Il en reste %d.', $left)
                : 'Lavage décompté. C\'était le dernier du forfait.'
        );
    }

    /**
     * POST /api/subscriptions/use/{operationId}/cancel
     *
     * Le forfait a été appliqué au mauvais dossier. Le lavage est
     * rendu au client — il suffit de détacher l'opération, puisque
     * c'est elle qui compte.
     */
    public function cancelUse(Request $request, string $operationId): void
    {
        $operationId = (int) $operationId;
        $operations  = new OperationRepository();
        $operation   = $operations->findDetailed($operationId);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        if (!AuthContext::current()->canAccessStation((int) $operation['station_id'])) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        if (($operation['subscription_id'] ?? null) === null) {
            Response::error("Aucun forfait n'est appliqué à ce dossier.", [], 409);
        }

        // Après restitution, retirer le forfait ferait réapparaître
        // une somme à réclamer à un client déjà parti.
        if ((string) $operation['status'] === 'COMPLETED') {
            Response::error(
                'Ce véhicule est déjà restitué : le forfait ne peut plus être retiré.',
                [],
                409
            );
        }

        $subscriptionId = (int) $operation['subscription_id'];

        $operations->update($operationId, [
            'subscription_id' => null,
            'discount_amount' => 0,
            'discount_source' => null,
            'discount_reason' => null,
            'discount_by_user_id' => AuthContext::current()->userId,
            'discounted_at' => date('Y-m-d H:i:s'),
        ]);

        AuditLogger::record(
            action: 'subscription.use_cancelled',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $operation['station_id'],
            entityType: 'operation',
            entityId: $operationId,
            metadata: [
                'subscription_id' => $subscriptionId,
                'reference' => $operation['reference'],
            ],
        );

        Response::success(
            [
                'operation' => OperationPresenter::present($operations->findDetailed($operationId) ?? []),
                'subscription' => $this->present(
                    (new SubscriptionRepository())->findDetailed($subscriptionId) ?? []
                ),
            ],
            'Forfait retiré. Le lavage est rendu au client.'
        );
    }

    // ==================================================================

    /**
     * Lit et vérifie les champs d'un forfait.
     *
     * @return array<string,mixed>
     */
    private function readPlan(Request $request): array
    {
        $validator = Validator::make($request->body())
            ->required('name', 'Le nom')
            ->required('service_id', 'La prestation')
            ->maxLength('name', 120);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $body = $request->body();

        $washes  = (int) ($body['washes'] ?? 0);
        $price   = (int) ($body['price'] ?? 0);
        $days    = (int) ($body['validity_days'] ?? 180);
        $status  = strtoupper((string) ($body['status'] ?? 'ACTIVE'));

        // Un forfait d'un seul lavage n'est pas un forfait, c'est un
        // lavage. Au-delà de cinquante, la station s'engage sur une
        // durée qu'elle ne maîtrise plus.
        if ($washes < 2 || $washes > 50) {
            Response::validationFailed([
                'washes' => 'Entre 2 et 50 lavages. Un seul lavage n\'est pas un forfait.',
            ]);
        }

        if ($price <= 0) {
            Response::validationFailed(['price' => 'Un forfait a un prix.']);
        }

        // Un forfait sans fin est une dette éternelle ; au-delà de
        // deux ans, les tarifs auront changé plusieurs fois.
        if ($days < 7 || $days > 730) {
            Response::validationFailed([
                'validity_days' => 'Entre 7 et 730 jours. Un forfait sans date de fin est une dette éternelle.',
            ]);
        }

        if (!in_array($status, ['ACTIVE', 'INACTIVE'], true)) {
            Response::validationFailed(['status' => 'Statut inconnu.']);
        }

        $service = (new ServiceRepository())->find((int) $validator->string('service_id'));

        if ($service === null) {
            Response::validationFailed(['service_id' => "Cette prestation n'existe pas."]);
        }

        return [
            'name' => $validator->string('name'),
            'service_id' => (int) $service['id'],
            'washes' => $washes,
            'price' => $price,
            'validity_days' => $days,
            'status' => $status,
        ];
    }

    private function currentCashSessionId(int $stationId): ?int
    {
        $session = (new CashSessionRepository())->openFor($stationId);

        return $session === null ? null : (int) $session['id'];
    }

    /**
     * @param array<string,mixed> $plan
     * @return array<string,mixed>
     */
    private function presentPlan(array $plan): array
    {
        if ($plan === []) {
            return [];
        }

        $washes = (int) $plan['washes'];
        $price  = (int) $plan['price'];
        $unit   = (int) ($plan['service_price'] ?? 0);

        return [
            'id' => (int) $plan['id'],
            'name' => (string) $plan['name'],
            'service_id' => (int) $plan['service_id'],
            'service_name' => $plan['service_name'] ?? null,
            'service_price' => $unit,
            'washes' => $washes,
            'price' => $price,
            'validity_days' => (int) $plan['validity_days'],
            'status' => (string) $plan['status'],
            'is_active' => (string) $plan['status'] === 'ACTIVE',
            'sold_count' => (int) ($plan['sold_count'] ?? 0),

            // CE QUE LE CLIENT ÉCONOMISE, calculé ici plutôt qu'à
            // l'écran : c'est l'argument de vente, et il doit être le
            // même sur tous les écrans qui l'affichent.
            'full_price' => $unit * $washes,
            'saving' => max(0, ($unit * $washes) - $price),
        ];
    }

    /**
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    private function present(array $row): array
    {
        if ($row === []) {
            return [];
        }

        $total = (int) $row['washes_total'];
        $used  = (int) $row['washes_used'];
        $left  = max(0, $total - $used);

        $expired = (new DateTimeImmutable((string) $row['expires_at']))
            < (new DateTimeImmutable('today'));

        // ==============================================================
        // L'ÉTAT EST CALCULÉ, JAMAIS LU DANS UNE COLONNE.
        // ==============================================================
        // Seule l'annulation est stockée : c'est la seule qui soit une
        // décision. « Périmé » se lit dans une date, « épuisé » se
        // compte. Les stocker aurait supposé une tâche planifiée
        // nocturne — et un forfait qui reste actif le jour où elle
        // échoue.
        $state = match (true) {
            (string) $row['status'] === 'CANCELLED' => 'CANCELLED',
            $expired => 'EXPIRED',
            $left === 0 => 'EXHAUSTED',
            default => 'ACTIVE',
        };

        return [
            'id' => (int) $row['id'],
            'customer_id' => (int) $row['customer_id'],
            'customer_name' => $row['customer_name'] ?? null,
            'customer_phone' => $row['customer_phone'] ?? null,

            'plan_id' => (int) $row['plan_id'],
            'plan_name' => $row['plan_name'] ?? null,
            'service_id' => (int) $row['service_id'],
            'service_name' => $row['service_name'] ?? null,
            'station_id' => (int) $row['station_id'],
            'station_name' => $row['station_name'] ?? null,

            'washes_total' => $total,
            'washes_used' => $used,
            'washes_left' => $left,
            'price_paid' => (int) $row['price_paid'],

            'starts_at' => $row['starts_at'],
            'expires_at' => $row['expires_at'],
            'days_left' => $expired
                ? 0
                : (int) (new DateTimeImmutable('today'))
                    ->diff(new DateTimeImmutable((string) $row['expires_at']))->days,

            'state' => $state,
            'state_label' => match ($state) {
                'ACTIVE' => 'Actif',
                'EXPIRED' => 'Périmé',
                'EXHAUSTED' => 'Épuisé',
                'CANCELLED' => 'Annulé',
                default => $state,
            },
            'is_usable' => $state === 'ACTIVE',

            'cancelled_at' => $row['cancelled_at'],
            'cancellation_reason' => $row['cancellation_reason'],

            'notes' => $row['notes'],
            'sold_by_name' => $row['sold_by_name'] ?? null,
            'created_at' => $row['created_at'],
        ];
    }

    private function readDate(?string $value): ?string
    {
        if ($value === null || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return null;
        }

        return $value;
    }
}
