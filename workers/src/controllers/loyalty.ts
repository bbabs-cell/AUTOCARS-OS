/**
 * La fidélité
 * ==================================================================
 * UNE CARTE À TAMPONS, PAS UN PROGRAMME À POINTS.
 * ==================================================================
 *
 * « Après 10 lavages, 5 000 F offerts. » Le client compte lui-même,
 * et c'est tout l'intérêt : un programme à points lui demanderait de
 * croire une arithmétique qu'il ne peut pas vérifier.
 *
 * ------------------------------------------------------------------
 * TROIS RÈGLES QUI TIENNENT TOUT LE MODULE
 *
 * 1. UNE RÉCOMPENSE EST UNE REMISE, PAS UN ENCAISSEMENT.
 *    Un faux paiement « fidélité » aurait été plus simple à coder :
 *    le dossier devenait réglé et rien d'autre ne bougeait. Il aurait
 *    aussi fait compter un lavage offert dans la recette du jour —
 *    une somme que le tiroir ne contient pas.
 *
 *    Une remise diminue ce qui est DÛ. La recette reste vraie, la
 *    caisse reste juste, et le coût du programme devient un chiffre
 *    qu'un gérant peut lire.
 *
 * 2. LE GRAND LIVRE NE SE MODIFIE PAS.
 *    Une utilisation annulée n'est pas effacée : elle est compensée
 *    par une écriture inverse. Effacer ferait disparaître le fait
 *    qu'un employé a appliqué une remise, l'a retirée, et l'a
 *    peut-être remise ailleurs.
 *
 * 3. LES RÈGLES PEUVENT CHANGER, L'HISTOIRE NON.
 *    Chaque écriture emporte la valeur de la récompense au moment où
 *    elle a été faite. Passer de « 10 tampons, 5 000 F » à
 *    « 12 tampons, 6 000 F » ne réécrit rien.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import type { TenantDb } from '../core/db';
import { enregistre } from '../core/audit';
import { erreur, interdit, introuvable, succes } from '../core/response';
import { carte, programmeActif, programmeCourant, type Programme } from '../core/fidelite';
import { dossierComplet } from './operations';

/** Le format des montants dans les messages : « 5 000 ». */
const fcfa = (n: number) => n.toLocaleString('fr-FR').replace(/ | /g, ' ');

function presenteProgramme(p: Programme | null) {
  return p === null ? null : {
    id: p.id,
    name: p.name,
    stamps_required: p.stamps_required,
    reward_amount: p.reward_amount,
    min_operation_amount: p.min_operation_amount,
    status: p.status,
    is_active: p.status === 'ACTIVE',
  };
}

const LIBELLES: Record<string, string> = {
  EARN: 'Tampon gagné',
  REDEEM: 'Récompense utilisée',
  REVERSAL: 'Utilisation annulée',
};

/** Une date `AAAA-MM-JJ`, ou null si ce n'en est pas une. */
function lireDate(valeur: string | null): string | null {
  return valeur !== null && /^\d{4}-\d{2}-\d{2}$/.test(valeur) ? valeur : null;
}

/**
 * GET /api/loyalty?from=&to=
 *
 * L'écran du programme : les règles, le bilan, et surtout les clients
 * qui ont une récompense à prendre.
 */
export async function apercu(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('loyalty.view')) {
    return interdit();
  }

  const parametres = new URL(request.url).searchParams;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const depuis = lireDate(parametres.get('from')) ?? `${aujourdhui.slice(0, 7)}-01`;
  const jusqua = lireDate(parametres.get('to')) ?? aujourdhui;

  const base = baseDe(utilisateur, env.DB);
  const p = await programmeCourant(base);
  const requis = p === null ? 0 : Math.max(1, p.stamps_required);

  const totaux = await base
    .select(
      `SELECT type, COALESCE(SUM(ABS(points)), 0) AS total
         FROM loyalty_entries
        WHERE {ORG} AND created_at >= ? AND created_at <= ?
        GROUP BY type`,
      `${depuis} 00:00:00`, `${jusqua} 23:59:59`,
    )
    .all<{ type: string; total: number }>();

  const par = (t: string) => totaux.results.find((r) => r.type === t)?.total ?? 0;

  // LE COÛT RÉEL, lu sur les remises effectivement appliquées et non
  // sur la valeur annoncée des récompenses : une récompense de
  // 5 000 F sur un dossier à 3 000 F ne coûte que 3 000 F.
  //
  // `discount_source` compte autant que le montant : sans lui, le
  // coût du programme compterait aussi les lavages d'abonnés — et
  // annoncerait au gérant qu'il offre un argent qu'il a encaissé six
  // mois plus tôt.
  const cout = await base
    .select(
      `SELECT COALESCE(SUM(discount_amount), 0) AS n FROM operations
        WHERE {ORG} AND discount_amount > 0 AND discount_source = 'LOYALTY'
          AND discounted_at >= ? AND discounted_at <= ?`,
      `${depuis} 00:00:00`, `${jusqua} 23:59:59`,
    )
    .first<{ n: number }>();

  // CEUX QUI ONT AU MOINS UNE RÉCOMPENSE COMPLÈTE. Ils ont gagné
  // quelque chose et ne le savent peut-être pas : c'est la seule
  // liste de cet écran sur laquelle on agit.
  const prets = requis === 0 ? { results: [] } : await base
    .select(
      `SELECT e.customer_id, c.first_name, c.last_name, c.phone,
              SUM(e.points) AS balance
         FROM loyalty_entries e JOIN customers c ON c.id = e.customer_id
        WHERE e.{ORG} AND c.deleted_at IS NULL
        GROUP BY e.customer_id, c.first_name, c.last_name, c.phone
       HAVING balance >= ?
        ORDER BY balance DESC, c.first_name ASC
        LIMIT 100`,
      requis,
    )
    .all<{ customer_id: number; first_name: string; last_name: string; phone: string | null; balance: number }>();

  return succes({
    program: presenteProgramme(p),
    summary: {
      earned: par('EARN'),
      redeemed: par('REDEEM'),
      reversed: par('REVERSAL'),
      cost: cout?.n ?? 0,
    },
    ready: prets.results.map((r) => ({
      customer_id: r.customer_id,
      customer_name: `${r.first_name} ${r.last_name}`.trim(),
      phone: r.phone ?? '',
      balance: r.balance,
    })),
    period: { from: depuis, to: jusqua },
  });
}

/**
 * PUT /api/loyalty/program
 *
 * Créer ou modifier les règles. Droit `loyalty.manage`, réservé à
 * l'administrateur : un client qui collecte des tampons a une
 * promesse en cours, et la modifier n'est pas une décision
 * d'exploitation quotidienne.
 */
export async function reglage(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('loyalty.manage')) {
    return interdit();
  }

  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const entier = (cle: string, defaut: number) => {
    const v = corps[cle];

    if (v === undefined || v === null || v === '') {
      return defaut;
    }

    const n = typeof v === 'number' ? v : Number(v);

    return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
  };

  const nom = typeof corps.name === 'string' ? corps.name.trim() : '';

  if (nom.length > 120) {
    return erreur('Vérifiez les champs.', { name: 'Ce nom est trop long.' }, 422);
  }

  const requis = entier('stamps_required', 10);
  const recompense = entier('reward_amount', 0);
  const plancher = entier('min_operation_amount', 0);
  const statut = String(corps.status ?? 'INACTIVE').toUpperCase();

  // Des bornes larges, mais des bornes. Un programme à « 2 tampons »
  // n'est pas de la fidélité, c'est une remise permanente qui ne dit
  // pas son nom ; à 100 tampons, aucun client n'ira au bout et la
  // carte ne sert qu'à décevoir.
  if (!(requis >= 3 && requis <= 50)) {
    return erreur('Vérifiez les champs.', {
      stamps_required: "Entre 3 et 50 lavages. En dessous, ce n'est plus de la fidélité ; "
        + 'au-dessus, personne n\'ira au bout.',
    }, 422);
  }

  if (!(recompense > 0)) {
    return erreur('Vérifiez les champs.', {
      reward_amount: "Une récompense sans montant n'est pas une récompense.",
    }, 422);
  }

  if (!(plancher >= 0)) {
    return erreur('Vérifiez les champs.', {
      min_operation_amount: 'Le montant plancher ne peut pas être négatif.',
    }, 422);
  }

  if (statut !== 'ACTIVE' && statut !== 'INACTIVE') {
    return erreur('Vérifiez les champs.', { status: 'Statut inconnu.' }, 422);
  }

  const base = baseDe(utilisateur, env.DB);
  const existant = await programmeCourant(base);
  const valeurs = [
    nom === '' ? 'Carte de fidélité' : nom,
    requis, recompense, plancher, statut,
  ] as const;

  if (existant === null) {
    // `active_organization_id` n'est pas écrite : c'est une colonne
    // CALCULÉE, que la base déduit du statut. C'est elle qui garantit
    // un seul programme actif — deux rendraient le solde d'un client
    // indéterminé.
    await env.DB
      .prepare(
        `INSERT INTO loyalty_programs (organization_id, name, stamps_required, reward_amount,
                                       min_operation_amount, status, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(utilisateur.organizationId, ...valeurs, utilisateur.id)
      .run();
  } else {
    await base
      .select(
        `UPDATE loyalty_programs
            SET name = ?, stamps_required = ?, reward_amount = ?,
                min_operation_amount = ?, status = ?
          WHERE {ORG} AND id = ?`,
        ...valeurs, existant.id,
      )
      .run();
  }

  const apres = await programmeCourant(base);

  await enregistre(env.DB, {
    action: 'loyalty.program_updated',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'loyalty_program',
    entityId: apres?.id ?? null,
    // L'AVANT ET L'APRÈS : changer un seuil au milieu d'un programme
    // touche des clients qui collectent déjà.
    metadata: {
      from: existant === null ? null : {
        stamps_required: existant.stamps_required,
        reward_amount: existant.reward_amount,
        status: existant.status,
      },
      to: {
        stamps_required: requis, reward_amount: recompense, status: statut,
      },
    },
  });

  return succes(
    { program: presenteProgramme(apres) },
    statut === 'ACTIVE'
      ? 'Programme actif. Les prochains lavages payés donneront un tampon.'
      : 'Programme enregistré, mais INACTIF : aucun tampon ne sera distribué.',
  );
}

/**
 * GET /api/loyalty/customers/{id}
 * La carte d'un client, telle qu'on la lui montre au comptoir.
 */
export async function carteClient(
  env: Env,
  utilisateur: Utilisateur,
  clientId: string,
): Promise<Response> {
  if (!utilisateur.peut('loyalty.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(clientId, 10);

  const client = await base
    .select('SELECT id FROM customers WHERE {ORG} AND id = ? LIMIT 1', id)
    .first();

  if (client === null) {
    return introuvable("Ce client n'existe pas.");
  }

  const lignes = await base
    .select(
      `SELECT e.id, e.type, e.points, e.operation_id, e.note, e.created_at,
              o.reference AS operation_reference,
              u.first_name, u.last_name
         FROM loyalty_entries e
    LEFT JOIN operations o ON o.id = e.operation_id
    LEFT JOIN users      u ON u.id = e.created_by_user_id
        WHERE e.{ORG} AND e.customer_id = ?
        ORDER BY e.id DESC LIMIT 50`,
      id,
    )
    .all<{
      id: number; type: string; points: number; operation_id: number | null;
      note: string | null; created_at: string; operation_reference: string | null;
      first_name: string | null; last_name: string | null;
    }>();

  return succes({
    card: await carte(base, id),
    history: lignes.results.map((e) => ({
      id: e.id,
      type: e.type,
      label: LIBELLES[e.type] ?? e.type,
      points: e.points,
      operation_id: e.operation_id,
      operation_reference: e.operation_reference,
      note: e.note,
      created_by_name: e.first_name === null
        ? null
        : `${e.first_name} ${e.last_name ?? ''}`.trim(),
      created_at: e.created_at,
    })),
  });
}

interface LigneDossier {
  id: number;
  station_id: number;
  customer_id: number;
  status: string;
  price: number;
  discount_amount: number;
  reference: string;
  paid_amount: number;
}

const DOSSIER = `
  SELECT o.id, o.station_id, o.customer_id, o.status, o.price, o.discount_amount, o.reference,
         (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
           WHERE p.operation_id = o.id AND p.status = 'PAID') AS paid_amount
    FROM operations o WHERE o.{ORG} AND o.id = ? LIMIT 1`;

/**
 * Le REDEEM encore actif sur ce dossier — c'est-à-dire celui
 * qu'aucun REVERSAL n'a annulé.
 */
async function remiseActive(base: TenantDb, operationId: number) {
  return await base
    .select(
      `SELECT e.id, e.program_id, e.customer_id, e.points, e.reward_amount
         FROM loyalty_entries e
        WHERE e.{ORG} AND e.operation_id = ? AND e.type = 'REDEEM'
          AND NOT EXISTS (
              SELECT 1 FROM loyalty_entries r
               WHERE r.related_entry_id = e.id AND r.type = 'REVERSAL')
        ORDER BY e.id DESC LIMIT 1`,
      operationId,
    )
    .first<{ id: number; program_id: number; customer_id: number; points: number; reward_amount: number | null }>();
}

/**
 * POST /api/loyalty/redeem
 * ==================================================================
 * LE CLIENT UTILISE SA RÉCOMPENSE.
 * ==================================================================
 * Deux écritures, une seule transaction : l'écriture au grand livre
 * et la remise sur le dossier. L'une sans l'autre, et soit le client
 * perd ses tampons sans rien recevoir, soit il reçoit une remise sans
 * que personne ne puisse dire pourquoi.
 */
export async function utilise(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('loyalty.redeem')) {
    return interdit();
  }

  let corps: { operation_id?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  if (corps.operation_id === undefined || corps.operation_id === null || corps.operation_id === '') {
    return erreur('Vérifiez les champs.', { operation_id: 'Le dossier est obligatoire.' }, 422);
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number(corps.operation_id);
  const dossier = await base.select(DOSSIER, id).first<LigneDossier>();

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  if (!await utilisateur.voitStation(dossier.station_id)) {
    return interdit("Vous n'êtes pas rattaché à cette station.");
  }

  // UN DOSSIER TERMINÉ NE SE REMISE PLUS. La voiture est partie,
  // l'argent est encaissé : appliquer une remise après coup créerait
  // un solde négatif que personne ne saurait rendre.
  if (dossier.status === 'COMPLETED' || dossier.status === 'CANCELLED') {
    return erreur('Ce dossier est clos : la récompense ne peut plus y être appliquée.', {}, 409);
  }

  const p = await programmeActif(base);

  if (p === null) {
    return erreur("Aucun programme de fidélité n'est actif.", {}, 409);
  }

  if (await remiseActive(base, dossier.id) !== null) {
    return erreur('Une récompense est déjà appliquée à ce dossier.', {}, 409);
  }

  const c = await carte(base, dossier.customer_id, p);

  if (c.rewards_available < 1) {
    return erreur(
      `Ce client a ${c.balance} tampon(s) : il en faut ${c.stamps_required}.`,
      {}, 409,
    );
  }

  // ==============================================================
  // LA REMISE NE DÉPASSE JAMAIS LE MONTANT DU DOSSIER
  // ==============================================================
  // Sinon le dossier deviendrait négatif : la station devrait de
  // l'argent à un client parce qu'il est fidèle.
  //
  // Le surplus est PERDU, et c'est pour cela que le serveur prévient
  // plus bas : quelqu'un au comptoir doit pouvoir dire au client
  // « gardez-la pour un lavage plus cher ». Le logiciel ne refuse
  // pas — c'est au client de décider ce qu'il fait de ce qu'il a
  // gagné.
  const applique = Math.min(p.reward_amount, Math.max(0, dossier.price - dossier.discount_amount));

  if (applique === 0) {
    return erreur('Ce dossier est déjà entièrement remisé.', {}, 409);
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO loyalty_entries (organization_id, program_id, customer_id, type, points,
                                    operation_id, reward_amount, note, created_by_user_id)
       VALUES (?, ?, ?, 'REDEEM', ?, ?, ?, ?, ?)`,
    ).bind(
      utilisateur.organizationId, p.id, dossier.customer_id,
      -c.stamps_required, dossier.id, p.reward_amount,
      `Remise sur ${dossier.reference}`, utilisateur.id,
    ),
    env.DB.prepare(
      `UPDATE operations
          SET discount_amount = ?, discount_source = 'LOYALTY', discount_reason = ?,
              discount_by_user_id = ?, discounted_at = datetime('now')
        WHERE id = ? AND organization_id = ?`,
    ).bind(
      dossier.discount_amount + applique,
      `Fidélité — ${c.stamps_required} lavages (${p.name})`,
      utilisateur.id, dossier.id, utilisateur.organizationId,
    ),
  ]);

  await enregistre(env.DB, {
    action: 'loyalty.redeemed',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    stationId: dossier.station_id,
    entityType: 'operation',
    entityId: dossier.id,
    metadata: {
      customer_id: dossier.customer_id,
      stamps_used: c.stamps_required,
      reward_amount: p.reward_amount,
      // Ce qui a été RÉELLEMENT déduit, qui peut être inférieur à la
      // récompense.
      applied: applique,
    },
  });

  const avertissements: string[] = [];

  if (applique < p.reward_amount) {
    avertissements.push(
      `La récompense vaut ${fcfa(p.reward_amount)} FCFA mais le dossier n'en coûte que `
      + `${fcfa(applique)} : le reste est perdu.`,
    );
  }

  return succes(
    {
      operation: await dossierComplet(base, dossier.id),
      card: await carte(base, dossier.customer_id, p),
      warnings: avertissements,
    },
    `Récompense appliquée : ${fcfa(applique)} FCFA de remise.`,
  );
}

/**
 * POST /api/loyalty/redeem/{operationId}/cancel
 *
 * Une remise appliquée par erreur. Les tampons sont rendus par une
 * écriture INVERSE — jamais par une suppression : la manipulation
 * « j'applique, j'annule, je réapplique ailleurs » doit rester
 * lisible dans l'historique.
 */
export async function annule(
  env: Env,
  utilisateur: Utilisateur,
  operationId: string,
): Promise<Response> {
  if (!utilisateur.peut('loyalty.redeem')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(operationId, 10);
  const dossier = await base.select(DOSSIER, id).first<LigneDossier>();

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  if (!await utilisateur.voitStation(dossier.station_id)) {
    return interdit("Vous n'êtes pas rattaché à cette station.");
  }

  // Après restitution, l'annulation créerait un solde à réclamer à un
  // client déjà parti.
  if (dossier.status === 'COMPLETED') {
    return erreur(
      'Ce véhicule est déjà restitué : la remise ne peut plus être retirée.',
      {}, 409,
    );
  }

  const remise = await remiseActive(base, dossier.id);

  if (remise === null) {
    return erreur("Aucune récompense n'est appliquée à ce dossier.", {}, 409);
  }

  const tampons = Math.abs(remise.points);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO loyalty_entries (organization_id, program_id, customer_id, type, points,
                                    operation_id, related_entry_id, reward_amount, note,
                                    created_by_user_id)
       VALUES (?, ?, ?, 'REVERSAL', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      utilisateur.organizationId, remise.program_id, remise.customer_id,
      tampons, dossier.id, remise.id, remise.reward_amount,
      'Annulation de la remise', utilisateur.id,
    ),
    env.DB.prepare(
      `UPDATE operations
          SET discount_amount = 0, discount_source = NULL, discount_reason = NULL,
              discount_by_user_id = ?, discounted_at = datetime('now')
        WHERE id = ? AND organization_id = ?`,
    ).bind(utilisateur.id, dossier.id, utilisateur.organizationId),
  ]);

  await enregistre(env.DB, {
    action: 'loyalty.redeem_cancelled',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    stationId: dossier.station_id,
    entityType: 'operation',
    entityId: dossier.id,
    metadata: { entry_id: remise.id, stamps_returned: tampons },
  });

  const avertissements: string[] = [];

  // Le cas qui fait le plus mal au comptoir : le client a déjà payé
  // le montant remisé, et retirer la remise fait remonter ce qu'il
  // doit. Personne ne va le lui réclamer sur le parking sans le
  // savoir.
  if (dossier.paid_amount > 0 && dossier.paid_amount < dossier.price) {
    avertissements.push(
      `Ce dossier avait déjà été réglé à hauteur de ${fcfa(dossier.paid_amount)} FCFA : `
      + `il redevient dû de ${fcfa(Math.max(0, dossier.price - dossier.paid_amount))} FCFA.`,
    );
  }

  return succes(
    {
      operation: await dossierComplet(base, dossier.id),
      card: await carte(base, remise.customer_id),
      warnings: avertissements,
    },
    `Remise retirée. ${tampons} tampon(s) rendus au client.`,
  );
}
