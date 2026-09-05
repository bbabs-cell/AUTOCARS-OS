import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOT_DE_PASSE, prepareBase } from './aide';

const inscris = (corps: Record<string, unknown>) =>
  SELF.fetch('https://api.test/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });

const valide = {
  organization_name: 'Lavage Express Thiès',
  first_name: 'Ousmane',
  last_name: 'Ba',
  email: 'ousmane@lavage-express.sn',
  password: 'MonMotDePasse2026!',
};

describe('inscription', () => {
  beforeEach(prepareBase);

  it('crée l’organisation, l’administrateur et sa station', async () => {
    const res = await inscris(valide);
    expect(res.status).toBe(200);

    const { data } = (await res.json()) as {
      data: { user: { role: string; station_ids: number[]; full_name: string } };
    };

    expect(data.user.role).toBe('ADMIN');
    expect(data.user.full_name).toBe('Ousmane Ba');
    expect(data.user.station_ids).toHaveLength(1);
  });

  it('le nouveau compte peut se connecter aussitôt', async () => {
    await inscris(valide);

    const res = await SELF.fetch('https://api.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: valide.email, password: valide.password }),
    });

    expect(res.status).toBe(200);
  });

  /**
   * LA GARANTIE QUE LA TRANSACTION PORTAIT.
   *
   * En PHP, les insertions étaient dans une transaction : ni
   * organisation sans utilisateur, ni utilisateur incapable de se
   * connecter. Ici c'est `batch()` qui la porte — encore faut-il le
   * vérifier sur le résultat, et pas seulement sur le principe.
   */
  it('les quatre lignes existent, et se répondent', async () => {
    await inscris(valide);

    const r = await env.DB.prepare(
      `SELECT o.id AS org, u.id AS usr, s.id AS sta, su.role
         FROM organizations o
         JOIN users u  ON u.organization_id = o.id
         JOIN stations s ON s.organization_id = o.id
         JOIN station_users su ON su.user_id = u.id AND su.station_id = s.id
        WHERE u.email = ?`,
    ).bind(valide.email).first<{ org: number; usr: number; sta: number; role: string }>();

    expect(r).not.toBeNull();
    expect(r?.role).toBe('ADMIN');
  });

  it('une adresse déjà prise est refusée, sans rien créer', async () => {
    const avant = await env.DB.prepare('SELECT COUNT(*) AS n FROM organizations').first<{ n: number }>();

    const res = await inscris({ ...valide, email: 'mamadou@diallo.sn' });
    expect(res.status).toBe(422);

    const apres = await env.DB.prepare('SELECT COUNT(*) AS n FROM organizations').first<{ n: number }>();
    expect(apres?.n).toBe(avant?.n);
  });

  it('les champs manquants sont signalés un par un', async () => {
    const res = await inscris({});
    expect(res.status).toBe(422);

    const { errors } = (await res.json()) as { errors: Record<string, string> };
    expect(Object.keys(errors).sort()).toEqual(
      ['email', 'first_name', 'last_name', 'organization_name', 'password'],
    );
  });

  it('un mot de passe trop court est refusé', async () => {
    const res = await inscris({ ...valide, password: 'court' });
    expect(res.status).toBe(422);
  });

  it('deux organisations du même nom ne se marchent pas dessus', async () => {
    await inscris(valide);
    const res = await inscris({ ...valide, email: 'autre@lavage-express.sn' });

    expect(res.status).toBe(200);

    const r = await env.DB.prepare(
      "SELECT COUNT(DISTINCT slug) AS n FROM organizations WHERE name = ?",
    ).bind(valide.organization_name).first<{ n: number }>();

    expect(r?.n).toBe(2);
  });

  it('la nouvelle organisation ne voit pas les véhicules des autres', async () => {
    const res = await inscris(valide);
    const { data } = (await res.json()) as { data: { access_token: string } };

    const v = await SELF.fetch('https://api.test/api/vehicles', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });

    expect(((await v.json()) as { data: unknown[] }).data).toHaveLength(0);
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(prepareBase);

  it('renvoie le profil vu par la base MAINTENANT', async () => {
    const c = await SELF.fetch('https://api.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'aliou@diallo.sn', password: MOT_DE_PASSE }),
    });
    const jeton = ((await c.json()) as { data: { access_token: string } }).data.access_token;

    // On le promeut EN BASE, sans toucher au jeton déjà émis.
    await env.DB.prepare("UPDATE station_users SET role = 'MANAGER' WHERE user_id = 2").run();

    const res = await SELF.fetch('https://api.test/api/auth/me', {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    const { data } = (await res.json()) as { data: { role: string; permissions: string[] } };

    // Le rôle vient de la base, pas du jeton : la promotion est
    // immédiate, comme l'est la révocation.
    expect(data.role).toBe('MANAGER');
    expect(data.permissions).toContain('reports.view');
  });

  it('sans jeton, elle est fermée', async () => {
    expect((await SELF.fetch('https://api.test/api/auth/me')).status).toBe(401);
  });
});
