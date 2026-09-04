<?php

declare(strict_types=1);

namespace Autocare\Http\Presenters;

use Autocare\Core\OperationStatus;
use Autocare\Core\PlateNumber;
use Autocare\Models\OperationRepository;

/**
 * Mise en forme d'une opération pour l'API
 * ------------------------------------------------------------------
 * POURQUOI UNE CLASSE PLUTÔT QU'UNE MÉTHODE PRIVÉE PAR CONTRÔLEUR ?
 *
 * Parce que trois écrans montrent la même opération : la liste des
 * dossiers, la fiche d'un dossier et la file d'attente. Si chacun
 * fabriquait sa propre réponse, le même dossier arriverait au
 * frontend avec trois formes légèrement différentes — un champ
 * `plate_display` ici, `plate` là — et le TypeScript aurait besoin de
 * trois interfaces pour un seul objet.
 *
 * Un seul présentateur, un seul contrat. Le jour où l'on ajoute un
 * champ, les trois écrans en profitent sans qu'on y pense.
 *
 * CE QUE CETTE CLASSE NE FAIT PAS : décider. Elle ne lit pas la base,
 * ne vérifie aucun droit, ne change rien. Elle traduit une ligne SQL
 * en objet JSON, et rien d'autre. C'est ce qui la rend triviale à
 * relire et sans risque à modifier.
 */
final class OperationPresenter
{
    /**
     * @param array<string,mixed> $operation Ligne renvoyée par
     *        OperationRepository::listDetailed() ou findDetailed()
     * @return array<string,mixed>
     */
    public static function present(array $operation): array
    {
        $status = (string) ($operation['status'] ?? 'WAITING');
        $plate  = (string) ($operation['plate_number'] ?? '');

        // Le PRIX est ce que vaut la prestation ; le DÛ est ce qui
        // reste à encaisser après une éventuelle remise de fidélité.
        // Les deux sont envoyés au frontend : afficher « 5 000 F »
        // barré et « 0 F » à payer est la seule façon pour le client
        // de voir ce que sa fidélité lui a rapporté.
        $price    = (int) ($operation['price'] ?? 0);
        $discount = (int) ($operation['discount_amount'] ?? 0);
        $due  = OperationRepository::amountDue($operation);
        $paid = (int) ($operation['paid_amount'] ?? 0);

        $duration = (int) ($operation['duration_minutes'] ?? 0);
        $minutes  = self::minutesInStatus($operation);
        $threshold = OperationStatus::alertThreshold($status, $duration > 0 ? $duration : null);

        return [
            'id'        => (int) ($operation['id'] ?? 0),
            'reference' => $operation['reference'] ?? '',
            'status'    => $status,
            'status_label' => OperationStatus::label($status),
            'allowed_transitions' => OperationStatus::allowedFrom($status),
            'priority'  => (int) ($operation['priority'] ?? 0),

            'vehicle_id'    => (int) ($operation['vehicle_id'] ?? 0),
            'plate_number'  => $plate,
            'plate_display' => PlateNumber::format($plate),
            'brand'         => $operation['brand'] ?? '',
            'model'         => $operation['model'] ?? '',
            'color'         => $operation['color'] ?? null,
            'vehicle_type'  => $operation['vehicle_type'] ?? 'CAR',

            'customer_id'   => (int) ($operation['customer_id'] ?? 0),
            'customer_name' => trim(
                ($operation['customer_first_name'] ?? '') . ' ' . ($operation['customer_last_name'] ?? '')
            ),
            'customer_phone' => $operation['customer_phone'] ?? null,

            'service_id'       => (int) ($operation['service_id'] ?? 0),
            'service_name'     => $operation['service_name'] ?? '',
            'duration_minutes' => $duration,

            'station_id'   => (int) ($operation['station_id'] ?? 0),
            'station_name' => $operation['station_name'] ?? '',

            'assigned_user_id' => ($operation['assigned_user_id'] ?? null) === null
                ? null
                : (int) $operation['assigned_user_id'],
            'assigned_name'    => $operation['assigned_name'] ?? null,

            'price'         => $price,
            'discount_amount' => $discount,
            'discount_reason' => $operation['discount_reason'] ?? null,
            'amount_due'    => $due,
            'currency_code' => $operation['currency_code'] ?? 'XOF',
            'paid_amount'   => $paid,
            'is_settled'    => $paid >= $due,

            // Évite au frontend d'aller chercher les inspections pour
            // savoir s'il peut proposer « Commencer le lavage ».
            'has_entry_inspection' => (int) ($operation['has_entry_inspection'] ?? 0) > 0,

            // --- La file d'attente ---------------------------------
            // Le temps passé à l'étape actuelle, et le jugement qui va
            // avec. Calculés ICI et non côté client : l'heure du
            // serveur fait foi. Le téléphone d'un employé peut être
            // déréglé de vingt minutes, et une alerte fausse coûte
            // plus cher qu'une alerte absente.
            'status_changed_at'  => $operation['status_changed_at'] ?? null,
            'minutes_in_status'  => $minutes,
            'alert_after_minutes' => $threshold,
            'is_overdue' => $threshold !== null
                && $minutes !== null
                && $minutes > $threshold
                && !OperationStatus::isFinal($status),

            'notes'        => $operation['notes'] ?? null,
            'created_at'   => $operation['created_at'] ?? null,
            'started_at'   => $operation['started_at'] ?? null,
            'completed_at' => $operation['completed_at'] ?? null,
            'released_at'  => $operation['released_at'] ?? null,
        ];
    }

    /**
     * Depuis combien de minutes ce dossier est-il à cette étape ?
     *
     * On retombe sur created_at si status_changed_at est absent : un
     * dossier créé avant la mise en place de cette colonne ne doit pas
     * afficher « depuis 0 minute », ce qui serait faux — et une donnée
     * fausse est pire qu'une donnée absente, parce qu'on la croit.
     *
     * @param array<string,mixed> $operation
     */
    private static function minutesInStatus(array $operation): ?int
    {
        $since = $operation['status_changed_at'] ?? $operation['created_at'] ?? null;

        if (!is_string($since) || $since === '') {
            return null;
        }

        $timestamp = strtotime($since);

        if ($timestamp === false) {
            return null;
        }

        // Jamais négatif : une horloge serveur légèrement en arrière
        // afficherait « depuis -3 minutes », ce qui ne veut rien dire
        // pour la personne qui le lit.
        return max(0, (int) floor((time() - $timestamp) / 60));
    }
}
