<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\Database;
use Autocare\Core\Security\AuthContext;
use PDO;

/**
 * L'équipe de l'entreprise
 * ------------------------------------------------------------------
 * Un membre d'équipe n'est pas une entité à part : c'est un `user`
 * rattaché à une ou plusieurs stations via `station_users`, qui porte
 * son rôle.
 *
 * Ce dépôt n'hérite pas de TenantRepository parce qu'il travaille sur
 * DEUX tables jointes. Le filtre d'organisation est donc écrit
 * explicitement dans chaque requête — et il est vérifié par les tests
 * de sécurité, comme le reste.
 */
final class TeamRepository
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::connection();
    }

    /**
     * Les membres de l'équipe, avec leur rôle et leur station.
     *
     * @return list<array<string,mixed>>
     */
    public function members(): array
    {
        // UNE LIGNE PAR PERSONNE, PAS PAR RATTACHEMENT.
        //
        // `station_users` porte une ligne par station : un
        // administrateur rattaché à deux stations apparaissait deux
        // fois dans la liste de l'équipe. Le défaut est resté invisible
        // tant que personne n'avait plus d'une station.
        //
        // On regroupe donc par utilisateur et on agrège ses stations.
        //
        // ------------------------------------------------------------
        // LE PIÈGE DE MIN() SUR UN ENUM
        //
        // On voudrait « le rôle le plus élevé ». Écrire MIN(su.role)
        // serait tentant, mais MySQL et MariaDB ne comparent pas les
        // ENUM de la même façon selon les versions — tantôt par
        // l'ordre de déclaration, tantôt alphabétiquement. Or
        // alphabétiquement, ADMIN < EMPLOYEE < MANAGER : on obtiendrait
        // un résultat juste par accident, et faux le jour d'un
        // changement de moteur.
        //
        // FIELD() rend l'ordre EXPLICITE : 1 pour ADMIN, 2 pour
        // MANAGER, 3 pour EMPLOYEE. Le minimum est donc le rôle le
        // plus élevé, sur les deux moteurs, sans ambiguïté.
        $statement = $this->db->prepare(
            "SELECT u.id,
                    u.first_name,
                    u.last_name,
                    u.email,
                    u.phone,
                    u.status,
                    u.last_login_at,
                    MIN(FIELD(su.role, 'ADMIN', 'MANAGER', 'EMPLOYEE')) AS role_rank,
                    MIN(su.station_id) AS station_id,
                    GROUP_CONCAT(DISTINCT su.station_id ORDER BY su.station_id) AS station_ids,
                    GROUP_CONCAT(DISTINCT s.name ORDER BY s.name SEPARATOR ', ') AS station_names,
                    COUNT(DISTINCT su.station_id) AS station_count
               FROM users u
               JOIN station_users su ON su.user_id = u.id
               JOIN stations s       ON s.id = su.station_id
              WHERE u.organization_id = :organization_id
                AND u.deleted_at IS NULL
           GROUP BY u.id, u.first_name, u.last_name, u.email, u.phone,
                    u.status, u.last_login_at
              ORDER BY role_rank, u.last_name"
        );

        $statement->execute(['organization_id' => AuthContext::current()->organizationId]);

        $roles = [1 => 'ADMIN', 2 => 'MANAGER', 3 => 'EMPLOYEE'];

        return array_map(
            static function (array $row) use ($roles): array {
                $row['role'] = $roles[(int) $row['role_rank']] ?? 'EMPLOYEE';
                // Le nom de la première station, pour les écrans qui
                // n'en attendent qu'une ; `station_names` porte la
                // liste complète.
                $row['station_name'] = explode(', ', (string) $row['station_names'])[0] ?? '';

                // La liste des identifiants, pour l'écran de
                // rattachement. GROUP_CONCAT rend une chaîne
                // « 3,7,12 » : on la retransforme en entiers ici
                // plutôt que dans le contrôleur, pour que tous les
                // appelants reçoivent la même chose.
                $row['station_ids'] = array_map(
                    static fn (string $id): int => (int) $id,
                    array_filter(explode(',', (string) $row['station_ids'])),
                );

                return $row;
            },
            $statement->fetchAll(),
        );
    }

    /**
     * Un membre précis, dans l'organisation courante.
     *
     * Retourne null pour quelqu'un d'une autre entreprise — comme
     * s'il n'existait pas. Sert à vérifier qu'un dossier n'est pas
     * confié à l'employé d'un concurrent.
     *
     * @return array<string,mixed>|null
     */
    public function findMember(int $userId): ?array
    {
        $statement = $this->db->prepare(
            "SELECT u.id, u.first_name, u.last_name, u.email, u.status, su.role, su.station_id
               FROM users u
               JOIN station_users su ON su.user_id = u.id
              WHERE u.id = :id
                AND u.organization_id = :organization_id
                AND u.deleted_at IS NULL
              LIMIT 1"
        );

        $statement->execute([
            'id'              => $userId,
            'organization_id' => AuthContext::current()->organizationId,
        ]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /**
     * L'activité d'un membre : ce qu'il a réellement fait.
     *
     * POURQUOI COMPTER LES OPÉRATIONS PLUTÔT QUE LES HEURES ?
     * Parce que les deux répondent à des questions différentes. Le
     * pointage dit combien de temps quelqu'un était là ; ceci dit ce
     * qui est sorti de ses mains. Un employé présent douze jours qui
     * a lavé quatre voitures, ce n'est pas la même conversation qu'un
     * employé présent douze jours qui en a lavé soixante.
     *
     * On ne compte QUE les dossiers non annulés : un dossier annulé
     * n'a pas produit de travail.
     *
     * @return array<int, array{operations:int, revenue:int}> Indexé par user_id
     */
    public function activitySince(string $from): array
    {
        $statement = $this->db->prepare(
            "SELECT o.assigned_user_id AS user_id,
                    COUNT(*) AS operations,
                    COALESCE(SUM(o.price), 0) AS revenue
               FROM operations o
              WHERE o.organization_id = :organization_id
                AND o.assigned_user_id IS NOT NULL
                AND o.status != 'CANCELLED'
                AND o.created_at >= :from
           GROUP BY o.assigned_user_id"
        );

        $statement->execute([
            'organization_id' => AuthContext::current()->organizationId,
            'from' => $from . ' 00:00:00',
        ]);

        $activity = [];

        foreach ($statement->fetchAll() as $row) {
            $activity[(int) $row['user_id']] = [
                'operations' => (int) $row['operations'],
                'revenue'    => (int) $row['revenue'],
            ];
        }

        return $activity;
    }

    /**
     * Change le rôle d'un membre.
     *
     * LE RÔLE VAUT POUR TOUTE L'ENTREPRISE, pas station par station.
     * Techniquement il est stocké dans `station_users`, donc une même
     * personne pourrait être responsable ici et employée ailleurs —
     * mais rien dans le produit ne permet de le faire, et la mise à
     * jour porte volontairement sur TOUTES ses lignes.
     *
     * C'est une simplification assumée : personne n'a demandé des
     * rôles par station, et une permission qui change selon l'endroit
     * où l'on se trouve est très difficile à expliquer à un
     * utilisateur.
     *
     * LA QUESTION S'EST REPOSÉE AU LOT 17, et la réponse n'a pas
     * changé. Une personne peut désormais être rattachée à trois
     * stations ; elle y porte le MÊME rôle. « Manager à Dakar,
     * employé à Thiès » est possible dans la table depuis le lot 4 et
     * reste impossible dans le produit : il faudrait afficher un rôle
     * différent selon l'écran consulté, et personne ne saurait
     * répondre à la question « ai-je le droit de faire ceci ? ».
     */
    public function updateRole(int $userId, string $role): bool
    {
        $statement = $this->db->prepare(
            'UPDATE station_users
                SET role = :role
              WHERE user_id = :user_id
                AND organization_id = :organization_id'
        );

        $statement->execute([
            'role'    => $role,
            'user_id' => $userId,
            'organization_id' => AuthContext::current()->organizationId,
        ]);

        return $statement->rowCount() > 0;
    }

    /**
     * Active ou désactive un compte.
     *
     * ON NE SUPPRIME PAS UN EMPLOYÉ QUI PART. Son nom figure sur des
     * inspections, des encaissements et des restitutions : effacer la
     * ligne casserait cet historique, qui est précisément ce qui sert
     * en cas de litige. On coupe l'accès, on garde la trace.
     */
    public function setStatus(int $userId, string $status): bool
    {
        $statement = $this->db->prepare(
            'UPDATE users
                SET status = :status
              WHERE id = :user_id
                AND organization_id = :organization_id
                AND deleted_at IS NULL'
        );

        $statement->execute([
            'status'  => $status,
            'user_id' => $userId,
            'organization_id' => AuthContext::current()->organizationId,
        ]);

        return $statement->rowCount() > 0;
    }

    /**
     * Combien de comptes ADMIN actifs reste-t-il ?
     *
     * Sert à empêcher de désactiver le dernier administrateur — une
     * entreprise sans personne pouvant gérer les comptes est une
     * entreprise enfermée dehors.
     */
    public function activeAdminCount(): int
    {
        $statement = $this->db->prepare(
            "SELECT COUNT(DISTINCT u.id)
               FROM users u
               JOIN station_users su ON su.user_id = u.id
              WHERE u.organization_id = :organization_id
                AND u.deleted_at IS NULL
                AND u.status = 'ACTIVE'
                AND su.role = 'ADMIN'"
        );

        $statement->execute(['organization_id' => AuthContext::current()->organizationId]);

        return (int) $statement->fetchColumn();
    }

    public function count(): int
    {
        $statement = $this->db->prepare(
            'SELECT COUNT(*) FROM users
              WHERE organization_id = :organization_id
                AND deleted_at IS NULL'
        );

        $statement->execute(['organization_id' => AuthContext::current()->organizationId]);

        return (int) $statement->fetchColumn();
    }

    /**
     * Les stations où cette personne est rattachée.
     *
     * @return list<int>
     */
    public function stationIdsFor(int $userId): array
    {
        $statement = $this->db->prepare(
            'SELECT station_id
               FROM station_users
              WHERE user_id = :user_id
                AND organization_id = :organization_id
              ORDER BY station_id'
        );

        $statement->execute([
            'user_id'         => $userId,
            'organization_id' => AuthContext::current()->organizationId,
        ]);

        return array_map(
            static fn (mixed $id): int => (int) $id,
            $statement->fetchAll(PDO::FETCH_COLUMN),
        );
    }

    /**
     * Fixe la liste des stations d'une personne.
     *
     * ON N'ÉCRASE PAS TOUT POUR TOUT RÉÉCRIRE.
     *
     * La méthode évidente serait « DELETE puis INSERT ». Elle donne
     * le bon résultat final, mais elle détruit et recrée les lignes
     * de rattachement qui n'ont pas bougé : leur `created_at` — la
     * date à laquelle quelqu'un a rejoint une station — serait remis
     * à aujourd'hui à chaque enregistrement du formulaire, même sans
     * modification. On ne touche donc qu'à la différence.
     *
     * Le rôle est celui que la personne porte déjà : ce sont les
     * stations qui changent ici, pas les droits. Deux formulaires,
     * deux décisions.
     *
     * @param list<int> $stationIds
     */
    public function setStations(int $userId, array $stationIds, string $role): void
    {
        $organizationId = AuthContext::current()->organizationId;
        $current        = $this->stationIdsFor($userId);

        $toAdd    = array_diff($stationIds, $current);
        $toRemove = array_diff($current, $stationIds);

        if ($toAdd === [] && $toRemove === []) {
            return;
        }

        $this->db->beginTransaction();

        try {
            $insert = $this->db->prepare(
                'INSERT INTO station_users (organization_id, station_id, user_id, role)
                 VALUES (:organization_id, :station_id, :user_id, :role)'
            );

            foreach ($toAdd as $stationId) {
                $insert->execute([
                    'organization_id' => $organizationId,
                    'station_id'      => $stationId,
                    'user_id'         => $userId,
                    'role'            => $role,
                ]);
            }

            $delete = $this->db->prepare(
                'DELETE FROM station_users
                  WHERE user_id = :user_id
                    AND station_id = :station_id
                    AND organization_id = :organization_id'
            );

            foreach ($toRemove as $stationId) {
                $delete->execute([
                    'user_id'         => $userId,
                    'station_id'      => $stationId,
                    'organization_id' => $organizationId,
                ]);
            }

            $this->db->commit();
        } catch (\Throwable $exception) {
            $this->db->rollBack();

            throw $exception;
        }
    }

    /**
     * Crée un membre d'équipe et le rattache à une station.
     *
     * Les deux insertions forment un tout : un utilisateur sans
     * rattachement n'aurait aucun rôle, donc aucun droit — il
     * pourrait se connecter sans rien pouvoir faire, ce qui est pire
     * que de ne pas exister.
     *
     * @param array{first_name:string, last_name:string, email:string,
     *              phone:?string, role:string, station_id:int, password:string} $data
     */
    public function create(array $data): int
    {
        $organizationId = AuthContext::current()->organizationId;

        $this->db->beginTransaction();

        try {
            $this->db->prepare(
                'INSERT INTO users
                    (organization_id, first_name, last_name, email, phone, password_hash)
                 VALUES
                    (:organization_id, :first_name, :last_name, :email, :phone, :password_hash)'
            )->execute([
                'organization_id' => $organizationId,
                'first_name'      => $data['first_name'],
                'last_name'       => $data['last_name'],
                'email'           => mb_strtolower($data['email']),
                'phone'           => $data['phone'],
                'password_hash'   => password_hash($data['password'], PASSWORD_DEFAULT),
            ]);

            $userId = (int) $this->db->lastInsertId();

            $this->db->prepare(
                'INSERT INTO station_users (organization_id, station_id, user_id, role)
                 VALUES (:organization_id, :station_id, :user_id, :role)'
            )->execute([
                'organization_id' => $organizationId,
                'station_id'      => $data['station_id'],
                'user_id'         => $userId,
                'role'            => $data['role'],
            ]);

            $this->db->commit();

            return $userId;
        } catch (\Throwable $exception) {
            $this->db->rollBack();

            throw $exception;
        }
    }
}
