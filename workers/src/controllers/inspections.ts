/**
 * Les inspections : le constat d'état
 * ==================================================================
 * C'est la pièce qui protège la station ET le client. Sans constat
 * d'arrivée, une rayure découverte après le lavage est indéfendable :
 * personne ne peut dire si elle était là avant.
 *
 * ------------------------------------------------------------------
 * QUATRE REFUS, ET CE QU'ILS PROTÈGENT
 *
 * 1. UN CONSTAT NE SE RÉÉCRIT PAS. Une seule inspection par type et
 *    par dossier. Un constat modifiable ne prouve rien.
 *
 * 2. L'INSPECTION D'ENTRÉE SE FAIT AVANT LE LAVAGE. Enregistrée
 *    après, elle ne constate plus l'état d'arrivée mais celui d'un
 *    véhicule déjà manipulé : elle perd toute valeur de preuve.
 *
 * 3. « DOMMAGE CONSTATÉ » SANS DESCRIPTION EST REFUSÉ. « Il y avait
 *    une rayure » ne dit ni où, ni laquelle.
 *
 * 4. CLIENT PRÉSENT SANS SON NOM EST REFUSÉ. Le nom saisi vaut accord
 *    sur l'état constaté : c'est la seule chose qui transforme un
 *    constat interne en constat contradictoire.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { enregistre } from '../core/audit';
import { erreur, interdit, introuvable, succes } from '../core/response';
import { permet, type Etat } from '../core/etats';

const NIVEAUX = ['EMPTY', 'QUARTER', 'HALF', 'THREE_QUARTERS', 'FULL'];

/** Les étapes où un véhicule n'a pas encore été touché. */
const AVANT_LAVAGE: Etat[] = ['WAITING', 'IN_PROGRESS', 'INSPECTION'];

interface LigneInspection {
  id: number;
  operation_id: number;
  vehicle_id: number;
  type: string;
  fuel_level: string | null;
  mileage: number | null;
  has_damage: number;
  damage_notes: string | null;
  items_left: string | null;
  observations: string | null;
  customer_present: number;
  signature_name: string | null;
  performed_at: string;
}

/** POST /api/operations/{id}/inspections */
export async function cree(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  operationId: string,
): Promise<Response> {
  if (!utilisateur.peut('inspections.create')) {
    return interdit();
  }

  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(operationId, 10);

  const dossier = await base
    .select(
      `SELECT id, vehicle_id, station_id, status, reference
         FROM operations WHERE {ORG} AND id = ? LIMIT 1`,
      id,
    )
    .first<{ id: number; vehicle_id: number; station_id: number; status: Etat; reference: string }>();

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  const type = corps.type === 'EXIT' ? 'EXIT' : 'ENTRY';

  // --- REFUS 1 : un constat ne se réécrit pas -----------------------
  const deja = await base
    .select(
      'SELECT id FROM inspections WHERE {ORG} AND operation_id = ? AND type = ? LIMIT 1',
      dossier.id,
      type,
    )
    .first();

  if (deja !== null) {
    return erreur(
      type === 'ENTRY'
        ? "L'inspection d'entrée de ce dossier est déjà enregistrée. Un constat ne se réécrit pas."
        : "L'inspection de sortie de ce dossier est déjà enregistrée.",
      {}, 409,
    );
  }

  // --- REFUS 2 : l'entrée se constate avant le lavage ---------------
  if (type === 'ENTRY' && !AVANT_LAVAGE.includes(dossier.status)) {
    return erreur(
      "Le lavage a déjà commencé : une inspection d'entrée enregistrée "
      + "maintenant ne constaterait plus l'état d'arrivée du véhicule.",
      {}, 409,
    );
  }

  // --- Les champs ---------------------------------------------------
  const texte = (k: string) => {
    const v = corps[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  };
  const booleen = (k: string) => corps[k] === true || corps[k] === 1 || corps[k] === '1';

  const erreurs: Record<string, string> = {};

  const niveau = texte('fuel_level');

  if (niveau !== null && !NIVEAUX.includes(niveau)) {
    erreurs.fuel_level = "Ce niveau de carburant n'existe pas.";
  }

  let km: number | null = null;

  if (corps.mileage !== undefined && corps.mileage !== null && corps.mileage !== '') {
    const n = typeof corps.mileage === 'number' ? corps.mileage : Number(corps.mileage);

    if (!Number.isInteger(n) || n < 0) {
      erreurs.mileage = 'Le kilométrage doit être un nombre entier positif.';
    } else {
      km = n;
    }
  }

  const dommage = booleen('has_damage');
  const description = texte('damage_notes');

  // --- REFUS 3 : un dommage se décrit -------------------------------
  if (dommage && description === null) {
    erreurs.damage_notes =
      'Décrivez le dommage constaté : sans description, la photo seule ne prouve rien.';
  }

  const present = booleen('customer_present');
  const signature = texte('signature_name');

  // --- REFUS 4 : le nom vaut accord ---------------------------------
  if (present && signature === null) {
    erreurs.signature_name =
      "Saisissez le nom du client : c'est ce qui vaut accord sur l'état constaté.";
  }

  if (Object.keys(erreurs).length > 0) {
    return erreur('Vérifiez les champs.', erreurs, 422);
  }

  const r = await env.DB
    .prepare(
      `INSERT INTO inspections (organization_id, operation_id, vehicle_id, type,
                                fuel_level, mileage, has_damage, damage_notes,
                                items_left, observations, customer_present,
                                signature_name, performed_by_user_id, performed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .bind(
      utilisateur.organizationId, dossier.id, dossier.vehicle_id, type,
      niveau, km, dommage ? 1 : 0, description,
      texte('items_left'), texte('observations'), present ? 1 : 0,
      signature, utilisateur.id,
    )
    .run();

  const inspectionId = Number(r.meta.last_row_id);

  // ENREGISTRER L'INSPECTION D'ENTRÉE FAIT AVANCER LE DOSSIER.
  //
  // Sans cela, l'employé devrait changer le statut à la main juste
  // après — et oublierait une fois sur deux. C'est le genre d'oubli
  // qui bloque ensuite le lavage sans que personne comprenne
  // pourquoi.
  if (type === 'ENTRY' && permet(dossier.status, 'INSPECTION')) {
    await base
      .select(
        "UPDATE operations SET status = 'INSPECTION', status_changed_at = datetime('now') WHERE {ORG} AND id = ?",
        dossier.id,
      )
      .run();
  }

  await enregistre(env.DB, {
    action: 'inspection.created',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'inspection',
    entityId: inspectionId,
    metadata: {
      operation_reference: dossier.reference,
      type,
      has_damage: dommage,
    },
  });

  return await montre(env, utilisateur, String(inspectionId), 'Inspection enregistrée.');
}

/** GET /api/inspections/{id} */
export async function montre(
  env: Env,
  utilisateur: Utilisateur,
  id: string,
  message = '',
): Promise<Response> {
  if (!utilisateur.peut('inspections.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const n = Number.parseInt(id, 10);

  const inspection = await base
    .select(
      `SELECT id, operation_id, vehicle_id, type, fuel_level, mileage, has_damage,
              damage_notes, items_left, observations, customer_present,
              signature_name, performed_at
         FROM inspections WHERE {ORG} AND id = ? LIMIT 1`,
      n,
    )
    .first<LigneInspection>();

  if (inspection === null) {
    return introuvable("Cette inspection n'existe pas.");
  }

  const photos = await base
    .select(
      `SELECT id, position, caption, width, height, file_size, created_at
         FROM inspection_photos WHERE {ORG} AND inspection_id = ?
        ORDER BY id ASC`,
      n,
    )
    .all<{ id: number; position: string; caption: string | null; width: number | null; height: number | null; file_size: number; created_at: string | null }>();

  return succes({
    inspection: {
      ...presente(inspection),
      photos: photos.results.map((p) => ({
        id: p.id,
        position: p.position,
        // L'URL passe par l'API : les photos ne sont jamais servies
        // directement depuis un dossier public.
        url: `/api/photos/${p.id}`,
        caption: p.caption,
        width: p.width,
        height: p.height,
        file_size: p.file_size,
        created_at: p.created_at,
      })),
    },
  }, message);
}

/** GET /api/vehicles/{id}/inspections — l'historique d'un véhicule. */
export async function pourVehicule(
  env: Env,
  utilisateur: Utilisateur,
  vehicleId: string,
): Promise<Response> {
  if (!utilisateur.peut('inspections.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const n = Number.parseInt(vehicleId, 10);

  const lignes = await base
    .select(
      `SELECT i.id, i.operation_id, i.vehicle_id, i.type, i.fuel_level, i.mileage,
              i.has_damage, i.damage_notes, i.items_left, i.observations,
              i.customer_present, i.signature_name, i.performed_at
         FROM inspections i
        WHERE i.{ORG} AND i.vehicle_id = ?
        ORDER BY i.performed_at DESC LIMIT 50`,
      n,
    )
    .all<LigneInspection>();

  return succes(lignes.results.map(presente));
}

function presente(i: LigneInspection) {
  return {
    id: i.id,
    operation_id: i.operation_id,
    vehicle_id: i.vehicle_id,
    type: i.type,
    fuel_level: i.fuel_level,
    mileage: i.mileage,
    // SQLite ne connaît pas les booléens : on rend un vrai booléen au
    // frontend plutôt que le 0/1 stocké.
    has_damage: i.has_damage === 1,
    damage_notes: i.damage_notes,
    items_left: i.items_left,
    observations: i.observations,
    customer_present: i.customer_present === 1,
    signature_name: i.signature_name,
    performed_at: i.performed_at,
  };
}
