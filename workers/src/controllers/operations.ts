/**
 * Les opérations : le dossier d'un véhicule dans la station
 * ==================================================================
 * C'est le cœur du produit. Tout le reste — encaissements, fidélité,
 * statistiques — se rattache à un dossier.
 *
 * Les règles portées ici sont celles que l'aide en ligne documente
 * comme des REFUS. Elles sont vérifiées SUR LE SERVEUR, jamais
 * seulement par un bouton caché : l'application Angular masque déjà
 * ce qui est interdit, mais n'importe qui peut appeler l'API
 * directement.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { affiche } from '../core/plate';
import { enregistre } from '../core/audit';
import { erreur, interdit, introuvable, succes } from '../core/response';
import {
  ACTIFS, ALERTES, COLONNES, GARDES, HORODATAGES, LIBELLES, TRANSITIONS,
  existe, messageRefus, permet, type Etat,
} from '../core/etats';

interface LigneOperation {
  id: number;
  reference: string;
  status: Etat;
  priority: number;
  price: number;
  discount_amount: number;
  discount_reason: string | null;
  discount_source: 'LOYALTY' | 'SUBSCRIPTION' | null;
  currency_code: string;
  station_id: number;
  station_name: string;
  assigned_user_id: number | null;
  notes: string | null;
  created_at: string;
  status_changed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  released_at: string | null;
  vehicle_id: number;
  plate_number: string;
  brand: string;
  model: string;
  color: string | null;
  vehicle_type: string;
  customer_id: number;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone: string | null;
  service_id: number;
  service_name: string;
  duration_minutes: number;
  assigned_first_name: string | null;
  assigned_last_name: string | null;
  paid_amount: number;
  entry_inspections: number;
}

// TOUS LES CHAMPS DU MODÈLE `Operation`, ET PAS UN DE MOINS.
//
// Une première version n'en envoyait qu'une quinzaine. L'API
// répondait 200, la file d'attente affichait une carte — puis plus
// rien : le gabarit Angular lisait `operation.is_overdue`, absent, et
// le rendu s'arrêtait là. Les quatre colonnes suivantes restaient
// vides, sans la moindre erreur en console.
//
// Le contrat se lit dans le modèle du frontend. Le deviner coûte une
// demi-journée de recherche pour un champ oublié.
const CHAMPS = `
  o.id, o.reference, o.status, o.priority, o.price, o.discount_amount,
  o.discount_reason, o.discount_source, o.currency_code, o.notes,
  o.station_id, o.assigned_user_id, o.created_at, o.status_changed_at,
  o.started_at, o.completed_at, o.released_at,
  v.id AS vehicle_id, v.plate_number, v.brand, v.model, v.color, v.vehicle_type,
  c.id AS customer_id, c.first_name AS customer_first_name,
  c.last_name AS customer_last_name, c.phone AS customer_phone,
  s.id AS service_id, s.name AS service_name, s.duration_minutes,
  st.name AS station_name,
  a.first_name AS assigned_first_name, a.last_name AS assigned_last_name,
  (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
    WHERE p.operation_id = o.id AND p.status = 'PAID') AS paid_amount,
  (SELECT COUNT(*) FROM inspections i
    WHERE i.operation_id = o.id AND i.type = 'ENTRY') AS entry_inspections`;

const JOINTURES = `
  FROM operations o
  JOIN vehicles  v ON v.id = o.vehicle_id
  JOIN customers c ON c.id = o.customer_id
  JOIN services  s ON s.id = o.service_id
  JOIN stations  st ON st.id = o.station_id
  LEFT JOIN users a ON a.id = o.assigned_user_id`;

/**
 * GET /api/queue
 *
 * La file d'attente, regroupée en colonnes. C'est l'écran que
 * l'équipe garde ouvert toute la journée.
 */
export async function file(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('operations.view')) {
    return interdit();
  }

  const station = stationDemandee(request);
  const filtre = station === null ? '' : ' AND o.station_id = ?';
  const parametres = station === null ? [] : [station];

  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `SELECT ${CHAMPS} ${JOINTURES}
        WHERE o.{ORG} AND o.status IN (${ACTIFS.map(() => '?').join(',')})${filtre}
        ORDER BY o.priority DESC, o.created_at ASC`,
      ...ACTIFS,
      ...parametres,
    )
    .all<LigneOperation>();

  const dossiers = lignes.results.map(presente);

  // LES NOMS DE CHAMPS SONT CEUX QUE L'APPLICATION LIT DÉJÀ.
  //
  // `drop_status` et non `drop`, `count` et `overdue` par colonne,
  // plus `metrics` et `generated_at`. Une première version avait
  // inventé une forme voisine : l'API répondait correctement, et
  // l'écran restait sur « Chargement… » avec quatre colonnes vides.
  // Le contrat se lit dans le modèle du frontend, il ne se devine
  // pas.
  const colonnes = COLONNES.map((c) => {
    const dedans = dossiers.filter((d) => (c.statuses as readonly string[]).includes(d.status));

    return {
      label: c.label,
      drop_status: c.drop,
      statuses: [...c.statuses],
      count: dedans.length,
      overdue: dedans.filter((d) => d.is_overdue).length,
      operations: dedans,
    };
  });

  const attentes = dossiers
    .filter((d) => d.status === 'WAITING')
    .map((d) => d.minutes_in_status);

  return succes({
    columns: colonnes,
    metrics: {
      waiting: dossiers.filter((d) => d.status === 'WAITING').length,
      in_progress: dossiers.filter(
        (d) => d.status === 'IN_PROGRESS' || d.status === 'INSPECTION' || d.status === 'WASHING',
      ).length,
      ready: dossiers.filter((d) => d.status === 'READY').length,
      overdue: dossiers.filter((d) => d.is_overdue).length,
      longest_wait_minutes: attentes.length === 0 ? null : Math.max(...attentes),
    },
    // L'heure du SERVEUR : le poste de l'accueil peut être à l'heure
    // de n'importe quoi, et deux écrans afficheraient des durées
    // différentes pour le même dossier.
    generated_at: new Date().toISOString(),
  });
}

/**
 * PUT /api/operations/{id}/status
 * ==================================================================
 * LE POINT LE PLUS SENSIBLE DU PRODUIT.
 *
 * Trois barrières, dans cet ordre :
 *   1. la transition est-elle permise par la machine à états ?
 *   2. la garde éventuelle est-elle satisfaite ?
 *   3. l'utilisateur a-t-il le droit de la franchir ?
 *
 * Chacune renvoie un message qui dit ce qu'il faut faire, pas
 * seulement que c'est refusé.
 */
export async function changeStatut(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  id: string,
): Promise<Response> {
  if (!utilisateur.peut('operations.update_status')) {
    return interdit();
  }

  let corps: { status?: unknown; reason?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const vers = typeof corps.status === 'string' ? corps.status : '';
  const base = baseDe(utilisateur, env.DB);

  const dossier = await base
    .select(
      `SELECT o.id, o.status, o.reference, o.vehicle_id, o.price, o.discount_amount
         FROM operations o WHERE o.{ORG} AND o.id = ? LIMIT 1`,
      Number.parseInt(id, 10),
    )
    .first<{ id: number; status: Etat; reference: string; vehicle_id: number; price: number; discount_amount: number }>();

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  // --- 1. La machine à états ---------------------------------------
  if (!existe(vers) || !permet(dossier.status, vers)) {
    return erreur(messageRefus(dossier.status, vers), {}, 409);
  }

  // --- 2. Les gardes ------------------------------------------------
  const garde = GARDES[`${dossier.status}:${vers}`];

  if (garde === 'entry_inspection_recorded') {
    const inspection = await base
      .select(
        `SELECT i.id FROM inspections i
          WHERE i.{ORG} AND i.operation_id = ? AND i.type = 'ENTRY' LIMIT 1`,
        dossier.id,
      )
      .first();

    if (inspection === null) {
      return erreur(
        "Ce véhicule n'a pas d'inspection d'entrée. On ne lave pas un "
        + "véhicule dont on n'a pas constaté l'état à l'arrivée : sans "
        + 'ce constat, une rayure découverte après coup est indéfendable.',
        {}, 409,
      );
    }
  }

  if (garde === 'payment_settled') {
    const du = dossier.price - dossier.discount_amount;
    const regle = await base
      .select(
        `SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p
          WHERE p.{ORG} AND p.operation_id = ? AND p.status = 'PAID'`,
        dossier.id,
      )
      .first<{ total: number }>();

    if ((regle?.total ?? 0) < du) {
      // La dérogation existe, et elle laisse une trace : c'est ce qui
      // la rend acceptable. Sans trace, ce serait un contournement.
      const derogation = typeof corps.reason === 'string' && corps.reason.trim() !== '';

      if (!derogation) {
        // 402 Payment Required : le code existe, c'est exactement ce
        // cas. Le PHP l'utilisait déjà, et le frontend s'en sert pour
        // proposer l'encaissement plutôt qu'une erreur générique.
        return erreur(
          `Ce véhicule n'est pas réglé : ${(regle?.total ?? 0).toLocaleString('fr-FR')} `
          + `sur ${du.toLocaleString('fr-FR')}. Encaissez le solde, ou `
          + 'un responsable peut lever le blocage en indiquant un motif.',
          { payment: 'Paiement incomplet.' }, 402,
        );
      }

      // La dérogation est un droit DISTINCT : un employé ne peut pas
      // s'autoriser lui-même à rendre un véhicule impayé.
      if (!utilisateur.peut('operations.override_payment')) {
        return interdit('Seul un responsable peut restituer un véhicule non réglé.');
      }

      await enregistre(env.DB, {
        action: 'operation.released_unpaid',
        organizationId: utilisateur.organizationId,
        userId: utilisateur.id,
        entityType: 'operation',
        entityId: dossier.id,
        metadata: { reference: dossier.reference, reste_du: du - (regle?.total ?? 0), motif: corps.reason },
      });
    }
  }

  // --- 3. L'écriture -------------------------------------------------
  const colonne = HORODATAGES[vers];
  const horodatage = colonne === undefined ? '' : `, ${colonne} = datetime('now')`;

  await base
    .select(
      `UPDATE operations SET status = ?, status_changed_at = datetime('now')${horodatage}
        WHERE {ORG} AND id = ?`,
      vers,
      dossier.id,
    )
    .run();

  await enregistre(env.DB, {
    action: 'operation.status_changed',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'operation',
    entityId: dossier.id,
    metadata: { de: dossier.status, vers },
  });

  const apres = await base
    .select(`SELECT ${CHAMPS} ${JOINTURES} WHERE o.{ORG} AND o.id = ?`, dossier.id)
    .first<LigneOperation>();

  return succes(apres === null ? null : presente(apres), `Dossier ${LIBELLES[vers]}.`);
}

function stationDemandee(request: Request): number | null {
  const brut = new URL(request.url).searchParams.get('station_id');

  if (brut === null || brut === '') {
    return null;
  }

  const n = Number.parseInt(brut, 10);

  return Number.isInteger(n) && n > 0 ? n : null;
}

/** La forme exacte que l'application Angular lit déjà. */
function presente(o: LigneOperation) {
  const depuis = o.status_changed_at ?? o.created_at;
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(depuis.replace(' ', 'T') + 'Z').getTime()) / 60_000),
  );

  // Le seuil du lavage est la durée annoncée de la prestation : c'est
  // la seule étape dont la durée normale dépend du service rendu.
  const seuil = ALERTES[o.status] ?? o.duration_minutes ?? null;
  const du = o.price - o.discount_amount;

  return {
    id: o.id,
    reference: o.reference,

    status: o.status,
    status_label: LIBELLES[o.status],
    // Envoyées par le SERVEUR : l'application n'a pas à recopier la
    // machine à états pour savoir quels boutons proposer.
    allowed_transitions: [...TRANSITIONS[o.status]],
    priority: o.priority,

    vehicle_id: o.vehicle_id,
    plate_number: o.plate_number,
    plate_display: affiche(o.plate_number),
    brand: o.brand,
    model: o.model,
    color: o.color,
    vehicle_type: o.vehicle_type,

    customer_id: o.customer_id,
    customer_name: `${o.customer_first_name} ${o.customer_last_name}`.trim(),
    customer_phone: o.customer_phone,

    service_id: o.service_id,
    service_name: o.service_name,
    duration_minutes: o.duration_minutes,

    station_id: o.station_id,
    station_name: o.station_name,

    assigned_user_id: o.assigned_user_id,
    assigned_name: o.assigned_first_name === null
      ? null
      : `${o.assigned_first_name} ${o.assigned_last_name ?? ''}`.trim(),

    price: o.price,
    discount_amount: o.discount_amount,
    discount_reason: o.discount_reason,
    discount_source: o.discount_source,
    amount_due: du,
    currency_code: o.currency_code,
    paid_amount: o.paid_amount,
    is_settled: o.paid_amount >= du,

    has_entry_inspection: o.entry_inspections > 0,

    status_changed_at: o.status_changed_at,
    minutes_in_status: minutes,
    alert_after_minutes: seuil,
    is_overdue: typeof seuil === 'number' && seuil > 0 && minutes > seuil,

    notes: o.notes,
    created_at: o.created_at,
    started_at: o.started_at,
    completed_at: o.completed_at,
    released_at: o.released_at,
  };
}
