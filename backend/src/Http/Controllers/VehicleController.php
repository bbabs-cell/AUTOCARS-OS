<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\PlateNumber;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\CustomerRepository;
use Autocare\Models\VehicleRepository;

/**
 * Les véhicules
 * ------------------------------------------------------------------
 * Objet central du produit. Sa fiche est l'écran qu'on ouvre en cas
 * de litige : elle doit répondre à « qu'a-t-on fait sur ce véhicule,
 * quand, et par qui ».
 */
final class VehicleController
{
    /** GET /api/vehicles?search=&customer_id= */
    public function index(Request $request): void
    {
        $customerId = $request->query('customer_id');

        $vehicles = (new VehicleRepository())->search(
            $request->query('search') ?? '',
            $customerId !== null && $customerId !== '' ? (int) $customerId : null,
        );

        Response::success(array_map($this->present(...), $vehicles));
    }

    /**
     * GET /api/vehicles/{id}
     * La fiche complète : véhicule, propriétaire, historique.
     */
    public function show(Request $request, string $id): void
    {
        $vehicleId  = (int) $id;
        $repository = new VehicleRepository();
        $vehicle    = $repository->findWithOwner($vehicleId);

        if ($vehicle === null) {
            Response::notFound("Ce véhicule n'existe pas.");
        }

        Response::success([
            'vehicle' => $this->present($vehicle),
            'history' => array_map(
                static fn (array $operation): array => [
                    'id'           => (int) $operation['id'],
                    'reference'    => $operation['reference'],
                    'status'       => $operation['status'],
                    'service_name' => $operation['service_name'],
                    'employee_name' => $operation['employee_name'],
                    'price'        => (int) $operation['price'],
                    'created_at'   => $operation['created_at'],
                    'released_at'  => $operation['released_at'],
                ],
                $repository->history($vehicleId),
            ),
        ]);
    }

    /** POST /api/vehicles */
    public function store(Request $request): void
    {
        $validator  = $this->validate($request);
        $repository = new VehicleRepository();

        $plate = $validator->string('plate_number');

        if ($repository->plateIsTaken($plate)) {
            Response::validationFailed([
                'plate_number' => 'Ce véhicule est déjà enregistré. Recherchez-le plutôt que de le recréer.',
            ]);
        }

        $customerId = (int) $validator->string('customer_id');

        // Le client doit appartenir à la même entreprise. Le dépôt
        // filtre déjà les lectures, mais c'est ici que la cohérence
        // métier se vérifie : sans ce contrôle, un formulaire modifié
        // pourrait rattacher un véhicule au client d'un concurrent.
        if ((new CustomerRepository())->find($customerId) === null) {
            Response::validationFailed(['customer_id' => "Ce client n'existe pas."]);
        }

        $id = $repository->create([
            // STOCKÉE NORMALISÉE : « dk 1234 aa » et « DK-1234-AA »
            // désignent le même véhicule et doivent donc produire la
            // même valeur en base, sinon l'historique se scinde.
            'plate_number' => PlateNumber::normalize($plate),
            'customer_id'  => $customerId,
            'brand'        => $validator->string('brand'),
            'model'        => $validator->string('model'),
            'color'        => $validator->stringOrNull('color'),
            'vehicle_type' => $validator->string('vehicle_type'),
            'notes'        => $validator->stringOrNull('notes'),
        ]);

        AuditLogger::record(
            action: 'vehicle.created',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            entityType: 'vehicle',
            entityId: $id,
            metadata: ['plate' => PlateNumber::normalize($plate)],
        );

        Response::success(
            $this->present($repository->findWithOwner($id) ?? []),
            'Véhicule enregistré.',
            201
        );
    }

    /** PUT /api/vehicles/{id} */
    public function update(Request $request, string $id): void
    {
        $vehicleId  = (int) $id;
        $repository = new VehicleRepository();

        if ($repository->find($vehicleId) === null) {
            Response::notFound("Ce véhicule n'existe pas.");
        }

        $validator = $this->validate($request);
        $plate     = $validator->string('plate_number');

        if ($repository->plateIsTaken($plate, $vehicleId)) {
            Response::validationFailed([
                'plate_number' => 'Un autre véhicule porte déjà cette plaque.',
            ]);
        }

        $customerId = (int) $validator->string('customer_id');

        if ((new CustomerRepository())->find($customerId) === null) {
            Response::validationFailed(['customer_id' => "Ce client n'existe pas."]);
        }

        $repository->update($vehicleId, [
            'plate_number' => PlateNumber::normalize($plate),
            'customer_id'  => $customerId,
            'brand'        => $validator->string('brand'),
            'model'        => $validator->string('model'),
            'color'        => $validator->stringOrNull('color'),
            'vehicle_type' => $validator->string('vehicle_type'),
            'notes'        => $validator->stringOrNull('notes'),
        ]);

        AuditLogger::record(
            action: 'vehicle.updated',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            entityType: 'vehicle',
            entityId: $vehicleId,
        );

        Response::success(
            $this->present($repository->findWithOwner($vehicleId) ?? []),
            'Véhicule modifié.'
        );
    }

    // ------------------------------------------------------------------

    private function validate(Request $request): Validator
    {
        $validator = Validator::make($request->body())
            ->required('plate_number', 'La plaque')->maxLength('plate_number', 20)
            ->required('customer_id', 'Le propriétaire')
            ->required('brand', 'La marque')->maxLength('brand', 60)
            ->required('model', 'Le modèle')->maxLength('model', 60)
            ->maxLength('color', 40)
            ->maxLength('notes', 1000)
            ->required('vehicle_type', 'Le type')
            ->in('vehicle_type', ['CAR', 'SUV', 'PICKUP', 'VAN', 'MOTORCYCLE', 'TRUCK', 'OTHER']);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        // On ne valide PAS un format national précis : un véhicule
        // immatriculé en Gambie ou au Mali peut se présenter à la
        // station, et refuser sa plaque empêcherait de le servir.
        // On vérifie seulement qu'elle est exploitable.
        if (!PlateNumber::isPlausible($validator->string('plate_number'))) {
            Response::validationFailed([
                'plate_number' => 'Cette plaque semble incomplète. Exemple : DK-1234-AA.',
            ]);
        }

        return $validator;
    }

    /**
     * @param array<string,mixed> $vehicle
     * @return array<string,mixed>
     */
    private function present(array $vehicle): array
    {
        $plate = (string) ($vehicle['plate_number'] ?? '');

        return [
            'id'           => (int) ($vehicle['id'] ?? 0),
            // La forme brute sert aux comparaisons et aux recherches,
            // la forme lisible à l'affichage. On expose les deux pour
            // que le frontend n'ait pas à refaire le découpage.
            'plate_number' => $plate,
            'plate_display' => PlateNumber::format($plate),
            'brand'        => $vehicle['brand'] ?? '',
            'model'        => $vehicle['model'] ?? '',
            'color'        => $vehicle['color'] ?? null,
            'vehicle_type' => $vehicle['vehicle_type'] ?? 'CAR',
            'notes'        => $vehicle['notes'] ?? null,
            'customer_id'  => (int) ($vehicle['customer_id'] ?? 0),
            'customer_name' => trim(
                ($vehicle['customer_first_name'] ?? '') . ' ' . ($vehicle['customer_last_name'] ?? '')
            ),
            'customer_phone'  => $vehicle['customer_phone'] ?? null,
            'operation_count' => (int) ($vehicle['operation_count'] ?? 0),
            'last_operation_at' => $vehicle['last_operation_at'] ?? null,
            'created_at'      => $vehicle['created_at'] ?? null,
        ];
    }
}
