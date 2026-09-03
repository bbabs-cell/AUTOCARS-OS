<?php

declare(strict_types=1);

namespace Autocare\Core;

use PDO;
use Throwable;

/**
 * Journal des actions sensibles
 * ------------------------------------------------------------------
 * Répond à la question centrale en cas de litige :
 * « qui a fait quoi, et quand ? »
 *
 * Ce journal N'EST PAS un journal technique. On n'y écrit pas les
 * erreurs PHP ni les requêtes lentes, mais des FAITS MÉTIER :
 * une connexion, un changement de statut, un paiement, une
 * restitution.
 *
 * RÈGLE : l'échec d'une écriture dans le journal ne doit jamais faire
 * échouer l'action elle-même. Si la table est pleine ou verrouillée,
 * un employé doit quand même pouvoir restituer un véhicule à un
 * client qui attend. On enregistre donc l'incident dans le journal
 * technique du serveur et on continue.
 */
final class AuditLogger
{
    /**
     * @param string $action      « operation.status_changed »
     * @param array<string,mixed> $metadata Détails variables
     */
    public static function record(
        string $action,
        ?int $organizationId = null,
        ?int $userId = null,
        ?int $stationId = null,
        ?string $entityType = null,
        ?int $entityId = null,
        array $metadata = [],
    ): void {
        try {
            $statement = Database::connection()->prepare(
                'INSERT INTO audit_logs
                    (organization_id, station_id, user_id, action,
                     entity_type, entity_id, metadata, ip_address, user_agent)
                 VALUES
                    (:organization_id, :station_id, :user_id, :action,
                     :entity_type, :entity_id, :metadata, INET6_ATON(:ip), :user_agent)'
            );

            $statement->execute([
                'organization_id' => $organizationId,
                'station_id'      => $stationId,
                'user_id'         => $userId,
                'action'          => $action,
                'entity_type'     => $entityType,
                'entity_id'       => $entityId,
                'metadata'        => $metadata === []
                    ? null
                    : json_encode($metadata, JSON_UNESCAPED_UNICODE),
                'ip'              => self::clientIp(),
                'user_agent'      => self::userAgent(),
            ]);
        } catch (Throwable $exception) {
            // Volontairement silencieux côté client, tracé côté serveur.
            error_log('[AUTOCARE][AUDIT] ' . $exception->getMessage());
        }
    }

    /**
     * Compte les occurrences récentes d'une action, pour une valeur
     * donnée. Sert à limiter les tentatives de connexion.
     */
    public static function countRecent(string $action, string $metadataValue, int $withinMinutes): int
    {
        try {
            $statement = Database::connection()->prepare(
                'SELECT COUNT(*) FROM audit_logs
                  WHERE action = :action
                    AND created_at >= (NOW() - INTERVAL :minutes MINUTE)
                    AND metadata LIKE :needle'
            );

            $statement->bindValue('action', $action);
            $statement->bindValue('minutes', $withinMinutes, PDO::PARAM_INT);
            $statement->bindValue('needle', '%' . $metadataValue . '%');
            $statement->execute();

            return (int) $statement->fetchColumn();
        } catch (Throwable $exception) {
            error_log('[AUTOCARE][AUDIT] ' . $exception->getMessage());

            // En cas de problème on ne bloque pas l'utilisateur :
            // un journal indisponible ne doit pas empêcher de se
            // connecter.
            return 0;
        }
    }

    private static function clientIp(): ?string
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? null;

        // On ne fait PAS confiance à X-Forwarded-For : n'importe qui
        // peut l'envoyer. Il ne sera pris en compte qu'une fois le
        // serveur mandataire de production identifié (lot 22).
        return is_string($ip) && $ip !== '' ? $ip : null;
    }

    private static function userAgent(): ?string
    {
        $agent = $_SERVER['HTTP_USER_AGENT'] ?? null;

        return is_string($agent) ? mb_substr($agent, 0, 255) : null;
    }
}
