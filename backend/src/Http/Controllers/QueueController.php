<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\OperationStatus;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Http\Presenters\OperationPresenter;
use Autocare\Models\OperationRepository;
use Autocare\Models\StationRepository;
use Autocare\Models\TeamRepository;

/**
 * La file d'attente
 * ==================================================================
 * L'ÉCRAN QUE LE GÉRANT LAISSE OUVERT TOUTE LA JOURNÉE.
 * ==================================================================
 *
 * IL N'Y A PAS DE TABLE `queue`, ET CE N'EST PAS UN OUBLI.
 *
 * La file d'attente n'est pas une entité : c'est une LECTURE des
 * opérations actives, groupées par statut et triées. Une table
 * séparée dupliquerait l'état — et deux copies d'un même état
 * finissent toujours par diverger, en général le jour où l'une des
 * deux est mise à jour et pas l'autre. On aurait alors un véhicule
 * « en lavage » dans la file et « restitué » dans son dossier, sans
 * moyen de savoir lequel a raison.
 *
 * ------------------------------------------------------------------
 * CE QUI REND CET ÉCRAN UTILE : LE TEMPS, PAS L'ÉTAT
 *
 * « 6 véhicules en lavage » n'appelle aucune décision. « Cette
 * voiture est en lavage depuis 50 minutes pour une prestation vendue
 * 45 » en appelle une immédiatement. Chaque carte porte donc sa durée
 * et, le cas échéant, son alerte — calculées côté serveur, dont
 * l'horloge fait foi.
 */
final class QueueController
{
    /**
     * GET /api/queue?station_id=
     *
     * Renvoie les colonnes du tableau, prêtes à afficher.
     *
     * POURQUOI GROUPER CÔTÉ SERVEUR PLUTÔT QU'EN ANGULAR ?
     * Parce que l'ordre des colonnes et leur composition sont une
     * règle métier, déclarée dans config/operation_status.php. Si le
     * frontend regroupait lui-même, il faudrait y recopier la liste
     * des statuts actifs et leur ordre — une deuxième source de
     * vérité, qui divergerait au premier changement.
     */
    public function index(Request $request): void
    {
        $stationId = $this->readStationId($request);

        $repository = new OperationRepository();
        $operations = array_map(
            OperationPresenter::present(...),
            $repository->queue($stationId),
        );

        // Les colonnes sont déclarées dans config/operation_status.php,
        // à côté du parcours qu'elles montrent. Elles sont TOUJOURS
        // toutes présentes, même vides : une colonne qui apparaît et
        // disparaît selon le contenu fait sauter la mise en page sous
        // les yeux de l'utilisateur et l'oblige à relire les en-têtes
        // à chaque rafraîchissement.
        $columns = [];

        foreach (OperationStatus::board() as $definition) {
            $inColumn = array_values(array_filter(
                $operations,
                static fn (array $operation): bool => in_array(
                    $operation['status'],
                    $definition['statuses'],
                    true
                ),
            ));

            $columns[] = [
                'label'    => $definition['label'],
                // Le statut appliqué au dépôt d'une carte. Le frontend
                // s'en sert pour savoir si une colonne est une cible
                // possible — sans jamais avoir à connaître le parcours.
                'drop_status' => $definition['drop'],
                'statuses' => $definition['statuses'],
                'count'    => count($inColumn),
                'overdue'  => count(array_filter(
                    $inColumn,
                    static fn (array $operation): bool => $operation['is_overdue'],
                )),
                'operations' => $inColumn,
            ];
        }

        Response::success([
            'columns' => $columns,
            'metrics' => $this->metrics($operations),
            // L'heure du serveur, pour que le frontend affiche
            // « actualisé à 10 h 42 » sans faire confiance à l'horloge
            // du poste — souvent fausse dans une station.
            'generated_at' => date('c'),
        ]);
    }

    /**
     * PUT /api/operations/{id}/priority
     *
     * Faire passer un véhicule devant les autres.
     *
     * POURQUOI CETTE ACTION EST-ELLE RÉSERVÉE AUX RESPONSABLES,
     * ALORS QU'UN EMPLOYÉ PEUT DÉJÀ CHOISIR UNE PRIORITÉ À L'ACCUEIL ?
     *
     * Parce que ce ne sont pas les mêmes gestes. À l'accueil,
     * l'employé ENREGISTRE ce que le client lui dit — « je suis
     * pressé » fait partie de la prise de commande. Ici, on
     * RÉORGANISE une file où des gens attendent déjà, et on fait
     * reculer quelqu'un qui était devant. Cette décision-là engage la
     * station vis-à-vis de ses clients : elle revient au responsable.
     */
    public function prioritize(Request $request, string $id): void
    {
        $operationId = (int) $id;
        $repository  = new OperationRepository();
        $operation   = $repository->find($operationId);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        if (OperationStatus::isFinal((string) $operation['status'])) {
            Response::error(
                'Ce dossier est clos : sa place dans la file n\'a plus de sens.',
                [],
                409
            );
        }

        $validator = Validator::make($request->body())->required('priority', 'La priorité');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $priority = $validator->string('priority');

        if (!is_numeric($priority)) {
            Response::validationFailed(['priority' => 'La priorité doit être un nombre.']);
        }

        // Trois niveaux, pas trente. Au-delà, plus personne ne sait ce
        // que « priorité 47 » veut dire, et le classement redevient
        // arbitraire — donc inutile.
        $priority = max(0, min((int) $priority, 3));
        $previous = (int) $operation['priority'];

        $repository->update($operationId, ['priority' => $priority]);

        // Faire passer quelqu'un devant est une décision qui se
        // discute après coup — « pourquoi ma voiture est passée
        // après celle-là ? ». On la trace.
        AuditLogger::record(
            action: 'operation.prioritized',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $operation['station_id'],
            entityType: 'operation',
            entityId: $operationId,
            metadata: [
                'reference' => $operation['reference'],
                'from'      => $previous,
                'to'        => $priority,
            ],
        );

        Response::success(
            ['operation' => OperationPresenter::present($repository->findDetailed($operationId) ?? [])],
            $priority > 0 ? 'Ce véhicule passe devant.' : 'Priorité normale rétablie.'
        );
    }

    /**
     * PUT /api/operations/{id}/assign
     *
     * Confier un dossier à un employé.
     *
     * Un employé n'a pas besoin de cette route pour prendre un
     * véhicule en charge : passer le dossier à IN_PROGRESS l'inscrit
     * automatiquement dessus. Celle-ci sert à désigner QUELQU'UN
     * D'AUTRE — c'est de la répartition de travail, donc du ressort
     * du responsable.
     */
    public function assign(Request $request, string $id): void
    {
        $operationId = (int) $id;
        $repository  = new OperationRepository();
        $operation   = $repository->find($operationId);

        if ($operation === null) {
            Response::notFound("Ce dossier n'existe pas.");
        }

        if (OperationStatus::isFinal((string) $operation['status'])) {
            Response::error("Ce dossier est clos : il n'y a plus rien à confier.", [], 409);
        }

        $raw = $request->input('assigned_user_id');

        // Une valeur vide retire l'affectation : remettre un dossier
        // dans le pot commun doit être aussi simple que l'attribuer.
        if ($raw === null || $raw === '' || $raw === 0) {
            $repository->update($operationId, ['assigned_user_id' => null]);

            Response::success(
                ['operation' => OperationPresenter::present($repository->findDetailed($operationId) ?? [])],
                'Dossier remis dans la file commune.'
            );
        }

        $userId = (int) $raw;

        // L'employé doit appartenir à la MÊME entreprise. Le dépôt
        // filtre déjà, mais c'est ici que la cohérence métier se
        // vérifie : sans ce contrôle, une requête fabriquée pourrait
        // confier un véhicule à l'employé d'un concurrent.
        $member = (new TeamRepository())->findMember($userId);

        if ($member === null) {
            Response::validationFailed([
                'assigned_user_id' => "Cette personne ne fait pas partie de votre équipe.",
            ]);
        }

        if (($member['status'] ?? '') !== 'ACTIVE') {
            Response::validationFailed([
                'assigned_user_id' => "Ce compte n'est plus actif.",
            ]);
        }

        $repository->update($operationId, ['assigned_user_id' => $userId]);

        AuditLogger::record(
            action: 'operation.assigned',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $operation['station_id'],
            entityType: 'operation',
            entityId: $operationId,
            metadata: [
                'reference'   => $operation['reference'],
                'assigned_to' => $userId,
            ],
        );

        Response::success(
            ['operation' => OperationPresenter::present($repository->findDetailed($operationId) ?? [])],
            'Dossier confié à ' . trim(($member['first_name'] ?? '') . ' ' . ($member['last_name'] ?? '')) . '.'
        );
    }

    // ==================================================================

    /**
     * La station demandée, si l'utilisateur y a accès.
     *
     * Sans paramètre, on ne filtre pas : un administrateur voit alors
     * l'ensemble de son réseau. C'est volontaire — il pilote plusieurs
     * stations et doit pouvoir les comparer d'un coup d'œil.
     */
    private function readStationId(Request $request): ?int
    {
        $requested = $request->query('station_id');

        if ($requested === null || $requested === '') {
            return null;
        }

        $stationId = (int) $requested;

        if ((new StationRepository())->find($stationId) === null) {
            Response::notFound("Cette station n'existe pas.");
        }

        if (!AuthContext::current()->canAccessStation($stationId)) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        return $stationId;
    }

    /**
     * Les quatre chiffres du bandeau.
     *
     * QUATRE, PAS HUIT. Un bandeau qui affiche les huit statuts oblige
     * à lire les huit pour repérer celui qui pose problème. On répond
     * plutôt aux quatre questions qu'un gérant se pose vraiment :
     * combien attendent, combien sont en cours, combien peuvent
     * partir, et surtout — combien traînent.
     *
     * @param list<array<string,mixed>> $operations
     * @return array<string,int|null>
     */
    private function metrics(array $operations): array
    {
        $waiting = array_filter(
            $operations,
            static fn (array $o): bool => $o['status'] === 'WAITING',
        );

        $inProgress = array_filter(
            $operations,
            static fn (array $o): bool => in_array(
                $o['status'],
                ['IN_PROGRESS', 'INSPECTION', 'WASHING', 'QUALITY_CHECK'],
                true
            ),
        );

        $ready = array_filter(
            $operations,
            static fn (array $o): bool => $o['status'] === 'READY',
        );

        $overdue = array_filter(
            $operations,
            static fn (array $o): bool => $o['is_overdue'] === true,
        );

        // La plus longue attente de la file. C'est le chiffre qui dit
        // si la station tient la cadence : une moyenne masquerait
        // justement le véhicule oublié depuis deux heures.
        $longestWait = null;

        foreach ($waiting as $operation) {
            $minutes = $operation['minutes_in_status'];

            if ($minutes !== null && ($longestWait === null || $minutes > $longestWait)) {
                $longestWait = $minutes;
            }
        }

        return [
            'waiting'              => count($waiting),
            'in_progress'          => count($inProgress),
            'ready'                => count($ready),
            'overdue'              => count($overdue),
            'longest_wait_minutes' => $longestWait,
        ];
    }
}
