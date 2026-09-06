/**
 * L'équipe de la station
 * ------------------------------------------------------------------
 * QUI TRAVAILLE ICI, AVEC QUEL RÔLE, ET CE QU'IL A FAIT.
 *
 * ------------------------------------------------------------------
 * DEUX RÈGLES QUI STRUCTURENT TOUT LE MODULE
 *
 * 1. ON NE SUPPRIME PAS UN EMPLOYÉ QUI PART.
 *    Son nom figure sur des inspections, des encaissements et des
 *    restitutions : effacer la ligne casserait cet historique, qui
 *    est précisément ce qui sert en cas de litige. On DÉSACTIVE le
 *    compte — l'accès est coupé immédiatement, la trace reste.
 *
 * 2. ON NE PEUT PAS DÉSACTIVER LE DERNIER ADMINISTRATEUR.
 *    Une entreprise dont plus personne ne peut gérer les comptes est
 *    enfermée dehors, et il faudrait intervenir en base pour l'en
 *    sortir. Le refus est explicite plutôt que subi.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import type { TenantDb } from '../core/db';
import { enregistre } from '../core/audit';
import { hachePassword } from '../core/password';
import { erreur, interdit, introuvable, succes } from '../core/response';

const ROLES = ['ADMIN', 'MANAGER', 'EMPLOYEE'];

interface LigneMembre {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  status: string;
  last_login_at: string | null;
  role: string;
  station_id: number;
  station_ids: string | null;
  station_names: string | null;
  station_count: number;
}

/**
 * UNE LIGNE PAR PERSONNE, PAS PAR RATTACHEMENT.
 *
 * `station_users` porte une ligne par station : un administrateur
 * rattaché à deux stations apparaissait deux fois dans la liste de
 * l'équipe. Le défaut est resté invisible tant que personne n'avait
 * plus d'une station.
 *
 * ------------------------------------------------------------------
 * LE RÔLE LE PLUS ÉLEVÉ, SANS DEVINER L'ORDRE
 *
 * Le PHP écrivait `MIN(FIELD(role, 'ADMIN', 'MANAGER', 'EMPLOYEE'))`
 * pour rendre l'ordre explicite : trier sur le texte donnerait
 * ADMIN < EMPLOYEE < MANAGER, c'est-à-dire un résultat juste par
 * accident. `FIELD()` n'existe pas en SQLite ; le `CASE` ci-dessous
 * dit la même chose, et le dit aussi clairement.
 *
 * Les stations passent par des sous-requêtes plutôt que par un
 * `GROUP_CONCAT` : SQLite ne sait pas combiner DISTINCT, ORDER BY et
 * séparateur dans le même appel, et une liste de stations dans le
 * désordre change d'un affichage à l'autre.
 */
const MEMBRE = `
  SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.status, u.last_login_at,
         (SELECT su.role FROM station_users su WHERE su.user_id = u.id
           ORDER BY CASE su.role WHEN 'ADMIN' THEN 1 WHEN 'MANAGER' THEN 2 ELSE 3 END
           LIMIT 1) AS role,
         (SELECT MIN(su.station_id) FROM station_users su WHERE su.user_id = u.id) AS station_id,
         (SELECT group_concat(x.station_id)
            FROM (SELECT DISTINCT su.station_id FROM station_users su
                   WHERE su.user_id = u.id ORDER BY su.station_id) x) AS station_ids,
         (SELECT group_concat(x.name, ', ')
            FROM (SELECT DISTINCT s.name FROM station_users su
                    JOIN stations s ON s.id = su.station_id
                   WHERE su.user_id = u.id ORDER BY s.name) x) AS station_names,
         (SELECT COUNT(DISTINCT su.station_id) FROM station_users su
           WHERE su.user_id = u.id) AS station_count
    FROM users u
   WHERE u.{ORG} AND u.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM station_users su WHERE su.user_id = u.id)`;

const ORDRE = `
  ORDER BY CASE role WHEN 'ADMIN' THEN 1 WHEN 'MANAGER' THEN 2 ELSE 3 END, u.last_name`;

function presente(m: LigneMembre) {
  return {
    id: m.id,
    first_name: m.first_name,
    last_name: m.last_name,
    full_name: `${m.first_name} ${m.last_name}`.trim(),
    email: m.email,
    phone: m.phone,
    role: m.role,
    status: m.status,
    station_id: m.station_id,
    station_name: (m.station_names ?? '').split(', ')[0] ?? '',
    // La liste complète quand la personne est rattachée à plusieurs
    // stations : « Dakar Plateau, Thiès ».
    station_names: m.station_names,
    station_ids: (m.station_ids ?? '').split(',').filter((s) => s !== '').map(Number),
    station_count: m.station_count,
    last_login_at: m.last_login_at,
  };
}

/** GET /api/team */
export async function equipe(env: Env, utilisateur: Utilisateur): Promise<Response> {
  if (!utilisateur.peut('employees.view')) {
    return interdit();
  }

  const lignes = await baseDe(utilisateur, env.DB)
    .select(`${MEMBRE} ${ORDRE}`)
    .all<LigneMembre>();

  // Le tableau est renvoyé À LA RACINE de `data` : c'est ce que le
  // service Angular lit — `ApiResponse<TeamMember[]>`, pas
  // `{ members: … }`.
  return succes(lignes.results.map(presente));
}

/**
 * GET /api/team/activity?from=
 *
 * Ce que chacun a produit sur la période : dossiers pris en charge,
 * et ce qu'ils ont rapporté.
 *
 * LE CHIFFRE D'AFFAIRES N'EST ENVOYÉ QU'À QUI A LE DROIT DE VOIR DES
 * MONTANTS. Comme au tableau de bord, il n'est pas masqué par
 * l'interface : il n'est pas envoyé.
 */
export async function activite(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('employees.view')) {
    return interdit();
  }

  // Par défaut le mois en cours : c'est la période de la paie.
  const jour = new Date().toISOString().slice(0, 10);
  const demande = new URL(request.url).searchParams.get('from');
  const depuis = demande ?? `${jour.slice(0, 7)}-01`;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(depuis)) {
    return erreur('Vérifiez les champs.', {
      from: 'Date attendue au format AAAA-MM-JJ.',
    }, 422);
  }

  const base = baseDe(utilisateur, env.DB);
  const argent = utilisateur.peut('reports.view');

  const membres = await base.select(`${MEMBRE} ${ORDRE}`).all<LigneMembre>();

  const activite = await base
    .select(
      `SELECT assigned_user_id AS user_id, COUNT(*) AS operations,
              COALESCE(SUM(price), 0) AS revenue
         FROM operations
        WHERE {ORG} AND assigned_user_id IS NOT NULL AND status != 'CANCELLED'
          AND created_at >= ?
        GROUP BY assigned_user_id`,
      `${depuis} 00:00:00`,
    )
    .all<{ user_id: number; operations: number; revenue: number }>();

  return succes({
    from: depuis,
    members: membres.results.map((m) => {
      const ligne = activite.results.find((a) => a.user_id === m.id);

      return {
        id: m.id,
        full_name: `${m.first_name} ${m.last_name}`.trim(),
        role: m.role,
        status: m.status,
        operations: ligne?.operations ?? 0,
        ...(argent ? { revenue: ligne?.revenue ?? 0 } : {}),
      };
    }),
    can_see_money: argent,
  });
}

/** Un membre de l'équipe, ou null. */
async function membre(base: TenantDb, id: number) {
  return await base.select(`${MEMBRE} AND u.id = ? LIMIT 1`, id).first<LigneMembre>();
}

/** POST /api/team */
export async function ajoute(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('employees.create')) {
    return interdit();
  }

  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const texte = (k: string) => (typeof corps[k] === 'string' ? (corps[k] as string).trim() : '');
  const prenom = texte('first_name');
  const nom = texte('last_name');
  const email = texte('email').toLowerCase();
  const motDePasse = typeof corps.password === 'string' ? corps.password : '';
  const role = texte('role').toUpperCase();
  const telephone = texte('phone');
  const stationId = Number(corps.station_id);

  const erreurs: Record<string, string> = {};

  if (prenom === '' || prenom.length > 80) erreurs.first_name = 'Le prénom est obligatoire.';
  if (nom === '' || nom.length > 80) erreurs.last_name = 'Le nom est obligatoire.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) erreurs.email = "L'adresse e-mail n'est pas valide.";
  if (motDePasse.length < 10) erreurs.password = 'Le mot de passe doit faire au moins 10 caractères.';
  if (!ROLES.includes(role)) erreurs.role = 'Rôle inconnu.';
  if (!Number.isInteger(stationId) || stationId <= 0) erreurs.station_id = 'La station est obligatoire.';

  if (Object.keys(erreurs).length > 0) {
    return erreur('Vérifiez les champs.', erreurs, 422);
  }

  // L'unicité porte sur TOUTE la base, pas sur l'entreprise : deux
  // comptes de même adresse ne sauraient pas à qui appartient une
  // connexion.
  const existe = await env.DB
    .prepare('SELECT 1 FROM users WHERE email = ? LIMIT 1')
    .bind(email)
    .first();

  if (existe !== null) {
    return erreur('Vérifiez les champs.', {
      email: 'Cette adresse e-mail est déjà utilisée.',
    }, 422);
  }

  const base = baseDe(utilisateur, env.DB);

  // La station doit appartenir à l'entreprise. Sans cette
  // vérification, on pourrait rattacher un employé à la station d'un
  // concurrent en modifiant simplement le formulaire — le
  // cloisonnement filtre les lectures, c'est ICI que la cohérence
  // métier se vérifie.
  const station = await base
    .select('SELECT id FROM stations WHERE {ORG} AND id = ? LIMIT 1', stationId)
    .first();

  if (station === null) {
    return erreur('Vérifiez les champs.', { station_id: "Cette station n'existe pas." }, 422);
  }

  const empreinte = await hachePassword(motDePasse);

  const ecrit = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (organization_id, first_name, last_name, email, phone,
                          password_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
    ).bind(
      utilisateur.organizationId, prenom, nom, email,
      telephone === '' ? null : telephone, empreinte,
    ),
    env.DB.prepare(
      `INSERT INTO station_users (organization_id, station_id, user_id, role)
       VALUES (?, ?, last_insert_rowid(), ?)`,
    ).bind(utilisateur.organizationId, stationId, role),
  ]);

  const id = Number(ecrit[0].meta.last_row_id);

  // Une création de compte est une action sensible : elle donne accès
  // aux données de l'entreprise. Elle est journalisée.
  await enregistre(env.DB, {
    action: 'team.member_created',
    organizationId: utilisateur.organizationId,
    stationId,
    userId: utilisateur.id,
    entityType: 'user',
    entityId: id,
    metadata: { email, role },
  });

  return succes({ id }, 'Membre ajouté. Communiquez-lui son mot de passe.', 201);
}

/**
 * PUT /api/team/{id}
 * Modifier le rôle ou l'état d'un membre.
 */
export async function modifie(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  membreId: string,
): Promise<Response> {
  if (!utilisateur.peut('employees.update')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(membreId, 10);
  const avant = await membre(base, id);

  if (avant === null) {
    return introuvable('Cette personne ne fait pas partie de votre équipe.');
  }

  let corps: { role?: unknown; status?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const role = String(corps.role ?? '').toUpperCase();
  const statut = String(corps.status ?? '').toUpperCase();
  const erreurs: Record<string, string> = {};

  if (!ROLES.includes(role)) erreurs.role = 'Rôle inconnu.';
  if (statut !== 'ACTIVE' && statut !== 'DISABLED') erreurs.status = 'État inconnu.';

  if (Object.keys(erreurs).length > 0) {
    return erreur('Vérifiez les champs.', erreurs, 422);
  }

  // ON NE SE RETIRE PAS SOI-MÊME SES PROPRES DROITS : le seul effet
  // garanti serait de ne plus pouvoir revenir en arrière.
  if (id === utilisateur.id && (role !== 'ADMIN' || statut !== 'ACTIVE')) {
    return erreur(
      'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre compte. '
      + 'Demandez-le à un autre administrateur.',
      {}, 409,
    );
  }

  // LE DERNIER ADMINISTRATEUR ACTIF EST INTOUCHABLE — sinon plus
  // personne ne peut gérer les comptes, et il faut intervenir
  // directement en base pour rouvrir l'entreprise.
  const etaitAdmin = avant.role === 'ADMIN' && avant.status === 'ACTIVE';
  const resteAdmin = role === 'ADMIN' && statut === 'ACTIVE';

  if (etaitAdmin && !resteAdmin) {
    const admins = await base
      .select(
        `SELECT COUNT(DISTINCT u.id) AS n FROM users u
           JOIN station_users su ON su.user_id = u.id
          WHERE u.{ORG} AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
            AND su.role = 'ADMIN'`,
      )
      .first<{ n: number }>();

    if ((admins?.n ?? 0) <= 1) {
      return erreur(
        "C'est le dernier administrateur actif. Nommez-en un autre avant de modifier celui-ci.",
        {}, 409,
      );
    }
  }

  // LE RÔLE VAUT POUR TOUTE L'ENTREPRISE, pas station par station.
  // Techniquement il est stocké dans `station_users`, donc une même
  // personne pourrait être responsable ici et employée ailleurs —
  // mais rien dans le produit ne permet de le faire, et la mise à
  // jour porte volontairement sur TOUTES ses lignes. Une permission
  // qui change selon l'endroit où l'on se trouve est très difficile
  // à expliquer à un utilisateur.
  await base
    .select('UPDATE station_users SET role = ? WHERE {ORG} AND user_id = ?', role, id)
    .run();

  await base
    .select('UPDATE users SET status = ? WHERE {ORG} AND id = ?', statut, id)
    .run();

  await enregistre(env.DB, {
    action: statut === 'DISABLED' ? 'team.member_disabled' : 'team.member_updated',
    organizationId: utilisateur.organizationId,
    stationId: avant.station_id,
    userId: utilisateur.id,
    entityType: 'user',
    entityId: id,
    metadata: {
      from: { role: avant.role, status: avant.status },
      to: { role, status: statut },
    },
  });

  return succes(
    { id, role, status: statut },
    statut === 'DISABLED'
      ? "Compte désactivé. L'historique de cette personne est conservé."
      : 'Membre mis à jour.',
  );
}

/**
 * PUT /api/team/{id}/stations
 * ==================================================================
 * OÙ TRAVAILLE CETTE PERSONNE.
 * ==================================================================
 *
 * POURQUOI UNE ROUTE À PART, ET PAS UN CHAMP DE PLUS DANS `modifie` ?
 *
 * Parce que ce sont deux décisions de nature différente, prises à des
 * moments différents. `modifie` répond à « quel est son rôle, et son
 * compte est-il ouvert ? » — c'est-à-dire CE QU'IL A LE DROIT DE
 * FAIRE. Celle-ci répond à « où travaille-t-il ? ».
 *
 * Les mélanger obligerait le formulaire d'affectation à renvoyer le
 * rôle à chaque enregistrement — et un jour, à le renvoyer faux : il
 * suffirait qu'un écran ait chargé la fiche avant un changement de
 * rôle pour le réécrire à l'ancienne valeur en déplaçant simplement
 * quelqu'un d'une station à l'autre.
 */
export async function affecte(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  membreId: string,
): Promise<Response> {
  if (!utilisateur.peut('employees.update')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(membreId, 10);
  const personne = await membre(base, id);

  if (personne === null) {
    return introuvable('Cette personne ne fait pas partie de votre équipe.');
  }

  let corps: { station_ids?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  if (!Array.isArray(corps.station_ids)) {
    return erreur('Vérifiez les champs.', {
      station_ids: 'La liste des stations est attendue.',
    }, 422);
  }

  // On normalise AVANT de valider : le navigateur envoie volontiers
  // des chaînes (« 3 ») là où on attend des entiers, et un doublon
  // dans la liste ferait échouer l'insertion sur la contrainte
  // d'unicité au lieu de produire un message compréhensible.
  const stations = [...new Set(
    corps.station_ids
      .filter((v) => typeof v === 'number' || (typeof v === 'string' && v !== ''))
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  )];

  // UNE PERSONNE SANS STATION N'A AUCUN RÔLE, DONC AUCUN DROIT. Elle
  // pourrait se connecter et ne rien pouvoir faire — un état pire que
  // ne pas exister, parce qu'il ressemble à une panne. Le compte se
  // désactive, il ne se vide pas.
  if (stations.length === 0) {
    return erreur('Vérifiez les champs.', {
      station_ids: "Choisissez au moins une station. Pour retirer l'accès à quelqu'un, "
        + 'désactivez son compte.',
    }, 422);
  }

  const actuelles = (personne.station_ids ?? '')
    .split(',').filter((s) => s !== '').map(Number);

  for (const stationId of stations) {
    const station = await base
      .select('SELECT id, name, status FROM stations WHERE {ORG} AND id = ? LIMIT 1', stationId)
      .first<{ id: number; name: string; status: string }>();

    // La lecture est cloisonnée : la station d'un concurrent est
    // indistinguable d'une station inexistante, et c'est exactement
    // ce qu'on veut répondre.
    if (station === null) {
      return erreur('Vérifiez les champs.', {
        station_ids: "Cette station n'existe pas.",
      }, 422);
    }

    // On refuse d'AJOUTER quelqu'un sur une station fermée, mais on
    // n'oblige pas à retirer ceux qui y étaient déjà : sinon, fermer
    // une station rendrait impossible le moindre enregistrement de la
    // fiche des personnes qui y travaillaient.
    if (station.status !== 'ACTIVE' && !actuelles.includes(stationId)) {
      return erreur('Vérifiez les champs.', {
        station_ids: `« ${station.name} » est fermée. Rouvrez-la avant d'y affecter quelqu'un.`,
      }, 422);
    }
  }

  await env.DB.batch([
    env.DB
      .prepare('DELETE FROM station_users WHERE organization_id = ? AND user_id = ?')
      .bind(utilisateur.organizationId, id),
    ...stations.map((stationId) =>
      env.DB
        .prepare(
          `INSERT INTO station_users (organization_id, station_id, user_id, role)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(utilisateur.organizationId, stationId, id, personne.role)),
  ]);

  await enregistre(env.DB, {
    action: 'team.member_stations_changed',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'user',
    entityId: id,
    metadata: { from: actuelles, to: stations },
  });

  return succes(
    { id, station_ids: stations },
    stations.length === 1 ? 'Affectation enregistrée.' : `${stations.length} stations affectées.`,
  );
}
