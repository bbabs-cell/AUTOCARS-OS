<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\OrganizationRepository;
use Autocare\Models\StationRepository;
use Autocare\Models\TeamRepository;

/**
 * Les paramètres de l'entreprise
 * ==================================================================
 * TROIS CHAMPS MODIFIABLES, ET TROIS QU'ON REFUSE DE RENDRE
 * MODIFIABLES. Les seconds demandent plus d'explications que les
 * premiers.
 * ==================================================================
 *
 * MODIFIABLE : la raison sociale, le téléphone, l'e-mail.
 * Ce sont des coordonnées. Elles changent, elles n'engagent aucune
 * donnée déjà écrite, et personne n'est surpris de pouvoir les
 * corriger.
 *
 * ------------------------------------------------------------------
 * LA DEVISE NE SE CHANGE PAS DEPUIS UN ÉCRAN
 *
 * C'est le refus le plus important de ce lot.
 *
 * Tous les montants du produit sont des ENTIERS dans la plus petite
 * unité de la devise (lot 3). En franc CFA, cette unité est le franc
 * lui-même : 5000 se lit « 5 000 F ». Passer la devise à l'euro ne
 * convertirait rien du tout — les 5000 déjà en base deviendraient
 * « 50,00 € ». Le chiffre d'affaires de la station serait divisé par
 * cent, en silence, d'un seul clic dans un formulaire.
 *
 * Changer de devise est une MIGRATION DE DONNÉES, pas un réglage.
 * Elle demande de convertir chaque montant, chaque prix du
 * catalogue, chaque forfait vendu et chaque écriture de caisse — et
 * de décider à quel taux. Tant que ce travail n'est pas fait, le
 * champ est affiché et verrouillé, avec sa raison.
 *
 * ------------------------------------------------------------------
 * LE FUSEAU ET LE PAYS NON PLUS, MAIS POUR UNE AUTRE RAISON
 *
 * Le serveur calcule « aujourd'hui » en UTC — ce qui est EXACT pour
 * le Sénégal, la Gambie, la Guinée et le Mali, qui sont à UTC+0 toute
 * l'année (voir DashboardRepository). La colonne `timezone` existe
 * pour le jour d'une station au Cameroun, mais aucun calcul ne la lit
 * encore.
 *
 * Un champ modifiable qui ne change rien est pire qu'un champ absent :
 * le gérant croit avoir réglé son fuseau, et la recette continue de
 * basculer à minuit UTC. On l'affiche donc en lecture seule, et il
 * deviendra modifiable le jour où les requêtes le liront.
 */
final class OrganizationController
{
    /** GET /api/organization */
    public function show(Request $request): void
    {
        $organization = (new OrganizationRepository())->current();

        if ($organization === null) {
            // Ne devrait jamais arriver : l'utilisateur est
            // authentifié, donc son entreprise existe. On répond
            // proprement plutôt que de laisser une erreur PHP.
            Response::notFound("Cette entreprise n'existe pas.");
        }

        Response::success($this->present($organization));
    }

    /** PUT /api/organization */
    public function update(Request $request): void
    {
        $repository = new OrganizationRepository();

        if ($repository->current() === null) {
            Response::notFound("Cette entreprise n'existe pas.");
        }

        $validator = Validator::make($request->body())
            ->required('name', 'La raison sociale')->maxLength('name', 150)
            ->email('email')->maxLength('email', 190)
            ->phone('phone');

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $repository->updateCurrent([
            'name'  => $validator->string('name'),
            'phone' => $validator->stringOrNull('phone'),
            'email' => $validator->stringOrNull('email'),
        ]);

        AuditLogger::record(
            action: 'organization.updated',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            entityType: 'organization',
            entityId: AuthContext::current()->organizationId,
        );

        Response::success(
            $this->present($repository->current() ?? []),
            'Paramètres enregistrés.'
        );
    }

    // ------------------------------------------------------------------

    /**
     * @param array<string,mixed> $organization
     * @return array<string,mixed>
     */
    private function present(array $organization): array
    {
        return [
            'id'    => (int) ($organization['id'] ?? 0),
            'name'  => $organization['name'] ?? '',
            // Le slug apparaît dans les URL et les références : le
            // modifier casserait des liens déjà envoyés. On le montre,
            // on ne le reprend pas.
            'slug'  => $organization['slug'] ?? '',
            'phone' => $organization['phone'] ?? null,
            'email' => $organization['email'] ?? null,

            // Les trois valeurs verrouillées. Elles sont envoyées
            // pour être AFFICHÉES et expliquées, pas pour être
            // reprises dans un formulaire — voir la note de tête.
            'country_code'  => $organization['country_code'] ?? 'SN',
            'currency_code' => $organization['currency_code'] ?? 'XOF',
            'timezone'      => $organization['timezone'] ?? 'Africa/Dakar',

            'created_at' => $organization['created_at'] ?? null,
            'onboarding_completed_at' => $organization['onboarding_completed_at'] ?? null,

            // Deux chiffres qui donnent la taille de l'entreprise.
            // Ils tiennent en deux COUNT et évitent au frontend
            // d'appeler deux autres écrans pour les afficher.
            'station_count' => (new StationRepository())->count(),
            'member_count'  => (new TeamRepository())->count(),
        ];
    }
}
