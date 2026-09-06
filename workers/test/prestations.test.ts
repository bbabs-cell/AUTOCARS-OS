import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jetonPour, prepareBase } from './aide';

const ADMIN = 'mamadou@diallo.sn';
const EMPLOYE = 'aliou@diallo.sn';
const RIVAL = 'fatou@concurrent.sn';

const appel = async (email: string, chemin: string, methode = 'GET', corps?: unknown) => {
  const jeton = await jetonPour(email);
  const res = await SELF.fetch(`https://api.test${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  });

  return {
    res,
    corps: (await res.json()) as { message: string; data: any; errors: Record<string, string> },
  };
};

const cree = (champs: Record<string, unknown> = {}) =>
  appel(ADMIN, '/api/services', 'POST', {
    name: 'Lavage intégral', description: 'Intérieur et extérieur',
    category: 'LAVAGE', price: 12_000, duration_minutes: 90, ...champs,
  });

describe('le catalogue des prestations', () => {
  beforeEach(prepareBase);

  it('un administrateur crée une prestation', async () => {
    const { res, corps } = await cree();

    expect(res.status).toBe(201);
    expect(corps.data.price).toBe(12_000);
    expect(corps.data.status).toBe('ACTIVE');
  });

  it('porte les clés que le modèle Angular lit', async () => {
    const { corps } = await cree();

    expect(Object.keys(corps.data).sort()).toEqual([
      'category', 'description', 'duration_minutes', 'id', 'name', 'price', 'status',
    ]);
  });

  it('la liste arrive triée par prix, la moins chère en tête', async () => {
    await cree({ name: 'Lavage intégral', price: 12_000 });
    await cree({ name: 'Rinçage', price: 1500 });

    const { corps } = await appel(ADMIN, '/api/services');

    expect(corps.data.map((s: any) => s.name)).toEqual([
      'Rinçage', 'Lavage standard', 'Lavage intégral',
    ]);
  });

  /**
   * LES MONTANTS SONT DES ENTIERS DE FRANCS.
   *
   * On refuse tout ce qui n'en est pas un plutôt que de laisser une
   * conversion silencieuse transformer « 10 000 F » en 10.
   */
  it('un prix avec espace ou devise est refusé, pas converti', async () => {
    for (const prix of ['10 000', '5000 F', '4500,50', '-100']) {
      const { res, corps } = await cree({ price: prix });

      expect(res.status).toBe(422);
      expect(corps.errors.price).toContain('entier');
    }
  });

  it('une durée nulle est refusée', async () => {
    const { res, corps } = await cree({ duration_minutes: 0 });

    expect(res.status).toBe(422);
    expect(corps.errors.duration_minutes).toBeDefined();
  });

  it('un nom vide est refusé', async () => {
    const { res, corps } = await cree({ name: '   ' });

    expect(res.status).toBe(422);
    expect(corps.errors.name).toBeDefined();
  });

  // Deux prestations du même nom au comptoir, c'est une hésitation à
  // chaque saisie.
  it('un nom déjà pris est refusé, en français', async () => {
    const { res, corps } = await cree({ name: 'Lavage standard' });

    expect(res.status).toBe(422);
    expect(corps.errors.name).toContain('déjà ce nom');
  });

  it("le nom d'une prestation d'un concurrent reste disponible", async () => {
    const { res } = await cree({ name: 'Lavage rival' });

    expect(res.status).toBe(201);
  });

  it('modifier ne se heurte pas à son propre nom', async () => {
    const { res } = await appel(ADMIN, '/api/services/1', 'PUT', {
      name: 'Lavage standard', price: 6000, duration_minutes: 35,
    });

    expect(res.status).toBe(200);
  });

  it("modifier avec le nom d'une autre est refusé", async () => {
    const { corps: nouvelle } = await cree();

    const { res, corps } = await appel(ADMIN, `/api/services/${nouvelle.data.id}`, 'PUT', {
      name: 'Lavage standard', price: 12_000, duration_minutes: 90,
    });

    expect(res.status).toBe(422);
    expect(corps.errors.name).toContain('autre prestation');
  });

  /**
   * ON NE SUPPRIME PAS UNE PRESTATION, ON LA DÉSACTIVE.
   *
   * Elle est référencée par toutes les opérations passées : la
   * supprimer trouerait l'historique et fausserait les statistiques.
   */
  it('la bascule retire du comptoir sans rien effacer', async () => {
    const { corps } = await appel(ADMIN, '/api/services/1/status', 'PUT', {});

    expect(corps.data.status).toBe('INACTIVE');
    expect(corps.message).toContain('désactivée');

    // Le dossier ouvert avec cette prestation la trouve toujours.
    const { corps: file } = await appel(ADMIN, '/api/queue');
    const dossier = file.data.columns.flatMap((c: any) => c.operations)[0];

    expect(dossier.service_name).toBe('Lavage standard');
  });

  it('la bascule rallume ce qu’elle a éteint', async () => {
    await appel(ADMIN, '/api/services/1/status', 'PUT', {});
    const { corps } = await appel(ADMIN, '/api/services/1/status', 'PUT', {});

    expect(corps.data.status).toBe('ACTIVE');
  });

  // AU COMPTOIR, on ne propose pas une prestation retirée du
  // catalogue.
  it('?only_active=1 écarte les prestations désactivées', async () => {
    await appel(ADMIN, '/api/services/1/status', 'PUT', {});

    const { corps: toutes } = await appel(ADMIN, '/api/services');
    const { corps: actives } = await appel(ADMIN, '/api/services?only_active=1');

    expect(toutes.data).toHaveLength(1);
    expect(actives.data).toEqual([]);
  });

  it('un employé consulte le catalogue mais ne le modifie pas', async () => {
    const { res: lecture } = await appel(EMPLOYE, '/api/services');

    expect(lecture.status).toBe(200);

    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch('https://api.test/api/services', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', price: 1000, duration_minutes: 30 }),
    });

    expect(res.status).toBe(403);
  });

  it("la prestation d'un concurrent est introuvable", async () => {
    const { res } = await appel(ADMIN, '/api/services/2');

    expect(res.status).toBe(404);
  });

  it("l'autre entreprise ne voit que son catalogue", async () => {
    const { corps } = await appel(RIVAL, '/api/services');

    expect(corps.data).toHaveLength(1);
    expect(corps.data[0].name).toBe('Lavage rival');
  });
});
