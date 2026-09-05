/**
 * POST /api/auth/login
 * ==================================================================
 * La réponse a EXACTEMENT la forme que l'application Angular attend
 * déjà : access_token, expires_in, user. C'est ce qui permet au
 * frontend de fonctionner sans être modifié.
 *
 * Le rafraîchissement par cookie tournant (lot 21) n'est pas dans
 * cette tranche : elle sert à répondre à une question de faisabilité,
 * pas à livrer l'authentification complète. Il viendra à l'étape 3.
 */

import { hachePassword, verifiePassword } from '../core/password';
import { signe } from '../core/jwt';
import { droitsDe } from '../core/permissions';
import { erreur, succes } from '../core/response';
import { emet, retrouve, revoque, revoqueTout } from '../core/tokens';
import { efface, lit, pose } from '../core/cookie';
import { enregistre } from '../core/audit';
import type { Utilisateur } from '../core/auth';

export async function connexion(request: Request, env: Env): Promise<Response> {
  let corps: { email?: unknown; password?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const email = typeof corps.email === 'string' ? corps.email.trim().toLowerCase() : '';
  const motDePasse = typeof corps.password === 'string' ? corps.password : '';

  if (email === '' || motDePasse === '') {
    return erreur('Vérifiez les champs.', {
      ...(email === '' ? { email: "L'adresse e-mail est obligatoire." } : {}),
      ...(motDePasse === '' ? { password: 'Le mot de passe est obligatoire.' } : {}),
    }, 422);
  }

  // La recherche d'un utilisateur par e-mail précède la connaissance
  // de son organisation : c'est l'un des deux seuls endroits qui
  // sortent légitimement du cloisonnement.
  const utilisateur = await env.DB.prepare(
    `SELECT u.id, u.organization_id, u.email, u.first_name, u.last_name,
            u.password_hash, u.status, su.role
       FROM users u
       LEFT JOIN station_users su ON su.user_id = u.id
      WHERE u.email = ?
      LIMIT 1`,
  )
    .bind(email)
    .first<{
      id: number;
      organization_id: number;
      email: string;
      first_name: string;
      last_name: string;
      password_hash: string;
      status: string;
      role: string | null;
    }>();

  // UN SEUL MESSAGE POUR TOUS LES ÉCHECS.
  //
  // Compte inexistant, mot de passe faux, compte suspendu, compte sans
  // station : la réponse est la même. Distinguer ces cas dirait à un
  // inconnu quelles adresses existent chez ce client.
  const echec = () => erreur('Adresse e-mail ou mot de passe incorrect.', {}, 401);

  if (utilisateur === null) {
    // On vérifie quand même un mot de passe, contre une empreinte
    // fabriquée : sinon le temps de réponse trahirait l'inexistence du
    // compte, ce que le message uniforme cherchait justement à cacher.
    await verifiePassword(motDePasse, 'pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    return echec();
  }

  const correct = await verifiePassword(motDePasse, utilisateur.password_hash);

  if (!correct || utilisateur.status !== 'ACTIVE' || utilisateur.role === null) {
    return echec();
  }

  const stations = await env.DB.prepare(
    'SELECT station_id FROM station_users WHERE user_id = ?',
  )
    .bind(utilisateur.id)
    .all<{ station_id: number }>();

  await enregistre(env.DB, {
    action: 'auth.login',
    organizationId: utilisateur.organization_id,
    userId: utilisateur.id,
  });

  return await avecSession(env, {
    id: utilisateur.id,
    organization_id: utilisateur.organization_id,
    email: utilisateur.email,
    first_name: utilisateur.first_name,
    last_name: utilisateur.last_name,
    role: utilisateur.role,
    station_ids: stations.results.map((s) => s.station_id),
  }, 'Bienvenue.');
}

/** Jours de validité du cookie de rafraîchissement. */
const JOURS_REFRESH = 7;

// `wrangler types` déduit de wrangler.toml le type LITTÉRAL
// "production", ce qui rendrait toute comparaison impossible à
// compiler. `String()` élargit au type texte — la valeur réelle peut
// être surchargée par variable d'environnement au déploiement.
const estLocal = (env: Env) => String(env.APP_ENV ?? 'production') === 'local';

interface Profil {
  id: number;
  organization_id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  station_ids: number[];
}

/**
 * Fabrique la réponse d'une session ouverte : jeton d'accès en corps,
 * jeton de rafraîchissement en cookie.
 *
 * Une seule fonction pour la connexion ET le rafraîchissement : deux
 * chemins qui posent la même chose finissent toujours par diverger,
 * et c'est le genre de divergence qui ne se voit qu'en production.
 */
async function avecSession(env: Env, p: Profil, message: string): Promise<Response> {
  const dureeMinutes = Number.parseInt(env.JWT_ACCESS_TTL_MINUTES ?? '30', 10);

  const acces = await signe({ sub: p.id, org: p.organization_id }, env.JWT_SECRET, dureeMinutes * 60);
  const rafraichissement = await emet(env.DB, p.id, p.organization_id, JOURS_REFRESH);

  const reponse = succes({
    access_token: acces,
    expires_in: dureeMinutes * 60,
    user: {
      id: p.id,
      organization_id: p.organization_id,
      email: p.email,
      full_name: `${p.first_name} ${p.last_name}`.trim(),
      role: p.role,
      station_ids: p.station_ids,
      permissions: droitsDe(p.role),
    },
  }, message);

  reponse.headers.append('Set-Cookie', pose(rafraichissement, JOURS_REFRESH, estLocal(env)));

  return reponse;
}

/**
 * POST /api/auth/refresh
 * ==================================================================
 * LA ROTATION, ET LA DÉTECTION DE REJEU
 *
 * Le jeton présenté est révoqué et remplacé à chaque appel. Un jeton
 * volé ne vaut donc que jusqu'au prochain rafraîchissement du
 * propriétaire.
 *
 * Si un jeton DÉJÀ RÉVOQUÉ revient, c'est que deux personnes
 * détiennent la même session. On ne sait pas laquelle se présente :
 * on ferme donc tout pour cet utilisateur, et on l'inscrit au journal.
 *
 * ------------------------------------------------------------------
 * UNE LEÇON DU LOT 21 QUI VAUT POUR CETTE ÉTAPE
 *
 * Livrer cette détection SEULE avait déconnecté tout le monde à chaque
 * expiration : l'application lançait une quinzaine de requêtes en
 * parallèle, chacune déclenchait son propre rafraîchissement, et le
 * second passait pour un rejeu.
 *
 * Le correctif était côté client — un seul rafraîchissement à la fois
 * — et il est DÉJÀ dans l'application Angular (`inFlightRefresh`).
 * C'est ce qui rend cette détection utilisable ici sans rien changer
 * au frontend.
 */
export async function rafraichis(request: Request, env: Env): Promise<Response> {
  const brut = lit(request);

  const echec = async (): Promise<Response> => {
    const r = erreur('Session expirée. Reconnectez-vous.', {}, 401);
    r.headers.append('Set-Cookie', efface(estLocal(env)));
    return r;
  };

  if (brut === null) {
    return await echec();
  }

  const jeton = await retrouve(env.DB, brut);

  if (jeton === null) {
    return await echec();
  }

  // LE REJEU. Un jeton révoqué qui revient n'est pas une erreur
  // ordinaire : c'est le signe qu'une copie circule.
  if (jeton.revoque) {
    await revoqueTout(env.DB, jeton.userId);
    await enregistre(env.DB, {
      action: 'auth.refresh_reuse_detected',
      organizationId: jeton.organizationId,
      userId: jeton.userId,
    });

    return await echec();
  }

  if (jeton.expire) {
    return await echec();
  }

  const p = await profil(env.DB, jeton.userId, jeton.organizationId);

  if (p === null) {
    // Compte supprimé, désactivé, ou retiré de toute station depuis
    // l'émission du jeton. La session ne se prolonge pas.
    await revoqueTout(env.DB, jeton.userId);
    return await echec();
  }

  // On révoque AVANT d'émettre : si l'émission échouait, mieux vaut
  // une session fermée qu'un jeton qui resterait valable deux fois.
  await revoque(env.DB, jeton.id);

  return await avecSession(env, p, '');
}

/**
 * POST /api/auth/logout
 *
 * Révoque le jeton présenté et efface le cookie. On ne révoque QUE
 * celui-là : se déconnecter du poste de l'accueil ne doit pas fermer
 * la session ouverte sur le téléphone du responsable.
 */
export async function deconnexion(request: Request, env: Env): Promise<Response> {
  const brut = lit(request);

  if (brut !== null) {
    const jeton = await retrouve(env.DB, brut);

    if (jeton !== null && !jeton.revoque) {
      await revoque(env.DB, jeton.id);
      await enregistre(env.DB, {
        action: 'auth.logout',
        organizationId: jeton.organizationId,
        userId: jeton.userId,
      });
    }
  }

  // On répond toujours par un succès : dire « ce jeton n'existait
  // pas » n'aiderait personne, sinon celui qui les essaie.
  const r = succes(null, 'À bientôt.');
  r.headers.append('Set-Cookie', efface(estLocal(env)));

  return r;
}

/**
 * GET /api/auth/me
 *
 * Renvoie le profil tel que la base le voit MAINTENANT — rôle,
 * stations et droits compris. L'application s'en sert au démarrage
 * pour savoir ce qu'elle a le droit d'afficher.
 */
export function moi(utilisateur: Utilisateur): Response {
  return succes({
    id: utilisateur.id,
    organization_id: utilisateur.organizationId,
    email: utilisateur.email,
    full_name: utilisateur.nomComplet,
    role: utilisateur.role,
    station_ids: utilisateur.stationIds,
    permissions: droitsDe(utilisateur.role),
  });
}

/** Le profil complet d'un utilisateur, ou null s'il ne peut plus entrer. */
async function profil(db: D1Database, userId: number, orgId: number): Promise<Profil | null> {
  const u = await db
    .prepare(
      `SELECT u.id, u.organization_id, u.email, u.first_name, u.last_name, u.status, su.role
         FROM users u JOIN station_users su ON su.user_id = u.id
        WHERE u.id = ? AND u.organization_id = ? AND u.deleted_at IS NULL
        LIMIT 1`,
    )
    .bind(userId, orgId)
    .first<{
      id: number; organization_id: number; email: string;
      first_name: string; last_name: string; status: string; role: string;
    }>();

  if (u === null || u.status !== 'ACTIVE') {
    return null;
  }

  const stations = await db
    .prepare('SELECT station_id FROM station_users WHERE user_id = ?')
    .bind(userId)
    .all<{ station_id: number }>();

  return {
    id: u.id,
    organization_id: u.organization_id,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    role: u.role,
    station_ids: stations.results.map((s) => s.station_id),
  };
}

/**
 * POST /api/auth/register
 * ==================================================================
 * Crée une organisation ET son premier administrateur. Les deux, ou
 * aucun des deux.
 *
 * ------------------------------------------------------------------
 * LE POINT QUE LE CHIFFRAGE DE LA MIGRATION CROYAIT PERDU
 *
 * En PHP, c'était une transaction : trois insertions, un `rollBack`
 * si l'une échoue. On ne veut ni organisation sans utilisateur, ni
 * utilisateur incapable de se connecter.
 *
 * D1 n'a pas de transaction interactive, et le chiffrage annonçait
 * qu'il faudrait « repenser la logique ». Ce n'est pas nécessaire :
 * `batch()` est atomique, et `last_insert_rowid()` y fonctionne — la
 * seconde insertion désigne la ligne créée par la première. Les deux
 * points sont vérifiés par `test/transactions.test.ts`.
 *
 * Le seul changement par rapport au PHP est donc l'écriture, pas la
 * logique.
 */
export async function inscription(request: Request, env: Env): Promise<Response> {
  let c: Record<string, unknown>;

  try {
    c = (await request.json()) as Record<string, unknown>;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const texte = (k: string) => (typeof c[k] === 'string' ? (c[k] as string).trim() : '');
  const champs = {
    organization_name: texte('organization_name'),
    first_name: texte('first_name'),
    last_name: texte('last_name'),
    email: texte('email').toLowerCase(),
    password: typeof c.password === 'string' ? c.password : '',
  };

  const erreurs: Record<string, string> = {};

  if (champs.organization_name === '') erreurs.organization_name = "Le nom de l'entreprise est obligatoire.";
  if (champs.first_name === '') erreurs.first_name = 'Le prénom est obligatoire.';
  if (champs.last_name === '') erreurs.last_name = 'Le nom est obligatoire.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(champs.email)) erreurs.email = "L'adresse e-mail n'est pas valide.";
  if (champs.password.length < 10) erreurs.password = 'Le mot de passe doit faire au moins 10 caractères.';

  if (Object.keys(erreurs).length > 0) {
    return erreur('Vérifiez les champs.', erreurs, 422);
  }

  const existe = await env.DB.prepare('SELECT 1 FROM users WHERE email = ? LIMIT 1')
    .bind(champs.email)
    .first();

  if (existe !== null) {
    return erreur('Vérifiez les champs.', { email: 'Cette adresse e-mail est déjà utilisée.' }, 422);
  }

  const empreinte = await hachePassword(champs.password);
  const slug = slugify(champs.organization_name) + '-' + Date.now().toString(36);

  // Les quatre insertions forment un tout. `last_insert_rowid()` fait
  // le chaînage ; `batch()` fait l'atomicité.
  await env.DB.batch([
    env.DB.prepare('INSERT INTO organizations (name, slug) VALUES (?, ?)')
      .bind(champs.organization_name, slug),
    env.DB.prepare(
      `INSERT INTO users (organization_id, first_name, last_name, email, password_hash)
       VALUES (last_insert_rowid(), ?, ?, ?, ?)`,
    ).bind(champs.first_name, champs.last_name, champs.email, empreinte),
    env.DB.prepare(
      `INSERT INTO stations (organization_id, name, code)
       VALUES ((SELECT organization_id FROM users WHERE id = last_insert_rowid()), ?, 'PRI')`,
    ).bind('Station principale'),
    env.DB.prepare(
      `INSERT INTO station_users (organization_id, station_id, user_id, role)
       SELECT s.organization_id, s.id, u.id, 'ADMIN'
         FROM stations s
         JOIN users u ON u.organization_id = s.organization_id
        WHERE s.id = last_insert_rowid()`,
    ),
  ]);

  const u = await env.DB.prepare(
    'SELECT id, organization_id FROM users WHERE email = ? LIMIT 1',
  ).bind(champs.email).first<{ id: number; organization_id: number }>();

  if (u === null) {
    return erreur("La création du compte a échoué.", {}, 500);
  }

  const stations = await env.DB.prepare('SELECT station_id FROM station_users WHERE user_id = ?')
    .bind(u.id).all<{ station_id: number }>();

  await enregistre(env.DB, {
    action: 'auth.register',
    organizationId: u.organization_id,
    userId: u.id,
  });

  return await avecSession(env, {
    id: u.id,
    organization_id: u.organization_id,
    email: champs.email,
    first_name: champs.first_name,
    last_name: champs.last_name,
    role: 'ADMIN',
    station_ids: stations.results.map((s) => s.station_id),
  }, 'Votre station est créée.');
}

function slugify(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'station';
}
