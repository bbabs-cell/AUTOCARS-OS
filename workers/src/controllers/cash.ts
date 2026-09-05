/**
 * La caisse : une vacation au comptoir, pas un tiroir
 * ==================================================================
 * Une session de caisse ouvre le matin avec un fond, encaisse toute
 * la journée, et se ferme le soir sur un comptage. La différence
 * entre ce que le logiciel attendait et ce qui est réellement dans le
 * tiroir est l'ÉCART — et c'est tout l'objet de cet écran.
 *
 * ------------------------------------------------------------------
 * TROIS REFUS, ET POURQUOI ILS TIENNENT
 *
 * 1. UNE SEULE CAISSE OUVERTE PAR STATION.
 *    Deux vacations simultanées rendraient tout rapprochement
 *    impossible : à qui manque l'argent ? La règle est portée par le
 *    SCHÉMA — une clé unique sur `open_station_id` — et non par une
 *    vérification qu'un contrôleur pourrait oublier.
 *
 * 2. L'ÉCART NE SE CORRIGE PAS.
 *    On ne peut pas « ajuster » le total pour que la caisse tombe
 *    juste. Une caisse dont on peut réécrire le résultat ne prouve
 *    plus rien, et l'écart est précisément l'information qu'on
 *    cherche. Il se constate, il se commente, il ne s'efface pas.
 *
 * 3. LA RECETTE N'EST PAS VISIBLE PAR TOUT LE MONDE.
 *    Elle dépend du droit `cash.view`, vérifié ici. Masquer l'écran
 *    dans Angular ne protégerait rien.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { enregistre } from '../core/audit';
import { erreur, interdit, succes } from '../core/response';

interface LigneSession {
  id: number;
  station_id: number;
  status: string;
  opening_float: number;
  expected_amount: number | null;
  counted_amount: number | null;
  difference: number | null;
  opened_at: string | null;
  closed_at: string | null;
  opening_notes: string | null;
  closing_notes: string | null;
}

/**
 * Ce que le tiroir DEVRAIT contenir : le fond de caisse, plus les
 * encaissements en espèces de la vacation.
 *
 * Les paiements par mobile money ou par carte sont rattachés à la
 * session — c'est la vacation, pas le tiroir — mais ne sont PAS
 * attendus en espèces. Les confondre ferait apparaître un écart
 * énorme tous les soirs.
 */
const ESPERE = `
  s.opening_float + COALESCE((
    SELECT SUM(CASE WHEN p.status = 'PAID' THEN p.amount ELSE -p.amount END)
      FROM payments p
     WHERE p.cash_session_id = s.id AND p.method = 'CASH'
       AND p.status IN ('PAID', 'REFUNDED')
  ), 0) AS expected_amount`;

/** GET /api/cash/current */
export async function courante(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('cash.view')) {
    return interdit();
  }

  const station = stationDemandee(request, utilisateur);

  if (station === null) {
    return erreur('Indiquez la station.', { station_id: 'Station inconnue.' }, 422);
  }

  const base = baseDe(utilisateur, env.DB);

  const session = await base
    .select(
      `SELECT s.id, s.station_id, s.status, s.opening_float, ${ESPERE},
              s.counted_amount, s.difference, s.opened_at, s.closed_at,
              s.opening_notes, s.closing_notes
         FROM cash_sessions s
        WHERE s.{ORG} AND s.station_id = ? AND s.status = 'OPEN' LIMIT 1`,
      station,
    )
    .first<LigneSession>();

  // LE DÉTAIL PAR MOYEN DE PAIEMENT.
  //
  // « Ce matin nous avons fait 45 000 F, dont 18 000 en espèces » est
  // la phrase que le caissier doit pouvoir dire. Sans ce détail,
  // l'écran ne peut afficher qu'un total, et le rapprochement du
  // tiroir devient impossible.
  const mouvements: Record<string, { count: number; total: number }> = {};

  if (session !== null) {
    const parMoyen = await base
      .select(
        `SELECT p.method, COUNT(*) AS n, COALESCE(SUM(p.amount), 0) AS total
           FROM payments p
          WHERE p.{ORG} AND p.cash_session_id = ? AND p.status = 'PAID'
          GROUP BY p.method`,
        session.id,
      )
      .all<{ method: string; n: number; total: number }>();

    for (const m of parMoyen.results) {
      mouvements[m.method] = { count: m.n, total: m.total };
    }
  }

  // LES ESPÈCES ENCAISSÉES SANS CAISSE OUVERTE.
  //
  // On n'empêche pas d'encaisser sans session — on ne refuse pas
  // l'argent d'un client parce que personne n'a ouvert la caisse.
  // Mais cet argent n'est rattaché à aucune vacation, et il doit se
  // voir : c'est l'alerte « des espèces sont encaissées sans caisse
  // ouverte » du tableau de bord.
  const dehors = await base
    .select(
      `SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p
        WHERE p.{ORG} AND p.station_id = ? AND p.method = 'CASH'
          AND p.status = 'PAID' AND p.cash_session_id IS NULL`,
      station,
    )
    .first<{ total: number }>();

  return succes({
    session: session === null ? null : presente(session),
    movements: mouvements,
    cash_outside_session: dehors?.total ?? 0,
    station_id: station,
  });
}

/** POST /api/cash/open */
export async function ouvre(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('cash.open')) {
    return interdit();
  }

  let corps: { station_id?: unknown; opening_float?: unknown; opening_notes?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  // LA STATION EST FACULTATIVE, ET C'EST LE FRONTEND QUI L'IMPOSE.
  //
  // `openCash()` n'envoie que le fond et les notes : au comptoir, on
  // ouvre la caisse de SA station, on ne la choisit pas. Exiger
  // `station_id` aurait rendu l'écran inutilisable — et le défaut
  // n'aurait été visible qu'en cliquant.
  const station = resoudStation(request, corps.station_id, utilisateur);

  if (station === null || !utilisateur.stationIds.includes(station)) {
    return erreur('Vérifiez les champs.', {
      station_id: "Vous n'êtes pas rattaché à cette station.",
    }, 422);
  }

  const fond = typeof corps.opening_float === 'number' ? corps.opening_float : 0;

  if (!Number.isInteger(fond) || fond < 0) {
    return erreur('Vérifiez les champs.', {
      opening_float: 'Le fond de caisse doit être un nombre entier de francs.',
    }, 422);
  }

  // REFUS N° 1 — porté par le schéma.
  //
  // On vérifie AUSSI ici, pour renvoyer un message utile plutôt que
  // de laisser remonter une violation de contrainte. Mais c'est la
  // contrainte qui garantit, pas ce test : deux requêtes simultanées
  // passeraient toutes les deux par ici.
  const deja = await baseDe(utilisateur, env.DB)
    .select(
      "SELECT id FROM cash_sessions WHERE {ORG} AND station_id = ? AND status = 'OPEN' LIMIT 1",
      station,
    )
    .first<{ id: number }>();

  if (deja !== null) {
    return erreur(
      'Une caisse est déjà ouverte sur cette station. Fermez-la avant '
      + "d'en ouvrir une autre : deux vacations en même temps rendent "
      + 'tout rapprochement impossible.',
      {}, 409,
    );
  }

  const r = await env.DB
    .prepare(
      `INSERT INTO cash_sessions (organization_id, station_id, status, opening_float,
                                  opened_by_user_id, opened_at, opening_notes, open_station_id)
       VALUES (?, ?, 'OPEN', ?, ?, datetime('now'), ?, ?)`,
    )
    .bind(
      utilisateur.organizationId, station, fond, utilisateur.id,
      typeof corps.opening_notes === 'string' && corps.opening_notes.trim() !== ''
        ? corps.opening_notes.trim() : null,
      station,
    )
    .run();

  await enregistre(env.DB, {
    action: 'cash.opened',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'cash_session',
    entityId: Number(r.meta.last_row_id),
    metadata: { station_id: station, fond },
  });

  return await courante(
    new Request(`https://x/?station_id=${station}`), env, utilisateur,
  );
}

/**
 * POST /api/cash/close
 * ==================================================================
 * LE MOMENT OÙ L'ÉCART APPARAÎT.
 *
 * Le caissier compte le tiroir et saisit ce qu'il y trouve. Le
 * logiciel calcule l'écart et l'enregistre — en positif comme en
 * négatif. Il n'existe aucun moyen de le mettre à zéro : c'est le
 * refus n° 7.
 */
export async function ferme(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('cash.close')) {
    return interdit();
  }

  let corps: { station_id?: unknown; counted_amount?: unknown; closing_notes?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const station = resoudStation(request, corps.station_id, utilisateur);
  const compte = typeof corps.counted_amount === 'number' ? corps.counted_amount : Number.NaN;

  if (!Number.isInteger(compte) || compte < 0) {
    return erreur('Vérifiez les champs.', {
      counted_amount: 'Saisissez ce que contient réellement le tiroir, en francs entiers.',
    }, 422);
  }

  const base = baseDe(utilisateur, env.DB);

  const session = await base
    .select(
      `SELECT s.id, s.station_id, s.opening_float, ${ESPERE}
         FROM cash_sessions s
        WHERE s.{ORG} AND s.station_id = ? AND s.status = 'OPEN' LIMIT 1`,
      station,
    )
    .first<{ id: number; station_id: number; opening_float: number; expected_amount: number }>();

  if (session === null) {
    return erreur("Aucune caisse n'est ouverte sur cette station.", {}, 409);
  }

  // L'ÉCART. Négatif s'il manque de l'argent — et la base l'accepte,
  // parce que `difference` est la seule colonne signée du schéma.
  const ecart = compte - session.expected_amount;

  await base
    .select(
      `UPDATE cash_sessions
          SET status = 'CLOSED', counted_amount = ?, expected_amount = ?, difference = ?,
              closed_by_user_id = ?, closed_at = datetime('now'), closing_notes = ?,
              open_station_id = NULL
        WHERE {ORG} AND id = ?`,
      compte,
      session.expected_amount,
      ecart,
      utilisateur.id,
      typeof corps.closing_notes === 'string' && corps.closing_notes.trim() !== ''
        ? corps.closing_notes.trim() : null,
      session.id,
    )
    .run();

  await enregistre(env.DB, {
    action: 'cash.closed',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'cash_session',
    entityId: session.id,
    // L'écart est journalisé même quand il est nul : c'est la suite
    // des clôtures qui a du sens, pas seulement les mauvaises.
    metadata: { attendu: session.expected_amount, compte, ecart },
  });

  const fermee = await base
    .select(
      `SELECT id, station_id, status, opening_float, expected_amount, counted_amount,
              difference, opened_at, closed_at, opening_notes, closing_notes
         FROM cash_sessions WHERE {ORG} AND id = ?`,
      session.id,
    )
    .first<LigneSession>();

  return succes(
    { session: fermee === null ? null : presente(fermee) },
    ecart === 0
      ? 'Caisse fermée, le compte est juste.'
      : `Caisse fermée. Écart de ${ecart.toLocaleString('fr-FR')}.`,
  );
}

/** GET /api/cash/sessions — l'historique des vacations. */
export async function historique(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('cash.view')) {
    return interdit();
  }

  const station = stationDemandee(request, utilisateur);
  const filtre = station === null ? '' : ' AND s.station_id = ?';
  const parametres = station === null ? [] : [station];

  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `SELECT s.id, s.station_id, s.status, s.opening_float, s.expected_amount,
              s.counted_amount, s.difference, s.opened_at, s.closed_at,
              s.opening_notes, s.closing_notes
         FROM cash_sessions s
        WHERE s.{ORG}${filtre}
        ORDER BY s.opened_at DESC LIMIT 60`,
      ...parametres,
    )
    .all<LigneSession>();

  return succes({ sessions: lignes.results.map(presente) });
}

/**
 * La station concernée : celle demandée, sinon celle de la personne.
 *
 * Portée de `resolveStation()` en PHP. Au comptoir on travaille sur sa
 * station ; le paramètre n'existe que pour un responsable qui suit
 * plusieurs sites.
 */
function resoudStation(
  request: Request,
  depuisLeCorps: unknown,
  utilisateur: Utilisateur,
): number | null {
  if (typeof depuisLeCorps === 'number' && Number.isInteger(depuisLeCorps)) {
    return depuisLeCorps;
  }

  return stationDemandee(request, utilisateur);
}

function stationDemandee(request: Request, utilisateur: Utilisateur): number | null {
  const brut = new URL(request.url).searchParams.get('station_id');

  if (brut === null || brut === '') {
    // Par défaut, la première station de la personne : au comptoir on
    // ne travaille que sur la sienne.
    return utilisateur.stationIds[0] ?? null;
  }

  const n = Number.parseInt(brut, 10);

  return Number.isInteger(n) && n > 0 ? n : null;
}

function presente(s: LigneSession) {
  return {
    id: s.id,
    station_id: s.station_id,
    status: s.status,
    opening_float: s.opening_float,
    expected_amount: s.expected_amount ?? 0,
    counted_amount: s.counted_amount,
    difference: s.difference,
    opened_at: s.opened_at,
    closed_at: s.closed_at,
    opening_notes: s.opening_notes,
    closing_notes: s.closing_notes,
  };
}
