<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\Database;
use Autocare\Core\Security\AuthContext;
use PDO;

/**
 * L'entreprise elle-même
 * ------------------------------------------------------------------
 * LA SEULE TABLE MÉTIER QUI N'HÉRITE PAS DE TenantRepository.
 *
 * Toutes les autres portent une colonne `organization_id` qui dit
 * « j'appartiens à cette entreprise ». Celle-ci ne peut pas : elle
 * EST l'entreprise. Son identifiant s'appelle `id`, pas
 * `organization_id`, et TenantRepository ajouterait à chaque requête
 * un `WHERE organization_id = …` qui ne correspond à aucune colonne.
 *
 * Le filtre est donc écrit à la main — mais il n'est écrit qu'ICI,
 * dans deux requêtes, et il porte toujours sur l'organisation du
 * contexte d'authentification. Personne d'autre ne touche à cette
 * table : un contrôleur ne peut donc pas oublier le filtre, puisqu'il
 * n'a pas d'autre chemin.
 *
 * ------------------------------------------------------------------
 * IL N'Y A NI `all()` NI `find($id)`.
 *
 * C'est délibéré. Une méthode qui accepterait un identifiant
 * d'entreprise en paramètre serait le seul endroit du produit où
 * l'appelant choisit l'entreprise qu'il lit — exactement la forme de
 * code qui produit une fuite entre clients. Ici, l'entreprise lue est
 * toujours celle de la session, et il n'existe aucun moyen de
 * demander une autre.
 */
final class OrganizationRepository
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::connection();
    }

    /**
     * Les paramètres de l'entreprise courante.
     *
     * @return array<string,mixed>|null
     */
    public function current(): ?array
    {
        $statement = $this->db->prepare(
            'SELECT id, name, slug, phone, email,
                    country_code, currency_code, timezone,
                    status, onboarding_completed_at, created_at
               FROM organizations
              WHERE id = :organization_id
              LIMIT 1'
        );

        $statement->execute(['organization_id' => AuthContext::current()->organizationId]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /**
     * Modifie les paramètres de l'entreprise courante.
     *
     * LES COLONNES MODIFIABLES SONT ÉNUMÉRÉES ICI, pas fournies par
     * l'appelant. Un `UPDATE` construit à partir des clés reçues du
     * navigateur laisserait passer `status`, `slug` ou même `id` le
     * jour où un contrôleur oublierait de les filtrer.
     *
     * @param array<string,mixed> $data
     */
    public function updateCurrent(array $data): bool
    {
        // TROIS COLONNES DE CETTE TABLE NE SONT PAS MODIFIABLES,
        // et leur absence de cette liste est le seul endroit qui
        // l'empêche. Elles sont expliquées dans OrganizationController.
        $editable = ['name', 'phone', 'email'];
        $values   = [];

        foreach ($editable as $column) {
            if (array_key_exists($column, $data)) {
                $values[$column] = $data[$column];
            }
        }

        if ($values === []) {
            return false;
        }

        $assignments = implode(', ', array_map(
            static fn (string $column): string => "{$column} = :{$column}",
            array_keys($values),
        ));

        $statement = $this->db->prepare(
            "UPDATE organizations SET {$assignments} WHERE id = :organization_id"
        );

        $statement->execute(
            $values + ['organization_id' => AuthContext::current()->organizationId]
        );

        return $statement->rowCount() > 0;
    }
}
