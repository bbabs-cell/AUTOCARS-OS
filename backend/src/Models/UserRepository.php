<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\Database;
use PDO;

/**
 * Accès aux comptes utilisateurs
 * ------------------------------------------------------------------
 * ATTENTION — CETTE CLASSE N'HÉRITE PAS DE TenantRepository, ET C'EST
 * LA SEULE EXCEPTION DU PROJET.
 *
 * Pourquoi ? Parce qu'au moment de la connexion, on ne connaît pas
 * encore l'organisation de l'utilisateur : c'est justement ce qu'on
 * cherche à déterminer. Le filtre d'isolation ne peut donc pas
 * s'appliquer — il n'y a rien à filtrer.
 *
 * Cette exception est acceptable à trois conditions, toutes
 * respectées ici :
 *   1. elle est limitée à l'authentification ;
 *   2. la recherche se fait sur une adresse e-mail unique, jamais sur
 *      un critère qui permettrait de parcourir les comptes ;
 *   3. aucune donnée métier n'est retournée, seulement de quoi
 *      vérifier un mot de passe et construire le contexte.
 *
 * Toute autre lecture de données passera par TenantRepository.
 */
final class UserRepository
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::connection();
    }

    /**
     * Recherche par adresse e-mail, pour la connexion.
     *
     * @return array<string,mixed>|null
     */
    public function findByEmail(string $email): ?array
    {
        $statement = $this->db->prepare(
            'SELECT id, organization_id, first_name, last_name, email,
                    password_hash, status
               FROM users
              WHERE email = :email
                AND deleted_at IS NULL'
        );

        $statement->execute(['email' => mb_strtolower($email)]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /** @return array<string,mixed>|null */
    public function findById(int $id): ?array
    {
        $statement = $this->db->prepare(
            'SELECT id, organization_id, first_name, last_name, email, status
               FROM users
              WHERE id = :id
                AND deleted_at IS NULL'
        );

        $statement->execute(['id' => $id]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    public function emailExists(string $email): bool
    {
        $statement = $this->db->prepare('SELECT 1 FROM users WHERE email = :email');
        $statement->execute(['email' => mb_strtolower($email)]);

        return $statement->fetchColumn() !== false;
    }

    /**
     * Rôle le plus élevé de l'utilisateur et stations rattachées.
     *
     * Un utilisateur peut être manager sur une station et employé sur
     * une autre. Pour les permissions, on retient le rôle le plus
     * élevé : c'est ce qui correspond à l'attente — un manager ne perd
     * pas ses prérogatives en consultant une autre station.
     * Le contrôle station par station, lui, passe par
     * AuthContext::canAccessStation().
     *
     * @return array{role:string, station_ids:list<int>}
     */
    public function membership(int $userId): array
    {
        $statement = $this->db->prepare(
            "SELECT station_id, role
               FROM station_users
              WHERE user_id = :user_id
                AND status = 'ACTIVE'"
        );

        $statement->execute(['user_id' => $userId]);

        $stationIds = [];
        $roles      = [];

        foreach ($statement->fetchAll() as $row) {
            $stationIds[] = (int) $row['station_id'];
            $roles[]      = (string) $row['role'];
        }

        // Hiérarchie explicite plutôt qu'un tri alphabétique : ADMIN
        // vient avant EMPLOYEE dans l'alphabet, mais c'est un hasard
        // sur lequel il serait imprudent de s'appuyer.
        $hierarchy = ['ADMIN' => 3, 'MANAGER' => 2, 'EMPLOYEE' => 1];

        $highest = 'EMPLOYEE';
        $best    = 0;

        foreach ($roles as $role) {
            $level = $hierarchy[$role] ?? 0;

            if ($level > $best) {
                $best    = $level;
                $highest = $role;
            }
        }

        return ['role' => $highest, 'station_ids' => $stationIds];
    }

    public function touchLastLogin(int $userId): void
    {
        $this->db
            ->prepare('UPDATE users SET last_login_at = NOW() WHERE id = :id')
            ->execute(['id' => $userId]);
    }

    public function updatePassword(int $userId, string $passwordHash): void
    {
        $this->db
            ->prepare('UPDATE users SET password_hash = :hash WHERE id = :id')
            ->execute(['hash' => $passwordHash, 'id' => $userId]);
    }
}
