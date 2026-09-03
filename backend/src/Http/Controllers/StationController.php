<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\StationRepository;

/**
 * Les stations de l'entreprise
 * ------------------------------------------------------------------
 * Au lot 5, une seule station existe : celle créée à l'inscription.
 * L'installation guidée sert à la compléter — nom réel, adresse,
 * horaires — plutôt qu'à en créer une nouvelle.
 *
 * La gestion de plusieurs stations arrive au lot 17.
 */
final class StationController
{
    /** GET /api/stations */
    public function index(Request $request): void
    {
        $stations = (new StationRepository())->all([], 'name ASC');

        Response::success(array_map($this->present(...), $stations));
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

        // Le code apparaît dans les références de dossier remises au
        // client (« DKP-2608-0042 »). On impose des lettres et des
        // chiffres en majuscules : un code avec un espace ou un tiret
        // rendrait la référence ambiguë à lire au comptoir.
        $code = mb_strtoupper($validator->string('code'));

        if (preg_match('/^[A-Z0-9]{2,10}$/', $code) !== 1) {
            Response::validationFailed([
                'code' => 'Le code doit contenir 2 à 10 lettres ou chiffres, sans espace.',
            ]);
        }

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
