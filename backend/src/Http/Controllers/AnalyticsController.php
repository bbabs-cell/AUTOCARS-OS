<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Models\AnalyticsRepository;
use DateTimeImmutable;

/**
 * Les statistiques
 * ==================================================================
 * LE PREMIER MODULE QUI N'AJOUTE RIEN AU MÉTIER.
 * ==================================================================
 *
 * Aucune table, aucune colonne, aucune migration. Quinze lots ont
 * enregistré honnêtement ce qui se passait dans une station ; celui-ci
 * se contente de leur poser des questions.
 *
 * ------------------------------------------------------------------
 * POURQUOI AUCUN NOUVEAU DROIT
 *
 * `reports.view` existe depuis le lot 4 et veut dire exactement cela :
 * voir les chiffres de l'entreprise. Créer `analytics.view` à côté
 * aurait donné deux droits pour une même notion, et un jour quelqu'un
 * en aurait accordé un sans l'autre.
 *
 * ON N'INVENTE PAS UNE PERMISSION QUAND IL EN EXISTE UNE JUSTE.
 *
 * ------------------------------------------------------------------
 * LE TABLEAU DE BORD ET CET ÉCRAN NE RÉPONDENT PAS À LA MÊME QUESTION
 *
 *   TABLEAU DE BORD (lot 10)   « qu'est-ce qui demande une action
 *                                aujourd'hui ? »
 *   STATISTIQUES (ce lot)      « comment se porte l'affaire depuis
 *                                un mois ? »
 *
 * Le premier se regarde le matin et se vide quand tout va bien. Le
 * second se regarde le dimanche soir et ne se vide jamais. Les
 * confondre aurait produit un écran qu'on ouvre sans savoir ce qu'on
 * y cherche.
 *
 * ------------------------------------------------------------------
 * LA PÉRIODE EST BORNÉE À UN AN
 *
 * Pas par prudence technique — les requêtes tiennent bien plus — mais
 * parce qu'une moyenne sur trois ans mélange des tarifs, des équipes
 * et des prestations qui n'ont plus rien à voir. Un chiffre qu'on ne
 * peut pas interpréter vaut moins que pas de chiffre.
 */
final class AnalyticsController
{
    /** Au-delà, les chiffres mélangent des époques différentes. */
    private const MAX_DAYS = 366;

    /**
     * GET /api/analytics?from=&to=&station_id=
     *
     * TOUT L'ÉCRAN EN UNE SEULE REQUÊTE.
     *
     * Sept appels séparés donneraient sept états qui ne se
     * rafraîchissent pas ensemble : on verrait une décomposition
     * calculée sur mars à côté d'un graphique d'avril, et personne ne
     * comprendrait pourquoi les totaux ne tombent pas. Une seule
     * réponse, une seule période, des chiffres qui se recoupent.
     */
    public function index(Request $request): void
    {
        [$from, $to] = $this->readPeriod($request);

        $stationId = $request->query('station_id');
        $stationId = $stationId === null || $stationId === '' ? null : (int) $stationId;

        if ($stationId !== null && !AuthContext::current()->canAccessStation($stationId)) {
            Response::forbidden("Vous n'êtes pas rattaché à cette station.");
        }

        $repository = new AnalyticsRepository();

        $breakdown = $repository->deliveredBreakdown($from, $to, $stationId);
        $collected = $repository->collected($from, $to, $stationId);

        Response::success([
            'period' => [
                'from' => $from,
                'to' => $to,
                'days' => (new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days + 1,
            ],

            'daily' => $repository->daily($from, $to, $stationId),

            // ==============================================================
            // LE PANNEAU QUI VÉRIFIE QUE LE PRODUIT NE SE CONTREDIT PAS
            // ==============================================================
            // valeur livrée = encaissé + offert + prépayé + impayé
            //
            // Les quatre termes viennent de quatre modules différents.
            // `reconciles` dit si l'égalité tombe juste — et l'écran
            // l'affiche, plutôt que de la supposer.
            'delivered' => $breakdown + [
                'reconciles' => $breakdown['delivered']
                    === $breakdown['paid'] + $breakdown['gifted']
                        + $breakdown['prepaid'] + $breakdown['unpaid'],
            ],

            // L'argent réellement reçu : ce n'est PAS la même chose, et
            // l'écart s'explique par les forfaits (lot 15).
            'collected' => $collected,

            'services' => $repository->byService($from, $to, $stationId),
            'hours'    => $repository->byHour($from, $to, $stationId),
            'weekdays' => $repository->byWeekday($from, $to, $stationId),
            'durations' => $repository->durations($from, $to, $stationId),
            'customers' => $repository->customerReturn($from, $to, $stationId),
        ]);
    }

    /**
     * La période demandée, ramenée à quelque chose d'interprétable.
     *
     * @return array{0:string, 1:string}
     */
    private function readPeriod(Request $request): array
    {
        $to   = $this->readDate($request->query('to')) ?? date('Y-m-d');
        // Trente jours par défaut : assez pour voir une tendance, assez
        // court pour que les tarifs et l'équipe n'aient pas changé.
        $from = $this->readDate($request->query('from'))
            ?? date('Y-m-d', strtotime('-29 days', strtotime($to)));

        // Des bornes inversées sont une faute de saisie, pas une
        // demande : on les remet à l'endroit plutôt que de renvoyer un
        // écran vide que l'utilisateur croira être la réalité.
        if ($from > $to) {
            [$from, $to] = [$to, $from];
        }

        $days = (new DateTimeImmutable($from))->diff(new DateTimeImmutable($to))->days + 1;

        if ($days > self::MAX_DAYS) {
            Response::validationFailed([
                'from' => sprintf(
                    'Au-delà de %d jours, les chiffres mélangent des tarifs et des équipes qui n\'ont plus rien à voir.',
                    self::MAX_DAYS
                ),
            ]);
        }

        return [$from, $to];
    }

    private function readDate(?string $value): ?string
    {
        if ($value === null || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return null;
        }

        return $value;
    }
}
