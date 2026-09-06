/**
 * L'installation guidée
 * ------------------------------------------------------------------
 * Après l'inscription, le gérant arrive sur une station vide. Cette
 * étape l'amène à la remplir : informations réelles, prestations,
 * équipe, horaires.
 *
 * POURQUOI CE PASSAGE ?
 * Parce qu'un produit qu'on ne peut pas utiliser tout de suite est un
 * produit qu'on n'utilise jamais. Sans prestation configurée, on ne
 * peut pas accueillir un véhicule — donc rien ne fonctionne.
 * L'installation guidée transforme un blocage en parcours.
 *
 * ELLE N'EST PAS BLOQUANTE POUR AUTANT : l'API n'interdit rien tant
 * qu'elle n'est pas terminée. C'est l'interface qui guide, et le
 * gérant peut la finir plus tard.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { TenantDb } from '../core/db';
import { enregistre } from '../core/audit';
import { erreur, interdit, succes } from '../core/response';

/**
 * GET /api/onboarding/status
 *
 * Où en est l'installation ? Le frontend s'en sert pour savoir quelle
 * étape afficher et si l'installation doit être proposée.
 */
export async function etat(env: Env, utilisateur: Utilisateur): Promise<Response> {
  if (!utilisateur.peut('onboarding.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);

  const org = await TenantDb.sansCloisonnement(
    env.DB,
    'SELECT name, onboarding_completed_at FROM organizations WHERE id = ? LIMIT 1',
    utilisateur.organizationId,
  ).first<{ name: string; onboarding_completed_at: string | null }>();

  // La première station, celle créée à l'inscription. C'est elle que
  // l'installation complète.
  const station = await base
    .select(
      `SELECT id, name, code, address, city, phone, opens_at, closes_at, status
         FROM stations WHERE {ORG} ORDER BY id ASC LIMIT 1`,
    )
    .first<Record<string, unknown>>();

  // Ces compteurs permettent à l'interface de reprendre là où le
  // gérant s'était arrêté, plutôt que de recommencer.
  const services = await base
    .select('SELECT COUNT(*) AS n FROM services WHERE {ORG}')
    .first<{ n: number }>();

  const equipe = await base
    .select('SELECT COUNT(*) AS n FROM users WHERE {ORG} AND deleted_at IS NULL')
    .first<{ n: number }>();

  return succes({
    completed: (org?.onboarding_completed_at ?? null) !== null,
    organization_name: org?.name ?? '',
    station: station === null ? null : {
      ...station,
      // Comme partout : HH:MM, la forme qu'attend `<input type="time">`.
      opens_at: typeof station.opens_at === 'string' ? station.opens_at.slice(0, 5) : null,
      closes_at: typeof station.closes_at === 'string' ? station.closes_at.slice(0, 5) : null,
    },
    services_count: services?.n ?? 0,
    team_count: equipe?.n ?? 0,
  });
}

/**
 * POST /api/onboarding/complete
 *
 * Marque l'installation terminée. On vérifie qu'au moins une
 * prestation existe : sans catalogue, le gérant arriverait sur un
 * tableau de bord d'où il ne pourrait rien faire.
 */
export async function termine(env: Env, utilisateur: Utilisateur): Promise<Response> {
  //  et non un droit dédié : terminer l'installation,
  // c'est valider le paramétrage de la station. On n'invente pas une
  // permission quand il en existe une juste.
  // `stations.update` et non un droit dédié : terminer l'installation,
  // c'est valider le paramétrage de la station. On n'invente pas une
  // permission quand il en existe une juste.
  if (!utilisateur.peut('stations.update')) {
    return interdit();
  }

  const services = await baseDe(utilisateur, env.DB)
    .select('SELECT COUNT(*) AS n FROM services WHERE {ORG}')
    .first<{ n: number }>();

  if ((services?.n ?? 0) === 0) {
    return erreur(
      'Ajoutez au moins une prestation avant de terminer : sans catalogue, vous ne '
      + 'pourrez pas enregistrer de véhicule.',
      { services: 'Au moins une prestation est nécessaire.' },
      422,
    );
  }

  await TenantDb.sansCloisonnement(
    env.DB,
    "UPDATE organizations SET onboarding_completed_at = datetime('now') WHERE id = ?",
    utilisateur.organizationId,
  ).run();

  await enregistre(env.DB, {
    action: 'onboarding.completed',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
  });

  return succes(null, 'Votre station est prête.');
}
