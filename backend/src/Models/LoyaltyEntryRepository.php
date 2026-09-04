<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Le grand livre de la fidélité
 * ==================================================================
 * UNE LIGNE PAR ÉVÉNEMENT, EN AJOUT SEUL.
 * ==================================================================
 *
 * Le solde d'un client n'est stocké NULLE PART : il est la somme des
 * lignes. C'est plus de requêtes qu'un compteur — et infiniment plus
 * sûr.
 *
 * Un compteur `customers.loyalty_points` aurait été faux au premier
 * incident : un paiement rejoué, une remise annulée, une transaction
 * interrompue au mauvais moment, et le nombre affiché ne correspond
 * plus à rien. Personne ne peut alors dire s'il est trop haut ou trop
 * bas, ni depuis quand. Ici, on relit les lignes.
 *
 * CE DÉPÔT NE SUPPRIME ET NE MODIFIE RIEN. Une erreur se compense par
 * une écriture inverse (REVERSAL), exactement comme un encaissement
 * se corrige par une contre-écriture (lot 9).
 */
final class LoyaltyEntryRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'loyalty_entries';
    }

    /**
     * Le solde de tampons d'un client.
     *
     * Les REVERSAL sont positifs et les REDEEM négatifs : une simple
     * somme suffit, sans cas particulier à connaître. C'est tout
     * l'intérêt d'un grand livre signé.
     */
    public function balanceFor(int $customerId): int
    {
        $statement = $this->db->prepare(
            'SELECT COALESCE(SUM(points), 0) FROM loyalty_entries
              WHERE organization_id = :organization_id
                AND customer_id = :customer_id'
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'customer_id' => $customerId,
        ]);

        return (int) $statement->fetchColumn();
    }

    /**
     * L'historique d'un client, du plus récent au plus ancien.
     *
     * @return list<array<string,mixed>>
     */
    public function historyFor(int $customerId, int $limit = 50): array
    {
        $limit = max(1, min($limit, 200));

        $statement = $this->db->prepare(
            "SELECT e.*,
                    o.reference AS operation_reference,
                    CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
               FROM loyalty_entries e
          LEFT JOIN operations o ON o.id = e.operation_id
          LEFT JOIN users      u ON u.id = e.created_by_user_id
              WHERE e.organization_id = :organization_id
                AND e.customer_id = :customer_id
           ORDER BY e.id DESC
              LIMIT {$limit}"
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'customer_id' => $customerId,
        ]);

        return $statement->fetchAll();
    }

    /**
     * Ce dossier a-t-il déjà donné un tampon ?
     *
     * La base l'interdit de toute façon (contrainte d'unicité sur la
     * colonne calculée `earn_operation_id`). On le vérifie quand même
     * ici, pour ne pas remonter une erreur SQL brute à un caissier :
     * la contrainte est le filet, pas la règle.
     */
    public function hasEarnFor(int $operationId): bool
    {
        $statement = $this->db->prepare(
            "SELECT COUNT(*) FROM loyalty_entries
              WHERE organization_id = :organization_id
                AND operation_id = :operation_id
                AND type = 'EARN'"
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'operation_id' => $operationId,
        ]);

        return (int) $statement->fetchColumn() > 0;
    }

    /**
     * L'utilisation de récompense encore active sur ce dossier, s'il
     * y en a une.
     *
     * « Encore active » = un REDEEM qu'aucun REVERSAL n'a annulé.
     *
     * @return array<string,mixed>|null
     */
    public function activeRedeemFor(int $operationId): ?array
    {
        $statement = $this->db->prepare(
            "SELECT e.* FROM loyalty_entries e
              WHERE e.organization_id = :organization_id
                AND e.operation_id = :operation_id
                AND e.type = 'REDEEM'
                AND NOT EXISTS (
                    SELECT 1 FROM loyalty_entries r
                     WHERE r.related_entry_id = e.id
                       AND r.type = 'REVERSAL'
                )
              ORDER BY e.id DESC
              LIMIT 1"
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'operation_id' => $operationId,
        ]);

        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /**
     * ==================================================================
     * LES CLIENTS QUI ONT UNE RÉCOMPENSE À PRENDRE
     * ==================================================================
     * C'est le seul écran vraiment actionnable du module : ces
     * personnes ont gagné quelque chose et ne le savent peut-être
     * pas. Les appeler, c'est les faire revenir.
     *
     * `$minimumStamps` vaut le seuil du programme : en dessous, il
     * n'y a rien à annoncer.
     *
     * @return list<array{customer_id:int, customer_name:string, phone:string, balance:int}>
     */
    public function customersWithBalance(int $minimumStamps = 1, int $limit = 100): array
    {
        $limit = max(1, min($limit, 300));
        $minimumStamps = max(1, $minimumStamps);

        $statement = $this->db->prepare(
            "SELECT e.customer_id,
                    CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                    c.phone,
                    SUM(e.points) AS balance
               FROM loyalty_entries e
               JOIN customers c ON c.id = e.customer_id
              WHERE e.organization_id = :organization_id
                AND c.deleted_at IS NULL
           GROUP BY e.customer_id, c.first_name, c.last_name, c.phone
             HAVING balance >= :minimum
           ORDER BY balance DESC, customer_name ASC
              LIMIT {$limit}"
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'minimum' => $minimumStamps,
        ]);

        return array_map(
            static fn (array $row): array => [
                'customer_id' => (int) $row['customer_id'],
                'customer_name' => (string) $row['customer_name'],
                'phone' => (string) ($row['phone'] ?? ''),
                'balance' => (int) $row['balance'],
            ],
            $statement->fetchAll(),
        );
    }

    /**
     * Combien de tampons distribués et utilisés sur une période.
     *
     * Sert au bilan du programme. Le COÛT, lui, ne se lit pas ici : il
     * se lit sur les remises réellement appliquées aux dossiers (voir
     * `OperationRepository::discountTotal()`), parce qu'une
     * récompense de 5 000 F sur un dossier à 3 000 F ne coûte que
     * 3 000 F.
     *
     * @return array{earned:int, redeemed:int, reversed:int}
     */
    public function summaryBetween(string $from, string $to): array
    {
        $statement = $this->db->prepare(
            'SELECT type, COALESCE(SUM(ABS(points)), 0) AS total
               FROM loyalty_entries
              WHERE organization_id = :organization_id
                AND created_at >= :from
                AND created_at <= :to
           GROUP BY type'
        );

        $statement->execute([
            'organization_id' => $this->organizationId(),
            'from' => $from . ' 00:00:00',
            'to' => $to . ' 23:59:59',
        ]);

        $totals = ['EARN' => 0, 'REDEEM' => 0, 'REVERSAL' => 0];

        foreach ($statement->fetchAll() as $row) {
            $totals[(string) $row['type']] = (int) $row['total'];
        }

        return [
            'earned' => $totals['EARN'],
            'redeemed' => $totals['REDEEM'],
            'reversed' => $totals['REVERSAL'],
        ];
    }
}
