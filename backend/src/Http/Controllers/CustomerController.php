<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\CustomerRepository;
use Autocare\Models\VehicleRepository;

/**
 * Les clients de la station
 * ------------------------------------------------------------------
 * Le CRM du produit. Sa fonction la plus utilisée n'est pas la liste
 * mais la RECHERCHE : un client se présente au comptoir, l'employé
 * doit le retrouver avant qu'il n'ait fini de sortir ses clés.
 */
final class CustomerController
{
    /**
     * GET /api/customers?search=...
     */
    public function index(Request $request): void
    {
        $customers = (new CustomerRepository())->search(
            $request->query('search') ?? '',
        );

        Response::success(array_map($this->present(...), $customers));
    }

    /**
     * GET /api/customers/{id}
     * Le client, ses compteurs et ses véhicules.
     */
    public function show(Request $request, string $id): void
    {
        $customerId = (int) $id;
        $customer   = (new CustomerRepository())->findWithCounters($customerId);

        if ($customer === null) {
            Response::notFound("Ce client n'existe pas.");
        }

        $vehicles = (new VehicleRepository())->search('', $customerId);

        Response::success([
            'customer' => $this->present($customer),
            'vehicles' => array_map(
                static fn (array $v): array => [
                    'id'           => (int) $v['id'],
                    'plate_number' => $v['plate_number'],
                    // La forme LISIBLE, que le reste du produit
                    // affiche partout : « DK-1234-AA ». Elle manquait
                    // ici depuis le lot 6, et la fiche client montrait
                    // donc une pastille vide à la place de la plaque.
                    // Le défaut ne se voyait que sur cet écran, parce
                    // que c'est le seul à construire sa liste de
                    // véhicules à la main plutôt qu'avec le présentateur.
                    'plate_display' => \Autocare\Core\PlateNumber::format((string) $v['plate_number']),
                    'brand'        => $v['brand'],
                    'model'        => $v['model'],
                    'color'        => $v['color'],
                    'vehicle_type' => $v['vehicle_type'],
                ],
                $vehicles,
            ),
        ]);
    }

    /**
     * GET /api/customers/check-phone?phone=...
     *
     * Le téléphone n'est pas unique en base — un couple partage
     * souvent un numéro, et refuser l'enregistrement au comptoir
     * serait pire que le doublon. Cette route permet à l'interface
     * d'AVERTIR pendant la saisie : « ce numéro correspond déjà à
     * Cheikh Fall », et de proposer la fiche existante.
     */
    public function checkPhone(Request $request): void
    {
        $phone = $request->query('phone') ?? '';

        if (trim($phone) === '') {
            Response::success([]);
        }

        $matches = (new CustomerRepository())->findByPhone($phone);

        Response::success(array_map(
            static fn (array $c): array => [
                'id'        => (int) $c['id'],
                'full_name' => trim($c['first_name'] . ' ' . $c['last_name']),
                'phone'     => $c['phone'],
            ],
            $matches,
        ));
    }

    /** POST /api/customers */
    public function store(Request $request): void
    {
        $validator = $this->validate($request);

        $id = (new CustomerRepository())->create([
            'first_name' => $validator->string('first_name'),
            'last_name'  => $validator->string('last_name'),
            'phone'      => $validator->string('phone'),
            'email'      => $validator->stringOrNull('email'),
            'address'    => $validator->stringOrNull('address'),
            'notes'      => $validator->stringOrNull('notes'),
        ]);

        AuditLogger::record(
            action: 'customer.created',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            entityType: 'customer',
            entityId: $id,
        );

        $customer = (new CustomerRepository())->findWithCounters($id);

        Response::success($this->present($customer ?? []), 'Client enregistré.', 201);
    }

    /** PUT /api/customers/{id} */
    public function update(Request $request, string $id): void
    {
        $customerId = (int) $id;
        $repository = new CustomerRepository();

        if ($repository->find($customerId) === null) {
            Response::notFound("Ce client n'existe pas.");
        }

        $validator = $this->validate($request);

        $repository->update($customerId, [
            'first_name' => $validator->string('first_name'),
            'last_name'  => $validator->string('last_name'),
            'phone'      => $validator->string('phone'),
            'email'      => $validator->stringOrNull('email'),
            'address'    => $validator->stringOrNull('address'),
            'notes'      => $validator->stringOrNull('notes'),
        ]);

        AuditLogger::record(
            action: 'customer.updated',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            entityType: 'customer',
            entityId: $customerId,
        );

        Response::success(
            $this->present($repository->findWithCounters($customerId) ?? []),
            'Client modifié.'
        );
    }

    // ------------------------------------------------------------------

    private function validate(Request $request): Validator
    {
        $validator = Validator::make($request->body())
            ->required('first_name', 'Le prénom')->maxLength('first_name', 80)
            ->required('last_name', 'Le nom')->maxLength('last_name', 80)
            // Le téléphone est OBLIGATOIRE : au Sénégal c'est
            // l'identifiant naturel d'une personne, bien avant
            // l'adresse e-mail. C'est par lui qu'on retrouvera ce
            // client dans six mois.
            ->required('phone', 'Le téléphone')->phone('phone')
            ->email('email')->maxLength('email', 190)
            ->maxLength('address', 255)
            ->maxLength('notes', 1000);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        return $validator;
    }

    /**
     * @param array<string,mixed> $customer
     * @return array<string,mixed>
     */
    private function present(array $customer): array
    {
        return [
            'id'            => (int) ($customer['id'] ?? 0),
            'first_name'    => $customer['first_name'] ?? '',
            'last_name'     => $customer['last_name'] ?? '',
            'full_name'     => trim(($customer['first_name'] ?? '') . ' ' . ($customer['last_name'] ?? '')),
            'phone'         => $customer['phone'] ?? '',
            'email'         => $customer['email'] ?? null,
            'address'       => $customer['address'] ?? null,
            'notes'         => $customer['notes'] ?? null,
            'status'        => $customer['status'] ?? 'ACTIVE',
            'vehicle_count' => (int) ($customer['vehicle_count'] ?? 0),
            'visit_count'   => (int) ($customer['visit_count'] ?? 0),
            'total_spent'   => (int) ($customer['total_spent'] ?? 0),
            'last_visit_at' => $customer['last_visit_at'] ?? null,
            'created_at'    => $customer['created_at'] ?? null,
        ];
    }
}
