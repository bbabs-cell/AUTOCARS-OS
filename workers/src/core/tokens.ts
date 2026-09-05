/**
 * Jetons de rafraîchissement — rotation et détection de rejeu
 * ==================================================================
 * Porté du lot 21. Trois décisions y sont reprises telles quelles,
 * parce qu'elles avaient chacune une raison chèrement acquise.
 *
 * ------------------------------------------------------------------
 * 1. LE JETON N'EST JAMAIS STOCKÉ EN CLAIR
 *
 * La base ne garde que son empreinte SHA-256. Quelqu'un qui lirait la
 * table — sauvegarde égarée, accès en lecture à la base — n'y
 * trouverait rien d'utilisable pour se connecter.
 *
 * SHA-256 sans sel suffit ICI, contrairement aux mots de passe : un
 * jeton est 32 octets tirés au hasard, pas un mot choisi par un
 * humain. Il n'y a pas de dictionnaire à essayer.
 *
 * ------------------------------------------------------------------
 * 2. UN JETON NE SERT QU'UNE FOIS (ROTATION)
 *
 * Chaque rafraîchissement révoque le jeton présenté et en émet un
 * nouveau. Un jeton volé n'a donc de valeur que jusqu'au prochain
 * rafraîchissement du propriétaire légitime.
 *
 * ------------------------------------------------------------------
 * 3. UN JETON DÉJÀ RÉVOQUÉ QUI REVIENT EST UNE ALERTE
 *
 * Si un jeton déjà utilisé est présenté à nouveau, deux personnes
 * détiennent la même session : le propriétaire et quelqu'un d'autre.
 * On ne sait pas lequel des deux se présente, donc on révoque TOUT
 * pour cet utilisateur et on l'inscrit au journal d'audit.
 *
 * C'est brutal — le propriétaire légitime est déconnecté — et c'est
 * voulu : mieux vaut une reconnexion qu'un intrus qui reste.
 */

const OCTETS = 32;

export interface JetonLu {
  id: number;
  userId: number;
  organizationId: number;
  revoque: boolean;
  expire: boolean;
}

/**
 * Émet un jeton, l'enregistre, et renvoie sa forme en clair.
 *
 * La forme en clair n'existe qu'ici et dans le cookie du navigateur.
 * Elle n'est jamais réécrite ni journalisée.
 */
export async function emet(
  db: D1Database,
  userId: number,
  organizationId: number,
  jours: number,
): Promise<string> {
  const brut = base64url(crypto.getRandomValues(new Uint8Array(OCTETS)));
  const expire = new Date(Date.now() + jours * 86_400_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

  await db
    .prepare(
      `INSERT INTO refresh_tokens (organization_id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(organizationId, userId, await empreinte(brut), expire)
    .run();

  return brut;
}

/**
 * Retrouve un jeton, révoqué ou non, expiré ou non.
 *
 * On renvoie DÉLIBÉRÉMENT les jetons révoqués et expirés au lieu de
 * les ignorer : c'est ce qui permet à l'appelant de distinguer « ce
 * jeton n'a jamais existé » de « ce jeton a déjà servi », et donc de
 * détecter un rejeu. Une requête qui filtrerait sur `revoked_at IS
 * NULL` rendrait la détection impossible.
 */
export async function retrouve(db: D1Database, brut: string): Promise<JetonLu | null> {
  const ligne = await db
    .prepare(
      `SELECT id, user_id, organization_id, revoked_at, expires_at
         FROM refresh_tokens WHERE token_hash = ? LIMIT 1`,
    )
    .bind(await empreinte(brut))
    .first<{
      id: number;
      user_id: number;
      organization_id: number;
      revoked_at: string | null;
      expires_at: string;
    }>();

  if (ligne === null) {
    return null;
  }

  return {
    id: ligne.id,
    userId: ligne.user_id,
    organizationId: ligne.organization_id,
    revoque: ligne.revoked_at !== null,
    expire: new Date(ligne.expires_at.replace(' ', 'T') + 'Z').getTime() <= Date.now(),
  };
}

export async function revoque(db: D1Database, id: number): Promise<void> {
  await db
    .prepare("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL")
    .bind(id)
    .run();
}

/** Ferme toutes les sessions d'un utilisateur. Voir la décision n° 3. */
export async function revoqueTout(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare("UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL")
    .bind(userId)
    .run();
}

async function empreinte(brut: string): Promise<string> {
  const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(brut));

  return [...new Uint8Array(bits)].map((o) => o.toString(16).padStart(2, '0')).join('');
}

function base64url(octets: Uint8Array): string {
  return btoa(String.fromCharCode(...octets))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
