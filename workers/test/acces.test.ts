import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jetonPour, prepareBase } from './aide';
import { signe } from '../src/core/jwt';
import { autorise } from '../src/core/permissions';

const vehicules = (entetes: HeadersInit = {}) =>
  SELF.fetch('https://api.test/api/vehicles', { headers: entetes });

describe('contrôle d’accès', () => {
  beforeEach(prepareBase);

  it('sans jeton, la route est fermée', async () => {
    expect((await vehicules()).status).toBe(401);
  });

  it('un jeton bricolé est refusé', async () => {
    const vrai = await jetonPour('mamadou@diallo.sn');
    // On change un caractère de la signature.
    const faux = vrai.slice(0, -1) + (vrai.endsWith('A') ? 'B' : 'A');

    expect((await vehicules({ Authorization: `Bearer ${faux}` })).status).toBe(401);
  });

  it('un jeton expiré est refusé', async () => {
    const expire = await signe({ sub: 1, org: 1 }, env.JWT_SECRET, -60);

    expect((await vehicules({ Authorization: `Bearer ${expire}` })).status).toBe(401);
  });

  it('un jeton signé avec un autre secret est refusé', async () => {
    const etranger = await signe({ sub: 1, org: 1 }, 'un-autre-secret-entierement-different', 3600);

    expect((await vehicules({ Authorization: `Bearer ${etranger}` })).status).toBe(401);
  });

  /**
   * LA RÉVOCATION EST IMMÉDIATE, ET C'EST CE QUI COÛTE UNE LECTURE
   * EN BASE À CHAQUE REQUÊTE.
   *
   * Le jeton reste cryptographiquement valide trente minutes. Si le
   * rôle était recopié dedans, un employé renvoyé continuerait de
   * travailler pendant tout ce temps. Ici la base tranche.
   */
  it('un compte suspendu après émission du jeton perd l’accès immédiatement', async () => {
    const jeton = await jetonPour('aliou@diallo.sn');
    expect((await vehicules({ Authorization: `Bearer ${jeton}` })).status).toBe(200);

    await env.DB.prepare("UPDATE users SET status = 'SUSPENDED' WHERE id = 2").run();

    expect((await vehicules({ Authorization: `Bearer ${jeton}` })).status).toBe(401);
  });

  it('un jeton désignant un utilisateur inexistant est refusé', async () => {
    const fantome = await signe({ sub: 9999, org: 1 }, env.JWT_SECRET, 3600);

    expect((await vehicules({ Authorization: `Bearer ${fantome}` })).status).toBe(401);
  });

  /**
   * Le jeton porte son organisation. Changer ce champ ne doit rien
   * ouvrir : l'utilisateur est cherché sur les DEUX critères.
   */
  it("prétendre appartenir à une autre organisation ne donne rien", async () => {
    const usurpe = await signe({ sub: 1, org: 2 }, env.JWT_SECRET, 3600);

    expect((await vehicules({ Authorization: `Bearer ${usurpe}` })).status).toBe(401);
  });
});

describe('la matrice des droits est celle du PHP', () => {
  it('un employé peut voir les véhicules, pas les recettes', () => {
    expect(autorise('EMPLOYEE', 'vehicles.view')).toBe(true);
    expect(autorise('EMPLOYEE', 'reports.view')).toBe(false);
    expect(autorise('EMPLOYEE', 'employees.view')).toBe(false);
  });

  it('un domaine entier couvre ses actions', () => {
    expect(autorise('MANAGER', 'vehicles.delete')).toBe(true);
    expect(autorise('EMPLOYEE', 'vehicles.delete')).toBe(false);
  });

  it("l'administrateur peut tout", () => {
    expect(autorise('ADMIN', 'nimporte.quoi')).toBe(true);
  });

  it("un rôle inconnu n'a aucun droit", () => {
    expect(autorise('DIRECTEUR', 'vehicles.view')).toBe(false);
    expect(autorise('', 'vehicles.view')).toBe(false);
  });

  it("« vehicles.view » n'ouvre pas « vehicles_secrets.view »", () => {
    // Le motif « vehicles.* » ne doit pas déborder sur un domaine dont
    // le nom commence pareil.
    expect(autorise('MANAGER', 'vehicles_secrets.view')).toBe(false);
  });
});
