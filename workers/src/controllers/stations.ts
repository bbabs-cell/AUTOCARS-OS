/**
 * Les stations
 * ==================================================================
 * IL N'Y A PAS DE SUPPRESSION — comme pour les prestations et les
 * comptes. Une station fermée figure sur des milliers de dossiers
 * passés : l'effacer trouerait l'historique. On la ferme, et son
 * passé reste consultable.
 *
 * DEUX REFUS DE FERMETURE :
 *
 * 1. LA DERNIÈRE STATION OUVERTE ne se ferme pas. L'entreprise se
 *    retrouverait sans aucun point de service, donc incapable
 *    d'enregistrer quoi que ce soit.
 *
 * 2. UNE STATION OÙ DES VÉHICULES ATTENDENT non plus. Des clients
 *    vont revenir les chercher, et leur dossier doit pouvoir aller
 *    jusqu'à la restitution.
 *
 * LES STATIONS FERMÉES SONT DANS LA LISTE, avec leur statut. Les
 * masquer donnerait un écran de gestion où l'on ne peut pas rouvrir
 * ce qu'on a fermé — et ferait croire à une suppression. C'est à
 * l'appelant d'écarter les inactives quand il propose un choix de
 * saisie ; `status` est là pour ça.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import type { TenantDb } from '../core/db';
import { enregistre } from '../core/audit';
import { erreur, interdit, introuvable, succes } from '../core/response';
import { ACTIFS } from '../core/etats';

interface LigneStation {
  id: number;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  opens_at: string | null;
  closes_at: string | null;
  status: string;
}

const CHAMPS = 'id, name, code, address, city, phone, opens_at, closes_at, status';

/** On renvoie HH:MM et non HH:MM:SS : c'est ce qu'attend `<input type="time">`. */
const heure = (v: string | null) => (v !== null && v.length >= 5 ? v.slice(0, 5) : null);

function presente(s: LigneStation) {
  return {
    id: s.id,
    name: s.name,
    code: s.code,
    address: s.address,
    city: s.city,
    phone: s.phone,
    opens_at: heure(s.opens_at),
    closes_at: heure(s.closes_at),
    status: s.status,
  };
}

export async function liste(
  _request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('stations.view')) {
    return interdit();
  }

  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      // `vehicles_on_site` est facultatif dans le modèle, mais c'est
      // lui qui permet à l'écran d'annoncer un refus de fermeture
      // AVANT le clic — un refus prévisible vaut mieux qu'un refus
      // expliqué après coup.
      `SELECT ${CHAMPS.split(', ').map((c) => `s.${c}`).join(', ')},
              (SELECT COUNT(*) FROM operations o
                WHERE o.station_id = s.id
                  AND o.status IN (${ACTIFS.map(() => '?').join(',')})) AS vehicles_on_site
         FROM stations s
        WHERE s.{ORG}
        ORDER BY s.name ASC`,
      ...ACTIFS,
    )
    .all<LigneStation & { vehicles_on_site: number }>();

  return succes(
    lignes.results.map((s) => ({ ...presente(s), vehicles_on_site: s.vehicles_on_site })),
  );
}

/** GET /api/stations/{id} */
export async function montre(
  env: Env,
  utilisateur: Utilisateur,
  stationId: string,
): Promise<Response> {
  if (!utilisateur.peut('stations.view')) {
    return interdit();
  }

  const s = await baseDe(utilisateur, env.DB)
    .select(`SELECT ${CHAMPS} FROM stations WHERE {ORG} AND id = ? LIMIT 1`,
      Number.parseInt(stationId, 10))
    .first<LigneStation>();

  return s === null ? introuvable("Cette station n'existe pas.") : succes(presente(s));
}

interface Champs {
  nom: string;
  code: string;
  adresse: string | null;
  ville: string | null;
  telephone: string | null;
  ouverture: string | null;
  fermeture: string | null;
}

/**
 * Lit et vérifie les champs d'une station.
 *
 * La règle du code est écrite ICI, une seule fois, parce qu'elle vaut
 * pour la création comme pour la modification. Deux copies auraient
 * fini par diverger — et une station créée avec un code que la
 * modification refuse est un piège pour l'utilisateur.
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
  const erreurs: Record<string, string> = {};

  if (nom === '') erreurs.name = 'Le nom de la station est obligatoire.';
  else if (nom.length > 120) erreurs.name = 'Ce nom est trop long.';

  // LE CODE APPARAÎT DANS LES RÉFÉRENCES remises au client
  // (« DKP-2609-0042 »). Lettres et chiffres en majuscules : un code
  // avec un espace ou un tiret rendrait la référence ambiguë à lire
  // au comptoir.
  const code = texte('code').toUpperCase();

  if (code === '') {
    erreurs.code = 'Le code est obligatoire.';
  } else if (!/^[A-Z0-9]{2,10}$/.test(code)) {
    erreurs.code = 'Le code doit contenir 2 à 10 lettres ou chiffres, sans espace.';
  }

  if (texte('address').length > 255) erreurs.address = 'Cette adresse est trop longue.';
  if (texte('city').length > 80) erreurs.city = 'Ce nom de ville est trop long.';

  if (Object.keys(erreurs).length > 0) {
    return { refus: erreur('Vérifiez les champs.', erreurs, 422) };
  }

  // Horaires facultatifs, au format HH:MM. On refuse tout le reste
  // plutôt que de laisser la base interpréter une valeur douteuse.
  const horaire = (k: string) => {
    const v = texte(k);

    return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? `${v}:00` : null;
  };

  const vide = (k: string) => (texte(k) === '' ? null : texte(k));

  return {
    nom,
    code,
    adresse: vide('address'),
    ville: vide('city'),
    telephone: vide('phone'),
    ouverture: horaire('opens_at'),
    fermeture: horaire('closes_at'),
  };
}

/** Ce code est-il déjà pris par une AUTRE station ? */
async function codePris(base: TenantDb, code: string, sauf = 0): Promise<boolean> {
  const s = await base
    .select('SELECT id FROM stations WHERE {ORG} AND code = ? AND id != ? LIMIT 1', code, sauf)
    .first();

  return s !== null;
}

/**
 * POST /api/stations
 *
 * Réservé à l'administrateur : ouvrir un point de service est une
 * décision de propriétaire, pas d'exploitation quotidienne.
 */
export async function cree(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('stations.create')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const champs = await lit(request);

  if ('refus' in champs) {
    return champs.refus;
  }

  if (await codePris(base, champs.code)) {
    return erreur('Vérifiez les champs.', {
      code: 'Une autre station utilise déjà ce code.',
    }, 422);
  }

  // `organization_id` n'est PAS lu depuis la requête : il vient du
  // contexte d'authentification. Une station ne peut donc pas être
  // créée chez le voisin, même en modifiant le formulaire.
  const r = await env.DB
    .prepare(
      `INSERT INTO stations (organization_id, name, code, address, city, phone,
                             opens_at, closes_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      utilisateur.organizationId, champs.nom, champs.code, champs.adresse,
      champs.ville, champs.telephone, champs.ouverture, champs.fermeture,
    )
    .run();

  const id = Number(r.meta.last_row_id);

  await enregistre(env.DB, {
    action: 'station.created',
    organizationId: utilisateur.organizationId,
    stationId: id,
    userId: utilisateur.id,
    entityType: 'station',
    entityId: id,
    metadata: { code: champs.code },
  });

  const s = await base
    .select(`SELECT ${CHAMPS} FROM stations WHERE {ORG} AND id = ?`, id)
    .first<LigneStation>();

  return succes(
    s === null ? null : presente(s),
    "Station créée. Rattachez-y votre équipe pour qu'elle puisse y travailler.",
    201,
  );
}

/** PUT /api/stations/{id} */
export async function modifie(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  stationId: string,
): Promise<Response> {
  if (!utilisateur.peut('stations.update')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(stationId, 10);

  const existante = await base
    .select('SELECT id FROM stations WHERE {ORG} AND id = ? LIMIT 1', id)
    .first();

  if (existante === null) {
    return introuvable("Cette station n'existe pas.");
  }

  // Un responsable ne pilote que les stations où il est rattaché ; un
  // administrateur les voit toutes.
  if (!await utilisateur.voitStation(id)) {
    return interdit("Vous n'êtes pas rattaché à cette station.");
  }

  const champs = await lit(request);

  if ('refus' in champs) {
    return champs.refus;
  }

  if (await codePris(base, champs.code, id)) {
    return erreur('Vérifiez les champs.', {
      code: 'Une autre station utilise déjà ce code.',
    }, 422);
  }

  await base
    .select(
      `UPDATE stations SET name = ?, code = ?, address = ?, city = ?, phone = ?,
              opens_at = ?, closes_at = ?
        WHERE {ORG} AND id = ?`,
      champs.nom, champs.code, champs.adresse, champs.ville, champs.telephone,
      champs.ouverture, champs.fermeture, id,
    )
    .run();

  await enregistre(env.DB, {
    action: 'station.updated',
    organizationId: utilisateur.organizationId,
    stationId: id,
    userId: utilisateur.id,
    entityType: 'station',
    entityId: id,
  });

  const s = await base
    .select(`SELECT ${CHAMPS} FROM stations WHERE {ORG} AND id = ?`, id)
    .first<LigneStation>();

  return succes(s === null ? null : presente(s), 'Station enregistrée.');
}

/** PUT /api/stations/{id}/status — ouvrir ou fermer. */
export async function bascule(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  stationId: string,
): Promise<Response> {
  if (!utilisateur.peut('stations.update')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(stationId, 10);

  const station = await base
    .select(`SELECT ${CHAMPS} FROM stations WHERE {ORG} AND id = ? LIMIT 1`, id)
    .first<LigneStation>();

  if (station === null) {
    return introuvable("Cette station n'existe pas.");
  }

  let corps: { status?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const statut = String(corps.status ?? '').toUpperCase();

  if (statut !== 'ACTIVE' && statut !== 'INACTIVE') {
    return erreur('Vérifiez les champs.', { status: 'État inconnu.' }, 422);
  }

  if (statut === 'INACTIVE' && station.status === 'ACTIVE') {
    // REFUS 1 — l'entreprise se retrouverait sans aucun point de
    // service ouvert.
    const ouvertes = await base
      .select("SELECT COUNT(*) AS n FROM stations WHERE {ORG} AND status = 'ACTIVE'")
      .first<{ n: number }>();

    if ((ouvertes?.n ?? 0) <= 1) {
      return erreur(
        "C'est la dernière station ouverte. Ouvrez-en une autre avant de fermer celle-ci.",
        {}, 409,
      );
    }

    // REFUS 2 — des clients vont revenir chercher ces véhicules.
    const surPlace = await base
      .select(
        `SELECT COUNT(*) AS n FROM operations
          WHERE {ORG} AND station_id = ? AND status IN (${ACTIFS.map(() => '?').join(',')})`,
        id, ...ACTIFS,
      )
      .first<{ n: number }>();

    const n = surPlace?.n ?? 0;

    if (n > 0) {
      return erreur(
        n === 1
          ? 'Un véhicule est encore sur place. Terminez son dossier avant de fermer la station.'
          : `${n} véhicules sont encore sur place. Terminez leurs dossiers avant de `
            + 'fermer la station.',
        {}, 409,
      );
    }
  }

  await base
    .select('UPDATE stations SET status = ? WHERE {ORG} AND id = ?', statut, id)
    .run();

  await enregistre(env.DB, {
    action: statut === 'INACTIVE' ? 'station.closed' : 'station.reopened',
    organizationId: utilisateur.organizationId,
    stationId: id,
    userId: utilisateur.id,
    entityType: 'station',
    entityId: id,
    metadata: { from: station.status, to: statut },
  });

  return succes(
    presente({ ...station, status: statut }),
    statut === 'INACTIVE'
      ? 'Station fermée. Son historique reste consultable.'
      : 'Station rouverte.',
  );
}
