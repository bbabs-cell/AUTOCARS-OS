<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Database;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Models\ServiceRepository;
use Autocare\Models\StationRepository;
use Autocare\Models\TeamRepository;

/**
 * Installation guidée
 * ------------------------------------------------------------------
 * Après l'inscription, le gérant arrive sur une station vide. Cette
 * étape l'amène à la remplir : informations réelles, prestations,
 * équipe, horaires.
 *
 * POURQUOI FORCER CE PASSAGE ?
 * Parce qu'un produit qu'on ne peut pas utiliser tout de suite est un
 * produit qu'on n'utilise jamais. Sans prestations configurées, on ne
 * peut pas créer une opération — donc rien ne fonctionne. L'installation
 * guidée transforme un blocage en parcours.
 *
 * ELLE N'EST PAS BLOQUANTE POUR AUTANT : l'API n'interdit rien tant
 * qu'elle n'est pas terminée. C'est l'interface qui guide, et le
 * gérant peut la finir plus tard.
 */
final class OnboardingController
{
    /**
     * GET /api/onboarding/status
     *
     * Où en est l'installation ? Le frontend s'en sert pour savoir
     * quelle étape afficher et si l'installation doit être proposée.
     */
    public function status(Request $request): void
    {
        $organizationId = AuthContext::current()->organizationId;

        $statement = Database::connection()->prepare(
            'SELECT name, onboarding_completed_at FROM organizations WHERE id = :id'
        );
        $statement->execute(['id' => $organizationId]);

        $organization = $statement->fetch();

        $stations = (new StationRepository())->all([], 'id ASC', 10);
        $services = new ServiceRepository();

        Response::success([
            'completed'         => ($organization['onboarding_completed_at'] ?? null) !== null,
            'organization_name' => $organization['name'] ?? '',

            // La première station, celle créée à l'inscription. C'est
            // elle que l'installation complète.
            'station'           => $stations[0] ?? null,

            // Ces compteurs permettent à l'interface de reprendre là
            // où le gérant s'était arrêté, plutôt que de recommencer.
            'services_count'    => $services->count(),
            'team_count'        => (new TeamRepository())->count(),
        ]);
    }

    /**
     * POST /api/onboarding/complete
     *
     * Marque l'installation terminée. On vérifie qu'au moins une
     * prestation existe : sans catalogue, le gérant arriverait sur un
     * tableau de bord d'où il ne pourrait rien faire.
     */
    public function complete(Request $request): void
    {
        $organizationId = AuthContext::current()->organizationId;

        if ((new ServiceRepository())->count() === 0) {
            Response::error(
                'Ajoutez au moins une prestation avant de terminer : sans catalogue, '
                . 'vous ne pourrez pas enregistrer de véhicule.',
                ['services' => 'Au moins une prestation est nécessaire.'],
                422
            );
        }

        Database::connection()
            ->prepare('UPDATE organizations SET onboarding_completed_at = NOW() WHERE id = :id')
            ->execute(['id' => $organizationId]);

        AuditLogger::record(
            action: 'onboarding.completed',
            organizationId: $organizationId,
            userId: AuthContext::current()->userId,
        );

        Response::success(null, 'Votre station est prête.');
    }
}
