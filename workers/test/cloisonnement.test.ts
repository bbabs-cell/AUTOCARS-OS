import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jetonPour, prepareBase } from './aide';
import { TenantDb } from '../src/core/db';

const vehicules = (jeton: string, requete = '') =>
  SELF.fetch(`https://api.test/api/vehicles${requete}`, {
    headers: { Authorization: `Bearer ${jeton}` },
  });

interface Vehicule { id: number; plate_number: string; plate_display: string; customer_name: string }

describe('cloisonnement entre organisations', () => {
  beforeEach(prepareBase);

  /**
   * LE TEST QUI JUSTIFIE À LUI SEUL TenantDb.
   *
   * Deux organisations existent dans le jeu d'essai. Chacune ne doit
   * voir que ses véhicules — jamais un de plus, jamais celui du
   * concurrent.
   */
  it('chaque organisation ne voit que ses véhicules', async () => {
    const chezDiallo = (await (await vehicules(await jetonPour('mamadou@diallo.sn'))).json()) as { data: Vehicule[] };
    const chezRival  = (await (await vehicules(await jetonPour('fatou@concurrent.sn'))).json()) as { data: Vehicule[] };

    expect(chezDiallo.data.map((v) => v.plate_number).sort()).toEqual(['DK5678BC', 'DK9087DE']);
    expect(chezRival.data.map((v) => v.plate_number)).toEqual(['RF1111ZZ']);
  });

  it("la plaque du concurrent est introuvable, même en la cherchant nommément", async () => {
    const res = await vehicules(await jetonPour('mamadou@diallo.sn'), '?search=RF1111ZZ');
    const { data } = (await res.json()) as { data: Vehicule[] };

    expect(data).toHaveLength(0);
  });

  it("filtrer sur un client d'une autre organisation ne révèle rien", async () => {
    // customer_id = 2 appartient à l'organisation 2.
    const res = await vehicules(await jetonPour('mamadou@diallo.sn'), '?customer_id=2');
    const { data } = (await res.json()) as { data: Vehicule[] };

    expect(data).toHaveLength(0);
  });

  /**
   * Le mécanisme lui-même, pas seulement son effet.
   *
   * Vérifier le résultat des routes ne suffit pas : il faut que le
   * garde-fou refuse ACTIVEMENT une requête non cloisonnée, sinon la
   * prochaine route écrite pourra l'oublier sans que rien ne le dise.
   */
  it('une requête sans marqueur {ORG} est refusée par TenantDb', () => {
    const base = TenantDb.pour(env.DB, 1);

    expect(() => base.select('SELECT * FROM vehicles')).toThrow(/sans cloisonnement/i);
  });

  it("TenantDb refuse un identifiant d'organisation invalide", () => {
    expect(() => TenantDb.pour(env.DB, 0)).toThrow();
    expect(() => TenantDb.pour(env.DB, -1)).toThrow();
    expect(() => TenantDb.pour(env.DB, 1.5)).toThrow();
  });

  it('le filtre est bien appliqué quand le marqueur est présent', async () => {
    const base = TenantDb.pour(env.DB, 2);
    const r = await base
      .select('SELECT plate_number FROM vehicles WHERE {ORG}')
      .all<{ plate_number: string }>();

    expect(r.results.map((v) => v.plate_number)).toEqual(['RF1111ZZ']);
  });
});
