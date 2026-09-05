/**
 * Authentification — qui parle, et a-t-il le droit ?
 * ==================================================================
 * REPRISE D'UNE DÉCISION DU PHP : ON RELIT LA BASE À CHAQUE REQUÊTE
 *
 * Le jeton porte l'identifiant de l'utilisateur et de son
 * organisation, rien d'autre. Le rôle, les stations et le statut du
 * compte sont relus EN BASE à chaque requête.
 *
 * C'est plus coûteux qu'un rôle recopié dans le jeton, et c'est
 * volontaire : un compte suspendu, rétrogradé ou retiré d'une station
 * perd ses droits IMMÉDIATEMENT. Avec un rôle dans le jeton, il les
 * garderait jusqu'à l'expiration — trente minutes pendant lesquelles
 * quelqu'un qu'on vient de renvoyer travaille encore.
 */

import { autorise, droitsDe } from './permissions';
import { verifie } from './jwt';
import { TenantDb } from './db';

export interface Utilisateur {
  id: number;
  organizationId: number;
  email: string;
  nomComplet: string;
  role: string;
  stationIds: number[];
  peut(action: string): boolean;
}

/**
 * Identifie l'auteur d'une requête, ou renvoie `null`.
 *
 * `null` couvre l'absence de jeton, un jeton invalide ou expiré, un
 * compte disparu, un compte suspendu, et un compte rattaché à aucune
 * station. Du point de vue de l'appelant, ces cas sont le même : la
 * requête n'est pas authentifiée.
 */
export async function identifie(
  request: Request,
  db: D1Database,
  secret: string,
): Promise<Utilisateur | null> {
  const entete = request.headers.get('Authorization') ?? '';

  if (!entete.startsWith('Bearer ')) {
    return null;
  }

  const charge = await verifie(entete.slice(7), secret);

  if (charge === null) {
    return null;
  }

  // Le jeton dit qui prétend parler. La base dit ce qu'il a le droit
  // de faire, maintenant.
  const ligne = await db
    .prepare(
      `SELECT u.id, u.organization_id, u.email, u.first_name, u.last_name,
              u.status, su.role,
              (SELECT group_concat(station_id) FROM station_users
                WHERE user_id = u.id) AS station_ids
         FROM users u
         JOIN station_users su ON su.user_id = u.id
        WHERE u.id = ? AND u.organization_id = ?
        LIMIT 1`,
    )
    .bind(charge.sub, charge.org)
    .first<{
      id: number;
      organization_id: number;
      email: string;
      first_name: string;
      last_name: string;
      status: string;
      role: string;
      station_ids: string | null;
    }>();

  if (ligne === null || ligne.status !== 'ACTIVE') {
    return null;
  }

  const role = ligne.role;

  return {
    id: ligne.id,
    organizationId: ligne.organization_id,
    email: ligne.email,
    nomComplet: `${ligne.first_name} ${ligne.last_name}`.trim(),
    role,
    stationIds: (ligne.station_ids ?? '')
      .split(',')
      .filter((s) => s !== '')
      .map(Number),
    peut: (action: string) => autorise(role, action),
  };
}

/** Les droits d'un utilisateur, pour les renvoyer au frontend. */
export const droitsDeLUtilisateur = (u: Utilisateur) => droitsDe(u.role);

/** L'accès aux données, cloisonné sur l'organisation de cet utilisateur. */
export const baseDe = (u: Utilisateur, db: D1Database) =>
  TenantDb.pour(db, u.organizationId);
