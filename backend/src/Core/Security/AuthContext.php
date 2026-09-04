<?php

declare(strict_types=1);

namespace Autocare\Core\Security;

use RuntimeException;

/**
 * L'utilisateur de la requête en cours
 * ------------------------------------------------------------------
 * Rempli une seule fois par AuthMiddleware, au tout début du
 * traitement, puis lu partout ailleurs.
 *
 * POURQUOI UN ACCÈS STATIQUE ?
 * Parce que la couche d'accès aux données (TenantRepository) doit
 * connaître l'organisation courante SANS qu'on ait à la lui passer.
 * C'est précisément ce qui rend le filtre d'isolation impossible à
 * oublier : un développeur ne peut pas « omettre » un paramètre qui
 * n'existe pas.
 *
 * Le contexte vit le temps d'une requête HTTP. En PHP, chaque requête
 * démarre dans un processus neuf : il n'y a donc aucun risque qu'un
 * utilisateur hérite du contexte d'un autre.
 */
final class AuthContext
{
    private static ?self $current = null;

    /**
     * @param string $role Rôle le plus élevé de l'utilisateur dans
     *                     l'organisation (ADMIN > MANAGER > EMPLOYEE)
     * @param list<int> $stationIds Stations auxquelles il est rattaché
     */
    private function __construct(
        public readonly int $userId,
        public readonly int $organizationId,
        public readonly string $email,
        public readonly string $fullName,
        public readonly string $role,
        public readonly array $stationIds,
    ) {
    }

    /**
     * Cache des stations de l'entreprise, rempli à la demande.
     *
     * Le seul champ mutable de cette classe, et il ne porte qu'un
     * résultat de lecture — jamais une décision. Le rendre `readonly`
     * aurait obligé à charger la liste à chaque authentification, y
     * compris pour les requêtes qui ne filtrent aucune station.
     *
     * @var list<int>|null
     */
    private ?array $organizationStationIds = null;

    /**
     * @param list<int> $stationIds
     */
    public static function set(
        int $userId,
        int $organizationId,
        string $email,
        string $fullName,
        string $role,
        array $stationIds,
    ): void {
        self::$current = new self($userId, $organizationId, $email, $fullName, $role, $stationIds);
    }

    /**
     * L'utilisateur courant.
     *
     * Lève une exception s'il n'y en a pas : c'est volontaire. Si du
     * code appelle cette méthode sur une route publique, c'est un bug
     * de conception — mieux vaut une erreur bruyante qu'une requête
     * silencieusement exécutée sans filtre d'organisation.
     */
    public static function current(): self
    {
        if (self::$current === null) {
            throw new RuntimeException(
                'Aucun utilisateur authentifié dans le contexte. '
                . 'Cette route devrait être protégée par AuthMiddleware.'
            );
        }

        return self::$current;
    }

    public static function isAuthenticated(): bool
    {
        return self::$current !== null;
    }

    /** Utilisé au logout et par les tests. */
    public static function clear(): void
    {
        self::$current = null;
    }

    public function can(string $action): bool
    {
        return Permissions::allows($this->role, $action);
    }

    /**
     * L'utilisateur a-t-il accès à cette station ?
     *
     * Un administrateur voit toutes les stations DE SON ENTREPRISE,
     * même celles où il n'est pas explicitement rattaché : c'est le
     * propriétaire, il pilote l'ensemble du réseau.
     *
     * ==================================================================
     * « DE SON ENTREPRISE » A ÉTÉ AJOUTÉ AU LOT 16
     * ==================================================================
     * La version précédente renvoyait `true` pour TOUT administrateur,
     * sans regarder à qui appartenait la station. Un administrateur de
     * l'entreprise B qui passait l'identifiant d'une station de
     * l'entreprise A passait donc ce contrôle.
     *
     * AUCUNE DONNÉE NE FUYAIT POUR AUTANT : toutes les requêtes
     * portent `organization_id`, et le filtre d'isolation renvoyait
     * simplement zéro ligne. C'est exactement le rôle d'une défense en
     * profondeur — la première barrière a cédé, la seconde a tenu.
     *
     * Le défaut restait réel : l'API répondait « 200, rien à voir ici »
     * là où elle devait répondre « cette station n'est pas la vôtre ».
     * Un test des statistiques l'a révélé, parce que c'est le premier
     * écran à filtrer par station sans jamais écrire.
     *
     * Le coût de la correction est d'une requête par requête HTTP, et
     * seulement pour les administrateurs qui filtrent par station.
     */
    public function canAccessStation(int $stationId): bool
    {
        if ($this->role === 'ADMIN') {
            return in_array($stationId, $this->organizationStationIds(), true);
        }

        return in_array($stationId, $this->stationIds, true);
    }

    /**
     * Les stations de l'entreprise courante.
     *
     * Chargées au plus une fois par requête HTTP, et seulement si un
     * administrateur filtre effectivement par station : la plupart des
     * requêtes ne paient rien.
     *
     * La requête porte `organization_id` comme toutes les autres —
     * c'est ce qui rend la réponse fiable.
     *
     * @return list<int>
     */
    private function organizationStationIds(): array
    {
        if ($this->organizationStationIds !== null) {
            return $this->organizationStationIds;
        }

        $statement = \Autocare\Core\Database::connection()->prepare(
            'SELECT id FROM stations WHERE organization_id = :organization_id'
        );

        $statement->execute(['organization_id' => $this->organizationId]);

        $this->organizationStationIds = array_map(
            static fn (mixed $id): int => (int) $id,
            $statement->fetchAll(\PDO::FETCH_COLUMN),
        );

        return $this->organizationStationIds;
    }
}
