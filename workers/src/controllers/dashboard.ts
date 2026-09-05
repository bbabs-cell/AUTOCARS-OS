/**
 * Le tableau de bord
 * ==================================================================
 * Tous les rôles peuvent l'ouvrir. Le CONTENU, lui, dépend des
 * droits — et c'est une décision de sécurité, pas d'ergonomie.
 *
 * ------------------------------------------------------------------
 * LES BLOCS FINANCIERS NE SONT PAS MASQUÉS : ILS NE SONT PAS ENVOYÉS
 *
 * Masquer un bloc dans Angular ne protégerait rien. L'onglet réseau
 * du navigateur montre la réponse brute, et n'importe qui peut
 * appeler l'API directement. Un employé qui n'a pas `reports.view`
 * ne reçoit donc AUCUN chiffre d'affaires — pas même caché derrière
 * un booléen.
 *
 * `can_see_money` sert à l'application pour savoir quoi afficher, pas
 * à décider ce qu'elle reçoit. La décision est prise ici.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { interdit, succes } from '../core/response';
import { ACTIFS, ALERTES } from '../core/etats';

interface Alerte {
  key: string;
  severity: 'warning' | 'danger' | 'info';
  count: number;
  label: string;
  detail: string;
  route: string;
  amount?: number;
}

export async function tableau(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('dashboard.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const station = stationDemandee(request);
  const filtreOp = station === null ? '' : ' AND o.station_id = ?';
  const p = station === null ? [] : [station];

  const argent = utilisateur.peut('reports.view');

  // --- Ce qui s'est passé aujourd'hui, et hier ----------------------
  const jour = await base
    .select(
      `SELECT
         SUM(CASE WHEN date(o.created_at) = date('now') THEN 1 ELSE 0 END) AS entrees,
         SUM(CASE WHEN date(o.created_at) = date('now','-1 day') THEN 1 ELSE 0 END) AS entrees_hier,
         SUM(CASE WHEN o.status IN ('IN_PROGRESS','INSPECTION','WASHING','QUALITY_CHECK')
                  THEN 1 ELSE 0 END) AS en_cours,
         SUM(CASE WHEN o.status = 'WAITING' THEN 1 ELSE 0 END) AS en_attente,
         SUM(CASE WHEN o.status = 'COMPLETED' AND date(o.released_at) = date('now')
                  THEN 1 ELSE 0 END) AS restitues
       FROM operations o WHERE o.{ORG}${filtreOp}`,
      ...p,
    )
    .first<{
      entrees: number | null; entrees_hier: number | null; en_cours: number | null;
      en_attente: number | null; restitues: number | null;
    }>();

  // --- La répartition par étape --------------------------------------
  const parEtat = await base
    .select(
      `SELECT o.status, COUNT(*) AS n FROM operations o
        WHERE o.{ORG} AND o.status IN (${ACTIFS.map(() => '?').join(',')})${filtreOp}
        GROUP BY o.status`,
      ...ACTIFS,
      ...p,
    )
    .all<{ status: string; n: number }>();

  const operationsParEtat: Record<string, number> = {};

  for (const e of ACTIFS) {
    operationsParEtat[e] = 0;
  }

  for (const r of parEtat.results) {
    operationsParEtat[r.status] = r.n;
  }

  // --- Le délai moyen, arrivée → prêt --------------------------------
  //
  // Mesuré sur les dossiers RESTITUÉS du jour : un dossier encore en
  // cours n'a pas de durée, et l'inclure ferait baisser la moyenne à
  // mesure que la journée avance.
  const delai = await base
    .select(
      `SELECT AVG((julianday(o.completed_at) - julianday(o.created_at)) * 1440) AS moyenne
         FROM operations o
        WHERE o.{ORG} AND o.completed_at IS NOT NULL
          AND date(o.completed_at) = date('now')${filtreOp}`,
      ...p,
    )
    .first<{ moyenne: number | null }>();

  const donnees: Record<string, unknown> = {
    station_id: station,
    generated_at: new Date().toISOString(),
    today: {
      vehicles_in: jour?.entrees ?? 0,
      in_progress: jour?.en_cours ?? 0,
      released: jour?.restitues ?? 0,
      waiting: jour?.en_attente ?? 0,
    },
    yesterday: { vehicles_in: jour?.entrees_hier ?? 0 },
    operations_by_status: operationsParEtat,
    average_turnaround_minutes:
      delai?.moyenne === null || delai?.moyenne === undefined
        ? null
        : Math.round(delai.moyenne),
    can_see_money: argent,
    top_services: [],
    alerts: [] as Alerte[],
  };

  // --- Les prestations les plus demandées ----------------------------
  const services = await base
    .select(
      `SELECT s.name, COUNT(*) AS n${argent ? ', COALESCE(SUM(o.price - o.discount_amount), 0) AS total' : ''}
         FROM operations o JOIN services s ON s.id = o.service_id
        WHERE o.{ORG} AND date(o.created_at) >= date('now','-7 days')${filtreOp}
        GROUP BY s.id ORDER BY n DESC LIMIT 5`,
      ...p,
    )
    .all<{ name: string; n: number; total?: number }>();

  donnees.top_services = services.results.map((s) => ({
    name: s.name,
    count: s.n,
    ...(argent ? { total: s.total ?? 0 } : {}),
  }));

  // ==================================================================
  // À PARTIR D'ICI, RIEN N'EST ENVOYÉ SANS `reports.view`.
  // ==================================================================
  if (argent) {
    const recette = await base
      .select(
        `SELECT
           COALESCE(SUM(CASE WHEN date(p.paid_at) = date('now') THEN p.amount ELSE 0 END), 0) AS aujourdhui,
           COALESCE(SUM(CASE WHEN date(p.paid_at) = date('now','-1 day') THEN p.amount ELSE 0 END), 0) AS hier
         FROM payments p
        WHERE p.{ORG} AND p.status = 'PAID'${station === null ? '' : ' AND p.station_id = ?'}`,
        ...p,
      )
      .first<{ aujourdhui: number; hier: number }>();

    (donnees.today as Record<string, unknown>).revenue = recette?.aujourdhui ?? 0;
    (donnees.yesterday as Record<string, unknown>).revenue = recette?.hier ?? 0;

    // La recette des sept derniers jours, un point par jour.
    const serie = await base
      .select(
        `SELECT date(p.paid_at) AS jour, COALESCE(SUM(p.amount), 0) AS total
           FROM payments p
          WHERE p.{ORG} AND p.status = 'PAID'
            AND date(p.paid_at) >= date('now','-6 days')${station === null ? '' : ' AND p.station_id = ?'}
          GROUP BY date(p.paid_at) ORDER BY jour ASC`,
        ...p,
      )
      .all<{ jour: string; total: number }>();

    const parJour = new Map(serie.results.map((r) => [r.jour, r.total]));
    const points: { date: string; label: string; total: number }[] = [];
    const jours = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const iso = d.toISOString().slice(0, 10);
      points.push({ date: iso, label: jours[d.getUTCDay()], total: parJour.get(iso) ?? 0 });
    }

    donnees.revenue_series = points;

    const split = await base
      .select(
        `SELECT p.method, COUNT(*) AS n, COALESCE(SUM(p.amount), 0) AS total
           FROM payments p
          WHERE p.{ORG} AND p.status = 'PAID' AND date(p.paid_at) = date('now')
            ${station === null ? '' : 'AND p.station_id = ?'}
          GROUP BY p.method ORDER BY total DESC`,
        ...p,
      )
      .all<{ method: string; n: number; total: number }>();

    donnees.payment_split = split.results.map((r) => ({
      method: r.method,
      total: r.total,
      count: r.n,
    }));

    // L'ARGENT QUI DORT : la voiture est lavée, le client n'a pas payé.
    const impayes = await base
      .select(
        `SELECT COUNT(*) AS n, COALESCE(SUM(o.price - o.discount_amount - COALESCE((
                  SELECT SUM(p.amount) FROM payments p
                   WHERE p.operation_id = o.id AND p.status = 'PAID'), 0)), 0) AS montant
           FROM operations o
          WHERE o.{ORG} AND o.status = 'READY'${filtreOp}
            AND (o.price - o.discount_amount) > COALESCE((
                  SELECT SUM(p.amount) FROM payments p
                   WHERE p.operation_id = o.id AND p.status = 'PAID'), 0)`,
        ...p,
      )
      .first<{ n: number; montant: number }>();

    donnees.ready_unpaid = { count: impayes?.n ?? 0, amount: impayes?.montant ?? 0 };
  }

  // --- La caisse, pour ceux qui la voient -----------------------------
  if (utilisateur.peut('cash.view') && station !== null) {
    const session = await base
      .select(
        `SELECT s.id, s.opening_float + COALESCE((
                  SELECT SUM(CASE WHEN p.status = 'PAID' THEN p.amount ELSE -p.amount END)
                    FROM payments p
                   WHERE p.cash_session_id = s.id AND p.method = 'CASH'
                     AND p.status IN ('PAID','REFUNDED')), 0) AS attendu
           FROM cash_sessions s
          WHERE s.{ORG} AND s.station_id = ? AND s.status = 'OPEN' LIMIT 1`,
        station,
      )
      .first<{ id: number; attendu: number }>();

    const dehors = await base
      .select(
        `SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p
          WHERE p.{ORG} AND p.station_id = ? AND p.method = 'CASH'
            AND p.status = 'PAID' AND p.cash_session_id IS NULL`,
        station,
      )
      .first<{ total: number }>();

    donnees.cash = {
      is_open: session !== null,
      expected: session?.attendu ?? null,
      outside_session: dehors?.total ?? 0,
    };
  }

  donnees.alerts = await construitAlertes(base, utilisateur, station, filtreOp, p, donnees);

  return succes(donnees);
}

/**
 * Les alertes.
 * ==================================================================
 * UNE ALERTE QU'ON NE PEUT PAS FAIRE DISPARAÎTRE N'EST PAS UNE
 * ALERTE : c'est une décoration qu'on cesse de regarder au bout d'une
 * semaine. Chacune de celles-ci disparaît dès que le problème est
 * réglé — c'est ce qui fait qu'on les regarde encore au bout d'un
 * mois.
 */
async function construitAlertes(
  base: ReturnType<typeof baseDe>,
  utilisateur: Utilisateur,
  station: number | null,
  filtreOp: string,
  p: unknown[],
  donnees: Record<string, unknown>,
): Promise<Alerte[]> {
  const alertes: Alerte[] = [];

  // Les dossiers qui dépassent leur durée. On calcule ici plutôt qu'en
  // SQL : le seuil dépend de l'étape, et pour le lavage de la durée
  // annoncée de la prestation.
  const actifs = await base
    .select(
      `SELECT o.status, o.status_changed_at, o.created_at, s.duration_minutes
         FROM operations o JOIN services s ON s.id = o.service_id
        WHERE o.{ORG} AND o.status IN (${ACTIFS.map(() => '?').join(',')})${filtreOp}`,
      ...ACTIFS,
      ...p,
    )
    .all<{ status: string; status_changed_at: string | null; created_at: string; duration_minutes: number }>();

  const minutesDepuis = (v: string) =>
    Math.max(0, Math.floor((Date.now() - new Date(v.replace(' ', 'T') + 'Z').getTime()) / 60_000));

  let depassent = 0;
  let attendentTrop = 0;

  for (const o of actifs.results) {
    const minutes = minutesDepuis(o.status_changed_at ?? o.created_at);
    const seuil = ALERTES[o.status] ?? o.duration_minutes;

    if (typeof seuil === 'number' && seuil > 0 && minutes > seuil) {
      depassent++;
    }

    if (o.status === 'WAITING' && minutes >= 20) {
      attendentTrop++;
    }
  }

  if (depassent > 0) {
    alertes.push({
      key: 'overdue',
      severity: 'warning',
      count: depassent,
      label: depassent === 1
        ? 'Un dossier dépasse la durée prévue'
        : `${depassent} dossiers dépassent la durée prévue`,
      detail: "Ouvrez la file d'attente pour voir lesquels.",
      route: '/queue',
    });
  }

  if (attendentTrop > 0) {
    alertes.push({
      key: 'waiting_too_long',
      severity: 'warning',
      count: attendentTrop,
      label: attendentTrop === 1
        ? 'Un client attend depuis plus de 20 minutes'
        : `${attendentTrop} clients attendent depuis plus de 20 minutes`,
      detail: "Personne ne s'est encore chargé de leur véhicule.",
      route: '/queue',
    });
  }

  const impayes = donnees.ready_unpaid as { count: number; amount: number } | undefined;

  if (impayes !== undefined && impayes.count > 0) {
    alertes.push({
      key: 'ready_unpaid',
      severity: 'warning',
      count: impayes.count,
      amount: impayes.amount,
      label: impayes.count === 1
        ? "Un véhicule prêt n'est pas réglé"
        : `${impayes.count} véhicules prêts ne sont pas réglés`,
      detail: 'Ils ne pourront pas être restitués sans dérogation.',
      route: '/queue',
    });
  }

  const caisse = donnees.cash as { is_open: boolean; outside_session: number } | undefined;

  if (utilisateur.peut('cash.view') && station !== null && caisse !== undefined
      && !caisse.is_open && caisse.outside_session > 0) {
    alertes.push({
      key: 'cash_closed',
      severity: 'warning',
      count: 1,
      amount: caisse.outside_session,
      label: 'Des espèces sont encaissées sans caisse ouverte',
      detail: 'Ces montants ne seront comptés dans aucune clôture.',
      route: '/cash',
    });
  }

  return alertes;
}

function stationDemandee(request: Request): number | null {
  const brut = new URL(request.url).searchParams.get('station_id');

  if (brut === null || brut === '') {
    return null;
  }

  const n = Number.parseInt(brut, 10);

  return Number.isInteger(n) && n > 0 ? n : null;
}
