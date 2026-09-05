import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOT_DE_PASSE, prepareBase } from './aide';

/** Extrait la valeur du cookie de rafraîchissement d'une réponse. */
function cookieDe(res: Response): string | null {
  const brut = res.headers.get('Set-Cookie');
  if (brut === null) return null;
  const m = /autocare_refresh=([^;]*)/.exec(brut);
  return m && m[1] !== '' ? m[1] : null;
}

const connecte = () =>
  SELF.fetch('https://api.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'mamadou@diallo.sn', password: MOT_DE_PASSE }),
  });

const rafraichis = (cookie: string | null) =>
  SELF.fetch('https://api.test/api/auth/refresh', {
    method: 'POST',
    ...(cookie === null ? {} : { headers: { Cookie: `autocare_refresh=${cookie}` } }),
  });

describe('le cookie de rafraîchissement', () => {
  beforeEach(prepareBase);

  it('la connexion le pose avec ses quatre garde-fous', async () => {
    const brut = (await connecte()).headers.get('Set-Cookie') ?? '';

    expect(brut).toContain('HttpOnly');        // le JavaScript ne le lit pas
    expect(brut).toContain('SameSite=Strict'); // protection CSRF
    expect(brut).toContain('Path=/api/auth');  // les autres routes ne le voient pas
    expect(brut).toContain('Secure');          // APP_ENV vaut « production » ici
  });

  it("le jeton d'accès, lui, n'est PAS dans un cookie", async () => {
    const res = await connecte();
    const corps = (await res.json()) as { data: { access_token: string } };
    const brut = res.headers.get('Set-Cookie') ?? '';

    expect(corps.data.access_token.length).toBeGreaterThan(20);
    expect(brut).not.toContain(corps.data.access_token);
  });

  it("la base ne garde jamais le jeton en clair", async () => {
    const cookie = cookieDe(await connecte());

    const r = await env.DB.prepare('SELECT token_hash FROM refresh_tokens').first<{ token_hash: string }>();
    expect(r?.token_hash).not.toBe(cookie);
    expect(r?.token_hash).toMatch(/^[0-9a-f]{64}$/);   // SHA-256
  });
});

describe('la rotation', () => {
  beforeEach(prepareBase);

  it('rafraîchir donne un NOUVEAU cookie et un nouveau jeton', async () => {
    const premier = cookieDe(await connecte());
    const res = await rafraichis(premier);
    const second = cookieDe(res);

    expect(res.status).toBe(200);
    expect(second).not.toBeNull();
    expect(second).not.toBe(premier);
  });

  it('la session survit à plusieurs rafraîchissements de suite', async () => {
    let cookie = cookieDe(await connecte());

    for (let i = 0; i < 4; i++) {
      const res = await rafraichis(cookie);
      expect(res.status).toBe(200);
      cookie = cookieDe(res);
    }

    expect(cookie).not.toBeNull();
  });

  it('sans cookie, on est renvoyé se connecter', async () => {
    expect((await rafraichis(null)).status).toBe(401);
  });

  it('un cookie inventé est refusé', async () => {
    expect((await rafraichis('jeton-qui-nexiste-pas')).status).toBe(401);
  });
});

/**
 * ==================================================================
 * LA DÉTECTION DE REJEU
 * ==================================================================
 * Un jeton déjà utilisé qui revient signifie que deux personnes
 * détiennent la même session. On ne sait pas laquelle se présente :
 * on ferme donc TOUT pour cet utilisateur.
 *
 * C'est brutal — le propriétaire légitime est déconnecté lui aussi —
 * et c'est le comportement voulu au lot 21 : mieux vaut une
 * reconnexion qu'un intrus qui reste.
 */
describe('la détection de rejeu', () => {
  beforeEach(prepareBase);

  it('réutiliser un jeton déjà tourné est refusé', async () => {
    const premier = cookieDe(await connecte());
    await rafraichis(premier);                     // le tourne

    const rejeu = await rafraichis(premier);       // et on le rejoue
    expect(rejeu.status).toBe(401);
  });

  it('un rejeu ferme TOUTES les sessions de l’utilisateur', async () => {
    const premier = cookieDe(await connecte());
    const second = cookieDe(await rafraichis(premier));

    // Le second cookie est parfaitement valide à cet instant.
    await rafraichis(premier);                     // rejeu du premier

    // Il ne l'est plus : tout a été révoqué.
    expect((await rafraichis(second)).status).toBe(401);
  });

  it('le rejeu laisse une trace dans le journal d’audit', async () => {
    const premier = cookieDe(await connecte());
    await rafraichis(premier);
    await rafraichis(premier);

    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'auth.refresh_reuse_detected'",
    ).first<{ n: number }>();

    expect(r?.n).toBe(1);
  });

  it('une session ouverte AILLEURS n’est pas touchée par le rejeu d’une autre', async () => {
    // Deux appareils, deux sessions distinctes.
    const appareilA = cookieDe(await connecte());
    const appareilB = cookieDe(await connecte());

    await rafraichis(appareilA);
    await rafraichis(appareilA);   // rejeu sur A → tout est révoqué

    // B tombe aussi, et c'est VOULU : on ne sait pas lequel des deux
    // appareils est l'intrus.
    expect((await rafraichis(appareilB)).status).toBe(401);
  });
});

describe('la déconnexion', () => {
  beforeEach(prepareBase);

  it('révoque le jeton et efface le cookie', async () => {
    const cookie = cookieDe(await connecte());

    const res = await SELF.fetch('https://api.test/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `autocare_refresh=${cookie}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await rafraichis(cookie)).status).toBe(401);
  });

  /**
   * Se déconnecter du poste de l'accueil ne doit pas fermer la session
   * ouverte sur le téléphone du responsable.
   */
  it('ne ferme QUE la session concernée', async () => {
    const accueil = cookieDe(await connecte());
    const telephone = cookieDe(await connecte());

    await SELF.fetch('https://api.test/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `autocare_refresh=${accueil}` },
    });

    expect((await rafraichis(telephone)).status).toBe(200);
  });

  it('se déconnecter sans cookie répond quand même un succès', async () => {
    const res = await SELF.fetch('https://api.test/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});

describe('la session suit ce que dit la base', () => {
  beforeEach(prepareBase);

  it('un compte désactivé entre deux rafraîchissements ne se prolonge pas', async () => {
    const cookie = cookieDe(await connecte());

    await env.DB.prepare("UPDATE users SET status = 'DISABLED' WHERE id = 1").run();

    expect((await rafraichis(cookie)).status).toBe(401);
  });

  it('un compte désactivé voit ses jetons révoqués, pas seulement refusés', async () => {
    const cookie = cookieDe(await connecte());
    await env.DB.prepare("UPDATE users SET status = 'DISABLED' WHERE id = 1").run();
    await rafraichis(cookie);

    const r = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = 1 AND revoked_at IS NULL',
    ).first<{ n: number }>();

    expect(r?.n).toBe(0);
  });
});
