<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Les journées de caisse
 * ------------------------------------------------------------------
 * Une session = un tiroir-caisse ouvert, d'un matin à un soir.
 *
 * La valeur de ce module tient dans un seul nombre : l'ÉCART entre ce
 * que le logiciel attend et ce que le caissier compte. Tout le reste
 * n'est là que pour rendre cet écart calculable et honnête.
 */
final class CashSessionRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'cash_sessions';
    }

    /**
     * La caisse actuellement ouverte sur cette station, s'il y en a.
     *
     * @return array<string,mixed>|null
     */
    public function openFor(int $stationId): ?array
    {
        $rows = $this->select(
            '*',
            "AND station_id = :station_id AND status = 'OPEN' LIMIT 1",
            ['station_id' => $stationId],
        );

        return $rows[0] ?? null;
    }

    /**
     * Ce que la caisse DEVRAIT contenir : le fond de départ, plus les
     * espèces encaissées pendant la session.
     *
     * C'EST ICI QUE SE FAIT LE TRI. La session rattache TOUS les
     * encaissements de la vacation, quel que soit leur moyen ; seul ce
     * calcul-ci ne retient que les espèces.
     *
     * SEULES LES ESPÈCES, donc. Un paiement Wave n'est pas dans le tiroir ;
     * l'y ajouter rendrait la clôture fausse tous les soirs, et le
     * caissier cesserait de la faire — ce qui reviendrait à ne pas
     * avoir de caisse du tout.
     *
     * Les remboursements en espèces sont soustraits : l'argent rendu
     * au client est sorti du tiroir.
     */
    public function expectedAmount(int $sessionId): int
    {
        $session = $this->find($sessionId);

        if ($session === null) {
            return 0;
        }

        $statement = $this->db->prepare(
            "SELECT
                COALESCE(SUM(CASE WHEN status = 'PAID'     THEN amount ELSE 0 END), 0) AS encaisse,
                COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN amount ELSE 0 END), 0) AS rembourse
               FROM payments
              WHERE cash_session_id = :session_id
                AND organization_id = :organization_id
                AND method = 'CASH'"
        );

        $statement->execute([
            'session_id'      => $sessionId,
            'organization_id' => $this->organizationId(),
        ]);

        $row = $statement->fetch();

        return (int) $session['opening_float']
            + (int) ($row['encaisse'] ?? 0)
            - (int) ($row['rembourse'] ?? 0);
    }

    /**
     * Le détail des mouvements d'une session, par moyen de paiement.
     *
     * On montre AUSSI les moyens qui ne touchent pas le tiroir. Le
     * caissier doit pouvoir se dire « j'ai fait 45 000 F ce matin,
     * dont 18 000 en espèces » : cacher le reste donnerait
     * l'impression d'une journée deux fois moins bonne.
     *
     * @return array<string,array{count:int, total:int}>
     */
    public function movements(int $sessionId): array
    {
        $statement = $this->db->prepare(
            "SELECT method, COUNT(*) AS operations, COALESCE(SUM(amount), 0) AS total
               FROM payments
              WHERE cash_session_id = :session_id
                AND organization_id = :organization_id
                AND status = 'PAID'
           GROUP BY method"
        );

        $statement->execute([
            'session_id'      => $sessionId,
            'organization_id' => $this->organizationId(),
        ]);

        $movements = [];

        foreach ($statement->fetchAll() as $row) {
            $movements[(string) $row['method']] = [
                'count' => (int) $row['operations'],
                'total' => (int) $row['total'],
            ];
        }

        return $movements;
    }

    /**
     * Les encaissements en espèces enregistrés SANS caisse ouverte,
     * aujourd'hui, sur cette station.
     *
     * POURQUOI SIGNALER CELA ?
     * Parce que ces montants ne sont comptés dans aucune clôture. Le
     * tiroir contiendra un argent que le logiciel n'attend pas, et
     * l'écart du soir sera inexplicable — à moins qu'on ne dise
     * pourquoi. Une anomalie expliquée n'est plus une anomalie.
     */
    public function cashOutsideSession(int $stationId): int
    {
        $statement = $this->db->prepare(
            "SELECT COALESCE(SUM(amount), 0) FROM payments
              WHERE organization_id = :organization_id
                AND station_id = :station_id
                AND method = 'CASH'
                AND status = 'PAID'
                AND cash_session_id IS NULL
                -- Une borne, pas une fonction : `DATE(paid_at) = …`
                -- interdit à MySQL d'utiliser le moindre index sur la
                -- colonne, et lui fait relire tous les encaissements
                -- de l'entreprise (lot 20).
                AND paid_at >= CURDATE()
                AND paid_at <  CURDATE() + INTERVAL 1 DAY"
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'station_id'      => $stationId,
        ]);

        return (int) $statement->fetchColumn();
    }

    /**
     * L'historique des clôtures, avec les noms des personnes.
     *
     * Les noms ne sont pas décoratifs : un écart se discute avec
     * quelqu'un, pas avec un identifiant.
     *
     * @return list<array<string,mixed>>
     */
    public function history(?int $stationId = null, int $limit = 50): array
    {
        $extra = '';
        $parameters = ['organization_id' => $this->organizationId()];

        if ($stationId !== null) {
            $extra = ' AND cs.station_id = :station_id';
            $parameters['station_id'] = $stationId;
        }

        $limit = max(1, min($limit, 200));

        $statement = $this->db->prepare(
            "SELECT cs.*,
                    s.name AS station_name,
                    CONCAT(o.first_name, ' ', o.last_name) AS opened_by_name,
                    CONCAT(c.first_name, ' ', c.last_name) AS closed_by_name
               FROM cash_sessions cs
               JOIN stations s ON s.id = cs.station_id
               JOIN users    o ON o.id = cs.opened_by_user_id
          LEFT JOIN users    c ON c.id = cs.closed_by_user_id
              WHERE cs.organization_id = :organization_id
                    {$extra}
           ORDER BY cs.opened_at DESC
              LIMIT {$limit}"
        );

        $statement->execute($parameters);

        return $statement->fetchAll();
    }
}
