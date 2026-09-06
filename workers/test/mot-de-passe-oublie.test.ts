import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOT_DE_PASSE, prepareBase } from './aide';

const ADMIN = 'mamadou@diallo.sn';

const poste = async (chemin: string, corps: unknown) => {
  const res = await SELF.fetch(`https://api.test${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });

  return {
    res,
    corps: (await res.json()) as { message: string; data: any; errors: Record<string, string> },
  };
};

const demande = (email: string) => poste('/api/auth/forgot-password', { email });

const seConnecte = (email: string, password: string) =>
  poste('/api/auth/login', { email, password });

/**
 * Le jeton n'est jamais renvoyé par l'API : il part par courriel. Les
 * tests le relisent donc en base, comme le ferait quelqu'un qui a
 * accès à la boîte du destinataire — c'est-à-dire la seule personne
 * censée pouvoir s'en servir.
 */
async function jetonEnBase(): Promise<string | null> {
  const r = await env.DB
    .prepare('SELECT token_hash FROM password_resets ORDER BY id DESC LIMIT 1')
    .first<{ token_hash: string }>();

  return r?.token_hash ?? null;
}

describe('demander une réinitialisation', () => {
  beforeEach(prepareBase);

  /**
   * ==================================================================
   * LA MÊME RÉPONSE DANS TOUS LES CAS.
   * ==================================================================
   * Sinon ce formulaire deviendrait un moyen commode de découvrir
   * quelles adresses sont enregistrées.
   */
  it('répond pareil pour une adresse connue et une inconnue', async () => {
    const connue = await demande(ADMIN);
    const inconnue = await demande('personne@nulle-part.sn');

    expect(connue.res.status).toBe(inconnue.res.status);
    expect(connue.corps.message).toBe(inconnue.corps.message);
    expect(connue.corps.data).toBe(inconnue.corps.data);
    expect(connue.corps.message).toContain('Si un compte existe');
  });

  it('crée un jeton pour une adresse connue', async () => {
    await demande(ADMIN);

    const n = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM password_resets')
      .first<{ n: number }>();

    expect(n?.n).toBe(1);
  });

  it("n'en crée aucun pour une adresse inconnue", async () => {
    await demande('personne@nulle-part.sn');

    const n = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM password_resets')
      .first<{ n: number }>();

    expect(n?.n).toBe(0);
  });

  it("n'en crée aucun pour un compte désactivé", async () => {
    await demande('ancien@diallo.sn');

    const n = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM password_resets')
      .first<{ n: number }>();

    expect(n?.n).toBe(0);
  });

  // LE JETON N'EST STOCKÉ QUE SOUS FORME D'EMPREINTE : une copie de la
  // base ne permet pas de fabriquer un lien valide.
  it('ne garde que l’empreinte du jeton', async () => {
    await demande(ADMIN);

    const empreinte = await jetonEnBase();

    // 64 caractères hexadécimaux : un SHA-256, pas un jeton.
    expect(empreinte).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * ==================================================================
   * LA LIMITATION EST SILENCIEUSE.
   * ==================================================================
   * Répondre « trop de demandes » distinguerait une adresse connue
   * d'une adresse inconnue — exactement l'énumération que la réponse
   * unique existe pour empêcher.
   *
   * Sans elle, six appels fabriqueraient six jetons VALIDES : chacun
   * est une occasion de plus qu'un seul fuite.
   */
  it('cesse de fabriquer des jetons au-delà de trois demandes', async () => {
    for (let i = 0; i < 6; i += 1) {
      const { res, corps } = await demande(ADMIN);

      // Le refus ne se voit NULLE PART dans la réponse.
      expect(res.status).toBe(200);
      expect(corps.message).toContain('Si un compte existe');
    }

    const n = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM password_resets')
      .first<{ n: number }>();

    expect(n?.n).toBe(3);
  });

  /**
   * LA TRACE PORTE L'ADRESSE PARCE QUE LA LIMITATION LA CHERCHE.
   *
   * Une première version côté PHP comptait les demandes sans jamais
   * écrire l'adresse : le compte valait toujours zéro, et la
   * limitation était inerte. Ce test vérifie la donnée, pas le code
   * qui la lit.
   */
  it("écrit l'adresse dans la trace, faute de quoi la limitation serait inerte", async () => {
    await demande(ADMIN);

    const t = await env.DB
      .prepare(
        "SELECT json_extract(metadata, '$.email') AS email FROM audit_logs "
        + "WHERE action = 'auth.password_reset_requested'",
      )
      .first<{ email: string }>();

    expect(t?.email).toBe(ADMIN);
  });

  it('refuse une adresse mal formée', async () => {
    const { res, corps } = await demande('pas-une-adresse');

    expect(res.status).toBe(422);
    expect(corps.errors.email).toBeDefined();
  });
});

// ====================================================================

describe('utiliser le lien de réinitialisation', () => {
  beforeEach(prepareBase);

  /**
   * On fabrique le jeton en base plutôt que de le lire dans un
   * courriel : le test contrôle ainsi la valeur exacte, et la route
   * est exercée comme elle le sera en vrai.
   */
  const NOUVEAU = 'NouveauMotDePasse2026!';

  async function poseUnJeton(
    valeur = 'jeton-de-test-0123456789',
    quand = "datetime('now', '+1 hour')",
    utilise = false,
  ): Promise<string> {
    const octets = await crypto.subtle.digest(
      'SHA-256', new TextEncoder().encode(valeur),
    );
    const empreinte = [...new Uint8Array(octets)]
      .map((o) => o.toString(16).padStart(2, '0')).join('');

    await env.DB
      .prepare(
        `INSERT INTO password_resets (user_id, token_hash, expires_at, used_at)
         VALUES (1, ?, ${quand}, ${utilise ? "datetime('now')" : 'NULL'})`,
      )
      .bind(empreinte)
      .run();

    return valeur;
  }

  it('change le mot de passe et permet de se connecter', async () => {
    const jeton = await poseUnJeton();

    const { res, corps } = await poste('/api/auth/reset-password', {
      token: jeton, password: NOUVEAU,
    });

    expect(res.status).toBe(200);
    expect(corps.message).toContain('Vous pouvez vous connecter');

    expect((await seConnecte(ADMIN, NOUVEAU)).res.status).toBe(200);
    expect((await seConnecte(ADMIN, MOT_DE_PASSE)).res.status).toBe(401);
  });

  it('le mot de passe est haché, jamais stocké en clair', async () => {
    const jeton = await poseUnJeton();
    await poste('/api/auth/reset-password', { token: jeton, password: NOUVEAU });

    const u = await env.DB
      .prepare('SELECT password_hash FROM users WHERE id = 1')
      .first<{ password_hash: string }>();

    expect(u?.password_hash).not.toContain(NOUVEAU);
    expect(u?.password_hash).toMatch(/^pbkdf2\$\d+\$/);
  });

  // UN LIEN NE SERT QU'UNE FOIS.
  it('le même lien ne se réutilise pas', async () => {
    const jeton = await poseUnJeton();
    await poste('/api/auth/reset-password', { token: jeton, password: NOUVEAU });

    const { res, corps } = await poste('/api/auth/reset-password', {
      token: jeton, password: 'EncoreUnAutre2026!',
    });

    expect(res.status).toBe(400);
    expect(corps.message).toContain('invalide ou a expiré');
  });

  it('un lien expiré est refusé', async () => {
    const jeton = await poseUnJeton('expire-0123456789', "datetime('now', '-1 hour')");

    const { res } = await poste('/api/auth/reset-password', {
      token: jeton, password: NOUVEAU,
    });

    expect(res.status).toBe(400);
  });

  // Un seul message pour « inconnu », « déjà utilisé » et « expiré » :
  // les distinguer renseignerait sur l'existence d'un lien.
  it('un jeton inventé donne exactement le même refus qu’un jeton expiré', async () => {
    const expire = await poseUnJeton('expire2-0123456789', "datetime('now', '-1 hour')");

    const a = await poste('/api/auth/reset-password', { token: expire, password: NOUVEAU });
    const b = await poste('/api/auth/reset-password', { token: 'inventé', password: NOUVEAU });

    expect(a.res.status).toBe(b.res.status);
    expect(a.corps.message).toBe(b.corps.message);
  });

  /**
   * TOUTES LES SESSIONS OUVERTES SONT FERMÉES.
   *
   * Si quelqu'un s'était introduit dans le compte, il perd l'accès à
   * l'instant même où le mot de passe change.
   */
  it('ferme les sessions ouvertes du compte', async () => {
    await seConnecte(ADMIN, MOT_DE_PASSE);

    const avant = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = 1 AND revoked_at IS NULL')
      .first<{ n: number }>();

    expect(avant?.n).toBeGreaterThan(0);

    const jeton = await poseUnJeton();
    await poste('/api/auth/reset-password', { token: jeton, password: NOUVEAU });

    const apres = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = 1 AND revoked_at IS NULL')
      .first<{ n: number }>();

    expect(apres?.n).toBe(0);
  });

  it('refuse un mot de passe trop court', async () => {
    const jeton = await poseUnJeton();

    const { res, corps } = await poste('/api/auth/reset-password', {
      token: jeton, password: 'court',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.password).toBeDefined();

    // Et le jeton reste utilisable : le refus porte sur la saisie,
    // pas sur le lien.
    const encore = await poste('/api/auth/reset-password', {
      token: jeton, password: NOUVEAU,
    });

    expect(encore.res.status).toBe(200);
  });
});
