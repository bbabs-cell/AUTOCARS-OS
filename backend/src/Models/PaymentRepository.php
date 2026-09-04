<?php

declare(strict_types=1);

namespace Autocare\Models;

use Autocare\Core\TenantRepository;

/**
 * Les encaissements
 * ==================================================================
 * AUCUNE INTÉGRATION DE PAIEMENT N'EST CODÉE ICI, NI AILLEURS.
 * ==================================================================
 *
 * Cette table enregistre un FAIT COMPTABLE : « le caissier déclare
 * avoir reçu 5 000 F en espèces à 10 h 42 ». Elle ne déclenche aucune
 * transaction, n'appelle aucune API, ne vérifie rien auprès de Wave
 * ou d'Orange Money.
 *
 * Les colonnes `provider` et `external_reference` sont du texte saisi
 * à la main — le nom du service et le numéro recopié depuis le
 * téléphone du client. Le jour où une vraie intégration existera,
 * elle remplira ces mêmes colonnes. La structure est prête sans que
 * rien ne soit simulé aujourd'hui.
 *
 * ------------------------------------------------------------------
 * UN PAIEMENT NE SE MODIFIE PAS ET NE SE SUPPRIME PAS.
 *
 * Il n'y a ni `update()` ni `delete()` dans ce dépôt, et c'est
 * délibéré. Une erreur de saisie se corrige par une écriture
 * INVERSE — un remboursement — qui laisse les deux lignes visibles.
 *
 * C'est la règle de base de toute comptabilité : on ne gomme pas, on
 * contre-passe. Un montant qu'on peut réécrire après coup ne prouve
 * rien, et c'est précisément le soir où la caisse ne tombe pas juste
 * que quelqu'un voudrait le réécrire.
 */
final class PaymentRepository extends TenantRepository
{
    protected function table(): string
    {
        return 'payments';
    }

    /**
     * Les encaissements d'un dossier, du plus ancien au plus récent.
     *
     * L'ordre chronologique n'est pas un détail : on lit une suite
     * d'écritures — un acompte, un solde, éventuellement un
     * remboursement — et l'inverser rendrait l'histoire
     * incompréhensible.
     *
     * @return list<array<string,mixed>>
     */
    public function forOperation(int $operationId): array
    {
        $statement = $this->db->prepare(
            "SELECT p.*,
                    CONCAT(u.first_name, ' ', u.last_name) AS recorded_by_name
               FROM payments p
               JOIN users u ON u.id = p.recorded_by_user_id
              WHERE p.operation_id = :operation_id
                AND p.organization_id = :organization_id
           ORDER BY p.id ASC"
        );

        $statement->execute([
            'operation_id'    => $operationId,
            'organization_id' => $this->organizationId(),
        ]);

        return $statement->fetchAll();
    }

    /**
     * Le journal des encaissements, filtrable.
     *
     * @param array{from?:string, to?:string, method?:string,
     *              station_id?:int, status?:string} $filters
     * @return list<array<string,mixed>>
     */
    public function journal(array $filters = [], int $limit = 200): array
    {
        $conditions = [];
        $parameters = [];

        // Les bornes portent sur paid_at, la date de l'encaissement —
        // pas sur created_at. Un paiement d'hier saisi ce matin
        // appartient à la recette d'hier : c'est ce jour-là que
        // l'argent est entré.
        if (!empty($filters['from'])) {
            $conditions[] = 'p.paid_at >= :from';
            $parameters['from'] = $filters['from'] . ' 00:00:00';
        }

        if (!empty($filters['to'])) {
            $conditions[] = 'p.paid_at <= :to';
            $parameters['to'] = $filters['to'] . ' 23:59:59';
        }

        foreach (['method', 'status'] as $column) {
            if (!empty($filters[$column])) {
                $conditions[] = "p.{$column} = :{$column}";
                $parameters[$column] = $filters[$column];
            }
        }

        if (!empty($filters['station_id'])) {
            $conditions[] = 'p.station_id = :station_id';
            $parameters['station_id'] = (int) $filters['station_id'];
        }

        if (!empty($filters['cash_session_id'])) {
            $conditions[] = 'p.cash_session_id = :cash_session_id';
            $parameters['cash_session_id'] = (int) $filters['cash_session_id'];
        }

        $extra = $conditions === [] ? '' : ' AND ' . implode(' AND ', $conditions);
        $limit = max(1, min($limit, 500));

        $statement = $this->db->prepare(
            "SELECT p.*,
                    o.reference AS operation_reference,
                    v.plate_number,
                    s.name AS station_name,
                    CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
                    CONCAT(u.first_name, ' ', u.last_name) AS recorded_by_name
               FROM payments p
               JOIN stations   s ON s.id = p.station_id
               JOIN users      u ON u.id = p.recorded_by_user_id
          LEFT JOIN operations o ON o.id = p.operation_id
          LEFT JOIN vehicles   v ON v.id = o.vehicle_id
          LEFT JOIN customers  c ON c.id = p.customer_id
              WHERE p.organization_id = :organization_id
                    {$extra}
           ORDER BY p.paid_at DESC, p.id DESC
              LIMIT {$limit}"
        );

        $statement->execute($parameters + ['organization_id' => $this->organizationId()]);

        return $statement->fetchAll();
    }

    /**
     * Les totaux d'une période, par moyen de paiement.
     *
     * SEULS LES PAIEMENTS « PAID » SONT COMPTÉS. Un encaissement
     * remboursé ou annulé reste en base — il fait partie de
     * l'histoire — mais il n'est plus de l'argent reçu.
     *
     * @param array<string,mixed> $filters Mêmes clés que journal()
     * @return array{total:int, by_method:array<string,int>, count:int}
     */
    public function totals(array $filters = []): array
    {
        $filters['status'] = 'PAID';
        $rows = $this->journal($filters, 500);

        $byMethod = [];
        $total    = 0;

        foreach ($rows as $row) {
            $amount = (int) $row['amount'];
            $method = (string) $row['method'];

            $byMethod[$method] = ($byMethod[$method] ?? 0) + $amount;
            $total += $amount;
        }

        return [
            'total'     => $total,
            'by_method' => $byMethod,
            'count'     => count($rows),
        ];
    }

    /**
     * Somme réellement encaissée sur un dossier.
     *
     * Les remboursements sont enregistrés en NÉGATIF côté métier ?
     * Non : la colonne `amount` est UNSIGNED, elle ne peut pas être
     * négative. Un remboursement est une ligne dont le `status` vaut
     * REFUNDED, et la ligne d'origine passe elle aussi à REFUNDED.
     * Additionner les seules lignes PAID donne donc le solde réel,
     * sans soustraction à faire.
     */
    public function paidAmountFor(int $operationId): int
    {
        $statement = $this->db->prepare(
            "SELECT COALESCE(SUM(amount), 0) FROM payments
              WHERE operation_id = :operation_id
                AND organization_id = :organization_id
                AND status = 'PAID'"
        );

        $statement->execute([
            'operation_id'    => $operationId,
            'organization_id' => $this->organizationId(),
        ]);

        return (int) $statement->fetchColumn();
    }
}
