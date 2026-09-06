/**
 * Les rendez-vous
 * ==================================================================
 * Un créneau réservé, qui devient un dossier quand le client arrive.
 *
 * ------------------------------------------------------------------
 * QUATRE REFUS
 *
 * 1. LE PRIX PROMIS NE BOUGE PAS. Il est figé à la prise du
 *    rendez-vous. Changer son tarif ne doit pas changer ce qu'on a
 *    annoncé à quelqu'un — c'est la parole donnée.
 *
 * 2. ON NE DÉCLARE PAS UNE ABSENCE AVANT L'HEURE. Quinze minutes de
 *    grâce après l'heure prévue : déclarer quelqu'un absent pendant
 *    qu'il cherche une place est le meilleur moyen de le perdre.
 *
 * 3. UN RENDEZ-VOUS TERMINÉ NE SE MODIFIE PLUS. Arrivé, absent ou
 *    annulé : c'est de l'histoire.
 *
 * 4. « ARRIVÉ » NE SE COCHE PAS. L'arrivée ouvre un dossier ; c'est
 *    la route dédiée qui la déclare. Sinon on aurait un client dans
 *    la station sans trace de son véhicule.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { enregistre } from '../core/audit';
import { affiche } from '../core/plate';
import { erreur, interdit, introuvable, succes } from '../core/response';
import {
  GRACE_MINUTES, JOURS_MAX, LIBELLES_RDV, OUVERTS, PAR_ROUTE_SEULEMENT,
  TRANSITIONS_RDV, estOuvert, existeRdv, permetRdv, type EtatRdv,
} from '../core/rdv';

interface LigneRdv {
  id: number;
  station_id: number;
  station_name: string | null;
  service_id: number;
  service_name: string | null;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  vehicle_id: number | null;
  plate_number: string | null;
  brand: string | null;
  model: string | null;
  scheduled_at: string;
  duration_minutes: number;
  price: number;
  status: EtatRdv;
  operation_id: number | null;
  operation_reference: string | null;
  outcome_at: string | null;
  outcome_first_name: string | null;
  outcome_last_name: string | null;
  outcome_reason: string | null;
  notes: string | null;
  created_first_name: string | null;
  created_last_name: string | null;
  created_at: string;
}

const CHAMPS = `
  b.id, b.station_id, b.service_id, b.customer_id, b.customer_name, b.customer_phone,
  b.vehicle_id, b.scheduled_at, b.duration_minutes, b.price, b.status,
  b.operation_id, b.outcome_at, b.outcome_reason, b.notes, b.created_at,
  st.name AS station_name, s.name AS service_name,
  v.plate_number, v.brand, v.model,
  o.reference AS operation_reference,
  ob.first_name AS outcome_first_name, ob.last_name AS outcome_last_name,
  cb.first_name AS created_first_name, cb.last_name AS created_last_name`;

const JOINTURES = `
  FROM bookings b
  LEFT JOIN stations   st ON st.id = b.station_id
  LEFT JOIN services    s ON s.id  = b.service_id
  LEFT JOIN vehicles    v ON v.id  = b.vehicle_id
  LEFT JOIN operations  o ON o.id  = b.operation_id
  LEFT JOIN users      ob ON ob.id = b.outcome_by_user_id
  LEFT JOIN users      cb ON cb.id = b.created_by_user_id`;

/** GET /api/bookings/statuses */
export function statuts(utilisateur: Utilisateur): Response {
  if (!utilisateur.peut('bookings.view')) {
    return interdit();
  }

  return succes({
    statuses: (Object.keys(TRANSITIONS_RDV) as EtatRdv[]).map((e) => ({
      value: e,
      label: LIBELLES_RDV[e],
      is_open: estOuvert(e),
      allowed_next: [...TRANSITIONS_RDV[e]],
    })),
    open_statuses: [...OUVERTS],
    no_show_grace_minutes: GRACE_MINUTES,
    max_days_ahead: JOURS_MAX,
  });
}

/** GET /api/bookings?from=&to=&station_id=&status=&open=1&search= */
export async function liste(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('bookings.view')) {
    return interdit();
  }

  const url = new URL(request.url);
  const conditions: string[] = [];
  const parametres: unknown[] = [];

  const ajouteDate = (champ: string, operateur: string, suffixe: string) => {
    const v = url.searchParams.get(champ);

    if (v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
      conditions.push(`b.scheduled_at ${operateur} ?`);
      parametres.push(`${v} ${suffixe}`);
    }
  };

  ajouteDate('from', '>=', '00:00:00');
  ajouteDate('to', '<=', '23:59:59');

  const station = url.searchParams.get('station_id');

  if (station !== null && station !== '' && Number.isInteger(Number(station))) {
    conditions.push('b.station_id = ?');
    parametres.push(Number(station));
  }

  const statut = url.searchParams.get('status');

  if (statut !== null && existeRdv(statut)) {
    conditions.push('b.status = ?');
    parametres.push(statut);
  }

  if (url.searchParams.get('open') === '1') {
    conditions.push(`b.status IN (${OUVERTS.map(() => '?').join(',')})`);
    parametres.push(...OUVERTS);
  }

  const recherche = (url.searchParams.get('search') ?? '').trim();

  if (recherche !== '') {
    const motif = `%${recherche}%`;
    conditions.push('(b.customer_name LIKE ? OR b.customer_phone LIKE ? OR v.plate_number LIKE ?)');
    parametres.push(motif, motif, motif);
  }

  const extra = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `SELECT ${CHAMPS} ${JOINTURES}
        WHERE b.{ORG}${extra}
        ORDER BY b.scheduled_at ASC LIMIT 300`,
      ...parametres,
    )
    .all<LigneRdv>();

  return succes(lignes.results.map(presente));
}

/** GET /api/bookings/{id} */
export async function montre(
  env: Env,
  utilisateur: Utilisateur,
  id: string,
  message = '',
): Promise<Response> {
  if (!utilisateur.peut('bookings.view')) {
    return interdit();
  }

  const rdv = await baseDe(utilisateur, env.DB)
    .select(`SELECT ${CHAMPS} ${JOINTURES} WHERE b.{ORG} AND b.id = ? LIMIT 1`,
      Number.parseInt(id, 10))
    .first<LigneRdv>();

  if (rdv === null) {
    return introuvable("Ce rendez-vous n'existe pas.");
  }

  return succes(presente(rdv), message);
}

/** POST /api/bookings */
export async function cree(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('bookings.create')) {
    return interdit();
  }

  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const base = baseDe(utilisateur, env.DB);
  const texte = (k: string) => (typeof corps[k] === 'string' ? (corps[k] as string).trim() : '');
  const nombre = (k: string) => {
    const v = corps[k];
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const erreurs: Record<string, string> = {};
  const nom = texte('customer_name');
  const tel = texte('customer_phone');
  const quand = texte('scheduled_at');
  const serviceId = nombre('service_id');
  const stationId = nombre('station_id') ?? utilisateur.stationIds[0] ?? null;

  if (nom === '') erreurs.customer_name = 'Le nom du client est obligatoire.';
  if (tel === '') erreurs.customer_phone = 'Le téléphone est obligatoire : sans lui, on ne peut pas rappeler.';
  if (serviceId === null) erreurs.service_id = 'Choisissez une prestation.';
  if (stationId === null) erreurs.station_id = 'Choisissez une station.';

  const moment = quand === '' ? null : new Date(quand.replace(' ', 'T'));

  if (moment === null || Number.isNaN(moment.getTime())) {
    erreurs.scheduled_at = "L'heure du rendez-vous n'est pas lisible.";
  } else {
    // Deux minutes de tolérance : le temps de remplir le formulaire.
    if (moment.getTime() < Date.now() - 2 * 60_000) {
      erreurs.scheduled_at = 'Un rendez-vous ne se prend pas dans le passé.';
    } else if (moment.getTime() > Date.now() + JOURS_MAX * 86_400_000) {
      erreurs.scheduled_at =
        `Au-delà d'un an, c'est presque toujours une erreur d'année.`;
    }
  }

  if (Object.keys(erreurs).length > 0) {
    return erreur('Vérifiez les champs.', erreurs, 422);
  }

  const service = await base
    .select('SELECT id, price, duration_minutes FROM services WHERE {ORG} AND id = ? LIMIT 1', serviceId)
    .first<{ id: number; price: number; duration_minutes: number }>();

  if (service === null) {
    return erreur('Vérifiez les champs.', { service_id: "Cette prestation n'existe pas." }, 422);
  }

  // LE PRIX EST FIGÉ ICI, ET C'EST TOUT L'ENJEU.
  //
  // On recopie le tarif du jour dans le rendez-vous. Changer son
  // catalogue demain ne changera pas ce qu'on a annoncé à ce client :
  // c'est la parole donnée.
  const r = await env.DB
    .prepare(
      `INSERT INTO bookings (organization_id, station_id, service_id, customer_id,
                             customer_name, customer_phone, vehicle_id, scheduled_at,
                             duration_minutes, price, status, notes, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SCHEDULED', ?, ?)`,
    )
    .bind(
      utilisateur.organizationId, stationId, service.id, nombre('customer_id'),
      nom, tel, nombre('vehicle_id'),
      (moment as Date).toISOString().replace('T', ' ').slice(0, 19),
      service.duration_minutes, service.price,
      texte('notes') === '' ? null : texte('notes'), utilisateur.id,
    )
    .run();

  const id = Number(r.meta.last_row_id);

  await enregistre(env.DB, {
    action: 'booking.created',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'booking',
    entityId: id,
  });

  return await montre(env, utilisateur, String(id), 'Rendez-vous enregistré.');
}

/** PUT /api/bookings/{id} */
export async function modifie(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  id: string,
): Promise<Response> {
  if (!utilisateur.peut('bookings.update')) {
    return interdit();
  }

  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const base = baseDe(utilisateur, env.DB);
  const n = Number.parseInt(id, 10);

  const rdv = await base
    .select('SELECT id, status, price FROM bookings WHERE {ORG} AND id = ? LIMIT 1', n)
    .first<{ id: number; status: EtatRdv; price: number }>();

  if (rdv === null) {
    return introuvable("Ce rendez-vous n'existe pas.");
  }

  // REFUS 3 : un rendez-vous terminé est de l'histoire.
  if (!estOuvert(rdv.status)) {
    return erreur(
      `Ce rendez-vous est « ${LIBELLES_RDV[rdv.status]} » : il ne se modifie plus.`,
      {}, 409,
    );
  }

  const modifiables = ['customer_name', 'customer_phone', 'notes', 'scheduled_at'];
  const colonnes: string[] = [];
  const valeurs: unknown[] = [];

  for (const champ of modifiables) {
    if (champ in corps) {
      const v = typeof corps[champ] === 'string' ? (corps[champ] as string).trim() : '';

      if ((champ === 'customer_name' || champ === 'customer_phone') && v === '') {
        return erreur('Vérifiez les champs.', { [champ]: 'Ce champ ne peut pas être vidé.' }, 422);
      }

      colonnes.push(`${champ} = ?`);
      valeurs.push(v === '' ? null : v);
    }
  }

  // CHANGER LA PRESTATION NE CHANGE PAS LE PRIX PROMIS.
  //
  // On met à jour la durée, mais le tarif reste celui annoncé au
  // client. C'est le refus n° 12 de l'aide en ligne.
  const serviceId = typeof corps.service_id === 'number' ? corps.service_id : null;

  if (serviceId !== null) {
    const service = await base
      .select('SELECT id, duration_minutes FROM services WHERE {ORG} AND id = ? LIMIT 1', serviceId)
      .first<{ id: number; duration_minutes: number }>();

    if (service === null) {
      return erreur('Vérifiez les champs.', { service_id: "Cette prestation n'existe pas." }, 422);
    }

    colonnes.push('service_id = ?', 'duration_minutes = ?');
    valeurs.push(service.id, service.duration_minutes);
  }

  if (colonnes.length === 0) {
    return erreur('Rien à modifier.', {}, 422);
  }

  await base
    .select(`UPDATE bookings SET ${colonnes.join(', ')} WHERE {ORG} AND id = ?`, ...valeurs, n)
    .run();

  return await montre(env, utilisateur, id, 'Rendez-vous modifié.');
}

/** PUT /api/bookings/{id}/status */
export async function changeStatut(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  id: string,
): Promise<Response> {
  if (!utilisateur.peut('bookings.update')) {
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
  const n = Number.parseInt(id, 10);

  const rdv = await base
    .select('SELECT id, status, scheduled_at FROM bookings WHERE {ORG} AND id = ? LIMIT 1', n)
    .first<{ id: number; status: EtatRdv; scheduled_at: string }>();

  if (rdv === null) {
    return introuvable("Ce rendez-vous n'existe pas.");
  }

  if (!existeRdv(vers)) {
    return erreur("Ce statut n'existe pas.", {}, 409);
  }

  // REFUS 4 : « arrivé » se déclare par la route dédiée.
  if (PAR_ROUTE_SEULEMENT.includes(vers)) {
    return erreur(
      "L'arrivée se déclare en ouvrant le dossier du véhicule, pas en "
      + 'cochant un statut : sinon le client serait dans la station sans '
      + 'trace de sa voiture.',
      {}, 409,
    );
  }

  if (!permetRdv(rdv.status, vers)) {
    return erreur(
      `Un rendez-vous « ${LIBELLES_RDV[rdv.status]} » ne peut pas passer à `
      + `« ${LIBELLES_RDV[vers]} ».`,
      {}, 409,
    );
  }

  // REFUS 2 : le délai de grâce avant de déclarer une absence.
  if (vers === 'NO_SHOW') {
    const prevu = new Date(rdv.scheduled_at.replace(' ', 'T') + 'Z').getTime();
    const limite = prevu + GRACE_MINUTES * 60_000;

    if (Date.now() < limite) {
      const heure = rdv.scheduled_at.slice(11, 16);

      return erreur(
        `Ce rendez-vous est prévu à ${heure} : on ne déclare une absence `
        + `qu'au bout de ${GRACE_MINUTES} minutes d'attente.`,
        {}, 409,
      );
    }
  }

  await base
    .select(
      `UPDATE bookings SET status = ?, outcome_at = datetime('now'),
              outcome_by_user_id = ?, outcome_reason = ?
        WHERE {ORG} AND id = ?`,
      vers, utilisateur.id,
      typeof corps.reason === 'string' && corps.reason.trim() !== '' ? corps.reason.trim() : null,
      n,
    )
    .run();

  await enregistre(env.DB, {
    action: 'booking.status_changed',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'booking',
    entityId: n,
    metadata: { de: rdv.status, vers },
  });

  return await montre(env, utilisateur, id, `Rendez-vous ${LIBELLES_RDV[vers].toLowerCase()}.`);
}

/**
 * POST /api/bookings/{id}/arrive
 * ==================================================================
 * L'ARRIVÉE OUVRE UN DOSSIER.
 *
 * Deux écritures qui n'ont de sens qu'ensemble : le rendez-vous passe
 * à « arrivé » et l'opération naît. `batch()` garantit qu'on n'aura
 * jamais l'une sans l'autre — un rendez-vous « arrivé » sans dossier
 * serait un client dans la station dont personne ne suit la voiture.
 */
export async function arrive(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  id: string,
): Promise<Response> {
  if (!utilisateur.peut('operations.create')) {
    return interdit("Ouvrir un dossier n'est pas dans vos droits.");
  }

  let corps: { vehicle_id?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    corps = {};
  }

  const base = baseDe(utilisateur, env.DB);
  const n = Number.parseInt(id, 10);

  const rdv = await base
    .select(
      `SELECT id, station_id, service_id, customer_id, vehicle_id, price, status
         FROM bookings WHERE {ORG} AND id = ? LIMIT 1`,
      n,
    )
    .first<{
      id: number; station_id: number; service_id: number; customer_id: number | null;
      vehicle_id: number | null; price: number; status: EtatRdv;
    }>();

  if (rdv === null) {
    return introuvable("Ce rendez-vous n'existe pas.");
  }

  if (!estOuvert(rdv.status)) {
    return erreur(
      `Ce rendez-vous est déjà « ${LIBELLES_RDV[rdv.status]} ».`,
      {}, 409,
    );
  }

  const vehicule = typeof corps.vehicle_id === 'number' ? corps.vehicle_id : rdv.vehicle_id;

  if (vehicule === null || rdv.customer_id === null) {
    return erreur(
      'Indiquez le véhicule et son propriétaire : un dossier sans '
      + 'véhicule ne peut pas être suivi.',
      { vehicle_id: 'Véhicule obligatoire.' }, 422,
    );
  }

  const reference = 'RDV-' + Date.now().toString(36).toUpperCase();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO operations (organization_id, station_id, vehicle_id, customer_id,
                               service_id, reference, status, price, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, 'WAITING', ?, ?)`,
    ).bind(
      utilisateur.organizationId, rdv.station_id, vehicule, rdv.customer_id,
      rdv.service_id, reference, rdv.price, utilisateur.id,
    ),
    env.DB.prepare(
      `UPDATE bookings SET status = 'ARRIVED', operation_id = last_insert_rowid(),
              outcome_at = datetime('now'), outcome_by_user_id = ?
        WHERE id = ? AND organization_id = ?`,
    ).bind(utilisateur.id, n, utilisateur.organizationId),
  ]);

  await enregistre(env.DB, {
    action: 'booking.arrived',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'booking',
    entityId: n,
    metadata: { reference },
  });

  return await montre(env, utilisateur, id, 'Le client est arrivé, le dossier est ouvert.');
}

function presente(b: LigneRdv) {
  const vehicule = b.brand === null ? null : `${b.brand} ${b.model ?? ''}`.trim();
  const par = (a: string | null, z: string | null) => {
    const nom = `${a ?? ''} ${z ?? ''}`.trim();
    return nom === '' ? null : nom;
  };

  return {
    id: b.id,
    station_id: b.station_id,
    station_name: b.station_name,
    service_id: b.service_id,
    service_name: b.service_name,
    customer_id: b.customer_id,
    customer_name: b.customer_name,
    customer_phone: b.customer_phone,
    vehicle_id: b.vehicle_id,
    plate_number: b.plate_number === null ? null : affiche(b.plate_number),
    vehicle_label: vehicule,
    scheduled_at: b.scheduled_at,
    scheduled_date: b.scheduled_at.slice(0, 10),
    scheduled_time: b.scheduled_at.slice(11, 16),
    duration_minutes: b.duration_minutes,
    price: b.price,
    status: b.status,
    status_label: LIBELLES_RDV[b.status],
    is_open: estOuvert(b.status),
    // Envoyé par le serveur, pour que l'écran n'ait pas à recopier la
    // machine à états — et « ARRIVÉ » n'y figure jamais, puisqu'il ne
    // se coche pas.
    allowed_next: TRANSITIONS_RDV[b.status].filter((e) => !PAR_ROUTE_SEULEMENT.includes(e)),
    operation_id: b.operation_id,
    operation_reference: b.operation_reference,
    outcome_at: b.outcome_at,
    outcome_by_name: par(b.outcome_first_name, b.outcome_last_name),
    outcome_reason: b.outcome_reason,
    notes: b.notes,
    created_by_name: par(b.created_first_name, b.created_last_name),
    created_at: b.created_at,
  };
}
