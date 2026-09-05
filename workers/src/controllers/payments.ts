/**
 * Les encaissements
 * ==================================================================
 * Le second domaine où de l'argent réel est en jeu. Trois règles y
 * sont portées telles quelles, et chacune existe parce qu'elle
 * protège la caisse du soir.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { enregistre } from '../core/audit';
import { erreur, interdit, introuvable, succes } from '../core/response';

interface LignePaiement {
  id: number;
  amount: number;
  currency_code: string;
  method: string;
  status: string;
  provider: string | null;
  external_reference: string | null;
  operation_id: number | null;
  operation_reference: string | null;
  plate_number: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  station_id: number;
  station_name: string | null;
  cash_session_id: number | null;
  recorded_first_name: string | null;
  recorded_last_name: string | null;
  paid_at: string | null;
  notes: string | null;
}

const CHAMPS = `
  p.id, p.amount, p.currency_code, p.method, p.status, p.provider,
  p.external_reference, p.operation_id, p.station_id, p.cash_session_id,
  p.paid_at, p.notes,
  o.reference AS operation_reference,
  v.plate_number,
  c.first_name AS customer_first_name, c.last_name AS customer_last_name,
  st.name AS station_name,
  u.first_name AS recorded_first_name, u.last_name AS recorded_last_name`;

const JOINTURES = `
  FROM payments p
  LEFT JOIN operations o ON o.id = p.operation_id
  LEFT JOIN vehicles   v ON v.id = o.vehicle_id
  LEFT JOIN customers  c ON c.id = o.customer_id
  LEFT JOIN stations  st ON st.id = p.station_id
  LEFT JOIN users      u ON u.id = p.recorded_by_user_id`;

const MOYENS = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER'];

/**
 * POST /api/operations/{id}/payments
 * ==================================================================
 * LES TROIS RÈGLES, ET LEUR RAISON
 *
 * 1. Un montant est un ENTIER POSITIF de francs CFA. Le franc CFA n'a
 *    pas de centimes ; accepter « 5000,50 » créerait des arrondis dans
 *    une caisse qui doit tomber juste.
 *
 * 2. Un TROP-PERÇU est refusé. Ce n'est pas de la rigidité : c'est
 *    presque toujours une faute de frappe — 50 000 au lieu de 5 000 —
 *    et une fois enregistrée, elle fausse la caisse du soir sans que
 *    personne ne comprenne pourquoi.
 *
 * 3. Tout encaissement est rattaché à la SESSION DE CAISSE ouverte,
 *    quel que soit son moyen de paiement. Une session n'est pas un
 *    tiroir, c'est une vacation au comptoir : « ce matin nous avons
 *    fait 45 000 F, dont 18 000 en espèces » est la phrase que le
 *    caissier doit pouvoir dire.
 *
 *    L'absence de session ne BLOQUE pas l'encaissement — on ne refuse
 *    pas l'argent d'un client parce que personne n'a ouvert la caisse.
 *    Le rattachement reste simplement vide, et le tableau de bord le
 *    signale.
 */
export async function encaisse(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  operationId: string,
): Promise<Response> {
  if (!utilisateur.peut('payments.create')) {
    return interdit();
  }

  let corps: { amount?: unknown; method?: unknown; notes?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(operationId, 10);

  const dossier = await base
    .select(
      `SELECT o.id, o.station_id, o.price, o.discount_amount, o.currency_code, o.reference,
              (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                WHERE p.operation_id = o.id AND p.status = 'PAID') AS deja
         FROM operations o WHERE o.{ORG} AND o.id = ? LIMIT 1`,
      id,
    )
    .first<{
      id: number; station_id: number; price: number; discount_amount: number;
      currency_code: string; reference: string; deja: number;
    }>();

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  // Règle 1 : un entier positif, en francs entiers.
  const brut = corps.amount;
  const montant = typeof brut === 'number' ? brut : Number.NaN;

  if (!Number.isInteger(montant) || montant <= 0) {
    return erreur('Vérifiez les champs.', {
      amount: 'Le montant doit être un nombre entier de francs, supérieur à zéro.',
    }, 422);
  }

  const moyen = typeof corps.method === 'string' ? corps.method : 'CASH';

  if (!MOYENS.includes(moyen)) {
    return erreur('Vérifiez les champs.', { method: "Ce moyen de paiement n'existe pas." }, 422);
  }

  // Règle 2 : pas de trop-perçu.
  const du = dossier.price - dossier.discount_amount;

  if (dossier.deja + montant > du) {
    const reste = du - dossier.deja;

    return erreur('Vérifiez les champs.', {
      amount: reste <= 0
        ? 'Ce dossier est déjà entièrement réglé.'
        : `Il ne reste que ${reste.toLocaleString('fr-FR')} à encaisser sur ce dossier.`,
    }, 422);
  }

  // Règle 3 : rattachement à la session ouverte, sans la rendre
  // obligatoire.
  const session = await base
    .select(
      "SELECT id FROM cash_sessions WHERE {ORG} AND station_id = ? AND status = 'OPEN' LIMIT 1",
      dossier.station_id,
    )
    .first<{ id: number }>();

  await env.DB
    .prepare(
      `INSERT INTO payments (organization_id, station_id, operation_id, cash_session_id,
                             amount, currency_code, method, status, recorded_by_user_id,
                             paid_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID', ?, datetime('now'), ?)`,
    )
    .bind(
      utilisateur.organizationId, dossier.station_id, dossier.id,
      session?.id ?? null, montant, dossier.currency_code, moyen, utilisateur.id,
      typeof corps.notes === 'string' && corps.notes.trim() !== '' ? corps.notes.trim() : null,
    )
    .run();

  await enregistre(env.DB, {
    action: 'payment.recorded',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'operation',
    entityId: dossier.id,
    metadata: {
      reference: dossier.reference,
      montant,
      moyen,
      in_cash_session: session?.id ?? null,
    },
  });

  return await pourDossier(env, utilisateur, String(dossier.id), 'Encaissement enregistré.');
}

/** GET /api/operations/{id}/payments */
export async function pourDossier(
  env: Env,
  utilisateur: Utilisateur,
  operationId: string,
  message = '',
): Promise<Response> {
  if (!utilisateur.peut('payments.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(operationId, 10);

  const dossier = await base
    .select(
      `SELECT o.id, o.price, o.discount_amount,
              (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                WHERE p.operation_id = o.id AND p.status = 'PAID') AS deja
         FROM operations o WHERE o.{ORG} AND o.id = ? LIMIT 1`,
      id,
    )
    .first<{ id: number; price: number; discount_amount: number; deja: number }>();

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  const lignes = await base
    .select(
      `SELECT ${CHAMPS} ${JOINTURES}
        WHERE p.{ORG} AND p.operation_id = ?
        ORDER BY p.paid_at DESC, p.id DESC`,
      dossier.id,
    )
    .all<LignePaiement>();

  const du = dossier.price - dossier.discount_amount;

  return succes({
    payments: lignes.results.map(presente),
    amount_due: du,
    paid_amount: dossier.deja,
    remaining: Math.max(0, du - dossier.deja),
    is_settled: dossier.deja >= du,
  }, message);
}

/**
 * POST /api/payments/{id}/refund
 * ==================================================================
 * ON NE CORRIGE PAS UN ENCAISSEMENT : ON LE REMBOURSE.
 *
 * C'est le refus n° 6 de l'aide en ligne. Modifier le montant d'une
 * ligne déjà enregistrée effacerait la trace de l'erreur — et une
 * caisse dont on peut réécrire l'histoire ne prouve plus rien.
 *
 * Le remboursement écrit donc DEUX lignes : l'originale passe en
 * REFUNDED, et une seconde ligne enregistre la sortie. Les deux
 * portent le même montant, et aucune ne compte plus dans le total,
 * qui ne somme que les lignes PAID.
 *
 * La sortie est rattachée à la session ouverte MAINTENANT, pas à
 * celle de l'encaissement d'origine : l'argent sort du tiroir
 * d'aujourd'hui.
 */
export async function rembourse(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  paymentId: string,
): Promise<Response> {
  if (!utilisateur.peut('payments.refund')) {
    return interdit('Rendre de l\'argent n\'est pas un geste d\'accueil.');
  }

  let corps: { reason?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    corps = {};
  }

  const motif = typeof corps.reason === 'string' ? corps.reason.trim() : '';

  if (motif === '') {
    return erreur('Vérifiez les champs.', {
      reason: 'Un remboursement doit être motivé : il sera relu.',
    }, 422);
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(paymentId, 10);

  const paiement = await base
    .select(
      `SELECT id, amount, currency_code, method, status, station_id, operation_id
         FROM payments WHERE {ORG} AND id = ? LIMIT 1`,
      id,
    )
    .first<{
      id: number; amount: number; currency_code: string; method: string;
      status: string; station_id: number; operation_id: number | null;
    }>();

  if (paiement === null) {
    return introuvable("Cet encaissement n'existe pas.");
  }

  if (paiement.status !== 'PAID') {
    return erreur(
      'Seul un encaissement encore valide peut être remboursé. '
      + `Celui-ci est déjà « ${paiement.status} ».`,
      {}, 409,
    );
  }

  const session = await base
    .select(
      "SELECT id FROM cash_sessions WHERE {ORG} AND station_id = ? AND status = 'OPEN' LIMIT 1",
      paiement.station_id,
    )
    .first<{ id: number }>();

  // Les deux écritures forment un tout : `batch()` garantit qu'on
  // n'aura jamais l'une sans l'autre.
  await env.DB.batch([
    env.DB.prepare("UPDATE payments SET status = 'REFUNDED' WHERE id = ? AND organization_id = ?")
      .bind(paiement.id, utilisateur.organizationId),
    env.DB.prepare(
      `INSERT INTO payments (organization_id, station_id, operation_id, cash_session_id,
                             amount, currency_code, method, status, recorded_by_user_id,
                             paid_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'REFUNDED', ?, datetime('now'), ?)`,
    ).bind(
      utilisateur.organizationId, paiement.station_id, paiement.operation_id,
      session?.id ?? null, paiement.amount, paiement.currency_code, paiement.method,
      utilisateur.id, `Remboursement de l'encaissement #${paiement.id} — ${motif}`,
    ),
  ]);

  await enregistre(env.DB, {
    action: 'payment.refunded',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'payment',
    entityId: paiement.id,
    metadata: { montant: paiement.amount, motif },
  });

  return succes(null, 'Remboursement enregistré.');
}

/** GET /api/payments — le journal de la recette. */
export async function journal(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  // `payments.journal` et non `payments.view` : un employé voit ce qui
  // a été réglé sur le dossier qu'il rend, pas la recette du jour.
  if (!utilisateur.peut('payments.journal')) {
    return interdit();
  }

  const url = new URL(request.url);
  const conditions: string[] = [];
  const parametres: unknown[] = [];

  const station = url.searchParams.get('station_id');

  if (station !== null && station !== '' && Number.isInteger(Number(station))) {
    conditions.push('p.station_id = ?');
    parametres.push(Number(station));
  }

  for (const [champ, colonne] of [['from', '>='], ['to', '<=']] as const) {
    const v = url.searchParams.get(champ);

    if (v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      // On compare sur la DATE, pas sur l'horodatage : `date(paid_at)`
      // sur la colonne empêcherait d'utiliser un index. On borne donc
      // l'intervalle.
      conditions.push(`p.paid_at ${colonne} ?`);
      parametres.push(colonne === '>=' ? `${v} 00:00:00` : `${v} 23:59:59`);
    }
  }

  const extra = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `SELECT ${CHAMPS} ${JOINTURES}
        WHERE p.{ORG}${extra}
        ORDER BY p.paid_at DESC, p.id DESC
        LIMIT 500`,
      ...parametres,
    )
    .all<LignePaiement>();

  // LE TOTAL EST UN AGRÉGAT, PAS UNE SOMME DES LIGNES AFFICHÉES.
  //
  // Le lot 20 avait trouvé ce défaut dans le PHP : le total sommait
  // les 500 lignes du journal, donc un total FAUX dès la 501e. On
  // agrège en base, sur toutes les lignes.
  const totaux = await baseDe(utilisateur, env.DB)
    .select(
      `SELECT COALESCE(SUM(p.amount), 0) AS total, COUNT(*) AS n
         FROM payments p WHERE p.{ORG} AND p.status = 'PAID'${extra}`,
      ...parametres,
    )
    .first<{ total: number; n: number }>();

  return succes({
    payments: lignes.results.map(presente),
    total_amount: totaux?.total ?? 0,
    count: totaux?.n ?? 0,
  });
}

function presente(p: LignePaiement) {
  const nom = [p.customer_first_name, p.customer_last_name].filter(Boolean).join(' ').trim();
  const encaisseur = [p.recorded_first_name, p.recorded_last_name].filter(Boolean).join(' ').trim();

  return {
    id: p.id,
    amount: p.amount,
    currency_code: p.currency_code,
    method: p.method,
    status: p.status,
    provider: p.provider,
    external_reference: p.external_reference,
    operation_id: p.operation_id,
    operation_reference: p.operation_reference,
    plate_number: p.plate_number,
    customer_name: nom === '' ? null : nom,
    station_id: p.station_id,
    station_name: p.station_name,
    cash_session_id: p.cash_session_id,
    recorded_by_name: encaisseur === '' ? null : encaisseur,
    paid_at: p.paid_at,
    notes: p.notes,
  };
}
