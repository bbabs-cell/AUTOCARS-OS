/**
 * GET /api/vehicles
 * ==================================================================
 * Le second bout de la tranche verticale. Il a été choisi parce qu'il
 * traverse TOUT ce qui compte : le jeton, la relecture du rôle en
 * base, le contrôle de permission côté serveur, une jointure, une
 * recherche, et le cloisonnement multi-clients.
 *
 * Si cette route est juste, l'architecture tient.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import type { TenantDb } from '../core/db';
import { enregistre } from '../core/audit';
import { affiche, normalise, plausible } from '../core/plate';
import { erreur, interdit, introuvable, succes } from '../core/response';

interface LigneVehicule {
  id: number;
  plate_number: string;
  brand: string;
  model: string;
  color: string | null;
  vehicle_type: string;
  notes: string | null;
  customer_id: number;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone: string | null;
  operation_count: number;
  last_operation_at: string | null;
  created_at: string | null;
}

/**
 * Les mêmes champs partout.
 *
 * `operation_count`, `last_operation_at` et `created_at` sont déclarés
 * par le modèle `Vehicle` du frontend. Une première version les
 * omettait : la fiche d'un véhicule affichait « 0 passage » pour un
 * habitué de six mois.
 */
const CHAMPS = `
  v.id, v.plate_number, v.brand, v.model, v.color, v.vehicle_type,
  v.notes, v.customer_id, v.created_at,
  c.first_name AS customer_first_name,
  c.last_name  AS customer_last_name,
  c.phone      AS customer_phone,
  (SELECT COUNT(*) FROM operations o WHERE o.vehicle_id = v.id) AS operation_count,
  (SELECT MAX(o.created_at) FROM operations o WHERE o.vehicle_id = v.id) AS last_operation_at`;

const JOINTURES = `
  FROM vehicles v
  JOIN customers c ON c.id = v.customer_id`;

export async function liste(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  // LE DROIT SE VÉRIFIE ICI, SUR LE SERVEUR.
  //
  // L'application Angular cache déjà les entrées de menu interdites,
  // mais cacher un bouton n'est pas une sécurité : n'importe qui peut
  // appeler l'API directement. C'était une exigence du cahier des
  // charges, elle est reprise telle quelle.
  if (!utilisateur.peut('vehicles.view')) {
    return interdit();
  }

  const url = new URL(request.url);
  const recherche = (url.searchParams.get('search') ?? '').trim();
  const clientBrut = url.searchParams.get('customer_id');
  const clientId =
    clientBrut !== null && clientBrut !== '' ? Number.parseInt(clientBrut, 10) : null;

  const conditions: string[] = [];
  const parametres: unknown[] = [];

  if (recherche !== '') {
    // La plaque est comparée sous sa forme normalisée : « dk 1234 ab »
    // et « DK-1234-AB » doivent trouver le même véhicule.
    const motif = `%${recherche}%`;
    conditions.push(
      `(v.plate_number LIKE ? OR v.brand LIKE ? OR v.model LIKE ?
        OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?)`,
    );
    parametres.push(`%${normalise(recherche)}%`, motif, motif, motif, motif, motif);
  }

  if (clientId !== null && Number.isInteger(clientId)) {
    conditions.push('v.customer_id = ?');
    parametres.push(clientId);
  }

  const extra = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

  // `{ORG}` est remplacé par le filtre d'organisation, et le paramètre
  // correspondant est lié avant les nôtres. Sans ce marqueur, select()
  // refuse la requête.
  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `SELECT ${CHAMPS} ${JOINTURES}
        WHERE v.{ORG}${extra}
        ORDER BY v.created_at DESC
        LIMIT 200`,
      ...parametres,
    )
    .all<LigneVehicule>();

  return succes(lignes.results.map(presente));
}

/** La forme exacte que l'application Angular lit déjà. */
function presente(v: LigneVehicule) {
  return {
    id: v.id,
    plate_number: v.plate_number,
    plate_display: affiche(v.plate_number),
    brand: v.brand,
    model: v.model,
    color: v.color,
    vehicle_type: v.vehicle_type,
    notes: v.notes,
    customer_id: v.customer_id,
    customer_name: `${v.customer_first_name} ${v.customer_last_name}`.trim(),
    customer_phone: v.customer_phone,
    operation_count: v.operation_count,
    last_operation_at: v.last_operation_at,
    created_at: v.created_at,
  };
}

/**
 * GET /api/vehicles/{id}
 * La fiche d'un véhicule, et son historique de passages.
 */
export async function fiche(
  env: Env,
  utilisateur: Utilisateur,
  vehiculeId: string,
): Promise<Response> {
  if (!utilisateur.peut('vehicles.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(vehiculeId, 10);

  const v = await base
    .select(`SELECT ${CHAMPS} ${JOINTURES} WHERE v.{ORG} AND v.id = ? LIMIT 1`, id)
    .first<LigneVehicule>();

  if (v === null) {
    return introuvable("Ce véhicule n'existe pas.");
  }

  const passages = await base
    .select(
      `SELECT o.id, o.reference, o.status, o.price, o.created_at, o.released_at,
              s.name AS service_name,
              u.first_name, u.last_name
         FROM operations o
         JOIN services s ON s.id = o.service_id
    LEFT JOIN users    u ON u.id = o.assigned_user_id
        WHERE o.{ORG} AND o.vehicle_id = ?
        ORDER BY o.created_at DESC LIMIT 50`,
      id,
    )
    .all<{
      id: number; reference: string; status: string; price: number;
      created_at: string; released_at: string | null; service_name: string;
      first_name: string | null; last_name: string | null;
    }>();

  return succes({
    vehicle: presente(v),
    history: passages.results.map((o) => ({
      id: o.id,
      reference: o.reference,
      status: o.status,
      service_name: o.service_name,
      employee_name: o.first_name === null
        ? null
        : `${o.first_name} ${o.last_name ?? ''}`.trim(),
      price: o.price,
      created_at: o.created_at,
      released_at: o.released_at,
    })),
  });
}

interface Champs {
  plaque: string;
  clientId: number;
  marque: string;
  modele: string;
  couleur: string | null;
  type: string;
  notes: string | null;
}

const TYPES = ['CAR', 'SUV', 'PICKUP', 'VAN', 'MOTORCYCLE', 'TRUCK', 'OTHER'];

async function lit(request: Request): Promise<Champs | { refus: Response }> {
  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return { refus: erreur('Le corps de la requête est illisible.') };
  }

  const texte = (k: string) => (typeof corps[k] === 'string' ? (corps[k] as string).trim() : '');
  const plaque = texte('plate_number');
  const marque = texte('brand');
  const modele = texte('model');
  const type = texte('vehicle_type').toUpperCase();
  const clientBrut = Number(corps.customer_id);
  const erreurs: Record<string, string> = {};

  if (plaque === '') {
    erreurs.plate_number = 'La plaque est obligatoire.';
  } else if (!plausible(plaque)) {
    erreurs.plate_number = 'Cette plaque semble incomplète. Exemple : DK-1234-AA.';
  }

  if (!Number.isInteger(clientBrut) || clientBrut <= 0) {
    erreurs.customer_id = 'Le propriétaire est obligatoire.';
  }

  if (marque === '') erreurs.brand = 'La marque est obligatoire.';
  if (modele === '') erreurs.model = 'Le modèle est obligatoire.';
  if (!TYPES.includes(type)) erreurs.vehicle_type = 'Ce type de véhicule est inconnu.';

  if (Object.keys(erreurs).length > 0) {
    return { refus: erreur('Vérifiez les champs.', erreurs, 422) };
  }

  return {
    plaque,
    clientId: clientBrut,
    marque: marque.slice(0, 60),
    modele: modele.slice(0, 60),
    couleur: texte('color') === '' ? null : texte('color').slice(0, 40),
    type,
    notes: texte('notes') === '' ? null : texte('notes').slice(0, 1000),
  };
}

/** Cette plaque est-elle déjà enregistrée par un AUTRE véhicule ? */
async function plaquePrise(base: TenantDb, plaque: string, sauf = 0): Promise<boolean> {
  const v = await base
    .select(
      'SELECT id FROM vehicles WHERE {ORG} AND plate_number = ? AND id != ? LIMIT 1',
      normalise(plaque), sauf,
    )
    .first();

  return v !== null;
}

/** POST /api/vehicles */
export async function cree(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('vehicles.create')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const champs = await lit(request);

  if ('refus' in champs) {
    return champs.refus;
  }

  if (await plaquePrise(base, champs.plaque)) {
    return erreur('Vérifiez les champs.', {
      plate_number: 'Ce véhicule est déjà enregistré. Recherchez-le plutôt que de le recréer.',
    }, 422);
  }

  // Le client doit appartenir à la même entreprise. Le cloisonnement
  // filtre déjà les lectures, mais c'est ICI que la cohérence métier
  // se vérifie : sans ce contrôle, un formulaire modifié rattacherait
  // un véhicule au client d'un concurrent.
  const client = await base
    .select(
      'SELECT id FROM customers WHERE {ORG} AND id = ? AND deleted_at IS NULL LIMIT 1',
      champs.clientId,
    )
    .first();

  if (client === null) {
    return erreur('Vérifiez les champs.', { customer_id: "Ce client n'existe pas." }, 422);
  }

  const r = await env.DB
    .prepare(
      `INSERT INTO vehicles (organization_id, customer_id, plate_number, brand, model,
                             color, vehicle_type, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      utilisateur.organizationId, champs.clientId,
      // STOCKÉE NORMALISÉE : « dk 1234 aa » et « DK-1234-AA » désignent
      // le même véhicule et doivent produire la même valeur en base,
      // sinon l'historique se scinde.
      normalise(champs.plaque),
      champs.marque, champs.modele, champs.couleur, champs.type, champs.notes,
    )
    .run();

  const id = Number(r.meta.last_row_id);

  await enregistre(env.DB, {
    action: 'vehicle.created',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'vehicle',
    entityId: id,
  });

  const v = await base
    .select(`SELECT ${CHAMPS} ${JOINTURES} WHERE v.{ORG} AND v.id = ?`, id)
    .first<LigneVehicule>();

  return succes(v === null ? null : presente(v), 'Véhicule enregistré.', 201);
}

/** PUT /api/vehicles/{id} */
export async function modifie(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  vehiculeId: string,
): Promise<Response> {
  if (!utilisateur.peut('vehicles.update')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(vehiculeId, 10);

  const existant = await base
    .select('SELECT id FROM vehicles WHERE {ORG} AND id = ? LIMIT 1', id)
    .first();

  if (existant === null) {
    return introuvable("Ce véhicule n'existe pas.");
  }

  const champs = await lit(request);

  if ('refus' in champs) {
    return champs.refus;
  }

  if (await plaquePrise(base, champs.plaque, id)) {
    return erreur('Vérifiez les champs.', {
      plate_number: 'Un autre véhicule porte déjà cette plaque.',
    }, 422);
  }

  const client = await base
    .select(
      'SELECT id FROM customers WHERE {ORG} AND id = ? AND deleted_at IS NULL LIMIT 1',
      champs.clientId,
    )
    .first();

  if (client === null) {
    return erreur('Vérifiez les champs.', { customer_id: "Ce client n'existe pas." }, 422);
  }

  await base
    .select(
      `UPDATE vehicles SET plate_number = ?, customer_id = ?, brand = ?, model = ?,
              color = ?, vehicle_type = ?, notes = ?
        WHERE {ORG} AND id = ?`,
      normalise(champs.plaque), champs.clientId, champs.marque, champs.modele,
      champs.couleur, champs.type, champs.notes, id,
    )
    .run();

  await enregistre(env.DB, {
    action: 'vehicle.updated',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'vehicle',
    entityId: id,
  });

  const v = await base
    .select(`SELECT ${CHAMPS} ${JOINTURES} WHERE v.{ORG} AND v.id = ?`, id)
    .first<LigneVehicule>();

  return succes(v === null ? null : presente(v), 'Véhicule modifié.');
}
