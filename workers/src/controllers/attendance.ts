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
 *    ouverte toute la nuit. Le logiciel ne sait pas à quelle heure il
 *    est parti : inventer une heure de sortie, c'est fabriquer une
 *    donnée de paie. On signale l'anomalie, un responsable tranche
 *    avec ce qu'il sait.
 *
 * 2. UNE CORRECTION EST VISIBLE.
 *    L'entrée corrigée porte le nom de qui l'a modifiée et pourquoi,
 *    et le détail avant/après va dans le journal d'audit. Sans cela,
 *    un employé payé sur des heures qu'il n'a pas reconnues n'aurait
 *    aucun moyen de s'en apercevoir.
 *
 * 3. CHACUN POINTE POUR SOI.
 *    Pointer à la place d'un collègue est le premier détournement
 *    d'un registre de présence. Seul un responsable peut modifier le
 *    pointage de quelqu'un d'autre — et c'est tracé.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import type { TenantDb } from '../core/db';
import { enregistre } from '../core/audit';
import { erreur, interdit, introuvable, succes } from '../core/response';

/** Le nombre d'heures au-delà duquel un pointage ouvert est oublié. */
const OUBLI_HEURES = 12;

interface LignePointage {
  id: number;
  user_id: number;
  user_name: string;
  station_id: number;
  station_name: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  duration_minutes: number | null;
  minutes_present: number | null;
  hours_open: number | null;
  corrected_by_user_id: number | null;
  corrected_by_name: string | null;
  corrected_at: string | null;
  correction_reason: string | null;
  notes: string | null;
}

/**
 * Les mêmes jointures partout.
 *
 * La ligne renvoyée après un pointage ou une correction doit être
 * IDENTIQUE à celle du registre. Une version antérieure du PHP lisait
 * la seule table `time_entries` après une correction : l'écran
 * affichait « corrigé par — » alors que le registre montrait le nom.
 * Deux écrans, deux vérités, pour la même donnée.
 *
 * `minutes_present` et `hours_open` sont calculés PAR LE SERVEUR :
 * l'horloge d'un téléphone peut être déréglée.
 */
const POINTAGE = `
  SELECT t.id, t.user_id, t.station_id, t.clock_in_at, t.clock_out_at,
         t.duration_minutes, t.corrected_by_user_id, t.corrected_at,
         t.correction_reason, t.notes,
         u.first_name || ' ' || u.last_name AS user_name,
         s.name AS station_name,
         c.first_name || ' ' || c.last_name AS corrected_by_name,
         CASE WHEN t.clock_out_at IS NULL
              THEN CAST((julianday('now') - julianday(t.clock_in_at)) * 1440 AS INTEGER)
         END AS minutes_present,
         CASE WHEN t.clock_out_at IS NULL
              THEN CAST((julianday('now') - julianday(t.clock_in_at)) * 24 AS INTEGER)
         END AS hours_open
    FROM time_entries t
    JOIN users    u ON u.id = t.user_id
    JOIN stations s ON s.id = t.station_id
    LEFT JOIN users c ON c.id = t.corrected_by_user_id`;

function presente(t: LignePointage) {
  return {
    id: t.id,
    user_id: t.user_id,
    user_name: t.user_name,
    station_id: t.station_id,
    station_name: t.station_name,

    clock_in_at: t.clock_in_at,
    clock_out_at: t.clock_out_at,
    is_open: t.clock_out_at === null,
    duration_minutes: t.duration_minutes,

    minutes_present: t.minutes_present,
    hours_open: t.hours_open,

    // Une correction ne se cache pas.
    is_corrected: t.corrected_by_user_id !== null,
    corrected_by_name: t.corrected_by_name,
    corrected_at: t.corrected_at,
    correction_reason: t.correction_reason,

    notes: t.notes,
  };
}

/** Le pointage encore ouvert de quelqu'un, s'il y en a un. */
async function ouvertDe(base: TenantDb, userId: number) {
  return await base
    .select(
      `${POINTAGE} WHERE t.{ORG} AND t.user_id = ? AND t.clock_out_at IS NULL LIMIT 1`,
      userId,
    )
    .first<LignePointage>();
}

/** « 8 h 15 », « 45 min ». */
function duree(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;

  return reste === 0 ? `${heures} h` : `${heures} h ${String(reste).padStart(2, '0')}`;
}

/** GET /api/attendance/me — suis-je pointé, et depuis quand ? */
export async function moi(env: Env, utilisateur: Utilisateur): Promise<Response> {
  if (!utilisateur.peut('attendance.clock')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const ouvert = await ouvertDe(base, utilisateur.id);

  // Les dix derniers pointages : de quoi vérifier soi-même ses
  // journées avant la paie. Un registre qu'on ne peut pas relire ne
  // rassure personne.
  const recents = await base
    .select(
      `${POINTAGE} WHERE t.{ORG} AND t.user_id = ? ORDER BY t.clock_in_at DESC LIMIT 10`,
      utilisateur.id,
    )
    .all<LignePointage>();

  return succes({
    is_clocked_in: ouvert !== null,
    current: ouvert === null ? null : presente(ouvert),
    recent: recents.results.map(presente),
  });
}

/**
 * La station du pointage.
 *
 * Sans paramètre, celle de l'utilisateur. Un employé envoyé en
 * renfort ailleurs doit pouvoir le préciser : ses heures
 * appartiennent à la station où il a travaillé.
 */
async function stationDuPointage(
  utilisateur: Utilisateur,
  demandee: unknown,
): Promise<{ id: number } | { refus: Response }> {
  if (demandee !== undefined && demandee !== null && demandee !== '') {
    const n = typeof demandee === 'number' ? demandee : Number(demandee);

    if (!Number.isInteger(n) || !await utilisateur.voitStation(n)) {
      return { refus: interdit("Vous n'êtes pas rattaché à cette station.") };
    }

    return { id: n };
  }

  const premiere = utilisateur.stationIds[0];

  if (premiere === undefined) {
    return {
      refus: erreur(
        "Votre compte n'est rattaché à aucune station. Contactez votre responsable.",
        {}, 409,
      ),
    };
  }

  return { id: premiere };
}

/** POST /api/attendance/clock-in */
export async function arrivee(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('attendance.clock')) {
    return interdit();
  }

  let corps: { station_id?: unknown; notes?: unknown } = {};

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    // Un corps vide est le cas normal : « je pointe » n'a rien à
    // dire de plus.
  }

  const base = baseDe(utilisateur, env.DB);

  if (await ouvertDe(base, utilisateur.id) !== null) {
    return erreur('Vous êtes déjà pointé. Pointez votre départ avant de repointer.', {}, 409);
  }

  const station = await stationDuPointage(utilisateur, corps.station_id);

  if ('refus' in station) {
    return station.refus;
  }

  let id: number;

  try {
    const r = await env.DB
      .prepare(
        `INSERT INTO time_entries (organization_id, station_id, user_id, clock_in_at, notes)
         VALUES (?, ?, ?, datetime('now'), ?)`,
      )
      .bind(
        utilisateur.organizationId, station.id, utilisateur.id,
        typeof corps.notes === 'string' && corps.notes.trim() !== ''
          ? corps.notes.trim().slice(0, 500) : null,
      )
      .run();

    id = Number(r.meta.last_row_id);
  } catch (e) {
    // La colonne calculée `open_user_id` est unique : un double appui
    // sur un téléphone lent passe deux fois la vérification ci-dessus
    // avant que la première écriture n'arrive. C'est exactement ce
    // que la base est là pour attraper.
    if (/UNIQUE|constraint/i.test(String(e))) {
      return erreur('Vous êtes déjà pointé.', {}, 409);
    }

    throw e;
  }

  await enregistre(env.DB, {
    action: 'attendance.clock_in',
    organizationId: utilisateur.organizationId,
    stationId: station.id,
    userId: utilisateur.id,
    entityType: 'time_entry',
    entityId: id,
  });

  const ligne = await base
    .select(`${POINTAGE} WHERE t.{ORG} AND t.id = ? LIMIT 1`, id)
    .first<LignePointage>();

  return succes(
    { entry: ligne === null ? null : presente(ligne) },
    'Arrivée enregistrée.',
    201,
  );
}

/** POST /api/attendance/clock-out */
export async function depart(env: Env, utilisateur: Utilisateur): Promise<Response> {
  if (!utilisateur.peut('attendance.clock')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const ouvert = await ouvertDe(base, utilisateur.id);

  if (ouvert === null) {
    return erreur("Vous n'êtes pas pointé.", {}, 409);
  }

  const minutes = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(`${ouvert.clock_in_at.replace(' ', 'T')}Z`).getTime()) / 60_000,
    ),
  );

  await base
    .select(
      `UPDATE time_entries
          SET clock_out_at = datetime('now'), duration_minutes = ?
        WHERE {ORG} AND id = ?`,
      // Durée FIGÉE : une correction ultérieure sur une heure ne doit
      // pas changer rétroactivement une durée déjà servie à payer
      // quelqu'un.
      minutes, ouvert.id,
    )
    .run();

  await enregistre(env.DB, {
    action: 'attendance.clock_out',
    organizationId: utilisateur.organizationId,
    stationId: ouvert.station_id,
    userId: utilisateur.id,
    entityType: 'time_entry',
    entityId: ouvert.id,
    metadata: { minutes },
  });

  const ligne = await base
    .select(`${POINTAGE} WHERE t.{ORG} AND t.id = ? LIMIT 1`, ouvert.id)
    .first<LignePointage>();

  return succes(
    { entry: ligne === null ? null : presente(ligne) },
    `Départ enregistré. ${duree(minutes)} de présence.`,
  );
}

/**
 * GET /api/attendance?from=&to=&user_id=&station_id=
 * Le registre de l'équipe.
 */
export async function registre(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('attendance.view')) {
    return interdit();
  }

  const p = new URL(request.url).searchParams;
  const jour = new Date().toISOString().slice(0, 10);

  const date = (cle: string) => {
    const v = p.get(cle);

    return v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  };

  // Sans bornes, on montre le MOIS EN COURS : c'est la période de la
  // paie, donc la question posée neuf fois sur dix.
  let depuis = date('from');
  let jusqua = date('to');

  if (depuis === null && jusqua === null) {
    depuis = `${jour.slice(0, 7)}-01`;
    jusqua = jour;
  }

  const conditions: string[] = [];
  const parametres: unknown[] = [];

  // Les bornes portent sur l'ARRIVÉE. Un pointage commencé à 22 h et
  // fermé à 2 h du matin appartient à la journée où la personne a
  // pris son poste, pas à celle où elle est partie.
  if (depuis !== null) {
    conditions.push('t.clock_in_at >= ?');
    parametres.push(`${depuis} 00:00:00`);
  }

  if (jusqua !== null) {
    conditions.push('t.clock_in_at <= ?');
    parametres.push(`${jusqua} 23:59:59`);
  }

  for (const colonne of ['user_id', 'station_id']) {
    const v = p.get(colonne);
    const n = v === null ? Number.NaN : Number.parseInt(v, 10);

    if (Number.isInteger(n) && n > 0) {
      conditions.push(`t.${colonne} = ?`);
      parametres.push(n);
    }
  }

  const suite = conditions.length === 0 ? '' : ` AND ${conditions.join(' AND ')}`;
  const base = baseDe(utilisateur, env.DB);

  const lignes = await base
    .select(
      `${POINTAGE} WHERE t.{ORG}${suite} ORDER BY t.clock_in_at DESC LIMIT 300`,
      ...parametres,
    )
    .all<LignePointage>();

  // ==============================================================
  // LES TOTAUX COMPTENT AUSSI LES JOURS.
  // ==============================================================
  // La paie d'une station de lavage se fait souvent à la journée
  // travaillée, pas à l'heure. « 14 jours » est le chiffre qu'on
  // cherche ; « 112 heures » celui qu'un logiciel européen
  // afficherait.
  //
  // Les pointages encore ouverts sont EXCLUS : leur durée n'est pas
  // connue, et l'estimer fausserait un total qui sert à payer.
  const totaux = await base
    .select(
      `SELECT t.user_id,
              u.first_name || ' ' || u.last_name AS user_name,
              COUNT(DISTINCT date(t.clock_in_at)) AS days,
              COALESCE(SUM(t.duration_minutes), 0) AS minutes,
              COUNT(*) AS entries
         FROM time_entries t JOIN users u ON u.id = t.user_id
        WHERE t.{ORG} AND t.clock_out_at IS NOT NULL
          AND t.clock_in_at >= ? AND t.clock_in_at <= ?
        GROUP BY t.user_id, u.first_name, u.last_name
        ORDER BY minutes DESC`,
      `${depuis ?? `${jour.slice(0, 7)}-01`} 00:00:00`,
      `${jusqua ?? jour} 23:59:59`,
    )
    .all<{ user_id: number; user_name: string; days: number; minutes: number; entries: number }>();

  // Les pointages restés ouverts : l'anomalie à traiter en premier,
  // avant même de regarder les totaux.
  const oublies = await base
    .select(
      `${POINTAGE} WHERE t.{ORG} AND t.clock_out_at IS NULL
         AND t.clock_in_at < datetime('now', '-${OUBLI_HEURES} hours')
       ORDER BY t.clock_in_at ASC`,
    )
    .all<LignePointage>();

  // ==============================================================
  // LES POINTAGES OUBLIÉS SONT EXCLUS DES PRÉSENTS.
  // ==============================================================
  // Un pointage ouvert depuis quatre-vingts heures n'est pas une
  // présence : c'est quelqu'un qui est parti sans pointer, il y a
  // trois jours. L'afficher comme « présent depuis 81 h » ferait
  // douter de tout le panneau — et un panneau dont on doute, on
  // cesse de le regarder.
  const presents = await base
    .select(
      `${POINTAGE} WHERE t.{ORG} AND t.clock_out_at IS NULL
         AND t.clock_in_at >= datetime('now', '-${OUBLI_HEURES} hours')
       ORDER BY t.clock_in_at ASC`,
    )
    .all<LignePointage>();

  return succes({
    entries: lignes.results.map(presente),
    totals: totaux.results,
    stale: oublies.results.map(presente),
    present: presents.results.map(presente),
    period: { from: depuis, to: jusqua },
  });
}

/**
 * PUT /api/attendance/{id}
 * LA CORRECTION D'UN POINTAGE.
 *
 * Réservée aux responsables, et jamais silencieuse : l'entrée porte
 * ensuite le nom de qui l'a modifiée, et le détail avant/après va
 * dans le journal d'audit.
 */
export async function corrige(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  pointageId: string,
): Promise<Response> {
  if (!utilisateur.peut('attendance.correct')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(pointageId, 10);

  const avant = await base
    .select(`${POINTAGE} WHERE t.{ORG} AND t.id = ? LIMIT 1`, id)
    .first<LignePointage>();

  if (avant === null) {
    return introuvable("Ce pointage n'existe pas.");
  }

  let corps: { clock_in_at?: unknown; clock_out_at?: unknown; reason?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const motif = typeof corps.reason === 'string' ? corps.reason.trim() : '';

  if (motif === '' || motif.length > 255) {
    return erreur('Vérifiez les champs.', {
      reason: motif === '' ? 'Le motif est obligatoire.' : 'Ce motif est trop long.',
    }, 422);
  }

  /**
   * Lit une date du formulaire et la refuse si elle est illisible ou
   * dans le futur : un pointage à venir n'a aucun sens et fausserait
   * les totaux du mois en cours.
   */
  const lit = (valeur: unknown, champ: string): string | Response => {
    if (typeof valeur !== 'string' || valeur.trim() === '') {
      return erreur('Vérifiez les champs.', { [champ]: 'Cette date est illisible.' }, 422);
    }

    const t = Date.parse(valeur.replace(' ', 'T'));

    if (Number.isNaN(t)) {
      return erreur('Vérifiez les champs.', { [champ]: 'Cette date est illisible.' }, 422);
    }

    if (t > Date.now() + 60_000) {
      return erreur('Vérifiez les champs.', {
        [champ]: 'Un pointage ne peut pas être dans le futur.',
      }, 422);
    }

    return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
  };

  const entree = lit(corps.clock_in_at, 'clock_in_at');

  if (typeof entree !== 'string') {
    return entree;
  }

  let sortie: string | null = null;

  if (corps.clock_out_at !== undefined && corps.clock_out_at !== null && corps.clock_out_at !== '') {
    const lue = lit(corps.clock_out_at, 'clock_out_at');

    if (typeof lue !== 'string') {
      return lue;
    }

    sortie = lue;
  }

  if (sortie !== null && sortie <= entree) {
    return erreur('Vérifiez les champs.', {
      clock_out_at: "Le départ doit être postérieur à l'arrivée.",
    }, 422);
  }

  const minutes = sortie === null ? null : Math.max(
    0,
    Math.floor(
      (Date.parse(`${sortie.replace(' ', 'T')}Z`) - Date.parse(`${entree.replace(' ', 'T')}Z`))
      / 60_000,
    ),
  );

  // Une journée de plus de 16 heures est presque toujours une faute
  // de saisie — ou un pointage jamais fermé qu'on essaie de rattraper
  // au jugé. On refuse plutôt que de laisser entrer un chiffre qui
  // servira à payer.
  if (minutes !== null && minutes > 16 * 60) {
    return erreur('Vérifiez les champs.', {
      clock_out_at: 'Plus de 16 heures de présence : vérifiez la date.',
    }, 422);
  }

  await base
    .select(
      `UPDATE time_entries
          SET clock_in_at = ?, clock_out_at = ?, duration_minutes = ?,
              corrected_by_user_id = ?, corrected_at = datetime('now'),
              correction_reason = ?
        WHERE {ORG} AND id = ?`,
      entree, sortie, minutes, utilisateur.id, motif, id,
    )
    .run();

  await enregistre(env.DB, {
    action: 'attendance.corrected',
    organizationId: utilisateur.organizationId,
    stationId: avant.station_id,
    userId: utilisateur.id,
    entityType: 'time_entry',
    entityId: id,
    metadata: {
      user_id: avant.user_id,
      from: { clock_in_at: avant.clock_in_at, clock_out_at: avant.clock_out_at },
      to: { clock_in_at: entree, clock_out_at: sortie },
      reason: motif,
    },
  });

  const apres = await base
    .select(`${POINTAGE} WHERE t.{ORG} AND t.id = ? LIMIT 1`, id)
    .first<LignePointage>();

  return succes(
    { entry: apres === null ? null : presente(apres) },
    'Pointage corrigé. La modification est visible dans le registre.',
  );
}
