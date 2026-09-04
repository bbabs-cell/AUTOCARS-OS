<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\CashSessionRepository;
use Autocare\Models\PaymentRepository;
use Autocare\Models\StationRepository;
use PDOException;

/**
 * La caisse
 * ==================================================================
 * TOUT CE MODULE EXISTE POUR UN SEUL NOMBRE : L'ÉCART.
 * ==================================================================
 *
 * Le matin, le caissier compte le fond de caisse. Le soir, il
 * recompte. Le logiciel dit ce qu'il devrait y avoir. La différence
 * est la seule information que ce module produit, et elle vaut à elle
 * seule tout le reste.
 *
 * POURQUOI ENREGISTRER L'ÉCART PLUTÔT QUE DE LE CORRIGER ?
 * Mille francs manquants un mardi, c'est une erreur de rendu de
 * monnaie. Mille francs manquants tous les mardis, c'est autre
 * chose — et on ne le voit qu'en gardant la trace de chacun.
 *
 * Un logiciel de caisse qui affiche toujours zéro d'écart ne prouve
 * rien : il dit seulement que personne ne compte.
 *
 * ------------------------------------------------------------------
 * CE QUI ENTRE DANS LE TIROIR : LES ESPÈCES, ET RIEN D'AUTRE.
 * Un paiement Wave n'y est pas. Le compter rendrait la clôture fausse
 * tous les soirs, et le caissier cesserait de la faire — ce qui
 * reviendrait à ne pas avoir de caisse du tout.
 */
final class CashController
{
    /**
     * GET /api/cash/current?station_id=
     * L'état de la caisse maintenant.
     */
    public function current(Request $request): void
    {
        $stationId  = $this->resolveStation($request);
        $repository = new CashSessionRepository();
        $session    = $repository->openFor($stationId);

        if ($session === null) {
            Response::success([
                'session' => null,
                // Même sans caisse ouverte, on signale les espèces déjà
                // encaissées aujourd'hui : c'est ce qui explique
                // pourquoi le tiroir n'est pas vide.
                'cash_outside_session' => $repository->cashOutsideSession($stationId),
                'station_id' => $stationId,
            ]);
        }

        $sessionId = (int) $session['id'];

        Response::success([
            'session'   => $this->present($session, $repository, $sessionId),
            'movements' => $repository->movements($sessionId),
            'cash_outside_session' => $repository->cashOutsideSession($stationId),
            'station_id' => $stationId,
        ]);
    }

    /**
     * POST /api/cash/open
     * Ouvrir la caisse pour la journée.
     */
    public function open(Request $request): void
    {
        $stationId  = $this->resolveStation($request);
        $repository = new CashSessionRepository();

        if ($repository->openFor($stationId) !== null) {
            Response::error(
                'Une caisse est déjà ouverte sur cette station. Fermez-la avant d\'en ouvrir une autre.',
                [],
                409
            );
        }

        $validator = Validator::make($request->body())
            ->required('opening_float', 'Le fond de caisse')
            ->maxLength('opening_notes', 1000);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $float = $validator->string('opening_float');

        // Zéro est une valeur valide : une station peut démarrer sans
        // monnaie. C'est pourquoi on teste le format, pas la valeur.
        if (!ctype_digit($float)) {
            Response::validationFailed([
                'opening_float' => 'Le fond de caisse doit être un nombre entier de francs.',
            ]);
        }

        try {
            $id = $repository->create([
                'station_id'    => $stationId,
                'status'        => 'OPEN',
                'opening_float' => (int) $float,
                'opened_by_user_id' => AuthContext::current()->userId,
                'opened_at'     => date('Y-m-d H:i:s'),
                'opening_notes' => $validator->stringOrNull('opening_notes'),
            ]);
        } catch (PDOException $exception) {
            // 23000 : la contrainte d'unicité a tranché. Deux caissiers
            // ont cliqué à la même seconde et sont tous les deux passés
            // par la vérification ci-dessus avant que l'un n'écrive.
            // C'est exactement le cas que la base est là pour attraper.
            if ($exception->getCode() === '23000') {
                Response::error(
                    'Une caisse vient d\'être ouverte sur cette station.',
                    [],
                    409
                );
            }

            throw $exception;
        }

        AuditLogger::record(
            action: 'cash.opened',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'cash_session',
            entityId: $id,
            metadata: ['opening_float' => (int) $float],
        );

        Response::success(
            ['session' => $this->present($repository->find($id) ?? [], $repository, $id)],
            'Caisse ouverte.',
            201
        );
    }

    /**
     * POST /api/cash/close
     * LE MOMENT DE VÉRITÉ.
     */
    public function close(Request $request): void
    {
        $stationId  = $this->resolveStation($request);
        $repository = new CashSessionRepository();
        $session    = $repository->openFor($stationId);

        if ($session === null) {
            Response::error("Aucune caisse n'est ouverte sur cette station.", [], 409);
        }

        $validator = Validator::make($request->body())
            ->required('counted_amount', 'Le montant compté')
            ->maxLength('closing_notes', 1000);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $counted = $validator->string('counted_amount');

        if (!ctype_digit($counted)) {
            Response::validationFailed([
                'counted_amount' => 'Le montant compté doit être un nombre entier de francs.',
            ]);
        }

        $sessionId = (int) $session['id'];
        $counted   = (int) $counted;
        $expected  = $repository->expectedAmount($sessionId);
        $difference = $counted - $expected;

        $notes = $validator->stringOrNull('closing_notes');

        // UN ÉCART IMPORTANT DOIT ÊTRE EXPLIQUÉ.
        //
        // Le seuil est volontairement bas. À 500 F près, on est dans
        // l'erreur de monnaie ordinaire et exiger une justification
        // ferait écrire « RAS » tous les soirs — ce qui n'apprendrait
        // rien à personne. Au-delà, quelqu'un doit se souvenir de la
        // raison MAINTENANT : dans trois jours, personne ne saura.
        if (abs($difference) > 500 && $notes === null) {
            Response::validationFailed([
                'closing_notes' => sprintf(
                    'L\'écart est de %s FCFA. Expliquez-le maintenant : dans trois jours, personne ne s\'en souviendra.',
                    number_format($difference, 0, ',', ' ')
                ),
            ]);
        }

        // Les montants sont FIGÉS dans la ligne, jamais recalculés à
        // l'affichage. Une correction ultérieure sur un paiement
        // changerait sinon rétroactivement un écart déjà constaté.
        // Une clôture est une photo, pas une vue.
        $repository->update($sessionId, [
            'status'          => 'CLOSED',
            'expected_amount' => $expected,
            'counted_amount'  => $counted,
            'difference'      => $difference,
            'closed_by_user_id' => AuthContext::current()->userId,
            'closed_at'       => date('Y-m-d H:i:s'),
            'closing_notes'   => $notes,
        ]);

        AuditLogger::record(
            action: $difference === 0 ? 'cash.closed' : 'cash.closed_with_difference',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'cash_session',
            entityId: $sessionId,
            metadata: array_filter([
                'expected'   => $expected,
                'counted'    => $counted,
                'difference' => $difference,
                'notes'      => $notes,
            ], static fn (mixed $v): bool => $v !== null),
        );

        Response::success(
            [
                'session'   => $this->present($repository->find($sessionId) ?? [], $repository, $sessionId),
                'movements' => $repository->movements($sessionId),
            ],
            $difference === 0
                ? 'Caisse fermée, le compte est juste.'
                : sprintf(
                    'Caisse fermée. Écart de %s FCFA, enregistré.',
                    number_format($difference, 0, ',', ' ')
                )
        );
    }

    /** GET /api/cash/sessions?station_id= */
    public function history(Request $request): void
    {
        $requested = $request->query('station_id');
        $stationId = null;

        if ($requested !== null && $requested !== '') {
            $stationId = (int) $requested;

            if (!AuthContext::current()->canAccessStation($stationId)) {
                Response::forbidden("Vous n'êtes pas rattaché à cette station.");
            }
        }

        $repository = new CashSessionRepository();
        $sessions   = $repository->history($stationId);

        Response::success([
            'sessions' => array_map(
                static fn (array $row): array => [
                    'id'         => (int) $row['id'],
                    'station_id' => (int) $row['station_id'],
                    'station_name' => $row['station_name'],
                    'status'     => $row['status'],
                    'opening_float'   => (int) $row['opening_float'],
                    'expected_amount' => $row['expected_amount'] === null
                        ? null : (int) $row['expected_amount'],
                    'counted_amount'  => $row['counted_amount'] === null
                        ? null : (int) $row['counted_amount'],
                    'difference'      => $row['difference'] === null
                        ? null : (int) $row['difference'],
                    'opened_by_name' => $row['opened_by_name'],
                    'closed_by_name' => $row['closed_by_name'],
                    'opened_at'   => $row['opened_at'],
                    'closed_at'   => $row['closed_at'],
                    'opening_notes' => $row['opening_notes'],
                    'closing_notes' => $row['closing_notes'],
                ],
                $sessions
            ),
        ]);
    }

    // ==================================================================

    /**
     * Sur quelle station travaille-t-on ?
     *
     * Sans paramètre, celle de l'utilisateur. Une caisse est un objet
     * physique : on ne l'ouvre pas à distance, on est devant.
     */
    private function resolveStation(Request $request): int
    {
        $requested = $request->query('station_id') ?? $request->input('station_id');

        if ($requested !== null && $requested !== '') {
            $stationId = (int) $requested;

            if ((new StationRepository())->find($stationId) === null) {
                Response::notFound("Cette station n'existe pas.");
            }

            if (!AuthContext::current()->canAccessStation($stationId)) {
                Response::forbidden("Vous n'êtes pas rattaché à cette station.");
            }

            return $stationId;
        }

        $stations = AuthContext::current()->stationIds;

        if ($stations === []) {
            Response::error(
                "Votre compte n'est rattaché à aucune station. Contactez votre responsable.",
                [],
                409
            );
        }

        return $stations[0];
    }

    /**
     * @param array<string,mixed> $session
     * @return array<string,mixed>
     */
    private function present(array $session, CashSessionRepository $repository, int $sessionId): array
    {
        $isOpen = ($session['status'] ?? '') === 'OPEN';

        // Sur une caisse OUVERTE, le montant attendu se calcule en
        // direct — il bouge à chaque encaissement. Sur une caisse
        // FERMÉE, on relit celui qui a été figé à la clôture.
        $expected = $isOpen
            ? $repository->expectedAmount($sessionId)
            : (int) ($session['expected_amount'] ?? 0);

        return [
            'id'         => (int) ($session['id'] ?? 0),
            'station_id' => (int) ($session['station_id'] ?? 0),
            'status'     => $session['status'] ?? 'OPEN',
            'opening_float'   => (int) ($session['opening_float'] ?? 0),
            'expected_amount' => $expected,
            'counted_amount'  => ($session['counted_amount'] ?? null) === null
                ? null : (int) $session['counted_amount'],
            'difference'      => ($session['difference'] ?? null) === null
                ? null : (int) $session['difference'],
            'opened_at'     => $session['opened_at'] ?? null,
            'closed_at'     => $session['closed_at'] ?? null,
            'opening_notes' => $session['opening_notes'] ?? null,
            'closing_notes' => $session['closing_notes'] ?? null,
        ];
    }
}
