/**
 * Les prestations
 * ------------------------------------------------------------------
 * ON NE SUPPRIME PAS UNE PRESTATION, ON LA DÉSACTIVE.
 *
 * Elle est référencée par toutes les opérations passées, par les
 * rendez-vous et par les forfaits : la supprimer trouerait
 * l'historique et fausserait les statistiques. Désactivée, elle
 * disparaît du comptoir et l'historique reste lisible.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { enregistre } from '../core/audit';
import { erreur, interdit, introuvable, succes } from '../core/response';

interface LigneService {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  duration_minutes: number;
  status: string;
}

const CHAMPS = 'id, name, description, category, price, duration_minutes, status';

/**
 * On expose exactement ce dont le frontend a besoin, pas la ligne
 * brute : les colonnes internes ne doivent pas fuir dans le contrat
 * public de l'API, sinon on ne peut plus les changer.
 */
function presente(s: LigneService) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    price: s.price,
    duration_minutes: s.duration_minutes,
    status: s.status,
  };
}

/** GET /api/services?only_active=1 */
export async function liste(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('services.view')) {
    return interdit();
  }

  // Au comptoir, on ne propose pas une prestation retirée du
  // catalogue.
  const actives = new URL(request.url).searchParams.get('only_active') === '1';

  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `SELECT ${CHAMPS} FROM services
        WHERE {ORG}${actives ? " AND status = 'ACTIVE'" : ''}
        ORDER BY price ASC LIMIT 200`,
    )
    .all<LigneService>();

  // Le tableau est à la RACINE de `data` : c'est ce que le service
  // Angular lit — `ApiResponse<Service[]>`.
  return succes(lignes.results.map(presente));
}

/** GET /api/services/{id} */
export async function montre(
  env: Env,
  utilisateur: Utilisateur,
  serviceId: string,
): Promise<Response> {
  if (!utilisateur.peut('services.view')) {
    return interdit();
  }

  const s = await baseDe(utilisateur, env.DB)
    .select(`SELECT ${CHAMPS} FROM services WHERE {ORG} AND id = ? LIMIT 1`,
      Number.parseInt(serviceId, 10))
    .first<LigneService>();

  return s === null ? introuvable("Cette prestation n'existe pas.") : succes(presente(s));
}

interface Champs {
  nom: string;
  description: string | null;
  categorie: string | null;
  prix: number;
  duree: number;
}

/**
 * Lit et vérifie les champs d'une prestation.
 *
 * LES MONTANTS SONT DES ENTIERS DE FRANCS. On refuse tout ce qui n'en
 * est pas un plutôt que de laisser une conversion silencieuse
 * transformer « 10 000 F » en 10.
 */
async function lit(request: Request): Promise<Champs | { refus: Response }> {
  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return { refus: erreur('Le corps de la requête est illisible.') };
  }

  const texte = (k: string) => (typeof corps[k] === 'string' ? (corps[k] as string).trim() : '');
  const nom = texte('name');
  const description = texte('description');
  const categorie = texte('category');
  const erreurs: Record<string, string> = {};

  if (nom === '') erreurs.name = 'Le nom est obligatoire.';
  else if (nom.length > 120) erreurs.name = 'Ce nom est trop long.';

  if (description.length > 500) erreurs.description = 'Cette description est trop longue.';
  if (categorie.length > 60) erreurs.category = 'Cette catégorie est trop longue.';

  const brut = (k: string) =>
    corps[k] === undefined || corps[k] === null ? '' : String(corps[k]).trim();

  const prix = brut('price');
  const duree = brut('duration_minutes');

  if (prix === '') {
    erreurs.price = 'Le prix est obligatoire.';
  } else if (!/^\d{1,9}$/.test(prix)) {
    erreurs.price = 'Le prix doit être un nombre entier, sans espace ni devise.';
  }

  if (duree === '') {
    erreurs.duration_minutes = 'La durée est obligatoire.';
  } else if (!/^\d{1,4}$/.test(duree) || Number(duree) < 1) {
    erreurs.duration_minutes = 'La durée doit être un nombre de minutes.';
  }

  if (Object.keys(erreurs).length > 0) {
    return { refus: erreur('Vérifiez les champs.', erreurs, 422) };
  }

  return {
    nom,
    description: description === '' ? null : description,
    categorie: categorie === '' ? null : categorie,
    prix: Number(prix),
    duree: Number(duree),
  };
}

/** POST /api/services */
export async function cree(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('services.create')) {
    return interdit();
  }

  const champs = await lit(request);

  if ('refus' in champs) {
    return champs.refus;
  }

  const base = baseDe(utilisateur, env.DB);

  // Deux prestations du même nom au comptoir, c'est une hésitation à
  // chaque saisie. Le schéma l'interdit déjà ; on le dit ici en
  // français plutôt que de laisser remonter une erreur SQL.
  const prise = await base
    .select('SELECT id FROM services WHERE {ORG} AND name = ? LIMIT 1', champs.nom)
    .first();

  if (prise !== null) {
    return erreur('Vérifiez les champs.', {
      name: 'Une prestation porte déjà ce nom.',
    }, 422);
  }

  const r = await env.DB
    .prepare(
      `INSERT INTO services (organization_id, name, description, category, price,
                             duration_minutes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      utilisateur.organizationId, champs.nom, champs.description,
      champs.categorie, champs.prix, champs.duree,
    )
    .run();

  const id = Number(r.meta.last_row_id);

  await enregistre(env.DB, {
    action: 'service.created',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'service',
    entityId: id,
    metadata: { name: champs.nom },
  });

  const s = await base
    .select(`SELECT ${CHAMPS} FROM services WHERE {ORG} AND id = ?`, id)
    .first<LigneService>();

  return succes(s === null ? null : presente(s), 'Prestation créée.', 201);
}

/** PUT /api/services/{id} */
export async function modifie(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  serviceId: string,
): Promise<Response> {
  if (!utilisateur.peut('services.update')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(serviceId, 10);

  const existant = await base
    .select('SELECT id FROM services WHERE {ORG} AND id = ? LIMIT 1', id)
    .first();

  if (existant === null) {
    return introuvable("Cette prestation n'existe pas.");
  }

  const champs = await lit(request);

  if ('refus' in champs) {
    return champs.refus;
  }

  const prise = await base
    .select('SELECT id FROM services WHERE {ORG} AND name = ? AND id != ? LIMIT 1',
      champs.nom, id)
    .first();

  if (prise !== null) {
    return erreur('Vérifiez les champs.', {
      name: 'Une autre prestation porte déjà ce nom.',
    }, 422);
  }

  await base
    .select(
      `UPDATE services SET name = ?, description = ?, category = ?, price = ?,
              duration_minutes = ?
        WHERE {ORG} AND id = ?`,
      champs.nom, champs.description, champs.categorie, champs.prix, champs.duree, id,
    )
    .run();

  await enregistre(env.DB, {
    action: 'service.updated',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'service',
    entityId: id,
  });

  const s = await base
    .select(`SELECT ${CHAMPS} FROM services WHERE {ORG} AND id = ?`, id)
    .first<LigneService>();

  return succes(s === null ? null : presente(s), 'Prestation modifiée.');
}

/**
 * PUT /api/services/{id}/status
 *
 * Bascule ACTIVE ↔ INACTIVE. Le prix d'un dossier déjà ouvert ne
 * bouge pas : il a été recopié à l'accueil.
 */
export async function bascule(
  env: Env,
  utilisateur: Utilisateur,
  serviceId: string,
): Promise<Response> {
  if (!utilisateur.peut('services.update')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(serviceId, 10);

  const s = await base
    .select(`SELECT ${CHAMPS} FROM services WHERE {ORG} AND id = ? LIMIT 1`, id)
    .first<LigneService>();

  if (s === null) {
    return introuvable("Cette prestation n'existe pas.");
  }

  const nouveau = s.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  await base
    .select('UPDATE services SET status = ? WHERE {ORG} AND id = ?', nouveau, id)
    .run();

  await enregistre(env.DB, {
    action: 'service.status_changed',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'service',
    entityId: id,
    metadata: { from: s.status, to: nouveau },
  });

  return succes(
    presente({ ...s, status: nouveau }),
    nouveau === 'ACTIVE' ? 'Prestation activée.' : 'Prestation désactivée.',
  );
}
