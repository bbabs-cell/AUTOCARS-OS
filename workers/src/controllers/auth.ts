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

import { verifiePassword } from '../core/password';
import { signe } from '../core/jwt';
import { droitsDe } from '../core/permissions';
import { erreur, succes } from '../core/response';

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

  const dureeMinutes = Number.parseInt(env.JWT_ACCESS_TTL_MINUTES ?? '30', 10);
  const jeton = await signe(
    { sub: utilisateur.id, org: utilisateur.organization_id },
    env.JWT_SECRET,
    dureeMinutes * 60,
  );

  return succes({
    access_token: jeton,
    expires_in: dureeMinutes * 60,
    user: {
      id: utilisateur.id,
      organization_id: utilisateur.organization_id,
      email: utilisateur.email,
      full_name: `${utilisateur.first_name} ${utilisateur.last_name}`.trim(),
      role: utilisateur.role,
      station_ids: stations.results.map((s) => s.station_id),
      permissions: droitsDe(utilisateur.role),
    },
  }, 'Bienvenue.');
}
