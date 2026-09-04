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
use Autocare\Models\CustomerRepository;
use Autocare\Models\LoyaltyEntryRepository;
use Autocare\Models\LoyaltyProgramRepository;
use Autocare\Models\OperationRepository;
use PDOException;

/**
 * La fidélité
 * ==================================================================
 * UNE CARTE À TAMPONS, PAS UN PROGRAMME À POINTS.
 * ==================================================================
 *
 * « Après 10 lavages, 5 000 F offerts. » Le client compte lui-même,
 * et c'est tout l'intérêt : un programme à points lui demanderait de
 * croire une arithmétique qu'il ne peut pas vérifier.
 *
 * ------------------------------------------------------------------
 * TROIS RÈGLES QUI TIENNENT TOUT LE MODULE
 *
 * 1. UNE RÉCOMPENSE EST UNE REMISE, PAS UN ENCAISSEMENT.
 *    Un faux paiement « fidélité » aurait été plus simple à coder :
 *    le dossier devenait réglé et rien d'autre ne bougeait. Il aurait
 *    aussi fait compter un lavage offert dans la recette du jour —
 *    une somme que le tiroir ne contient pas.
 *
 *    Une remise diminue ce qui est DÛ. La recette reste vraie, la
 *    caisse reste juste, et le coût du programme devient un chiffre
 *    qu'un gérant peut lire.
 *
 * 2. LE GRAND LIVRE NE SE MODIFIE PAS.
 *    Une utilisation annulée n'est pas effacée : elle est compensée
 *    par une écriture inverse. Effacer ferait disparaître le fait
 *    qu'un employé a appliqué une remise, l'a retirée, et l'a
 *    peut-être remise ailleurs.
 *
 * 3. LES RÈGLES PEUVENT CHANGER, L'HISTOIRE NON.
 *    Chaque écriture emporte la valeur de la récompense au moment où
 *    elle a été faite. Passer de « 10 tampons, 5 000 F » à
 *    « 12 tampons, 6 000 F » ne réécrit rien.
 */
final class LoyaltyController
{
    /**
     * GET /api/loyalty?from=&to=
     *
     * L'écran du programme : les règles, le bilan, et surtout les
     * clients qui ont une récompense à prendre.
     */
    public function index(Request $request): void
    {
        $from = $this->readDate($request->query('from')) ?? date('Y-m-01');
        $to   = $this->readDate($request->query('to')) ?? date('Y-m-d');

        $programs = new LoyaltyProgramRepository();
        $program  = $programs->current();
        $entries  = new LoyaltyEntryRepository();

        $required = $program === null ? 0 : max(1, (int) $program['stamps_required']);

        Response::success([
            'program' => $this->presentProgram($program),
            'summary' => $entries->summaryBetween($from, $to) + [
                // LE COÛT RÉEL, lu sur les remises effectivement
                // appliquées et non sur la valeur annoncée des
                // récompenses : une récompense de 5 000 F sur un
                // dossier à 3 000 F ne coûte que 3 000 F.
                'cost' => (new OperationRepository())->discountTotal($from, $to),
            ],
            // Ceux qui ont AU MOINS une récompense complète. Ils ont
            // gagné quelque chose et ne le savent peut-être pas :
            // c'est la seule liste de cet écran sur laquelle on agit.
            'ready' => $required === 0 ? [] : $entries->customersWithBalance($required),
            'period' => ['from' => $from, 'to' => $to],
        ]);
    }

    /**
     * PUT /api/loyalty/program
     *
     * Créer ou modifier les règles. Droit `loyalty.manage`, réservé à
     * l'administrateur : un client qui collecte des tampons a une
     * promesse en cours, et la modifier n'est pas une décision
     * d'exploitation quotidienne.
     */
    public function updateProgram(Request $request): void
    {
        $validator = Validator::make($request->body())
            ->maxLength('name', 120);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $body = $request->body();

        $required = (int) ($body['stamps_required'] ?? 10);
        $reward   = (int) ($body['reward_amount'] ?? 0);
        $minimum  = (int) ($body['min_operation_amount'] ?? 0);
        $status   = strtoupper((string) ($body['status'] ?? 'INACTIVE'));

        // Des bornes larges, mais des bornes. Un programme à
        // « 2 tampons » n'est pas de la fidélité, c'est une remise
        // permanente qui ne dit pas son nom ; à 100 tampons, aucun
        // client n'ira au bout et la carte ne sert qu'à décevoir.
        if ($required < 3 || $required > 50) {
            Response::validationFailed([
                'stamps_required' => 'Entre 3 et 50 lavages. En dessous, ce n\'est plus de la fidélité ; au-dessus, personne n\'ira au bout.',
            ]);
        }

        if ($reward <= 0) {
            Response::validationFailed([
                'reward_amount' => 'Une récompense sans montant n\'est pas une récompense.',
            ]);
        }

        if ($minimum < 0) {
            Response::validationFailed(['min_operation_amount' => 'Le montant plancher ne peut pas être négatif.']);
        }

        if (!in_array($status, ['ACTIVE', 'INACTIVE'], true)) {
            Response::validationFailed(['status' => 'Statut inconnu.']);
        }

        $programs = new LoyaltyProgramRepository();
        $existing = $programs->current();

        $data = [
            'name' => trim((string) ($body['name'] ?? '')) ?: 'Carte de fidélité',
            'stamps_required' => $required,
            'reward_amount' => $reward,
            'min_operation_amount' => $minimum,
            'status' => $status,
        ];

        if ($existing === null) {
            $data['created_by_user_id'] = AuthContext::current()->userId;
            $programId = $programs->create($data);
            $before = null;
        } else {
            $programId = (int) $existing['id'];
            $before = [
                'stamps_required' => (int) $existing['stamps_required'],
                'reward_amount' => (int) $existing['reward_amount'],
                'status' => $existing['status'],
            ];
            $programs->update($programId, $data);
        }

        AuditLogger::record(
            action: 'loyalty.program_updated',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: null,
            entityType: 'loyalty_program',
            entityId: $programId,
            // L'avant ET l'après : changer un seuil au milieu d'un
            // programme touche des clients qui collectent déjà.
            metadata: ['from' => $before, 'to' => $data],
        );

        Response::success(
            ['program' => $this->presentProgram($programs->current())],
            $status === 'ACTIVE'
                ? 'Programme actif. Les prochains lavages payés donneront un tampon.'
                : 'Programme enregistré, mais INACTIF : aucun tampon ne sera distribué.'
        );
    }

    /**
     * GET /api/loyalty/customers/{id}
     * La carte d'un client, telle qu'on la lui montre au comptoir.
     */
    public function card(Request $request, string $id): void
    {
        $customerId = (int) $id;
        $customer   = (new CustomerRepository())->find($customerId);

        if ($customer === null) {
            Response::notFound("Ce client n'existe pas.");
        }

        Response::success([
            'card' => LoyaltyLedger::card($customerId),
            'history' => array_map(
                $this->presentEntry(...),
                (new LoyaltyEntryRepository())->historyFor($customerId),
            ),
        ]);
    }

    /**
     * POST /api/loyalty/redeem
     * ==================================================================
     * LE CLIENT UTILISE SA RÉCOMPENSE.
     * ==================================================================
     * Deux écritures, une seule transaction : l'écriture au grand
     * livre et la remise sur le dossier. L'une sans l'autre, et soit
     * le client perd ses tampons sans rien recevoir, soit il reçoit
     * une remise sans que personne ne puisse dire pourquoi.
     */
    public function redeem(Request $request): void
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

        // UN DOSSIER TERMINÉ NE SE REMISE PLUS. La voiture est partie,
        // l'argent est encaissé : appliquer une remise après coup
        // créerait un solde négatif que personne ne saurait rendre.
        if (in_array((string) $operation['status'], ['COMPLETED', 'CANCELLED'], true)) {
            Response::error(
                'Ce dossier est clos : la récompense ne peut plus y être appliquée.',
                [],
                409
            );
        }

        $customerId = (int) $operation['customer_id'];

        $program = (new LoyaltyProgramRepository())->active();

        if ($program === null) {
            Response::error("Aucun programme de fidélité n'est actif.", [], 409);
        }

        $entries = new LoyaltyEntryRepository();

        if ($entries->activeRedeemFor($operationId) !== null) {
            Response::error(
                'Une récompense est déjà appliquée à ce dossier.',
                [],
                409
            );
        }

        $card = LoyaltyLedger::card($customerId, $program);

        if ($card['rewards_available'] < 1) {
            Response::error(
                sprintf(
                    'Ce client a %d tampon(s) : il en faut %d.',
                    $card['balance'],
                    $card['stamps_required']
                ),
                [],
                409
            );
        }

        $required = $card['stamps_required'];
        $reward   = (int) $program['reward_amount'];
        $price    = (int) $operation['price'];

        // ==============================================================
        // LA REMISE NE DÉPASSE JAMAIS LE MONTANT DU DOSSIER
        // ==============================================================
        // Sinon le dossier deviendrait négatif : la station devrait de
        // l'argent à un client parce qu'il est fidèle.
        //
        // Le surplus est PERDU, et c'est pour cela que le serveur
        // prévient (voir `warnings` plus bas) : quelqu'un au comptoir
        // doit pouvoir dire au client « gardez-la pour un lavage plus
        // cher ». Le logiciel ne refuse pas — c'est au client de
        // décider ce qu'il fait de ce qu'il a gagné.
        $applied = min($reward, max(0, $price - (int) $operation['discount_amount']));

        if ($applied === 0) {
            Response::error(
                'Ce dossier est déjà entièrement remisé.',
                [],
                409
            );
        }

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $entryId = $entries->create([
                'program_id'  => (int) $program['id'],
                'customer_id' => $customerId,
                'type'        => 'REDEEM',
                'points'      => -$required,
                'operation_id' => $operationId,
                'reward_amount' => $reward,
                'note' => 'Remise sur ' . ($operation['reference'] ?? $operationId),
                'created_by_user_id' => AuthContext::current()->userId,
            ]);

            $operations->update($operationId, [
                'discount_amount' => (int) $operation['discount_amount'] + $applied,
                // La SOURCE, ajoutée au lot 15 : une remise de
                // fidélité est un coût pour la station, une remise
                // d'abonnement est une dette qu'on solde. Sans elle,
                // le coût du programme compterait les deux.
                'discount_source' => 'LOYALTY',
                'discount_reason' => sprintf(
                    'Fidélité — %d lavages (%s)',
                    $required,
                    $program['name']
                ),
                'discount_by_user_id' => AuthContext::current()->userId,
                'discounted_at' => date('Y-m-d H:i:s'),
            ]);

            $connection->commit();
        } catch (PDOException $exception) {
            $connection->rollBack();

            throw $exception;
        }

        AuditLogger::record(
            action: 'loyalty.redeemed',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $operation['station_id'],
            entityType: 'operation',
            entityId: $operationId,
            metadata: [
                'entry_id' => $entryId,
                'customer_id' => $customerId,
                'stamps_used' => $required,
                'reward_amount' => $reward,
                // Ce qui a été RÉELLEMENT déduit, qui peut être
                // inférieur à la récompense.
                'applied' => $applied,
            ],
        );

        $warnings = [];

        if ($applied < $reward) {
            $warnings[] = sprintf(
                'La récompense vaut %s FCFA mais le dossier n\'en coûte que %s : le reste est perdu.',
                number_format($reward, 0, ',', ' '),
                number_format($applied, 0, ',', ' ')
            );
        }

        Response::success(
            [
                'operation' => \Autocare\Http\Presenters\OperationPresenter::present(
                    $operations->findDetailed($operationId) ?? []
                ),
                'card' => LoyaltyLedger::card($customerId, $program),
                'warnings' => $warnings,
            ],
            sprintf('Récompense appliquée : %s FCFA de remise.', number_format($applied, 0, ',', ' '))
        );
    }

    /**
     * POST /api/loyalty/redeem/{operationId}/cancel
     *
     * Une remise appliquée par erreur. Les tampons sont rendus par une
     * écriture INVERSE — jamais par une suppression : la manipulation
     * « j'applique, j'annule, je réapplique ailleurs » doit rester
     * lisible dans l'historique.
     */
    public function cancelRedeem(Request $request, string $operationId): void
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

        // Après restitution, l'annulation créerait un solde à réclamer
        // à un client déjà parti.
        if ((string) $operation['status'] === 'COMPLETED') {
            Response::error(
                'Ce véhicule est déjà restitué : la remise ne peut plus être retirée.',
                [],
                409
            );
        }

        $entries = new LoyaltyEntryRepository();
        $redeem  = $entries->activeRedeemFor($operationId);

        if ($redeem === null) {
            Response::error("Aucune récompense n'est appliquée à ce dossier.", [], 409);
        }

        $paid = (int) ($operation['paid_amount'] ?? 0);
        $stamps = abs((int) $redeem['points']);

        $connection = Database::connection();
        $connection->beginTransaction();

        try {
            $entries->create([
                'program_id'  => (int) $redeem['program_id'],
                'customer_id' => (int) $redeem['customer_id'],
                'type'        => 'REVERSAL',
                'points'      => $stamps,
                'operation_id' => $operationId,
                'related_entry_id' => (int) $redeem['id'],
                'reward_amount' => $redeem['reward_amount'],
                'note' => 'Annulation de la remise',
                'created_by_user_id' => AuthContext::current()->userId,
            ]);

            $operations->update($operationId, [
                'discount_amount' => 0,
                'discount_source' => null,
                'discount_reason' => null,
                'discount_by_user_id' => AuthContext::current()->userId,
                'discounted_at' => date('Y-m-d H:i:s'),
            ]);

            $connection->commit();
        } catch (PDOException $exception) {
            $connection->rollBack();

            throw $exception;
        }

        AuditLogger::record(
            action: 'loyalty.redeem_cancelled',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $operation['station_id'],
            entityType: 'operation',
            entityId: $operationId,
            metadata: [
                'entry_id' => (int) $redeem['id'],
                'stamps_returned' => $stamps,
            ],
        );

        $warnings = [];

        // Le cas qui fait le plus mal au comptoir : le client a déjà
        // payé le montant remisé, et retirer la remise fait remonter
        // ce qu'il doit. Personne ne va le lui réclamer sur le parking
        // sans le savoir.
        if ($paid > 0 && $paid < (int) $operation['price']) {
            $warnings[] = sprintf(
                'Ce dossier avait déjà été réglé à hauteur de %s FCFA : il redevient dû de %s FCFA.',
                number_format($paid, 0, ',', ' '),
                number_format(max(0, (int) $operation['price'] - $paid), 0, ',', ' ')
            );
        }

        Response::success(
            [
                'operation' => \Autocare\Http\Presenters\OperationPresenter::present(
                    $operations->findDetailed($operationId) ?? []
                ),
                'card' => LoyaltyLedger::card((int) $redeem['customer_id']),
                'warnings' => $warnings,
            ],
            sprintf('Remise retirée. %d tampon(s) rendus au client.', $stamps)
        );
    }

    // ==================================================================

    /**
     * @param array<string,mixed>|null $program
     * @return array<string,mixed>|null
     */
    private function presentProgram(?array $program): ?array
    {
        if ($program === null) {
            return null;
        }

        return [
            'id' => (int) $program['id'],
            'name' => (string) $program['name'],
            'stamps_required' => (int) $program['stamps_required'],
            'reward_amount' => (int) $program['reward_amount'],
            'min_operation_amount' => (int) $program['min_operation_amount'],
            'status' => (string) $program['status'],
            'is_active' => (string) $program['status'] === 'ACTIVE',
        ];
    }

    /**
     * @param array<string,mixed> $entry
     * @return array<string,mixed>
     */
    private function presentEntry(array $entry): array
    {
        $type = (string) $entry['type'];

        return [
            'id' => (int) $entry['id'],
            'type' => $type,
            'label' => match ($type) {
                'EARN' => 'Tampon gagné',
                'REDEEM' => 'Récompense utilisée',
                'REVERSAL' => 'Utilisation annulée',
                default => $type,
            },
            'points' => (int) $entry['points'],
            'operation_id' => $entry['operation_id'] === null ? null : (int) $entry['operation_id'],
            'operation_reference' => $entry['operation_reference'] ?? null,
            'note' => $entry['note'],
            'created_by_name' => $entry['created_by_name'] ?? null,
            'created_at' => $entry['created_at'],
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
