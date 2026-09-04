<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Http\Presenters\OperationPresenter;
use Autocare\Models\CashSessionRepository;
use Autocare\Models\DashboardRepository;
use Autocare\Models\OperationRepository;
use Autocare\Models\StationRepository;

/**
 * Le tableau de bord
 * ==================================================================
 * LE PREMIER ÉCRAN DE LA JOURNÉE.
 * ==================================================================
 *
 * Il répond à trois questions, dans cet ordre — et l'ordre est le
 * sujet :
 *
 *   1. QU'EST-CE QUI VA MAL ? Les alertes d'abord. Un tableau de bord
 *      qui commence par « 47 véhicules ce mois-ci » laisse passer le
 *      véhicule prêt depuis deux heures que personne n'a rappelé.
 *   2. OÙ EN EST-ON AUJOURD'HUI ? Quatre chiffres, pas quinze.
 *   3. COMMENT ÇA SE PASSE EN CE MOMENT ? La tendance de la semaine.
 *
 * ------------------------------------------------------------------
 * LE POINT DE SÉCURITÉ LE PLUS IMPORTANT DE CE FICHIER
 *
 * Un employé a le droit d'ouvrir cet écran (`dashboard.view`) : il a
 * besoin de savoir combien de voitures attendent. Il n'a PAS le droit
 * de voir le chiffre d'affaires (`reports.view`).
 *
 * Les blocs financiers ne sont donc pas « masqués par l'interface » :
 * ILS NE SONT PAS ENVOYÉS. La réponse JSON d'un employé ne contient
 * aucun montant. Masquer un bloc dans Angular n'aurait rien protégé —
 * il suffit d'ouvrir l'onglet réseau du navigateur pour lire ce que
 * le serveur a envoyé.
 */
final class DashboardController
{
    /** GET /api/dashboard?station_id= */
    public function index(Request $request): void
    {
        $stationId = $this->resolveStation($request);
        $user      = AuthContext::current();

        $dashboard  = new DashboardRepository();
        $operations = new OperationRepository();

        $activity = $dashboard->todayActivity($stationId);
        $queue    = array_map(
            OperationPresenter::present(...),
            $operations->queue($stationId),
        );

        // Le décompte des dossiers qui traînent réutilise EXACTEMENT
        // la même règle que la file d'attente (config/operation_status.php,
        // section `alerts`). Recalculer un seuil ici en ferait une
        // seconde définition, qui divergerait au premier réglage.
        $overdue = array_values(array_filter(
            $queue,
            static fn (array $operation): bool => $operation['is_overdue'] === true,
        ));

        $waiting = array_values(array_filter(
            $queue,
            static fn (array $operation): bool => $operation['status'] === 'WAITING',
        ));

        $payload = [
            'station_id'   => $stationId,
            'generated_at' => date('c'),

            'today' => [
                'vehicles_in' => $activity['vehicles_in'],
                'in_progress' => $activity['in_progress'],
                'released'    => $activity['released'],
                'waiting'     => count($waiting),
            ],

            // La comparaison à hier plutôt qu'à une moyenne : « on a
            // fait moins qu'hier » est une phrase qu'un gérant peut
            // vérifier de mémoire. Une moyenne mobile sur 30 jours ne
            // se vérifie pas, donc ne se croit pas.
            'yesterday' => [
                'vehicles_in' => $dashboard->vehiclesInOnDay(1, $stationId),
            ],

            'alerts' => $this->buildAlerts($dashboard, $overdue, $waiting, $stationId, $user),

            // Le VOLUME est une information de travail : savoir que le
            // lavage standard représente la moitié des passages aide
            // à s'organiser. Le CHIFFRE D'AFFAIRES par prestation,
            // lui, est retiré plus bas pour qui n'a pas le droit de
            // voir des montants — sans quoi ce bloc contournerait
            // discrètement toute la règle.
            'top_services' => $dashboard->topServices(30, 5, $stationId),

            'average_turnaround_minutes' => $dashboard->averageTurnaroundMinutes(7, $stationId),

            // Ce que l'employé peut voir : le travail, pas l'argent.
            'operations_by_status' => $operations->countByStatus($stationId),

            'can_see_money' => $user->can('reports.view'),
        ];

        // ==============================================================
        // LES BLOCS FINANCIERS — ENVOYÉS SEULEMENT SI LE DROIT EXISTE
        // ==============================================================
        if (!$user->can('reports.view')) {
            // On retire les montants du classement des prestations.
            // Un bloc « accessoire » qui laisse passer des chiffres
            // est exactement la façon dont une règle de droits se vide
            // de son sens sans que personne ne s'en aperçoive.
            $payload['top_services'] = array_map(
                static fn (array $service): array => [
                    'name'  => $service['name'],
                    'count' => $service['count'],
                ],
                $payload['top_services'],
            );
        }

        if ($user->can('reports.view')) {
            $unpaid = $dashboard->readyButUnpaid($stationId);

            $payload['today']['revenue']     = $dashboard->revenueOnDay(0, $stationId);
            $payload['yesterday']['revenue'] = $dashboard->revenueOnDay(1, $stationId);

            $payload['revenue_series'] = array_map(
                static fn (array $day): array => [
                    'date'  => $day['date'],
                    // Le jour de la semaine en trois lettres, calculé
                    // ici : le frontend n'a pas à refaire un mappage
                    // de dates qui dépend de la langue du produit.
                    'label' => self::dayLabel($day['date']),
                    'total' => $day['total'],
                ],
                $dashboard->revenueOverDays(7, $stationId),
            );

            $payload['payment_split'] = $dashboard->paymentSplitToday($stationId);
            $payload['ready_unpaid']  = $unpaid;
        }

        // La caisse est un droit encore distinct : un manager la voit,
        // un employé non.
        if ($user->can('cash.view') && $stationId !== null) {
            $sessions = new CashSessionRepository();
            $session  = $sessions->openFor($stationId);

            $payload['cash'] = [
                'is_open'  => $session !== null,
                'expected' => $session === null
                    ? null
                    : $sessions->expectedAmount((int) $session['id']),
                'outside_session' => $sessions->cashOutsideSession($stationId),
            ];
        }

        Response::success($payload);
    }

    // ==================================================================

    /**
     * CE QUI DEMANDE UNE ACTION, ET RIEN D'AUTRE.
     *
     * Une alerte qui s'affiche tous les jours cesse d'être lue au
     * bout d'une semaine. Chacune de celles-ci disparaît dès que le
     * problème est réglé — c'est ce qui fait qu'on les regarde encore
     * au bout d'un mois.
     *
     * @param list<array<string,mixed>> $overdue
     * @param list<array<string,mixed>> $waiting
     * @return list<array<string,mixed>>
     */
    private function buildAlerts(
        DashboardRepository $dashboard,
        array $overdue,
        array $waiting,
        ?int $stationId,
        AuthContext $user,
    ): array {
        $alerts = [];

        if ($overdue !== []) {
            $alerts[] = [
                'key'      => 'overdue',
                'severity' => 'warning',
                'count'    => count($overdue),
                'label'    => count($overdue) === 1
                    ? 'Un dossier dépasse la durée prévue'
                    : count($overdue) . ' dossiers dépassent la durée prévue',
                'detail'   => 'Ouvrez la file d\'attente pour voir lesquels.',
                'route'    => '/queue',
            ];
        }

        // Un véhicule que personne n'a pris en charge alors qu'il
        // attend depuis longtemps : le client, lui, est dans la salle
        // d'attente et regarde sa montre.
        $unassigned = array_filter(
            $waiting,
            static fn (array $o): bool => ($o['minutes_in_status'] ?? 0) >= 20,
        );

        if ($unassigned !== []) {
            $alerts[] = [
                'key'      => 'waiting_too_long',
                'severity' => 'warning',
                'count'    => count($unassigned),
                'label'    => count($unassigned) === 1
                    ? 'Un client attend depuis plus de 20 minutes'
                    : count($unassigned) . ' clients attendent depuis plus de 20 minutes',
                'detail'   => 'Personne ne s\'est encore chargé de leur véhicule.',
                'route'    => '/queue',
            ];
        }

        // Argent qui dort : la voiture est lavée, le client n'a pas
        // payé. Réservé à ceux qui ont le droit de voir des montants.
        if ($user->can('reports.view')) {
            $unpaid = $dashboard->readyButUnpaid($stationId);

            if ($unpaid['count'] > 0) {
                $alerts[] = [
                    'key'      => 'ready_unpaid',
                    'severity' => 'warning',
                    'count'    => $unpaid['count'],
                    'amount'   => $unpaid['amount'],
                    'label'    => $unpaid['count'] === 1
                        ? 'Un véhicule prêt n\'est pas réglé'
                        : $unpaid['count'] . ' véhicules prêts ne sont pas réglés',
                    'detail'   => 'Ils ne pourront pas être restitués sans dérogation.',
                    'route'    => '/queue',
                ];
            }
        }

        // La caisse fermée alors que la journée a commencé : les
        // espèces encaissées ne seront comptées nulle part.
        if ($user->can('cash.view') && $stationId !== null) {
            $sessions = new CashSessionRepository();

            if ($sessions->openFor($stationId) === null) {
                $outside = $sessions->cashOutsideSession($stationId);

                if ($outside > 0) {
                    $alerts[] = [
                        'key'      => 'cash_closed',
                        'severity' => 'warning',
                        'count'    => 1,
                        'amount'   => $outside,
                        'label'    => 'Des espèces sont encaissées sans caisse ouverte',
                        'detail'   => 'Ces montants ne seront comptés dans aucune clôture.',
                        'route'    => '/cash',
                    ];
                }
            }
        }

        return $alerts;
    }

    /**
     * Sur quelle station ?
     *
     * Sans paramètre : la station de l'utilisateur. Un administrateur
     * qui n'est rattaché à rien voit l'ensemble de son réseau — c'est
     * son rôle de le piloter.
     */
    private function resolveStation(Request $request): ?int
    {
        $requested = $request->query('station_id');

        if ($requested !== null && $requested !== '') {
            $stationId = (int) $requested;

            if ((new StationRepository())->find($stationId) === null) {
                Response::notFound("Cette station n'existe pas.");
            }

            if (!AuthContext::current()->canAccessStation($stationId)) {
                Response::forbidden("Vous n'êtes pas rattaché à cette station.");
            }

            return $stationId;
        }

        $stations = AuthContext::current()->stationIds;

        return $stations === [] ? null : $stations[0];
    }

    /** « lun. », « mar. »… en français, calculé côté serveur. */
    private static function dayLabel(string $date): string
    {
        $days = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

        return $days[(int) date('w', strtotime($date))] ?? $date;
    }
}
