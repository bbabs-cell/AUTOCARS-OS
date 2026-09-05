<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\StationRepository;
use Autocare\Models\TeamRepository;
use Autocare\Models\UserRepository;
use Throwable;

/**
 * L'équipe de la station
 * ------------------------------------------------------------------
 * QUI TRAVAILLE ICI, AVEC QUEL RÔLE, ET CE QU'IL A FAIT.
 *
 * ------------------------------------------------------------------
 * DEUX RÈGLES QUI STRUCTURENT TOUT LE MODULE
 *
 * 1. ON NE SUPPRIME PAS UN EMPLOYÉ QUI PART.
 *    Son nom figure sur des inspections, des encaissements et des
 *    restitutions : effacer la ligne casserait cet historique, qui
 *    est précisément ce qui sert en cas de litige. On DÉSACTIVE le
 *    compte — l'accès est coupé immédiatement, la trace reste.
 *
 * 2. ON NE PEUT PAS DÉSACTIVER LE DERNIER ADMINISTRATEUR.
 *    Une entreprise dont plus personne ne peut gérer les comptes est
 *    enfermée dehors, et il faudrait intervenir en base pour l'en
 *    sortir. Le refus est explicite plutôt que subi.
 */
final class TeamController
{
    /** GET /api/team */
    public function index(Request $request): void
    {
        $members = (new TeamRepository())->members();

        Response::success(array_map(
            static fn (array $member): array => [
                'id'            => (int) $member['id'],
                'first_name'    => $member['first_name'],
                'last_name'     => $member['last_name'],
                'full_name'     => trim($member['first_name'] . ' ' . $member['last_name']),
                'email'         => $member['email'],
                'phone'         => $member['phone'],
                'role'          => $member['role'],
                'status'        => $member['status'],
                'station_id'    => (int) $member['station_id'],
                'station_name'  => $member['station_name'],
                // La liste complète quand la personne est rattachée à
                // plusieurs stations : « Dakar Plateau, Thiès ».
                'station_names' => $member['station_names'],
                'station_ids'   => $member['station_ids'],
                'station_count' => (int) $member['station_count'],
                'last_login_at' => $member['last_login_at'],
            ],
            $members,
        ));
    }

    /**
     * GET /api/team/activity?from=
     *
     * Ce que chacun a produit sur la période : dossiers pris en
     * charge, et ce qu'ils ont rapporté.
     *
     * Le chiffre d'affaires n'est envoyé qu'à qui a le droit de voir
     * des montants. Comme au tableau de bord, il n'est pas masqué par
     * l'interface : il n'est pas envoyé.
     */
    public function activity(Request $request): void
    {
        // Par défaut le mois en cours : c'est la période de la paie.
        $from = $request->query('from') ?? date('Y-m-01');

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) !== 1) {
            Response::validationFailed(['from' => 'Date attendue au format AAAA-MM-JJ.']);
        }

        $team       = new TeamRepository();
        $activity   = $team->activitySince($from);
        $canSeeMoney = AuthContext::current()->can('reports.view');

        Response::success([
            'from' => $from,
            'members' => array_map(
                static function (array $member) use ($activity, $canSeeMoney): array {
                    $userId = (int) $member['id'];
                    $row    = $activity[$userId] ?? ['operations' => 0, 'revenue' => 0];

                    $result = [
                        'id'         => $userId,
                        'full_name'  => trim($member['first_name'] . ' ' . $member['last_name']),
                        'role'       => $member['role'],
                        'status'     => $member['status'],
                        'operations' => $row['operations'],
                    ];

                    if ($canSeeMoney) {
                        $result['revenue'] = $row['revenue'];
                    }

                    return $result;
                },
                $team->members(),
            ),
            'can_see_money' => $canSeeMoney,
        ]);
    }

    /**
     * PUT /api/team/{id}
     * Modifier le rôle ou l'état d'un membre.
     */
    public function update(Request $request, string $id): void
    {
        $userId = (int) $id;
        $team   = new TeamRepository();
        $member = $team->findMember($userId);

        if ($member === null) {
            Response::notFound("Cette personne ne fait pas partie de votre équipe.");
        }

        $validator = Validator::make($request->body())
            ->required('role', 'Le rôle')->in('role', ['ADMIN', 'MANAGER', 'EMPLOYEE'])
            ->required('status', "L'état")->in('status', ['ACTIVE', 'DISABLED']);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $role   = $validator->string('role');
        $status = $validator->string('status');

        $current = AuthContext::current();

        // On ne se retire pas soi-même ses propres droits : le seul
        // effet garanti serait de ne plus pouvoir revenir en arrière.
        if ($userId === $current->userId && ($role !== 'ADMIN' || $status !== 'ACTIVE')) {
            Response::error(
                'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre compte. '
                . 'Demandez-le à un autre administrateur.',
                [],
                409
            );
        }

        // Le dernier administrateur actif est intouchable — sinon
        // plus personne ne peut gérer les comptes, et il faut
        // intervenir directement en base pour rouvrir l'entreprise.
        $wasActiveAdmin = $member['role'] === 'ADMIN' && $member['status'] === 'ACTIVE';
        $staysActiveAdmin = $role === 'ADMIN' && $status === 'ACTIVE';

        if ($wasActiveAdmin && !$staysActiveAdmin && $team->activeAdminCount() <= 1) {
            Response::error(
                "C'est le dernier administrateur actif. Nommez-en un autre avant de "
                . 'modifier celui-ci.',
                [],
                409
            );
        }

        $team->updateRole($userId, $role);
        $team->setStatus($userId, $status);

        AuditLogger::record(
            action: $status === 'DISABLED' ? 'team.member_disabled' : 'team.member_updated',
            organizationId: $current->organizationId,
            userId: $current->userId,
            stationId: (int) $member['station_id'],
            entityType: 'user',
            entityId: $userId,
            metadata: [
                'from' => ['role' => $member['role'], 'status' => $member['status']],
                'to'   => ['role' => $role, 'status' => $status],
            ],
        );

        Response::success(
            ['id' => $userId, 'role' => $role, 'status' => $status],
            $status === 'DISABLED'
                ? "Compte désactivé. L'historique de cette personne est conservé."
                : 'Membre mis à jour.'
        );
    }

    /**
     * PUT /api/team/{id}/stations
     * ==================================================================
     * RATTACHER QUELQU'UN À PLUSIEURS STATIONS (lot 17).
     * ==================================================================
     *
     * La table `station_users` accepte plusieurs lignes par personne
     * depuis le lot 4, et `members()` sait déjà les agréger. Ce qui
     * manquait, c'était le geste : jusqu'ici un membre restait
     * définitivement rattaché à la station où il avait été créé.
     *
     * ------------------------------------------------------------------
     * POURQUOI UNE ROUTE À PART, ET PAS UN CHAMP DE PLUS DANS `update()` ?
     *
     * Parce que ce sont deux décisions de nature différente, prises à
     * des moments différents. `update()` répond à « quel est son rôle,
     * et son compte est-il ouvert ? » — c'est-à-dire CE QU'IL A LE
     * DROIT DE FAIRE. Celle-ci répond à « où travaille-t-il ? ».
     *
     * Les mélanger obligerait le formulaire d'affectation à renvoyer
     * le rôle à chaque enregistrement — et un jour, à le renvoyer
     * faux : il suffirait qu'un écran ait chargé la fiche avant un
     * changement de rôle pour le réécrire à l'ancienne valeur en
     * déplaçant simplement quelqu'un d'une station à l'autre.
     */
    public function stations(Request $request, string $id): void
    {
        $userId = (int) $id;
        $team   = new TeamRepository();
        $member = $team->findMember($userId);

        if ($member === null) {
            Response::notFound('Cette personne ne fait pas partie de votre équipe.');
        }

        $submitted = $request->input('station_ids');

        if (!is_array($submitted)) {
            Response::validationFailed(['station_ids' => 'La liste des stations est attendue.']);
        }

        // On normalise avant de valider : le navigateur envoie
        // volontiers des chaînes (« 3 ») là où on attend des entiers,
        // et un doublon dans la liste ferait échouer l'insertion sur
        // la contrainte d'unicité au lieu de produire un message
        // compréhensible.
        $stationIds = array_values(array_unique(array_map(
            static fn (mixed $value): int => (int) $value,
            array_filter($submitted, static fn (mixed $value): bool => is_int($value)
                || (is_string($value) && $value !== '')),
        )));

        // UNE PERSONNE SANS STATION N'A AUCUN RÔLE, DONC AUCUN DROIT.
        // Elle pourrait se connecter et ne rien pouvoir faire — un
        // état pire que ne pas exister, parce qu'il ressemble à une
        // panne. Le compte se désactive (`update()`), il ne se vide
        // pas.
        if ($stationIds === []) {
            Response::validationFailed([
                'station_ids' => 'Choisissez au moins une station. Pour retirer l\'accès à '
                    . 'quelqu\'un, désactivez son compte.',
            ]);
        }

        $repository = new StationRepository();
        $current    = $team->stationIdsFor($userId);

        foreach ($stationIds as $stationId) {
            $station = $repository->find($stationId);

            // `find()` filtre par organisation : la station d'un
            // concurrent est indistinguable d'une station inexistante,
            // et c'est exactement ce qu'on veut répondre.
            if ($station === null) {
                Response::validationFailed(['station_ids' => "Cette station n'existe pas."]);
            }

            // On refuse d'AJOUTER quelqu'un sur une station fermée,
            // mais on n'oblige pas à retirer ceux qui y étaient déjà :
            // sinon, fermer une station rendrait impossible le moindre
            // enregistrement de la fiche des personnes qui y
            // travaillaient.
            if ($station['status'] !== 'ACTIVE' && !in_array($stationId, $current, true)) {
                Response::validationFailed([
                    'station_ids' => "« {$station['name']} » est fermée. Rouvrez-la avant d'y "
                        . 'affecter quelqu\'un.',
                ]);
            }
        }

        $team->setStations($userId, $stationIds, (string) $member['role']);

        AuditLogger::record(
            action: 'team.member_stations_changed',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            entityType: 'user',
            entityId: $userId,
            metadata: ['from' => $current, 'to' => $stationIds],
        );

        Response::success(
            ['id' => $userId, 'station_ids' => $stationIds],
            count($stationIds) === 1
                ? 'Affectation enregistrée.'
                : count($stationIds) . ' stations affectées.'
        );
    }

    /** POST /api/team */
    public function store(Request $request): void
    {
        $validator = Validator::make($request->body())
            ->required('first_name', 'Le prénom')->maxLength('first_name', 80)
            ->required('last_name', 'Le nom')->maxLength('last_name', 80)
            ->required('email', "L'adresse e-mail")->email('email')->maxLength('email', 190)
            ->required('password', 'Le mot de passe')->password('password')
            ->required('role', 'Le rôle')->in('role', ['ADMIN', 'MANAGER', 'EMPLOYEE'])
            ->required('station_id', 'La station')
            ->phone('phone');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $email = mb_strtolower($validator->string('email'));

        if ((new UserRepository())->emailExists($email)) {
            Response::validationFailed(['email' => 'Cette adresse e-mail est déjà utilisée.']);
        }

        // La station doit appartenir à l'entreprise de l'utilisateur.
        // Sans cette vérification, on pourrait rattacher un employé à
        // la station d'un concurrent en modifiant simplement le
        // formulaire — le dépôt filtre les lectures, mais c'est ici
        // que la cohérence métier se vérifie.
        $stationId = (int) $validator->string('station_id');

        if ((new StationRepository())->find($stationId) === null) {
            Response::validationFailed(['station_id' => 'Cette station n\'existe pas.']);
        }

        try {
            $userId = (new TeamRepository())->create([
                'first_name' => $validator->string('first_name'),
                'last_name'  => $validator->string('last_name'),
                'email'      => $email,
                'phone'      => $validator->stringOrNull('phone'),
                'role'       => $validator->string('role'),
                'station_id' => $stationId,
                'password'   => $validator->string('password'),
            ]);
        } catch (Throwable $exception) {
            error_log('[AUTOCARE][TEAM] ' . $exception->getMessage());

            Response::error("L'ajout du membre a échoué. Réessayez.", [], 500);
        }

        // Une création de compte est une action sensible : elle donne
        // accès aux données de l'entreprise. Elle est journalisée.
        AuditLogger::record(
            action: 'team.member_created',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'user',
            entityId: $userId,
            metadata: ['email' => $email, 'role' => $validator->string('role')],
        );

        Response::success(
            ['id' => $userId],
            'Membre ajouté. Communiquez-lui son mot de passe.',
            201
        );
    }
}
