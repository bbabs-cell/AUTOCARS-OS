<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\OperationRepository;
use Autocare\Models\StationRepository;

/**
 * Les stations de l'entreprise
 * ==================================================================
 * OUVRIR UN SECOND POINT DE SERVICE, ET EN FERMER UN.
 * ==================================================================
 *
 * Jusqu'au lot 16, une seule station existait : celle créée à
 * l'inscription. Tout le produit était pourtant déjà écrit pour
 * plusieurs — chaque table porte `station_id`, chaque écran de
 * consultation accepte un filtre, et `canAccessStation()` décide qui
 * voit quoi. Ce lot n'ajoute donc pas le multi-stations : il ouvre
 * la porte qui manquait, celle qui permet d'en créer une seconde.
 *
 * ------------------------------------------------------------------
 * ON FERME UNE STATION, ON NE L'EFFACE PAS
 *
 * C'est exactement la règle des comptes utilisateurs (lot 12), pour
 * la même raison. Une station fermée figure sur des milliers de
 * dossiers, d'encaissements et de fiches de paie. Supprimer la ligne
 * casserait cet historique — c'est-à-dire précisément ce qui sert en
 * cas de litige ou de contrôle.
 *
 * Une station INACTIVE n'accepte donc plus de nouveau travail, mais
 * son passé reste lisible, comptabilisé dans les statistiques, et
 * consultable dossier par dossier.
 *
 * ------------------------------------------------------------------
 * DEUX REFUS À LA FERMETURE
 *
 * 1. LA DERNIÈRE STATION ACTIVE NE SE FERME PAS. Une entreprise sans
 *    aucun point de service ouvert ne peut plus rien enregistrer :
 *    ni accueillir un véhicule, ni encaisser. Le refus est explicite
 *    plutôt que subi, comme pour le dernier administrateur.
 *
 * 2. UNE STATION QUI A DES VÉHICULES SUR PLACE NE SE FERME PAS. Ces
 *    voitures appartiennent à des clients qui vont revenir les
 *    chercher. Fermer la station rendrait leur dossier impossible à
 *    faire avancer, et les clés seraient rendues sans que le logiciel
 *    puisse l'enregistrer.
 */
final class StationController
{
    /**
     * GET /api/stations
     *
     * LES STATIONS FERMÉES SONT DANS LA LISTE, avec leur statut.
     * Les masquer donnerait un écran de gestion où l'on ne peut pas
     * rouvrir ce qu'on a fermé — et ferait croire à une suppression.
     * C'est à l'appelant d'écarter les inactives quand il propose un
     * choix de saisie ; `status` est là pour ça.
     */
    public function index(Request $request): void
    {
        $stations = (new StationRepository())->all([], 'name ASC');
        $counts   = (new OperationRepository())->openCountByStation();

        Response::success(array_map(
            fn (array $station): array => $this->present($station) + [
                // Combien de véhicules sont sur place en ce moment.
                // C'est ce chiffre qui explique un refus de fermeture,
                // et l'écran peut le montrer AVANT que l'utilisateur
                // clique — un refus prévisible vaut mieux qu'un refus
                // expliqué après coup.
                'vehicles_on_site' => $counts[(int) ($station['id'] ?? 0)] ?? 0,
            ],
            $stations,
        ));
    }

    /**
     * POST /api/stations
     *
     * Réservé à l'administrateur (voir la table des routes) : ouvrir
     * un point de service est une décision de propriétaire, pas
     * d'exploitation quotidienne.
     */
    public function store(Request $request): void
    {
        $repository = new StationRepository();

        $validator = Validator::make($request->body())
            ->required('name', 'Le nom de la station')->maxLength('name', 120)
            ->required('code', 'Le code')->maxLength('code', 10)
            ->maxLength('address', 255)
            ->maxLength('city', 80)
            ->phone('phone');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $code = $this->readCode($validator->string('code'));

        if ($repository->codeIsTaken($code)) {
            Response::validationFailed(['code' => 'Une autre station utilise déjà ce code.']);
        }

        $hours = $this->readOpeningHours($request);

        // `organization_id` n'est PAS lu depuis la requête : c'est
        // TenantRepository::create() qui l'ajoute, à partir du
        // contexte d'authentification. Une station ne peut donc pas
        // être créée chez le voisin, même en modifiant le formulaire.
        $stationId = $repository->create([
            'name'      => $validator->string('name'),
            'code'      => $code,
            'address'   => $validator->stringOrNull('address'),
            'city'      => $validator->stringOrNull('city'),
            'phone'     => $validator->stringOrNull('phone'),
            'opens_at'  => $hours['opens_at'],
            'closes_at' => $hours['closes_at'],
        ]);

        AuditLogger::record(
            action: 'station.created',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'station',
            entityId: $stationId,
            metadata: ['code' => $code],
        );

        Response::success(
            $this->present($repository->find($stationId) ?? []),
            'Station créée. Rattachez-y votre équipe pour qu\'elle puisse y travailler.',
            201
        );
    }

    /**
     * PUT /api/stations/{id}/status
     *
     * Ouvrir ou fermer une station. Les deux refus sont détaillés
     * dans la note de tête de classe.
     */
    public function setStatus(Request $request, string $id): void
    {
        $stationId  = (int) $id;
        $repository = new StationRepository();
        $station    = $repository->find($stationId);

        if ($station === null) {
            Response::notFound("Cette station n'existe pas.");
        }

        $validator = Validator::make($request->body())
            ->required('status', "L'état")->in('status', ['ACTIVE', 'INACTIVE']);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $status = $validator->string('status');

        if ($status === 'INACTIVE' && $station['status'] === 'ACTIVE') {
            // Refus 1 — l'entreprise se retrouverait sans aucun point
            // de service ouvert, donc incapable d'enregistrer quoi que
            // ce soit.
            if ($repository->count(['status' => 'ACTIVE']) <= 1) {
                Response::error(
                    'C\'est la dernière station ouverte. Ouvrez-en une autre avant de '
                    . 'fermer celle-ci.',
                    [],
                    409
                );
            }

            // Refus 2 — des clients vont revenir chercher ces
            // véhicules, et leur dossier doit pouvoir aller jusqu'à la
            // restitution.
            $onSite = (new OperationRepository())->openCountAtStation($stationId);

            if ($onSite > 0) {
                Response::error(
                    $onSite === 1
                        ? 'Un véhicule est encore sur place. Terminez son dossier avant de '
                          . 'fermer la station.'
                        : "{$onSite} véhicules sont encore sur place. Terminez leurs dossiers "
                          . 'avant de fermer la station.',
                    [],
                    409
                );
            }
        }

        $repository->update($stationId, ['status' => $status]);

        AuditLogger::record(
            action: $status === 'INACTIVE' ? 'station.closed' : 'station.reopened',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'station',
            entityId: $stationId,
            metadata: ['from' => $station['status'], 'to' => $status],
        );

        Response::success(
            $this->present($repository->find($stationId) ?? []),
            $status === 'INACTIVE'
                ? 'Station fermée. Son historique reste consultable.'
                : 'Station rouverte.'
        );
    }

    /** GET /api/stations/{id} */
    public function show(Request $request, string $id): void
    {
        $station = (new StationRepository())->find((int) $id);

        if ($station === null) {
            Response::notFound('Cette station n\'existe pas.');
        }

        Response::success($this->present($station));
    }

    /** PUT /api/stations/{id} */
    public function update(Request $request, string $id): void
    {
        $stationId  = (int) $id;
        $repository = new StationRepository();

        if ($repository->find($stationId) === null) {
            Response::notFound('Cette station n\'existe pas.');
        }

        // Un manager ne pilote que les stations où il est rattaché.
        // Un administrateur les voit toutes (voir AuthContext).
        if (!AuthContext::current()->canAccessStation($stationId)) {
            Response::forbidden('Vous n\'êtes pas rattaché à cette station.');
        }

        $validator = Validator::make($request->body())
            ->required('name', 'Le nom de la station')->maxLength('name', 120)
            ->required('code', 'Le code')->maxLength('code', 10)
            ->maxLength('address', 255)
            ->maxLength('city', 80)
            ->phone('phone');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $code = $this->readCode($validator->string('code'));

        if ($repository->codeIsTaken($code, $stationId)) {
            Response::validationFailed(['code' => 'Une autre station utilise déjà ce code.']);
        }

        $hours = $this->readOpeningHours($request);

        $repository->update($stationId, [
            'name'      => $validator->string('name'),
            'code'      => $code,
            'address'   => $validator->stringOrNull('address'),
            'city'      => $validator->stringOrNull('city'),
            'phone'     => $validator->stringOrNull('phone'),
            'opens_at'  => $hours['opens_at'],
            'closes_at' => $hours['closes_at'],
        ]);

        AuditLogger::record(
            action: 'station.updated',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: $stationId,
            entityType: 'station',
            entityId: $stationId,
        );

        Response::success($this->present($repository->find($stationId) ?? []), 'Station enregistrée.');
    }

    // ------------------------------------------------------------------

    /**
     * Le code court de la station, normalisé.
     *
     * Il apparaît dans les références de dossier remises au client
     * (« DKP-2608-0042 »). On impose des lettres et des chiffres en
     * majuscules : un code avec un espace ou un tiret rendrait la
     * référence ambiguë à lire au comptoir.
     *
     * La règle est écrite ICI, une seule fois, parce qu'elle vaut
     * pour la création comme pour la modification. Deux copies
     * auraient fini par diverger — et une station créée avec un code
     * que la modification refuse est un piège pour l'utilisateur.
     */
    private function readCode(string $raw): string
    {
        $code = mb_strtoupper(trim($raw));

        if (preg_match('/^[A-Z0-9]{2,10}$/', $code) !== 1) {
            Response::validationFailed([
                'code' => 'Le code doit contenir 2 à 10 lettres ou chiffres, sans espace.',
            ]);
        }

        return $code;
    }

    /**
     * Horaires d'ouverture, facultatifs.
     *
     * @return array{opens_at:?string, closes_at:?string}
     */
    private function readOpeningHours(Request $request): array
    {
        $read = static function (mixed $value): ?string {
            if (!is_string($value) || trim($value) === '') {
                return null;
            }

            // Format attendu : HH:MM. On refuse tout le reste plutôt
            // que de laisser MySQL interpréter une valeur douteuse.
            return preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', trim($value)) === 1
                ? trim($value) . ':00'
                : null;
        };

        return [
            'opens_at'  => $read($request->input('opens_at')),
            'closes_at' => $read($request->input('closes_at')),
        ];
    }

    /**
     * @param array<string,mixed> $station
     * @return array<string,mixed>
     */
    private function present(array $station): array
    {
        return [
            'id'        => (int) ($station['id'] ?? 0),
            'name'      => $station['name'] ?? '',
            'code'      => $station['code'] ?? '',
            'address'   => $station['address'] ?? null,
            'city'      => $station['city'] ?? null,
            'phone'     => $station['phone'] ?? null,
            // On renvoie HH:MM et non HH:MM:SS : c'est ce qu'attend
            // un champ <input type="time"> côté navigateur.
            'opens_at'  => $this->shortTime($station['opens_at'] ?? null),
            'closes_at' => $this->shortTime($station['closes_at'] ?? null),
            'status'    => $station['status'] ?? 'ACTIVE',
        ];
    }

    private function shortTime(mixed $time): ?string
    {
        return is_string($time) && strlen($time) >= 5 ? substr($time, 0, 5) : null;
    }
}
