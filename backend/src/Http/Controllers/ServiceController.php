<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\ServiceRepository;

/**
 * Le catalogue des prestations
 * ------------------------------------------------------------------
 * Premier contrôleur métier du produit. Il illustre le schéma que
 * suivront tous les suivants :
 *
 *   1. valider ce qui entre
 *   2. appeler le dépôt (qui applique le cloisonnement tout seul)
 *   3. journaliser si l'action est sensible
 *   4. répondre au format unique de l'API
 *
 * Remarque ce qui N'Y EST PAS : aucune vérification d'organisation.
 * Elle est faite par TenantRepository, en dessous. Un contrôleur qui
 * devrait y penser finirait par oublier.
 */
final class ServiceController
{
    /** GET /api/services */
    public function index(Request $request): void
    {
        $repository = new ServiceRepository();

        // Un employé n'a pas à voir les prestations désactivées :
        // elles ne sont plus proposables au comptoir.
        $onlyActive = $request->query('only_active') === '1';

        $services = $onlyActive
            ? $repository->activeServices()
            : $repository->all([], 'price ASC', 200);

        Response::success(array_map($this->present(...), $services));
    }

    /** GET /api/services/{id} */
    public function show(Request $request, string $id): void
    {
        $service = (new ServiceRepository())->find((int) $id);

        if ($service === null) {
            Response::notFound('Cette prestation n\'existe pas.');
        }

        Response::success($this->present($service));
    }

    /** POST /api/services */
    public function store(Request $request): void
    {
        $validator = $this->validate($request);
        $repository = new ServiceRepository();

        $name = $validator->string('name');

        if ($repository->nameIsTaken($name)) {
            Response::validationFailed(['name' => 'Une prestation porte déjà ce nom.']);
        }

        $id = $repository->create([
            'name'             => $name,
            'description'      => $validator->stringOrNull('description'),
            'category'         => $validator->stringOrNull('category'),
            'price'            => (int) $validator->string('price'),
            'duration_minutes' => (int) $validator->string('duration_minutes'),
        ]);

        AuditLogger::record(
            action: 'service.created',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            entityType: 'service',
            entityId: $id,
            metadata: ['name' => $name],
        );

        Response::success(
            $this->present($repository->find($id) ?? []),
            'Prestation créée.',
            201
        );
    }

    /** PUT /api/services/{id} */
    public function update(Request $request, string $id): void
    {
        $serviceId  = (int) $id;
        $repository = new ServiceRepository();

        if ($repository->find($serviceId) === null) {
            Response::notFound('Cette prestation n\'existe pas.');
        }

        $validator = $this->validate($request);
        $name      = $validator->string('name');

        if ($repository->nameIsTaken($name, $serviceId)) {
            Response::validationFailed(['name' => 'Une autre prestation porte déjà ce nom.']);
        }

        $repository->update($serviceId, [
            'name'             => $name,
            'description'      => $validator->stringOrNull('description'),
            'category'         => $validator->stringOrNull('category'),
            'price'            => (int) $validator->string('price'),
            'duration_minutes' => (int) $validator->string('duration_minutes'),
        ]);

        AuditLogger::record(
            action: 'service.updated',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            entityType: 'service',
            entityId: $serviceId,
        );

        Response::success($this->present($repository->find($serviceId) ?? []), 'Prestation modifiée.');
    }

    /**
     * PUT /api/services/{id}/status
     *
     * ON NE SUPPRIME PAS UNE PRESTATION, ON LA DÉSACTIVE.
     * Elle est référencée par toutes les opérations passées : la
     * supprimer trouerait l'historique et fausserait les statistiques.
     * Désactivée, elle disparaît du comptoir mais l'historique reste
     * lisible.
     */
    public function toggleStatus(Request $request, string $id): void
    {
        $serviceId  = (int) $id;
        $repository = new ServiceRepository();
        $service    = $repository->find($serviceId);

        if ($service === null) {
            Response::notFound('Cette prestation n\'existe pas.');
        }

        $newStatus = $service['status'] === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

        $repository->update($serviceId, ['status' => $newStatus]);

        AuditLogger::record(
            action: 'service.status_changed',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            entityType: 'service',
            entityId: $serviceId,
            metadata: ['from' => $service['status'], 'to' => $newStatus],
        );

        Response::success(
            $this->present($repository->find($serviceId) ?? []),
            $newStatus === 'ACTIVE' ? 'Prestation activée.' : 'Prestation désactivée.'
        );
    }

    // ------------------------------------------------------------------

    private function validate(Request $request): Validator
    {
        $validator = Validator::make($request->body())
            ->required('name', 'Le nom')->maxLength('name', 120)
            ->maxLength('description', 500)
            ->maxLength('category', 60)
            ->required('price', 'Le prix')
            ->required('duration_minutes', 'La durée');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        // Les montants sont des entiers en FCFA. On refuse tout ce qui
        // n'en est pas un plutôt que de laisser PHP convertir
        // silencieusement « 10 000 F » en 10.
        $price = $validator->string('price');

        if (preg_match('/^\d{1,9}$/', $price) !== 1) {
            Response::validationFailed([
                'price' => 'Le prix doit être un nombre entier, sans espace ni devise.',
            ]);
        }

        $duration = $validator->string('duration_minutes');

        if (preg_match('/^\d{1,4}$/', $duration) !== 1 || (int) $duration < 1) {
            Response::validationFailed([
                'duration_minutes' => 'La durée doit être un nombre de minutes.',
            ]);
        }

        return $validator;
    }

    /**
     * Met en forme une prestation pour l'API.
     *
     * On expose exactement ce dont le frontend a besoin, pas la ligne
     * brute : les colonnes internes ne doivent pas fuir dans le
     * contrat public de l'API, sinon on ne peut plus les changer.
     *
     * @param array<string,mixed> $service
     * @return array<string,mixed>
     */
    private function present(array $service): array
    {
        return [
            'id'               => (int) ($service['id'] ?? 0),
            'name'             => $service['name'] ?? '',
            'description'      => $service['description'] ?? null,
            'category'         => $service['category'] ?? null,
            'price'            => (int) ($service['price'] ?? 0),
            'duration_minutes' => (int) ($service['duration_minutes'] ?? 0),
            'status'           => $service['status'] ?? 'ACTIVE',
        ];
    }
}
