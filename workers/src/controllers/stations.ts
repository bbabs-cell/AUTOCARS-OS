/**
 * GET /api/stations
 * ==================================================================
 * La liste des stations de l'organisation. Elle alimente le filtre de
 * l'en-tête, présent sur tous les écrans : sans elle, l'application
 * reste en chargement même quand le reste répond.
 *
 * C'est ce qui l'a fait entrer dans cette étape : la file d'attente
 * ne s'affichait pas, et la cause n'était pas la file.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { interdit, succes } from '../core/response';
import { ACTIFS } from '../core/etats';

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
      // lui qui permet de refuser la fermeture d'une station où des
      // véhicules attendent encore.
      `SELECT s.id, s.name, s.code, s.address, s.city, s.phone,
              s.opens_at, s.closes_at, s.status,
              (SELECT COUNT(*) FROM operations o
                WHERE o.station_id = s.id
                  AND o.status IN (${ACTIFS.map(() => '?').join(',')})) AS vehicles_on_site
         FROM stations s
        WHERE s.{ORG}
        ORDER BY s.name ASC`,
      ...ACTIFS,
    )
    .all<Record<string, unknown>>();

  return succes(lignes.results);
}
