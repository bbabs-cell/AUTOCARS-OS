/**
 * Les paramètres de l'entreprise
 * ==================================================================
 * TROIS CHAMPS MODIFIABLES, ET TROIS QU'ON REFUSE DE RENDRE
 * MODIFIABLES. Les seconds demandent plus d'explications que les
 * premiers.
 * ==================================================================
 *
 * MODIFIABLE : la raison sociale, le téléphone, l'e-mail. Ce sont des
 * coordonnées : elles changent, elles n'engagent aucune donnée déjà
 * écrite, et personne n'est surpris de pouvoir les corriger.
 *
 * ------------------------------------------------------------------
 * LA DEVISE NE SE CHANGE PAS DEPUIS UN ÉCRAN
 *
 * C'est le refus le plus important de ce module.
 *
 * Tous les montants du produit sont des ENTIERS dans la plus petite
 * unité de la devise. En franc CFA, cette unité est le franc
 * lui-même : 5000 se lit « 5 000 F ». Passer la devise à l'euro ne
 * convertirait rien du tout — les 5000 déjà en base deviendraient
 * « 50,00 € ». Le chiffre d'affaires de la station serait divisé par
 * cent, en silence, d'un seul clic dans un formulaire.
 *
 * Changer de devise est une MIGRATION DE DONNÉES, pas un réglage.
 * Elle demande de convertir chaque montant, chaque prix du catalogue,
 * chaque forfait vendu et chaque écriture de caisse — et de décider à
 * quel taux. Tant que ce travail n'est pas fait, le champ est affiché
 * et verrouillé, avec sa raison.
 *
 * ------------------------------------------------------------------
 * LE FUSEAU ET LE PAYS NON PLUS, MAIS POUR UNE AUTRE RAISON
 *
 * Le serveur calcule « aujourd'hui » en UTC — ce qui est EXACT pour
 * le Sénégal, la Gambie, la Guinée et le Mali, à UTC+0 toute l'année.
 * La colonne `timezone` existe pour le jour d'une station au
 * Cameroun, mais aucun calcul ne la lit encore.
 *
 * Un champ modifiable qui ne change rien est pire qu'un champ
 * absent : le gérant croit avoir réglé son fuseau, et la recette
 * continue de basculer à minuit UTC. On l'affiche donc en lecture
 * seule, et il deviendra modifiable le jour où les requêtes le
 * liront.
 */

import { type Utilisateur } from '../core/auth';
import { TenantDb } from '../core/db';
import { enregistre } from '../core/audit';
import { erreur, interdit, introuvable, succes } from '../core/response';

interface LigneEntreprise {
  id: number;
  name: string;
  slug: string;
  phone: string | null;
  email: string | null;
  country_code: string;
  currency_code: string;
  timezone: string;
  created_at: string | null;
  onboarding_completed_at: string | null;
}

/**
 * La table `organizations` EST le client : elle n'a pas de colonne
 * `organization_id` à filtrer. C'est l'un des deux seuls endroits où
 * la sortie du cloisonnement est légitime — et elle est écrite avec
 * le nom qui se remarque en relecture.
 */
const entreprise = (db: D1Database, id: number) =>
  TenantDb.sansCloisonnement(
    db,
    `SELECT id, name, slug, phone, email, country_code, currency_code, timezone,
            created_at, onboarding_completed_at
       FROM organizations WHERE id = ? LIMIT 1`,
    id,
  ).first<LigneEntreprise>();

async function presente(env: Env, o: LigneEntreprise) {
  // Deux chiffres qui donnent la taille de l'entreprise. Ils tiennent
  // en deux COUNT et évitent au frontend d'appeler deux autres écrans
  // pour les afficher.
  const base = TenantDb.pour(env.DB, o.id);

  const stations = await base
    .select('SELECT COUNT(*) AS n FROM stations WHERE {ORG}')
    .first<{ n: number }>();

  const equipe = await base
    .select('SELECT COUNT(*) AS n FROM users WHERE {ORG} AND deleted_at IS NULL')
    .first<{ n: number }>();

  return {
    id: o.id,
    name: o.name,
    // Le slug apparaît dans les URL et les références : le modifier
    // casserait des liens déjà envoyés. On le montre, on ne le
    // reprend pas.
    slug: o.slug,
    phone: o.phone,
    email: o.email,

    // Les trois valeurs verrouillées. Elles sont envoyées pour être
    // AFFICHÉES et expliquées, pas pour être reprises dans un
    // formulaire — voir la note de tête.
    country_code: o.country_code,
    currency_code: o.currency_code,
    timezone: o.timezone,

    created_at: o.created_at,
    onboarding_completed_at: o.onboarding_completed_at,
    station_count: stations?.n ?? 0,
    member_count: equipe?.n ?? 0,
  };
}

/** GET /api/organization */
export async function montre(env: Env, utilisateur: Utilisateur): Promise<Response> {
  if (!utilisateur.peut('organization.view')) {
    return interdit();
  }

  const o = await entreprise(env.DB, utilisateur.organizationId);

  // Ne devrait jamais arriver : l'utilisateur est authentifié, donc
  // son entreprise existe. On répond proprement plutôt que de laisser
  // une erreur remonter.
  return o === null
    ? introuvable("Cette entreprise n'existe pas.")
    : succes(await presente(env, o));
}

/** PUT /api/organization */
export async function modifie(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('organization.update')) {
    return interdit();
  }

  const o = await entreprise(env.DB, utilisateur.organizationId);

  if (o === null) {
    return introuvable("Cette entreprise n'existe pas.");
  }

  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const texte = (k: string) => (typeof corps[k] === 'string' ? (corps[k] as string).trim() : '');
  const nom = texte('name');
  const email = texte('email');
  const erreurs: Record<string, string> = {};

  if (nom === '') erreurs.name = 'La raison sociale est obligatoire.';
  else if (nom.length > 150) erreurs.name = 'Ce nom est trop long.';

  if (email !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    erreurs.email = "L'adresse e-mail n'est pas valide.";
  }

  if (Object.keys(erreurs).length > 0) {
    return erreur('Vérifiez les champs.', erreurs, 422);
  }

  // `currency_code`, `country_code` et `timezone` ne sont PAS lus :
  // les envoyer dans le formulaire ne les change pas.
  await TenantDb.sansCloisonnement(
    env.DB,
    'UPDATE organizations SET name = ?, phone = ?, email = ? WHERE id = ?',
    nom,
    texte('phone') === '' ? null : texte('phone'),
    email === '' ? null : email,
    utilisateur.organizationId,
  ).run();

  await enregistre(env.DB, {
    action: 'organization.updated',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'organization',
    entityId: utilisateur.organizationId,
  });

  const apres = await entreprise(env.DB, utilisateur.organizationId);

  return succes(
    apres === null ? null : await presente(env, apres),
    'Paramètres enregistrés.',
  );
}
