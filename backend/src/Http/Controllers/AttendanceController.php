<?php

declare(strict_types=1);

namespace Autocare\Http\Controllers;

use Autocare\Core\AuditLogger;
use Autocare\Core\Request;
use Autocare\Core\Response;
use Autocare\Core\Security\AuthContext;
use Autocare\Core\Validator;
use Autocare\Models\TimeEntryRepository;
use PDOException;

/**
 * Le pointage
 * ==================================================================
 * UN REGISTRE, PAS UNE CAMÉRA.
 * ==================================================================
 *
 * Ce module n'a ni géolocalisation, ni photo, ni pointage
 * automatique. Un employé déclare son arrivée et son départ ; un
 * responsable peut corriger, et la correction se voit.
 *
 * C'est délibéré. Dans une station où la paie se fait à la journée
 * travaillée, ce qu'on cherche c'est « combien de jours Aliou a-t-il
 * faits ce mois-ci » — pas de savoir s'il est arrivé à 7 h 58 ou
 * 8 h 03. Un outil de surveillance serait mal accepté, contourné, et
 * finirait par produire des données fausses.
 *
 * ------------------------------------------------------------------
 * TROIS DÉCISIONS À COMPRENDRE
 *
 * 1. ON NE FERME JAMAIS UN POINTAGE AUTOMATIQUEMENT.
 *    Quelqu'un qui oublie de pointer en partant laisse une ligne
 *    ouverte toute la nuit. Le logiciel ne sait pas à quelle heure
 *    il est parti : inventer une heure de sortie, c'est fabriquer
 *    une donnée de paie. On signale l'anomalie, un responsable
 *    tranche avec ce qu'il sait.
 *
 * 2. UNE CORRECTION EST VISIBLE.
 *    L'entrée corrigée porte le nom de qui l'a modifiée et pourquoi,
 *    et le détail avant/après va dans le journal d'audit. Sans cela,
 *    un employé payé sur des heures qu'il n'a pas reconnues n'aurait
 *    aucun moyen de s'en apercevoir.
 *
 * 3. CHACUN POINTE POUR SOI.
 *    Pointer à la place d'un collègue est le premier détournement
 *    d'un registre de présence. Seul un responsable peut créer ou
 *    modifier le pointage de quelqu'un d'autre — et c'est tracé.
 */
final class AttendanceController
{
    /**
     * GET /api/attendance/me
     * Suis-je pointé, et depuis quand ?
     */
    public function me(Request $request): void
    {
        $user       = AuthContext::current();
        $repository = new TimeEntryRepository();
        $open       = $repository->openFor($user->userId);

        Response::success([
            'is_clocked_in' => $open !== null,
            'current'       => $open === null ? null : $this->present($open),
            // Les dix derniers pointages : de quoi vérifier soi-même
            // ses journées avant la paie. Un registre qu'on ne peut
            // pas relire ne rassure personne.
            'recent' => array_map(
                $this->present(...),
                $repository->listDetailed(['user_id' => $user->userId], 10),
            ),
        ]);
    }

    /** POST /api/attendance/clock-in */
    public function clockIn(Request $request): void
    {
        $user       = AuthContext::current();
        $repository = new TimeEntryRepository();

        if ($repository->openFor($user->userId) !== null) {
            Response::error(
                'Vous êtes déjà pointé. Pointez votre départ avant de repointer.',
                [],
                409
            );
        }

        $stationId = $this->resolveStation($request);

        try {
            $id = $repository->create([
                'station_id'  => $stationId,
                'user_id'     => $user->userId,
                'clock_in_at' => date('Y-m-d H:i:s'),
                'notes'       => Validator::make($request->body())->stringOrNull('notes'),
            ]);
        } catch (PDOException $exception) {
            // 23000 : la contrainte d'unicité a tranché. Un double
            // appui sur un téléphone lent passe deux fois la
            // vérification ci-dessus avant que la première écriture
            // n'arrive. C'est exactement ce que la base est là pour
            // attraper.
            if ($exception->getCode() === '23000') {
                Response::error('Vous êtes déjà pointé.', [], 409);
            }

            throw $exception;
        }

        AuditLogger::record(
            action: 'attendance.clock_in',
            organizationId: $user->organizationId,
            userId: $user->userId,
            stationId: $stationId,
            entityType: 'time_entry',
            entityId: $id,
        );

        Response::success(
            ['entry' => $this->present($repository->findDetailed($id) ?? [])],
            'Arrivée enregistrée.',
            201
        );
    }

    /** POST /api/attendance/clock-out */
    public function clockOut(Request $request): void
    {
        $user       = AuthContext::current();
        $repository = new TimeEntryRepository();
        $open       = $repository->openFor($user->userId);

        if ($open === null) {
            Response::error("Vous n'êtes pas pointé.", [], 409);
        }

        $entryId = (int) $open['id'];
        $minutes = $this->minutesBetween((string) $open['clock_in_at'], date('Y-m-d H:i:s'));

        $repository->update($entryId, [
            'clock_out_at' => date('Y-m-d H:i:s'),
            // Durée FIGÉE : une correction ultérieure sur une heure ne
            // doit pas changer rétroactivement une durée déjà servie
            // à payer quelqu'un.
            'duration_minutes' => $minutes,
        ]);

        AuditLogger::record(
            action: 'attendance.clock_out',
            organizationId: $user->organizationId,
            userId: $user->userId,
            stationId: (int) $open['station_id'],
            entityType: 'time_entry',
            entityId: $entryId,
            metadata: ['minutes' => $minutes],
        );

        Response::success(
            ['entry' => $this->present($repository->findDetailed($entryId) ?? [])],
            sprintf('Départ enregistré. %s de présence.', $this->humanDuration($minutes))
        );
    }

    /**
     * GET /api/attendance?from=&to=&user_id=&station_id=
     * Le registre de l'équipe.
     */
    public function index(Request $request): void
    {
        $filters = [];

        foreach (['from', 'to'] as $key) {
            $value = $request->query($key);

            if ($value !== null && $value !== '') {
                $filters[$key] = $value;
            }
        }

        foreach (['user_id', 'station_id'] as $key) {
            $value = $request->query($key);

            if ($value !== null && $value !== '') {
                $filters[$key] = (int) $value;
            }
        }

        // Sans bornes, on montre le MOIS EN COURS : c'est la période
        // de la paie, donc la question posée neuf fois sur dix.
        if (!isset($filters['from']) && !isset($filters['to'])) {
            $filters['from'] = date('Y-m-01');
            $filters['to']   = date('Y-m-d');
        }

        $repository = new TimeEntryRepository();

        Response::success([
            'entries' => array_map($this->present(...), $repository->listDetailed($filters)),
            'totals'  => $repository->totalsByUser(
                $filters['from'] ?? date('Y-m-01'),
                $filters['to'] ?? date('Y-m-d'),
            ),
            // Les pointages restés ouverts : l'anomalie à traiter en
            // premier, avant même de regarder les totaux.
            'stale'   => array_map($this->present(...), $repository->stale()),
            'present' => array_map($this->present(...), $repository->presentNow()),
            'period'  => [
                'from' => $filters['from'] ?? null,
                'to'   => $filters['to'] ?? null,
            ],
        ]);
    }

    /**
     * PUT /api/attendance/{id}
     * LA CORRECTION D'UN POINTAGE.
     *
     * Réservée aux responsables, et jamais silencieuse : l'entrée
     * porte ensuite le nom de qui l'a modifiée, et le détail
     * avant/après va dans le journal d'audit.
     */
    public function correct(Request $request, string $id): void
    {
        $entryId    = (int) $id;
        $repository = new TimeEntryRepository();
        $entry      = $repository->find($entryId);

        if ($entry === null) {
            Response::notFound("Ce pointage n'existe pas.");
        }

        $validator = Validator::make($request->body())
            ->required('clock_in_at', "L'heure d'arrivée")
            ->required('reason', 'Le motif')->maxLength('reason', 255);

        if ($validator->fails()) {
            Response::validationFailed($validator->errors());
        }

        $clockIn  = $this->parseDateTime($validator->string('clock_in_at'), 'clock_in_at');
        $clockOut = $validator->stringOrNull('clock_out_at');
        $clockOut = $clockOut === null ? null : $this->parseDateTime($clockOut, 'clock_out_at');

        if ($clockOut !== null && $clockOut <= $clockIn) {
            Response::validationFailed([
                'clock_out_at' => "Le départ doit être postérieur à l'arrivée.",
            ]);
        }

        // Une journée de plus de 16 heures est presque toujours une
        // faute de saisie — ou un pointage jamais fermé qu'on essaie
        // de rattraper au jugé. On refuse plutôt que de laisser
        // entrer un chiffre qui servira à payer.
        if ($clockOut !== null && $this->minutesBetween($clockIn, $clockOut) > 16 * 60) {
            Response::validationFailed([
                'clock_out_at' => 'Plus de 16 heures de présence : vérifiez la date.',
            ]);
        }

        $repository->update($entryId, [
            'clock_in_at'  => $clockIn,
            'clock_out_at' => $clockOut,
            'duration_minutes' => $clockOut === null
                ? null
                : $this->minutesBetween($clockIn, $clockOut),
            'corrected_by_user_id' => AuthContext::current()->userId,
            'corrected_at'      => date('Y-m-d H:i:s'),
            'correction_reason' => $validator->string('reason'),
        ]);

        AuditLogger::record(
            action: 'attendance.corrected',
            organizationId: AuthContext::current()->organizationId,
            userId: AuthContext::current()->userId,
            stationId: (int) $entry['station_id'],
            entityType: 'time_entry',
            entityId: $entryId,
            metadata: [
                'user_id'  => (int) $entry['user_id'],
                'from'     => [
                    'clock_in_at'  => $entry['clock_in_at'],
                    'clock_out_at' => $entry['clock_out_at'],
                ],
                'to'       => ['clock_in_at' => $clockIn, 'clock_out_at' => $clockOut],
                'reason'   => $validator->string('reason'),
            ],
        );

        Response::success(
            ['entry' => $this->present($repository->findDetailed($entryId) ?? [])],
            'Pointage corrigé. La modification est visible dans le registre.'
        );
    }

    // ==================================================================

    /**
     * La station du pointage.
     *
     * Sans paramètre, celle de l'utilisateur. Un employé envoyé en
     * renfort ailleurs doit pouvoir le préciser : ses heures
     * appartiennent à la station où il a travaillé.
     */
    private function resolveStation(Request $request): int
    {
        $requested = $request->input('station_id');

        if ($requested !== null && $requested !== '') {
            $stationId = (int) $requested;

            if (!AuthContext::current()->canAccessStation($stationId)) {
                Response::forbidden("Vous n'êtes pas rattaché à cette station.");
            }

            return $stationId;
        }

        $stations = AuthContext::current()->stationIds;

        if ($stations === []) {
            Response::error(
                "Votre compte n'est rattaché à aucune station. Contactez votre responsable.",
                [],
                409
            );
        }

        return $stations[0];
    }

    /**
     * Lit une date envoyée par le formulaire et la refuse si elle est
     * illisible ou dans le futur.
     *
     * Un pointage dans le futur n'a aucun sens et fausserait les
     * totaux du mois en cours.
     */
    private function parseDateTime(string $value, string $field): string
    {
        $timestamp = strtotime($value);

        if ($timestamp === false) {
            Response::validationFailed([$field => 'Cette date est illisible.']);
        }

        if ($timestamp > time() + 60) {
            Response::validationFailed([$field => "Un pointage ne peut pas être dans le futur."]);
        }

        return date('Y-m-d H:i:s', $timestamp);
    }

    private function minutesBetween(string $from, string $to): int
    {
        return max(0, (int) floor((strtotime($to) - strtotime($from)) / 60));
    }

    /** « 8 h 15 », « 45 min ». */
    private function humanDuration(int $minutes): string
    {
        if ($minutes < 60) {
            return $minutes . ' min';
        }

        $hours = intdiv($minutes, 60);
        $rest  = $minutes % 60;

        return $rest === 0
            ? $hours . ' h'
            : sprintf('%d h %02d', $hours, $rest);
    }

    /**
     * @param array<string,mixed> $entry
     * @return array<string,mixed>
     */
    private function present(array $entry): array
    {
        $minutes = ($entry['duration_minutes'] ?? null) === null
            ? null
            : (int) $entry['duration_minutes'];

        return [
            'id'      => (int) ($entry['id'] ?? 0),
            'user_id' => (int) ($entry['user_id'] ?? 0),
            'user_name'   => $entry['user_name'] ?? null,
            'station_id'  => (int) ($entry['station_id'] ?? 0),
            'station_name' => $entry['station_name'] ?? null,

            'clock_in_at'  => $entry['clock_in_at'] ?? null,
            'clock_out_at' => $entry['clock_out_at'] ?? null,
            'is_open'      => ($entry['clock_out_at'] ?? null) === null,
            'duration_minutes' => $minutes,

            // Depuis combien de temps la personne est là, pour un
            // pointage encore ouvert. Calculé côté serveur : l'horloge
            // d'un téléphone peut être déréglée.
            'minutes_present' => ($entry['minutes_present'] ?? null) === null
                ? null
                : (int) $entry['minutes_present'],
            'hours_open' => ($entry['hours_open'] ?? null) === null
                ? null
                : (int) $entry['hours_open'],

            // Une correction ne se cache pas.
            'is_corrected' => ($entry['corrected_by_user_id'] ?? null) !== null,
            'corrected_by_name' => $entry['corrected_by_name'] ?? null,
            'corrected_at'      => $entry['corrected_at'] ?? null,
            'correction_reason' => $entry['correction_reason'] ?? null,

            'notes' => $entry['notes'] ?? null,
        ];
    }
}
