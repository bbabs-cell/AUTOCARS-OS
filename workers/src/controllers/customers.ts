/**
 * Les clients
 * ==================================================================
 * Un client, ses véhicules, son historique et ce qu'il a dépensé.
 *
 * Deux décisions portées du PHP :
 *
 *   - Le TÉLÉPHONE est la clé d'usage. Dans une station, on retrouve
 *     un client par son numéro bien plus souvent que par son nom, qui
 *     s'orthographie de dix façons. Il est donc obligatoire, unique
 *     par organisation, et cherché en priorité.
 *
 *   - `total_spent` ne compte QUE les paiements réellement encaissés.
 *     Un dossier créé mais impayé ne fait pas d'un client un bon
 *     client.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { enregistre } from '../core/audit';
import { erreur, interdit, introuvable, succes } from '../core/response';

interface LigneClient {
  id: number;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: string;
  created_at: string | null;
  vehicle_count: number;
  visit_count: number;
  total_spent: number;
  last_visit_at: string | null;
}

const CHAMPS = `
  c.id, c.first_name, c.last_name, c.phone, c.email, c.address, c.notes,
  c.status, c.created_at,
  (SELECT COUNT(*) FROM vehicles v
    WHERE v.customer_id = c.id AND v.deleted_at IS NULL) AS vehicle_count,
  (SELECT COUNT(*) FROM operations o WHERE o.customer_id = c.id) AS visit_count,
  (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
     JOIN operations o2 ON o2.id = p.operation_id
    WHERE o2.customer_id = c.id AND p.status = 'PAID') AS total_spent,
  (SELECT MAX(o3.created_at) FROM operations o3 WHERE o3.customer_id = c.id) AS last_visit_at`;

/** GET /api/customers */
export async function liste(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('customers.view')) {
    return interdit();
  }

  const recherche = (new URL(request.url).searchParams.get('search') ?? '').trim();
  const conditions: string[] = [];
  const parametres: unknown[] = [];

  if (recherche !== '') {
    // Le numéro d'abord : c'est ainsi qu'on cherche au comptoir.
    const motif = `%${recherche}%`;
    conditions.push('(c.phone LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ?)');
    parametres.push(motif, motif, motif, motif);
  }

  const extra = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `SELECT ${CHAMPS} FROM customers c
        WHERE c.{ORG} AND c.deleted_at IS NULL${extra}
        ORDER BY c.last_name ASC, c.first_name ASC
        LIMIT 200`,
      ...parametres,
    )
    .all<LigneClient>();

  return succes(lignes.results.map(presente));
}

/** GET /api/customers/{id} */
export async function fiche(
  env: Env,
  utilisateur: Utilisateur,
  id: string,
): Promise<Response> {
  if (!utilisateur.peut('customers.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const n = Number.parseInt(id, 10);

  const client = await base
    .select(
      `SELECT ${CHAMPS} FROM customers c
        WHERE c.{ORG} AND c.id = ? AND c.deleted_at IS NULL LIMIT 1`,
      n,
    )
    .first<LigneClient>();

  if (client === null) {
    return introuvable("Ce client n'existe pas.");
  }

  const vehicules = await base
    .select(
      `SELECT v.id, v.plate_number, v.brand, v.model, v.color, v.vehicle_type
         FROM vehicles v
        WHERE v.{ORG} AND v.customer_id = ? AND v.deleted_at IS NULL
        ORDER BY v.created_at DESC`,
      n,
    )
    .all<Record<string, unknown>>();

  return succes({
    customer: presente(client),
    vehicles: vehicules.results,
  });
}

/** POST /api/customers */
export async function cree(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('customers.create')) {
    return interdit();
  }

  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const texte = (k: string) => (typeof corps[k] === 'string' ? (corps[k] as string).trim() : '');
  const champs = {
    first_name: texte('first_name'),
    last_name: texte('last_name'),
    phone: texte('phone'),
    email: texte('email'),
    address: texte('address'),
    notes: texte('notes'),
  };

  const erreurs: Record<string, string> = {};

  if (champs.first_name === '') erreurs.first_name = 'Le prénom est obligatoire.';
  if (champs.last_name === '') erreurs.last_name = 'Le nom est obligatoire.';

  // LE TÉLÉPHONE EST OBLIGATOIRE, ET C'EST VOULU.
  //
  // C'est le seul moyen fiable de rappeler quelqu'un dont la voiture
  // est prête. Un client sans numéro est un véhicule qu'on ne peut pas
  // rendre.
  if (champs.phone === '') {
    erreurs.phone = 'Le téléphone est obligatoire : sans lui, on ne peut pas prévenir le client.';
  }

  if (champs.email !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(champs.email)) {
    erreurs.email = "L'adresse e-mail n'est pas valide.";
  }

  if (Object.keys(erreurs).length > 0) {
    return erreur('Vérifiez les champs.', erreurs, 422);
  }

  const base = baseDe(utilisateur, env.DB);

  // On ne crée pas deux fiches pour le même numéro : ce serait deux
  // historiques pour une seule personne, et une fidélité coupée en
  // deux.
  const existe = await base
    .select(
      'SELECT id, first_name, last_name FROM customers WHERE {ORG} AND phone = ? AND deleted_at IS NULL LIMIT 1',
      champs.phone,
    )
    .first<{ id: number; first_name: string; last_name: string }>();

  if (existe !== null) {
    return erreur('Vérifiez les champs.', {
      phone: `Ce numéro est déjà celui de ${existe.first_name} ${existe.last_name}.`,
    }, 422);
  }

  const r = await env.DB
    .prepare(
      `INSERT INTO customers (organization_id, first_name, last_name, phone, email, address, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      utilisateur.organizationId, champs.first_name, champs.last_name, champs.phone,
      champs.email === '' ? null : champs.email,
      champs.address === '' ? null : champs.address,
      champs.notes === '' ? null : champs.notes,
    )
    .run();

  const id = Number(r.meta.last_row_id);

  await enregistre(env.DB, {
    action: 'customer.created',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'customer',
    entityId: id,
  });

  return await fiche(env, utilisateur, String(id));
}

/** PUT /api/customers/{id} */
export async function modifie(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  id: string,
): Promise<Response> {
  if (!utilisateur.peut('customers.update')) {
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

  const client = await base
    .select('SELECT id FROM customers WHERE {ORG} AND id = ? AND deleted_at IS NULL LIMIT 1', n)
    .first<{ id: number }>();

  if (client === null) {
    return introuvable("Ce client n'existe pas.");
  }

  // LA LISTE BLANCHE DES COLONNES MODIFIABLES.
  //
  // Elle est ici, et nulle part ailleurs. Sans elle, un corps de
  // requête pourrait porter `organization_id` et déplacer un client
  // chez un concurrent.
  const modifiables = ['first_name', 'last_name', 'phone', 'email', 'address', 'notes'];
  const colonnes: string[] = [];
  const valeurs: unknown[] = [];

  for (const champ of modifiables) {
    if (champ in corps) {
      const v = typeof corps[champ] === 'string' ? (corps[champ] as string).trim() : '';

      if ((champ === 'first_name' || champ === 'last_name' || champ === 'phone') && v === '') {
        return erreur('Vérifiez les champs.', { [champ]: 'Ce champ ne peut pas être vidé.' }, 422);
      }

      colonnes.push(`${champ} = ?`);
      valeurs.push(v === '' ? null : v);
    }
  }

  if (colonnes.length === 0) {
    return erreur('Rien à modifier.', {}, 422);
  }

  await base
    .select(`UPDATE customers SET ${colonnes.join(', ')} WHERE {ORG} AND id = ?`, ...valeurs, n)
    .run();

  await enregistre(env.DB, {
    action: 'customer.updated',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'customer',
    entityId: n,
  });

  return await fiche(env, utilisateur, id);
}

function presente(c: LigneClient) {
  return {
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    full_name: `${c.first_name} ${c.last_name}`.trim(),
    phone: c.phone,
    email: c.email,
    address: c.address,
    notes: c.notes,
    status: c.status,
    vehicle_count: c.vehicle_count,
    visit_count: c.visit_count,
    total_spent: c.total_spent,
    last_visit_at: c.last_visit_at,
    created_at: c.created_at,
  };
}

/**
 * GET /api/customers/check-phone?phone=
 * ==================================================================
 * CE NUMÉRO EST-IL DÉJÀ ENREGISTRÉ ?
 *
 * Sert à AVERTIR pendant la saisie, jamais à bloquer : un couple
 * partage souvent un numéro, et refuser l'enregistrement en pleine
 * affluence serait pire que le doublon.
 *
 * ------------------------------------------------------------------
 * LA COMPARAISON SE FAIT PAR LA FIN, ET NON À L'ÉGAL
 *
 * La base contient « +221 77 611 22 33 », soit « 221776112233 » une
 * fois nettoyé. L'employé, lui, tape « 776112233 » sans l'indicatif —
 * c'est ainsi qu'on donne son numéro au Sénégal. Une égalité stricte
 * ne trouverait donc jamais rien, et l'avertissement de doublon ne se
 * déclencherait jamais.
 *
 * En dessous de huit chiffres on ne cherche pas : le résultat serait
 * trop large pour signifier quoi que ce soit.
 */
export async function verifieTelephone(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('customers.view')) {
    return interdit();
  }

  const chiffres = (new URL(request.url).searchParams.get('phone') ?? '').replace(/\D/g, '');

  if (chiffres.length < 8) {
    return succes([]);
  }

  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `SELECT id, first_name, last_name, phone FROM customers
        WHERE {ORG} AND deleted_at IS NULL
          AND REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '+', '') LIKE ?
        LIMIT 5`,
      `%${chiffres}`,
    )
    .all<{ id: number; first_name: string; last_name: string; phone: string }>();

  return succes(lignes.results.map((c) => ({
    id: c.id,
    full_name: `${c.first_name} ${c.last_name}`.trim(),
    phone: c.phone,
  })));
}
