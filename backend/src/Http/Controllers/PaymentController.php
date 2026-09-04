<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\PlateNumber;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\CashSessionRepository;
use Autocare\Models\OperationRepository;
use Autocare\Models\PaymentRepository;
use PDOException;

/**
 * Les encaissements
 * ==================================================================
 * CE MODULE N'INTÈGRE AUCUN FOURNISSEUR DE PAIEMENT.
 * ==================================================================
 *
 * Il n'appelle ni Wave, ni Orange Money, ni aucune passerelle. Il
 * n'existe pas de « mode bac à sable », pas de faux webhook, pas de
 * paiement simulé qui réussit toujours. Un tel code donnerait
 * l'illusion d'un produit branché, et le jour de la vraie intégration
 * il faudrait tout défaire — après avoir peut-être laissé croire à un
 * client que ça marchait.
 *
 * Ce que fait ce contrôleur : enregistrer ce que le caissier déclare
 * avoir reçu. C'est exactement ce que fait un cahier, en plus fiable
 * et en additionnant tout seul.
 *
 * Le jour où un compte marchand existera, une classe s'ajoutera à
 * côté de celle-ci et remplira les mêmes colonnes `provider` et
 * `external_reference`. Rien de ce qui est écrit ici ne sera à jeter.
 *
 * ------------------------------------------------------------------
 * ON N'EFFACE PAS, ON CONTRE-PASSE.
 * Aucune route ne modifie ni ne supprime un encaissement. Une erreur
 * se corrige par un remboursement, qui laisse les deux écritures
 * visibles. C'est la règle de base de la comptabilité, et c'est
 * surtout la seule qui résiste au soir où la caisse ne tombe pas
 * juste.
 */
final class PaymentController
{
    /**
     * POST /api/operations/{id}/payments
     * Enregistrer ce que le client vient de régler.
     */
    public function store(Request $request, string $operationId): void
    {
        $operationId = (int) $operationId;
        $operations  = new OperationRepository();
        $operation   = $operations->findDetailed($operationId);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        $validator = Validator::make($request->body())
            ->required('amount', 'Le montant')
            ->required('method', 'Le moyen de paiement')
            ->in('method', ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER'])
            ->maxLength('provider', 60)
            ->maxLength('external_reference', 120)
            ->maxLength('notes', 1000);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $amount = $validator->string('amount');

        if (!ctype_digit($amount) || (int) $amount <= 0) {
            // Entier positif, en francs CFA. Pas de centimes : le franc
            // CFA n'en a pas, et accepter « 5000,50 » créerait des
            // arrondis dans une caisse qui doit tomber juste.
            Response::validationFailed([
                'amount' => 'Le montant doit être un nombre entier de francs, supérieur à zéro.',
            ]);
        }

        $amount = (int) $amount;
        $due    = (int) $operation['price'];
        $paid   = (int) $operation['paid_amount'];

        // Un trop-perçu se refuse. Ce n'est pas de la rigidité : c'est
        // presque toujours une faute de frappe — 50 000 au lieu de
        // 5 000 — et une fois enregistrée, elle fausse la caisse du
        // soir sans que personne ne comprenne pourquoi.
        if ($paid + $amount > $due) {
            $reste = max(0, $due - $paid);

            Response::validationFailed([
                'amount' => $reste === 0
                    ? 'Ce dossier est déjà entièrement réglé.'
                    : sprintf(
                        'Il ne reste que %s FCFA à régler sur ce dossier.',
                        number_format($reste, 0, ',', ' ')
                    ),
            ]);
        }

        $method    = $validator->string('method');
        $stationId = (int) $operation['station_id'];

        // ==============================================================
        // TOUT encaissement est rattaché à la session ouverte, quel que
        // soit son moyen de paiement.
        // ==============================================================
        // Une session de caisse n'est pas seulement un tiroir : c'est
        // une VACATION au comptoir. « Ce matin nous avons fait 45 000 F,
        // dont 18 000 en espèces » est la phrase que le caissier doit
        // pouvoir lire à la clôture.
        //
        // Ne rattacher que les espèces priverait la clôture de tout le
        // reste, et le caissier croirait sa matinée deux fois moins
        // bonne qu'elle ne l'a été.
        //
        // Le tiroir, lui, ne contient QUE les espèces : c'est
        // `expectedAmount()` qui fait ce tri, pas ce rattachement.
        //
        // Sans session ouverte, la colonne reste vide. On n'empêche PAS
        // l'encaissement : un client qui paie n'attendra pas qu'on
        // règle un problème d'informatique, et un paiement non saisi
        // serait bien pire qu'un paiement mal rangé.
        $session = (new CashSessionRepository())->openFor($stationId);
        $cashSessionId = $session === null ? null : (int) $session['id'];

        $payments = new PaymentRepository();

        $id = $payments->create([
            'station_id'      => $stationId,
            'cash_session_id' => $cashSessionId,
            'operation_id'    => $operationId,
            'customer_id'     => (int) $operation['customer_id'],
            'amount'          => $amount,
            'method'          => $method,
            'provider'        => $validator->stringOrNull('provider'),
            'external_reference' => $validator->stringOrNull('external_reference'),
            'status'          => 'PAID',
            'paid_at'         => date('Y-m-d H:i:s'),
            'recorded_by_user_id' => AuthContext::current()->userId,
            'notes'           => $validator->stringOrNull('notes'),
        ]);

        AuditLogger::record(
            action: 'payment.recorded',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'payment',
            entityId: $id,
            metadata: [
                'operation_reference' => $operation['reference'],
                'amount'  => $amount,
                'method'  => $method,
                'in_cash_session' => $cashSessionId,
            ],
        );

        $newTotal = $payments->paidAmountFor($operationId);

        Response::success(
            [
                'payment'      => $this->present($payments->find($id) ?? []),
                'paid_amount'  => $newTotal,
                'is_settled'   => $newTotal >= $due,
                'remaining'    => max(0, $due - $newTotal),
                // Le caissier doit savoir tout de suite si son
                // encaissement est resté hors caisse : c'est au moment
                // de la saisie qu'on peut encore ouvrir le tiroir.
                'outside_cash_session' => $method === 'CASH' && $cashSessionId === null,
            ],
            $newTotal >= $due
                ? 'Paiement enregistré. Le dossier est réglé.'
                : sprintf(
                    'Paiement enregistré. Reste %s FCFA.',
                    number_format($due - $newTotal, 0, ',', ' ')
                ),
            201
        );
    }

    /** GET /api/operations/{id}/payments */
    public function forOperation(Request $request, string $operationId): void
    {
        $operationId = (int) $operationId;
        $operation   = (new OperationRepository())->findDetailed($operationId);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        $payments = new PaymentRepository();
        $paid     = $payments->paidAmountFor($operationId);
        $due      = (int) $operation['price'];

        Response::success([
            'payments'    => array_map($this->present(...), $payments->forOperation($operationId)),
            'due'         => $due,
            'paid_amount' => $paid,
            'remaining'   => max(0, $due - $paid),
            'is_settled'  => $paid >= $due,
        ]);
    }

    /**
     * POST /api/payments/{id}/refund
     *
     * Rembourser, c'est-à-dire CONTRE-PASSER.
     *
     * On n'efface pas la ligne d'origine : on la marque remboursée et
     * l'on ajoute une écriture qui dit qui a rendu l'argent, quand et
     * pourquoi. Le dossier redevient non réglé, ce qui rebloque sa
     * restitution — la boucle est cohérente.
     */
    public function refund(Request $request, string $id): void
    {
        $paymentId = (int) $id;
        $payments  = new PaymentRepository();
        $payment   = $payments->find($paymentId);

        if ($payment === null) {
            Response::notFound("Cet encaissement n'existe pas.");
        }

        if ($payment['status'] !== 'PAID') {
            Response::error(
                'Seul un encaissement encore valide peut être remboursé.',
                [],
                409
            );
        }

        $validator = Validator::make($request->body())
            ->required('reason', 'Le motif')
            ->maxLength('reason', 500);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $reason = $validator->string('reason');

        // Deux écritures, une seule transaction : marquer l'origine
        // sans créer la contre-écriture — ou l'inverse — laisserait la
        // caisse dans un état que personne ne saurait expliquer.
        $connection = \Autocare\Core\Database::connection();
        $connection->beginTransaction();

        try {
            $payments->update($paymentId, [
                'status' => 'REFUNDED',
                'notes'  => trim(($payment['notes'] ?? '') . "\nRemboursé : " . $reason),
            ]);

            $refundId = $payments->create([
                'station_id'      => (int) $payment['station_id'],
                // La sortie est rattachée à la session OUVERTE
                // MAINTENANT, pas à celle de l'encaissement d'origine :
                // c'est du tiroir d'aujourd'hui que l'argent sort.
                'cash_session_id' => $this->currentCashSessionId((int) $payment['station_id']),
                'operation_id'    => $payment['operation_id'],
                'customer_id'     => $payment['customer_id'],
                'amount'          => (int) $payment['amount'],
                'method'          => $payment['method'],
                'provider'        => $payment['provider'],
                'external_reference' => $payment['external_reference'],
                'status'          => 'REFUNDED',
                'paid_at'         => date('Y-m-d H:i:s'),
                'recorded_by_user_id' => AuthContext::current()->userId,
                'notes'           => 'Remboursement de l\'encaissement n°' . $paymentId . ' — ' . $reason,
            ]);

            $connection->commit();
        } catch (PDOException $exception) {
            $connection->rollBack();

            throw $exception;
        }

        AuditLogger::record(
            action: 'payment.refunded',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $payment['station_id'],
            entityType: 'payment',
            entityId: $paymentId,
            metadata: [
                'amount'    => (int) $payment['amount'],
                'method'    => $payment['method'],
                'reason'    => $reason,
                'refund_id' => $refundId,
            ],
        );

        Response::success(
            ['payment' => $this->present($payments->find($refundId) ?? [])],
            'Remboursement enregistré. Les deux écritures restent visibles.',
            201
        );
    }

    /**
     * GET /api/payments?from=&to=&method=&station_id=
     * Le journal des encaissements.
     */
    public function index(Request $request): void
    {
        $filters = [];

        foreach (['from', 'to', 'method', 'status'] as $key) {
            $value = $request->query($key);

            if ($value !== null && $value !== '') {
                $filters[$key] = $value;
            }
        }

        $stationId = $request->query('station_id');

        if ($stationId !== null && $stationId !== '') {
            if (!AuthContext::current()->canAccessStation((int) $stationId)) {
                Response::forbidden("Vous n'êtes pas rattaché à cette station.");
            }

            $filters['station_id'] = (int) $stationId;
        }

        // Sans bornes, on montre AUJOURD'HUI. Un journal qui s'ouvre
        // sur les six derniers mois oblige à filtrer avant de pouvoir
        // lire quoi que ce soit — alors que la question posée neuf
        // fois sur dix est « combien a-t-on fait aujourd'hui ? ».
        if (!isset($filters['from']) && !isset($filters['to'])) {
            $filters['from'] = date('Y-m-d');
            $filters['to']   = date('Y-m-d');
        }

        $repository = new PaymentRepository();

        Response::success([
            'payments' => array_map($this->present(...), $repository->journal($filters)),
            'totals'   => $repository->totals($filters),
            'period'   => [
                'from' => $filters['from'] ?? null,
                'to'   => $filters['to'] ?? null,
            ],
        ]);
    }

    // ==================================================================

    /**
     * La session de caisse ouverte sur cette station, s'il y en a une.
     *
     * Un remboursement est rattaché à la session D'AUJOURD'HUI, pas à
     * celle de l'encaissement d'origine : c'est du tiroir de ce matin
     * que l'argent sort, pas de celui de la semaine dernière.
     */
    private function currentCashSessionId(int $stationId): ?int
    {
        $session = (new CashSessionRepository())->openFor($stationId);

        return $session === null ? null : (int) $session['id'];
    }

    /**
     * @param array<string,mixed> $payment
     * @return array<string,mixed>
     */
    private function present(array $payment): array
    {
        return [
            'id'     => (int) ($payment['id'] ?? 0),
            'amount' => (int) ($payment['amount'] ?? 0),
            'currency_code' => $payment['currency_code'] ?? 'XOF',
            'method' => $payment['method'] ?? 'CASH',
            'status' => $payment['status'] ?? 'PAID',

            // Saisis à la main par le caissier, jamais renseignés par
            // une API : voir l'en-tête de ce fichier.
            'provider' => $payment['provider'] ?? null,
            'external_reference' => $payment['external_reference'] ?? null,

            'operation_id' => ($payment['operation_id'] ?? null) === null
                ? null
                : (int) $payment['operation_id'],
            'operation_reference' => $payment['operation_reference'] ?? null,
            // La forme lisible, pas celle stockée : « DK-9087-DE » se
            // relit contre un pare-chocs, « DK9087DE » non.
            'plate_number'  => ($payment['plate_number'] ?? null) === null
                ? null
                : PlateNumber::format((string) $payment['plate_number']),
            'customer_name' => $payment['customer_name'] ?? null,
            'station_id'    => (int) ($payment['station_id'] ?? 0),
            'station_name'  => $payment['station_name'] ?? null,

            'cash_session_id' => ($payment['cash_session_id'] ?? null) === null
                ? null
                : (int) $payment['cash_session_id'],

            'recorded_by_name' => $payment['recorded_by_name'] ?? null,
            'paid_at' => $payment['paid_at'] ?? null,
            'notes'   => $payment['notes'] ?? null,
        ];
    }
}
