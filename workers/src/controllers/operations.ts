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
import type { TenantDb } from '../core/db';
import { affiche, normalise } from '../core/plate';
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

  // --- 1. LA RESTITUTION NE PASSE PAS PAR ICI ----------------------
  //
  // Elle a sa propre route, avec sa procédure de vérification : la
  // référence et la PLAQUE sont ressaisies au comptoir. Autoriser un
  // simple changement de statut vers COMPLETED contournerait le seul
  // contrôle du produit qui porte sur le monde réel plutôt que sur la
  // base — celui qui oblige à regarder la voiture avant de rendre les
  // clés.
  //
  // La première version de ce portage l'avait manqué : elle vérifiait
  // le paiement, et laissait partir n'importe quel véhicule réglé
  // sans jamais comparer la plaque. Deux Toyota blanches le même
  // matin, ça arrive tous les jours.
  if (vers === 'COMPLETED') {
    return interdit(
      'La restitution suit une procédure de vérification : '
      + "utilisez l'écran de remise du véhicule.",
    );
  }

  // --- 2. La machine à états ---------------------------------------
  if (!existe(vers) || !permet(dossier.status, vers)) {
    return erreur(messageRefus(dossier.status, vers), {}, 409);
  }

  // --- 3. Les gardes ------------------------------------------------
  //
  // `payment_settled` n'est plus jamais atteinte ici : elle garde la
  // transition READY → COMPLETED, désormais réservée à la
  // restitution. Elle reste déclarée dans la machine à états, où
  // `restitue()` la lit.
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

  // --- 4. L'écriture -------------------------------------------------
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

  // `{ operation: … }` et non le dossier à la racine : c'est ce que
  // l'écran du dossier lit — `result.operation`. La première version
  // renvoyait l'objet nu, et la page remplaçait son dossier par
  // `undefined` après chaque changement d'étape.
  return succes(
    { operation: apres === null ? null : presente(apres) },
    `Dossier ${LIBELLES[vers]}.`,
  );
}

function stationDemandee(request: Request): number | null {
  const brut = new URL(request.url).searchParams.get('station_id');

  if (brut === null || brut === '') {
    return null;
  }

  const n = Number.parseInt(brut, 10);

  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * UN DOSSIER, DANS LA FORME EXACTE QUE L'APPLICATION LIT.
 *
 * Exportée parce que trois modules répondent avec un dossier complet
 * après l'avoir modifié — la fidélité, les abonnements, les
 * rendez-vous. Chacun refaisant sa propre requête, il manquerait un
 * champ quelque part : c'est précisément le défaut qui a coûté une
 * demi-journée sur la file d'attente.
 */
export async function dossierComplet(
  base: TenantDb,
  id: number,
): Promise<ReturnType<typeof presente> | null> {
  const ligne = await base
    .select(`SELECT ${CHAMPS} ${JOINTURES} WHERE o.{ORG} AND o.id = ? LIMIT 1`, id)
    .first<LigneOperation>();

  return ligne === null ? null : presente(ligne);
}

/**
 * Plusieurs dossiers, dans la même forme.
 *
 * `clause` complète le WHERE — « AND o.subscription_id = ? ». Elle
 * n'est jamais construite à partir d'une saisie : les valeurs passent
 * par les paramètres, comme partout ailleurs.
 */
export async function dossiersOu(
  base: TenantDb,
  clause: string,
  ...parametres: unknown[]
): Promise<ReturnType<typeof presente>[]> {
  const lignes = await base
    .select(
      `SELECT ${CHAMPS} ${JOINTURES} WHERE o.{ORG} ${clause} ORDER BY o.created_at DESC LIMIT 200`,
      ...parametres,
    )
    .all<LigneOperation>();

  return lignes.results.map(presente);
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

// ====================================================================
// LA LISTE, LA FICHE, L'ACCUEIL
// ====================================================================

/**
 * GET /api/operations/statuses
 *
 * La machine à états, envoyée au frontend : libellés, transitions
 * possibles, statuts actifs.
 *
 * POURQUOI L'ENVOYER AU CLIENT ?
 * Pour que l'interface n'affiche que les boutons utilisables, sans
 * recopier les règles en TypeScript. Une règle recopiée est une règle
 * qui divergera. C'est un CONFORT D'AFFICHAGE : le serveur revérifie
 * chaque transition, quoi qu'ait affiché l'écran.
 */
export function statuts(utilisateur: Utilisateur): Response {
  if (!utilisateur.peut('operations.view')) {
    return interdit();
  }

  return succes({
    statuses: (Object.keys(TRANSITIONS) as Etat[]).map((e) => ({
      value: e,
      label: LIBELLES[e],
      allowed_next: [...TRANSITIONS[e]],
      is_final: TRANSITIONS[e].length === 0,
      is_active: (ACTIFS as readonly string[]).includes(e),
    })),
  });
}

/** GET /api/operations?active=1&status=&station_id=&vehicle_id=&search= */
export async function liste(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('operations.view')) {
    return interdit();
  }

  const p = new URL(request.url).searchParams;
  const conditions: string[] = [];
  const parametres: unknown[] = [];

  const statut = p.get('status');

  if (statut !== null && statut !== '' && existe(statut)) {
    conditions.push('o.status = ?');
    parametres.push(statut);
  }

  // « Ce qui est en cours » : les statuts actifs, ceux qui occupent
  // réellement la station. C'est la vue par défaut du comptoir — un
  // dossier restitué la semaine dernière n'a rien à y faire.
  if (p.get('active') === '1') {
    conditions.push(`o.status IN (${ACTIFS.map(() => '?').join(',')})`);
    parametres.push(...ACTIFS);
  }

  for (const colonne of ['station_id', 'vehicle_id', 'customer_id', 'assigned_user_id']) {
    const v = p.get(colonne);
    const n = v === null ? Number.NaN : Number.parseInt(v, 10);

    if (Number.isInteger(n) && n > 0) {
      conditions.push(`o.${colonne} = ?`);
      parametres.push(n);
    }
  }

  const recherche = (p.get('search') ?? '').trim();

  if (recherche !== '') {
    // La plaque se cherche NORMALISÉE : elle est stockée sans espace
    // ni tiret, et un client qui tape « DK 9087 DE » doit trouver son
    // véhicule.
    conditions.push(
      '(o.reference LIKE ? OR v.plate_number LIKE ? OR c.last_name LIKE ? OR c.first_name LIKE ?)',
    );
    parametres.push(
      `${recherche}%`,
      `${recherche.replace(/[\s-]/g, '').toUpperCase()}%`,
      `${recherche}%`,
      `${recherche}%`,
    );
  }

  const suite = conditions.length === 0 ? '' : ` AND ${conditions.join(' AND ')}`;
  const base = baseDe(utilisateur, env.DB);

  const lignes = await base
    .select(
      `SELECT ${CHAMPS} ${JOINTURES} WHERE o.{ORG}${suite}
        ORDER BY o.priority DESC, o.created_at ASC LIMIT 100`,
      ...parametres,
    )
    .all<LigneOperation>();

  const station = stationDemandee(request);

  const comptes = await base
    .select(
      `SELECT status, COUNT(*) AS total FROM operations
        WHERE {ORG}${station === null ? '' : ' AND station_id = ?'}
        GROUP BY status`,
      ...(station === null ? [] : [station]),
    )
    .all<{ status: string; total: number }>();

  // TOUTES LES CLÉS SONT PRÉSENTES, même à zéro : sans cela le
  // frontend devrait tester l'existence de chaque colonne avant de
  // l'afficher.
  const counts: Record<string, number> = {};

  for (const e of Object.keys(TRANSITIONS)) {
    counts[e] = comptes.results.find((c) => c.status === e)?.total ?? 0;
  }

  return succes({ operations: lignes.results.map(presente), counts });
}

/** GET /api/operations/{id} */
export async function fiche(
  env: Env,
  utilisateur: Utilisateur,
  operationId: string,
): Promise<Response> {
  if (!utilisateur.peut('operations.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(operationId, 10);
  const dossier = await dossierComplet(base, id);

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  const inspections = await base
    .select(
      `SELECT i.id, i.type, i.performed_at, i.has_damage,
              u.first_name, u.last_name
         FROM inspections i LEFT JOIN users u ON u.id = i.performed_by_user_id
        WHERE i.{ORG} AND i.operation_id = ?
        ORDER BY i.id ASC`,
      id,
    )
    .all<{
      id: number; type: string; performed_at: string; has_damage: number;
      first_name: string | null; last_name: string | null;
    }>();

  return succes({
    operation: dossier,
    inspections: inspections.results.map((i) => ({
      id: i.id,
      type: i.type,
      performed_by_name: `${i.first_name ?? ''} ${i.last_name ?? ''}`.trim(),
      performed_at: i.performed_at,
      has_damage: i.has_damage === 1,
    })),
  });
}

/**
 * La référence remise au client : « DKP-2609-0042 ».
 *
 * TROIS PARTIES, CHACUNE UTILE :
 *   DKP   code de la station — on sait d'où vient le véhicule
 *   2609  année et mois     — on situe le dossier sans requête
 *   0042  numéro du mois    — court, dictable au téléphone
 *
 * POURQUOI PAS SIMPLEMENT L'IDENTIFIANT DE LA BASE ?
 * Parce qu'il révèle le volume d'activité : un concurrent qui dépose
 * une voiture le lundi et une autre le vendredi lit exactement
 * combien de dossiers ont été créés entre les deux.
 *
 * Le tri alphabétique donne bien le plus grand numéro parce que le
 * suffixe est rempli de zéros à gauche : « 0009 » précède « 0010 ».
 * Sans ce remplissage, « 9 » passerait après « 10 » et le compteur
 * reculerait.
 */
async function prochaineReference(base: TenantDb, codeStation: string): Promise<string> {
  const mois = new Date().toISOString().slice(2, 7).replace('-', '');
  const prefixe = `${codeStation.toUpperCase()}-${mois}-`;

  const derniere = await base
    .select(
      `SELECT reference FROM operations WHERE {ORG} AND reference LIKE ?
        ORDER BY reference DESC LIMIT 1`,
      `${prefixe}%`,
    )
    .first<{ reference: string }>();

  const numero = derniere === null ? 0 : Number.parseInt(derniere.reference.slice(-4), 10);

  return prefixe + String(numero + 1).padStart(4, '0');
}

/**
 * POST /api/operations
 * L'accueil d'un véhicule au comptoir.
 */
export async function accueille(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('operations.create')) {
    return interdit();
  }

  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const nombre = (cle: string) => {
    const v = corps[cle];
    const n = typeof v === 'number' ? v : Number(v);

    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const vehiculeId = nombre('vehicle_id');
  const serviceId = nombre('service_id');
  const stationId = nombre('station_id');
  const manquants: Record<string, string> = {};

  if (vehiculeId === null) manquants.vehicle_id = 'Le véhicule est obligatoire.';
  if (serviceId === null) manquants.service_id = 'La prestation est obligatoire.';
  if (stationId === null) manquants.station_id = 'La station est obligatoire.';

  if (Object.keys(manquants).length > 0) {
    return erreur('Vérifiez les champs.', manquants, 422);
  }

  const base = baseDe(utilisateur, env.DB);

  const vehicule = await base
    .select(
      'SELECT id, customer_id, plate_number FROM vehicles WHERE {ORG} AND id = ? LIMIT 1',
      vehiculeId,
    )
    .first<{ id: number; customer_id: number; plate_number: string }>();

  if (vehicule === null) {
    return erreur('Vérifiez les champs.', { vehicle_id: "Ce véhicule n'existe pas." }, 422);
  }

  const service = await base
    .select(
      'SELECT id, price, status FROM services WHERE {ORG} AND id = ? LIMIT 1',
      serviceId,
    )
    .first<{ id: number; price: number; status: string }>();

  if (service === null) {
    return erreur('Vérifiez les champs.', { service_id: "Cette prestation n'existe pas." }, 422);
  }

  if (service.status !== 'ACTIVE') {
    return erreur('Vérifiez les champs.', {
      service_id: "Cette prestation n'est plus proposée. Choisissez-en une autre.",
    }, 422);
  }

  const station = await base
    .select(
      'SELECT id, code, status FROM stations WHERE {ORG} AND id = ? LIMIT 1',
      stationId,
    )
    .first<{ id: number; code: string; status: string }>();

  if (station === null) {
    return erreur('Vérifiez les champs.', { station_id: "Cette station n'existe pas." }, 422);
  }

  // Un responsable d'une station ne crée pas de dossier dans une
  // autre : le cloisonnement par organisation ne suffit pas ici, la
  // séparation se joue À L'INTÉRIEUR d'une même entreprise.
  if (!await utilisateur.voitStation(station.id)) {
    return interdit("Vous n'êtes pas rattaché à cette station.");
  }

  // UNE STATION FERMÉE N'ACCUEILLE PLUS DE VÉHICULE. Sans ce refus,
  // « fermer une station » ne serait qu'une étiquette : le travail
  // continuerait d'y être enregistré, et le gérant découvrirait des
  // dossiers ouverts sur un site qu'il croyait clos. Le passé de la
  // station reste consultable — c'est l'avenir qu'on ferme.
  if (station.status !== 'ACTIVE') {
    return erreur('Vérifiez les champs.', {
      station_id: 'Cette station est fermée. Choisissez-en une autre.',
    }, 422);
  }

  // DEUX DOSSIERS OUVERTS SUR UN MÊME VÉHICULE, c'est deux inspections
  // contradictoires et un litige garanti sur « laquelle des deux fait
  // foi ».
  const ouvert = await base
    .select(
      `SELECT reference FROM operations
        WHERE {ORG} AND vehicle_id = ? AND status IN (${ACTIFS.map(() => '?').join(',')})
        LIMIT 1`,
      vehiculeId, ...ACTIFS,
    )
    .first<{ reference: string }>();

  if (ouvert !== null) {
    return erreur(
      `Ce véhicule a déjà un dossier en cours (${ouvert.reference}). `
      + "Ouvrez-le plutôt que d'en créer un second.",
      { vehicle_id: `Dossier déjà ouvert : ${ouvert.reference}` },
      409,
    );
  }

  // La priorité est bornée : au-delà de quelques niveaux, plus
  // personne ne sait ce que « priorité 47 » veut dire.
  const brute = Number(corps.priority);
  const priorite = Number.isFinite(brute) ? Math.max(0, Math.min(Math.trunc(brute), 3)) : 0;

  const notes = typeof corps.notes === 'string' && corps.notes.trim() !== ''
    ? corps.notes.trim().slice(0, 1000) : null;

  // Si deux postes créent un dossier dans la même seconde, l'un des
  // deux se voit refuser par la contrainte d'unicité : on relit le
  // compteur et on réessaie. Trois tentatives suffisent largement —
  // au-delà, ce n'est plus une collision mais un vrai problème, et
  // mieux vaut une erreur visible qu'une boucle infinie.
  let id = 0;
  let reference = '';

  for (let essai = 1; essai <= 3; essai += 1) {
    reference = await prochaineReference(base, station.code);

    try {
      const r = await env.DB
        .prepare(
          `INSERT INTO operations (organization_id, station_id, vehicle_id, customer_id,
                                   service_id, reference, status, status_changed_at,
                                   price, priority, notes, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, ?, 'WAITING', datetime('now'), ?, ?, ?, ?)`,
        )
        .bind(
          utilisateur.organizationId, station.id, vehicule.id,
          // Le client N'EST PAS lu dans la requête : il est déduit du
          // véhicule. Un formulaire modifié ne peut donc pas rattacher
          // un dossier au client de quelqu'un d'autre.
          vehicule.customer_id,
          service.id, reference,
          // PRIX FIGÉ, recopié du catalogue au moment de l'accueil. Si
          // le tarif change le mois prochain, ce dossier continue
          // d'afficher ce qui a réellement été annoncé au client.
          service.price,
          priorite, notes, utilisateur.id,
        )
        .run();

      id = Number(r.meta.last_row_id);
      break;
    } catch (e) {
      if (!/UNIQUE|constraint/i.test(String(e)) || essai === 3) {
        throw e;
      }
    }
  }

  await enregistre(env.DB, {
    action: 'operation.created',
    organizationId: utilisateur.organizationId,
    stationId: station.id,
    userId: utilisateur.id,
    entityType: 'operation',
    entityId: id,
    metadata: { reference, plate: vehicule.plate_number, price: service.price },
  });

  return succes(
    { operation: await dossierComplet(base, id) },
    `Dossier ${reference} ouvert.`,
    201,
  );
}

// ====================================================================
// LA PRIORITÉ ET L'AFFECTATION
// ====================================================================

/** PUT /api/operations/{id}/priority */
export async function priorite(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  operationId: string,
): Promise<Response> {
  if (!utilisateur.peut('operations.prioritize')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(operationId, 10);

  const dossier = await base
    .select(
      'SELECT id, status, priority, reference, station_id FROM operations WHERE {ORG} AND id = ? LIMIT 1',
      id,
    )
    .first<{ id: number; status: Etat; priority: number; reference: string; station_id: number }>();

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  let corps: { priority?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const brute = Number(corps.priority);

  if (!Number.isFinite(brute)) {
    return erreur('Vérifiez les champs.', {
      priority: 'La priorité doit être un nombre.',
    }, 422);
  }

  // TROIS NIVEAUX, PAS TRENTE. Au-delà, plus personne ne sait ce que
  // « priorité 47 » veut dire, et le classement redevient arbitraire —
  // donc inutile.
  const niveau = Math.max(0, Math.min(Math.trunc(brute), 3));

  await base
    .select('UPDATE operations SET priority = ? WHERE {ORG} AND id = ?', niveau, id)
    .run();

  // Faire passer quelqu'un devant est une décision qui se discute
  // après coup — « pourquoi ma voiture est passée après celle-là ? ».
  // On la trace.
  await enregistre(env.DB, {
    action: 'operation.prioritized',
    organizationId: utilisateur.organizationId,
    stationId: dossier.station_id,
    userId: utilisateur.id,
    entityType: 'operation',
    entityId: id,
    metadata: { reference: dossier.reference, from: dossier.priority, to: niveau },
  });

  return succes(
    { operation: await dossierComplet(base, id) },
    niveau > 0 ? 'Ce véhicule passe devant.' : 'Priorité normale rétablie.',
  );
}

/**
 * PUT /api/operations/{id}/assign
 *
 * Confier un dossier à quelqu'un.
 *
 * Un employé n'a pas besoin de cette route pour prendre un véhicule
 * en charge : passer le dossier à IN_PROGRESS l'inscrit
 * automatiquement dessus. Celle-ci sert à désigner QUELQU'UN
 * D'AUTRE — c'est de la répartition de travail, donc du ressort du
 * responsable.
 */
export async function affecte(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  operationId: string,
): Promise<Response> {
  if (!utilisateur.peut('operations.assign')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(operationId, 10);

  const dossier = await base
    .select(
      'SELECT id, status, reference, station_id FROM operations WHERE {ORG} AND id = ? LIMIT 1',
      id,
    )
    .first<{ id: number; status: Etat; reference: string; station_id: number }>();

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  if (TRANSITIONS[dossier.status].length === 0) {
    return erreur("Ce dossier est clos : il n'y a plus rien à confier.", {}, 409);
  }

  let corps: { assigned_user_id?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const brut = corps.assigned_user_id;

  // Une valeur vide RETIRE l'affectation : remettre un dossier dans le
  // pot commun doit être aussi simple que l'attribuer.
  if (brut === null || brut === undefined || brut === '' || brut === 0) {
    await base
      .select('UPDATE operations SET assigned_user_id = NULL WHERE {ORG} AND id = ?', id)
      .run();

    return succes(
      { operation: await dossierComplet(base, id) },
      'Dossier remis dans la file commune.',
    );
  }

  const userId = Number(brut);

  // L'employé doit appartenir à la MÊME entreprise. Le cloisonnement
  // filtre déjà, mais c'est ici que la cohérence métier se vérifie :
  // sans ce contrôle, une requête fabriquée pourrait confier un
  // véhicule à l'employé d'un concurrent.
  const membre = await base
    .select(
      `SELECT u.id, u.status FROM users u
        WHERE u.{ORG} AND u.id = ? AND u.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM station_users su WHERE su.user_id = u.id)
        LIMIT 1`,
      userId,
    )
    .first<{ id: number; status: string }>();

  if (membre === null) {
    return erreur('Vérifiez les champs.', {
      assigned_user_id: 'Cette personne ne fait pas partie de votre équipe.',
    }, 422);
  }

  if (membre.status !== 'ACTIVE') {
    return erreur('Vérifiez les champs.', {
      assigned_user_id: "Ce compte n'est plus actif.",
    }, 422);
  }

  await base
    .select('UPDATE operations SET assigned_user_id = ? WHERE {ORG} AND id = ?', userId, id)
    .run();

  await enregistre(env.DB, {
    action: 'operation.assigned',
    organizationId: utilisateur.organizationId,
    stationId: dossier.station_id,
    userId: utilisateur.id,
    entityType: 'operation',
    entityId: id,
    metadata: { reference: dossier.reference, assigned_to: userId },
  });

  return succes({ operation: await dossierComplet(base, id) }, 'Dossier confié.');
}

// ====================================================================
// LA RESTITUTION
// ====================================================================

/**
 * La liste de vérification avant la remise du véhicule.
 *
 * Elle est calculée ici et non à l'écran : les libellés et les
 * montants mis en forme sont des textes d'explication, pas des
 * données à recalculer. Le frontend n'a qu'à les afficher.
 */
function listeVerification(
  o: ReturnType<typeof presente>,
  inspectionSortie: boolean,
) {
  const du = o.price - o.discount_amount;
  const fcfa = (n: number) => n.toLocaleString('fr-FR').replace(/ | /g, ' ');

  return [
    {
      key: 'status',
      label: 'Le dossier est prêt à être restitué',
      passed: o.status === 'READY',
      blocking: true,
      detail: LIBELLES[o.status],
    },
    {
      key: 'identity',
      label: 'Référence et plaque à confirmer au comptoir',
      // Se vérifie à la SAISIE, pas avant : c'est tout l'objet de
      // cette ligne, et la seule qui ne puisse jamais être cochée
      // d'avance.
      passed: false,
      blocking: true,
      detail: o.plate_display,
    },
    {
      key: 'payment',
      label: 'La prestation est réglée',
      passed: o.paid_amount >= du,
      blocking: true,
      detail: o.paid_amount >= du
        ? `${fcfa(du)} FCFA encaissés`
        : `Reste ${fcfa(du - o.paid_amount)} FCFA sur ${fcfa(du)} FCFA`,
    },
    {
      key: 'exit_inspection',
      // NON BLOQUANTE : le contrôle qualité a déjà eu lieu, et bloquer
      // une remise sur une seconde inspection ferait attendre un
      // client dont la voiture est prête.
      label: 'Inspection de sortie enregistrée',
      passed: inspectionSortie,
      blocking: false,
      detail: inspectionSortie ? 'Enregistrée' : 'Recommandée en cas de doute',
    },
  ];
}

/** A-t-on enregistré l'inspection de sortie de ce dossier ? */
async function aInspectionSortie(base: TenantDb, id: number): Promise<boolean> {
  const i = await base
    .select(
      "SELECT id FROM inspections WHERE {ORG} AND operation_id = ? AND type = 'EXIT' LIMIT 1",
      id,
    )
    .first();

  return i !== null;
}

/**
 * GET /api/operations/{id}/release-check
 *
 * L'état de la liste de vérification AVANT la remise. L'écran de
 * restitution l'affiche pour que l'employé sache ce qui bloque,
 * plutôt que de découvrir le refus après avoir ramené la voiture
 * devant le comptoir.
 */
export async function verificationRestitution(
  env: Env,
  utilisateur: Utilisateur,
  operationId: string,
): Promise<Response> {
  if (!utilisateur.peut('operations.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(operationId, 10);
  const dossier = await dossierComplet(base, id);

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  return succes({
    operation: dossier,
    checklist: listeVerification(dossier, await aInspectionSortie(base, id)),
  });
}

/**
 * POST /api/operations/{id}/release
 * ==================================================================
 * LA REMISE DU VÉHICULE AU CLIENT.
 * ==================================================================
 *
 * C'est le moment où la station se dessaisit du bien de quelqu'un
 * d'autre. Quatre vérifications, dans cet ordre :
 *
 *   1. Le dossier est bien PRÊT (contrôle qualité passé).
 *   2. La référence présentée correspond au dossier.
 *   3. La plaque saisie correspond au véhicule qu'on va sortir.
 *   4. La prestation est réglée — ou un responsable lève le blocage,
 *      nominativement et avec un motif.
 *
 * POURQUOI RESSAISIR LA PLAQUE ALORS QU'ELLE EST À L'ÉCRAN ?
 * Parce que c'est le seul contrôle qui porte sur le MONDE RÉEL et non
 * sur la base. Il oblige à regarder la voiture avant de remettre les
 * clés. Deux Toyota blanches le même matin, ça arrive tous les jours ;
 * rendre la mauvaise, une seule fois, suffit à perdre un client.
 */
export async function restitue(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  operationId: string,
): Promise<Response> {
  if (!utilisateur.peut('operations.release')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(operationId, 10);
  const dossier = await dossierComplet(base, id);

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  let corps: { reference?: unknown; plate_number?: unknown; override_reason?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const saisie = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const manquants: Record<string, string> = {};

  if (saisie(corps.reference) === '') manquants.reference = 'La référence est obligatoire.';
  if (saisie(corps.plate_number) === '') manquants.plate_number = 'La plaque est obligatoire.';

  if (Object.keys(manquants).length > 0) {
    return erreur('Vérifiez les champs.', manquants, 422);
  }

  // --- 1. Le dossier est-il prêt ? -----------------------------------
  if (dossier.status !== 'READY') {
    return erreur(messageRefus(dossier.status, 'COMPLETED'), {}, 409);
  }

  // --- 2. La référence présentée -------------------------------------
  const reference = saisie(corps.reference).replace(/\s+/g, '').toUpperCase();

  // Comparaison à TEMPS CONSTANT : la référence est ce qui autorise à
  // repartir avec un véhicule. Comparer caractère par caractère avec
  // un arrêt au premier écart laisse mesurer, par le temps de
  // réponse, à quel rang la devinette s'est trompée. Le coût est le
  // même, la porte est fermée.
  const identiques = (a: string, b: string): boolean => {
    if (a.length !== b.length) {
      return false;
    }

    let ecart = 0;

    for (let i = 0; i < a.length; i += 1) {
      ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return ecart === 0;
  };

  if (!identiques(dossier.reference, reference)) {
    return erreur('Vérifiez les champs.', {
      reference: 'Cette référence ne correspond pas à ce dossier.',
    }, 422);
  }

  // --- 3. La plaque du véhicule --------------------------------------
  if (normalise(saisie(corps.plate_number)) !== dossier.plate_number) {
    return erreur('Vérifiez les champs.', {
      plate_number: 'Cette plaque ne correspond pas au véhicule du dossier. '
        + 'Vérifiez avant de remettre les clés.',
    }, 422);
  }

  // --- 4. Le règlement -----------------------------------------------
  // `amount_due` et non `price` : une remise de fidélité ou un forfait
  // peuvent avoir diminué ce qui reste dû.
  const du = dossier.amount_due;
  const regle = dossier.paid_amount;
  const motif = saisie(corps.override_reason);
  let derogation = false;

  if (regle < du) {
    const fcfa = (n: number) => n.toLocaleString('fr-FR').replace(/ | /g, ' ');

    if (motif === '') {
      // 402 Payment Required : le code existe, c'est exactement ce
      // cas. Le frontend s'en sert pour proposer la dérogation plutôt
      // qu'une erreur générique.
      return erreur(
        `Cette prestation n'est pas réglée (${fcfa(regle)} réglés sur ${fcfa(du)}). `
        + 'Un responsable peut lever le blocage en indiquant un motif.',
        { payment: 'Paiement incomplet.' }, 402,
      );
    }

    // LA DÉROGATION EST UN DROIT DISTINCT : un employé ne peut pas
    // s'autoriser lui-même à rendre un véhicule impayé.
    if (!utilisateur.peut('operations.override_payment')) {
      return interdit('Seul un responsable peut restituer un véhicule non réglé.');
    }

    derogation = true;
  }

  await base
    .select(
      `UPDATE operations
          SET status = 'COMPLETED', status_changed_at = datetime('now'),
              released_at = datetime('now'), released_by_user_id = ?
        WHERE {ORG} AND id = ?`,
      utilisateur.id, id,
    )
    .run();

  // LA DÉROGATION EST TRACÉE NOMINATIVEMENT. C'est la raison d'être du
  // journal d'audit : trois mois plus tard, on doit pouvoir dire qui a
  // laissé partir ce véhicule sans paiement, et pourquoi.
  await enregistre(env.DB, {
    action: derogation ? 'operation.released_unpaid' : 'operation.released',
    organizationId: utilisateur.organizationId,
    stationId: dossier.station_id,
    userId: utilisateur.id,
    entityType: 'operation',
    entityId: id,
    metadata: {
      reference: dossier.reference,
      plate: dossier.plate_number,
      amount_due: du,
      amount_paid: regle,
      ...(derogation ? { override_reason: motif } : {}),
    },
  });

  return succes({ operation: await dossierComplet(base, id) }, 'Véhicule restitué.');
}
