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
        $statement = $this->db->prepare(
            "SELECT u.id,
                    u.first_name,
                    u.last_name,
                    u.email,
                    u.phone,
                    u.status,
                    u.last_login_at,
                    su.role,
                    su.station_id,
                    s.name AS station_name
               FROM users u
               JOIN station_users su ON su.user_id = u.id
               JOIN stations s       ON s.id = su.station_id
              WHERE u.organization_id = :organization_id
                AND u.deleted_at IS NULL
              ORDER BY FIELD(su.role, 'ADMIN', 'MANAGER', 'EMPLOYEE'), u.last_name"
        );

        $statement->execute(['organization_id' => AuthContext::current()->organizationId]);

        return $statement->fetchAll();
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
