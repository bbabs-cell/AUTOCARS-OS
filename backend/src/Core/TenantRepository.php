<?php

declare(strict_types=1);

namespace Autocare\Core;

use Autocare\Core\Security\AuthContext;
use InvalidArgumentException;
use PDO;

/**
 * Accès aux données, cloisonné par entreprise
 * ==================================================================
 * LA CLASSE LA PLUS IMPORTANTE DU PROJET POUR LA SÉCURITÉ.
 * ==================================================================
 *
 * LE PROBLÈME
 * AUTOCARE OS sert plusieurs entreprises depuis une seule base. Une
 * seule requête SQL où l'on oublie « WHERE organization_id = ? »
 * expose les clients, les véhicules et le chiffre d'affaires d'une
 * entreprise à une autre. C'est le pire incident possible pour un
 * SaaS : il tue le produit et la confiance en une journée.
 *
 * LA MAUVAISE SOLUTION
 * « Il faut penser à filtrer. » Sur vingt modules et des centaines de
 * requêtes écrites sur plusieurs mois, quelqu'un oubliera. Ce n'est
 * pas une question de sérieux, c'est une question de statistique.
 *
 * LA SOLUTION RETENUE
 * Rendre l'oubli IMPOSSIBLE. Aucun contrôleur n'écrit de SQL
 * librement : tout passe par cette classe, qui ajoute le filtre
 * elle-même, à chaque lecture comme à chaque écriture. On ne peut pas
 * oublier un paramètre qu'on n'a pas la possibilité d'écrire.
 *
 * Un dépôt concret se réduit alors à ceci :
 *
 *     final class VehicleRepository extends TenantRepository
 *     {
 *         protected function table(): string { return 'vehicles'; }
 *     }
 *
 * Et son usage est automatiquement cloisonné :
 *
 *     $vehicles = (new VehicleRepository())->all(['status' => 'ACTIVE']);
 *
 * ------------------------------------------------------------------
 * SI UNE REQUÊTE COMPLEXE EST VRAIMENT NÉCESSAIRE
 * Utiliser la méthode `select()` : elle exige la clause WHERE mais
 * ajoute le filtre d'organisation d'office. Le SQL brut via PDO reste
 * possible, mais il devient alors visible dans la revue de code —
 * c'est exactement l'effet recherché.
 */
abstract class TenantRepository
{
    protected PDO $db;

    public function __construct()
    {
        $this->db = Database::connection();
    }

    /** Nom de la table gérée par ce dépôt. */
    abstract protected function table(): string;

    /**
     * Cette table utilise-t-elle la suppression logique ?
     * Si oui, les lignes supprimées sont exclues automatiquement.
     */
    protected function usesSoftDeletes(): bool
    {
        return false;
    }

    // ==================================================================
    // LECTURE
    // ==================================================================

    /**
     * Une ligne par son identifiant, dans l'organisation courante.
     *
     * Retourne null si la ligne appartient à une AUTRE entreprise —
     * exactement comme si elle n'existait pas. C'est volontaire :
     * répondre « accès interdit » confirmerait son existence et
     * permettrait de deviner le volume d'activité d'un concurrent.
     *
     * @return array<string,mixed>|null
     */
    public function find(int $id): ?array
    {
        $sql = "SELECT * FROM {$this->table()}
                 WHERE id = :id
                   AND organization_id = :organization_id"
            . $this->softDeleteClause();

        $statement = $this->db->prepare($sql);
        $statement->execute([
            'id'              => $id,
            'organization_id' => $this->organizationId(),
        ]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /**
     * Toutes les lignes correspondant à des conditions simples.
     *
     * @param array<string,mixed> $conditions ['status' => 'ACTIVE']
     * @return list<array<string,mixed>>
     */
    public function all(
        array $conditions = [],
        string $orderBy = 'id DESC',
        int $limit = 100,
        int $offset = 0,
    ): array {
        [$where, $parameters] = $this->buildConditions($conditions);

        $sql = "SELECT * FROM {$this->table()}
                 WHERE organization_id = :organization_id"
            . $where
            . $this->softDeleteClause()
            . ' ORDER BY ' . $this->safeOrderBy($orderBy)
            . ' LIMIT :limit OFFSET :offset';

        $statement = $this->db->prepare($sql);

        foreach ($parameters as $name => $value) {
            $statement->bindValue($name, $value);
        }

        $statement->bindValue('organization_id', $this->organizationId(), PDO::PARAM_INT);

        // LIMIT et OFFSET doivent être liés en entiers : en mode
        // « requêtes préparées réelles », MySQL refuse une chaîne à
        // cet endroit.
        $statement->bindValue('limit', max(1, min($limit, 500)), PDO::PARAM_INT);
        $statement->bindValue('offset', max(0, $offset), PDO::PARAM_INT);

        $statement->execute();

        return $statement->fetchAll();
    }

    /** @param array<string,mixed> $conditions */
    public function count(array $conditions = []): int
    {
        [$where, $parameters] = $this->buildConditions($conditions);

        $sql = "SELECT COUNT(*) FROM {$this->table()}
                 WHERE organization_id = :organization_id"
            . $where
            . $this->softDeleteClause();

        $statement = $this->db->prepare($sql);
        $statement->execute($parameters + ['organization_id' => $this->organizationId()]);

        return (int) $statement->fetchColumn();
    }

    /**
     * Requête personnalisée, filtre d'organisation ajouté d'office.
     *
     * @param string $whereAndBeyond Ce qui suit le filtre obligatoire,
     *                               ex : "AND status = :status ORDER BY id"
     * @param array<string,mixed> $parameters
     * @return list<array<string,mixed>>
     */
    protected function select(string $columns, string $whereAndBeyond, array $parameters = []): array
    {
        $sql = "SELECT {$columns} FROM {$this->table()}
                 WHERE organization_id = :organization_id {$whereAndBeyond}";

        $statement = $this->db->prepare($sql);
        $statement->execute($parameters + ['organization_id' => $this->organizationId()]);

        return $statement->fetchAll();
    }

    // ==================================================================
    // ÉCRITURE
    // ==================================================================

    /**
     * Insère une ligne. organization_id est ajouté automatiquement et
     * ne peut PAS être fourni par l'appelant : sinon un contrôleur
     * boguée — ou un attaquant passant par lui — pourrait écrire dans
     * les données d'une autre entreprise.
     *
     * @param array<string,mixed> $data
     * @return int L'identifiant créé
     */
    public function create(array $data): int
    {
        unset($data['organization_id'], $data['id']);

        $data['organization_id'] = $this->organizationId();

        $columns = array_keys($data);

        foreach ($columns as $column) {
            $this->assertSafeColumn($column);
        }

        $placeholders = array_map(static fn (string $c): string => ':' . $c, $columns);

        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            $this->table(),
            implode(', ', $columns),
            implode(', ', $placeholders),
        );

        $this->db->prepare($sql)->execute($data);

        return (int) $this->db->lastInsertId();
    }

    /**
     * Modifie une ligne. Le filtre d'organisation est dans le WHERE :
     * tenter de modifier la ligne d'une autre entreprise ne touche
     * simplement aucune ligne.
     *
     * @param array<string,mixed> $data
     * @return bool true si une ligne a effectivement été modifiée
     */
    public function update(int $id, array $data): bool
    {
        unset($data['organization_id'], $data['id']);

        if ($data === []) {
            return false;
        }

        $assignments = [];

        foreach (array_keys($data) as $column) {
            $this->assertSafeColumn($column);
            $assignments[] = "{$column} = :{$column}";
        }

        $sql = sprintf(
            'UPDATE %s SET %s WHERE id = :__id AND organization_id = :__organization_id',
            $this->table(),
            implode(', ', $assignments),
        );

        $statement = $this->db->prepare($sql);
        $statement->execute($data + [
            '__id'              => $id,
            '__organization_id' => $this->organizationId(),
        ]);

        return $statement->rowCount() > 0;
    }

    /**
     * Suppression logique : la ligne reste en base avec une date de
     * suppression. On ne détruit jamais une donnée qui porte un
     * historique.
     */
    public function softDelete(int $id): bool
    {
        return $this->update($id, ['deleted_at' => date('Y-m-d H:i:s')]);
    }

    // ==================================================================
    // INTERNE
    // ==================================================================

    protected function organizationId(): int
    {
        return AuthContext::current()->organizationId;
    }

    private function softDeleteClause(): string
    {
        return $this->usesSoftDeletes() ? ' AND deleted_at IS NULL' : '';
    }

    /**
     * Construit « AND colonne = :colonne » pour chaque condition.
     *
     * @param array<string,mixed> $conditions
     * @return array{0:string, 1:array<string,mixed>}
     */
    private function buildConditions(array $conditions): array
    {
        $sql        = '';
        $parameters = [];

        foreach ($conditions as $column => $value) {
            $this->assertSafeColumn($column);

            $sql .= " AND {$column} = :{$column}";
            $parameters[$column] = $value;
        }

        return [$sql, $parameters];
    }

    /**
     * Un nom de colonne ne peut pas être passé en paramètre préparé :
     * il fait partie de la structure de la requête, pas des données.
     * On le vérifie donc explicitement.
     *
     * Ces noms viennent normalement du code et non de l'utilisateur.
     * Mais « normalement » n'est pas une garantie : si un jour un
     * contrôleur transmet un nom de colonne reçu du client, cette
     * vérification empêche l'injection.
     */
    private function assertSafeColumn(string $column): void
    {
        if (preg_match('/^[a-z][a-z0-9_]{0,62}$/', $column) !== 1) {
            throw new InvalidArgumentException("Nom de colonne invalide : {$column}");
        }
    }

    /** Même principe pour le tri. */
    private function safeOrderBy(string $orderBy): string
    {
        if (preg_match('/^[a-z][a-z0-9_]{0,62}( (ASC|DESC))?$/i', $orderBy) !== 1) {
            throw new InvalidArgumentException("Clause de tri invalide : {$orderBy}");
        }

        return $orderBy;
    }
}
