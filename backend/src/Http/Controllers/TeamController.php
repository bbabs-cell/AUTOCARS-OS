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
 * Version minimale, celle dont l'installation guidée a besoin :
 * lister l'équipe et ajouter un membre.
 *
 * La gestion complète — modification, désactivation, performance,
 * historique d'activité — arrive au lot 12. On ne développe pas
 * d'avance ce dont personne n'a encore l'usage.
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
                'last_login_at' => $member['last_login_at'],
            ],
            $members,
        ));
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
