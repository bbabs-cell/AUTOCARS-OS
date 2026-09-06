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

/**
 * ==================================================================
 * LE PARAMÈTRE D'ORGANISATION SE PLACE OÙ IL FAUT
 * ==================================================================
 * La première version de `select()` liait toujours l'organisation en
 * PREMIER. Cela marchait pour un SELECT, où `{ORG}` précède tout
 * autre `?`. Dans une écriture, non :
 *
 *     UPDATE operations SET status = ? WHERE {ORG} AND id = ?
 *
 * le `?` de `SET status` vient avant. L'organisation partait donc
 * dans la colonne `status`, et la mise à jour ne touchait AUCUNE
 * ligne — sans lever la moindre erreur.
 *
 * Un défaut muet dans le mécanisme qui protège les données de chaque
 * client mérite son test.
 */
describe('la position du filtre d’organisation', () => {
  beforeEach(prepareBase);

  /**
   * On vérifie la DONNÉE, pas le compteur `meta.changes`.
   *
   * Ce compteur inclut les lignes modifiées par les déclencheurs :
   * une écriture sur `vehicles` en renvoie 2, parce que le
   * déclencheur `updated_at` en compte une de plus. Un test qui
   * s'appuierait dessus casserait à chaque ajout de déclencheur, et
   * il mesurerait de toute façon la mauvaise chose.
   */
  it('une écriture avec un paramètre AVANT le marqueur fonctionne', async () => {
    const base = TenantDb.pour(env.DB, 1);

    await base.select("UPDATE vehicles SET color = ? WHERE {ORG} AND id = ?", 'Bleu', 1).run();

    const v = await env.DB.prepare('SELECT color FROM vehicles WHERE id = 1')
      .first<{ color: string }>();
    expect(v?.color).toBe('Bleu');
  });

  it('et elle reste cloisonnée : le véhicule du concurrent est intouchable', async () => {
    const base = TenantDb.pour(env.DB, 1);

    await base.select("UPDATE vehicles SET color = ? WHERE {ORG} AND id = ?", 'Bleu', 3).run();

    // Le véhicule 3 appartient à l'organisation 2 : il ne bouge pas.
    const v = await env.DB.prepare('SELECT color FROM vehicles WHERE id = 3')
      .first<{ color: string | null }>();
    expect(v?.color).toBeNull();
  });

  it('plusieurs paramètres de part et d’autre du marqueur', async () => {
    const base = TenantDb.pour(env.DB, 1);

    await base
      .select(
        "UPDATE vehicles SET color = ?, notes = ? WHERE {ORG} AND id = ? AND brand = ?",
        'Vert', 'Repeint', 1, 'Renault',
      )
      .run();

    const v = await env.DB.prepare('SELECT color, notes FROM vehicles WHERE id = 1')
      .first<{ color: string; notes: string }>();

    expect(v?.color).toBe('Vert');
    expect(v?.notes).toBe('Repeint');
  });

  /**
   * ==================================================================
   * DEUX MARQUEURS DANS LA MÊME REQUÊTE
   * ==================================================================
   * Certaines questions portent sur deux ensembles cloisonnés qu'il
   * faut rapprocher — « les clients venus pendant la période » et
   * « ceux venus avant ». Chacun a besoin de son propre filtre.
   *
   * Le remplacement du texte traitait déjà les deux marqueurs ; la
   * liaison, non : deux `?` apparaissaient et une seule valeur était
   * fournie. Selon la requête, D1 aurait refusé — ou pire, décalé les
   * paramètres suivants d'un cran, et rendu des chiffres faux sans
   * rien signaler.
   */
  it('deux marqueurs reçoivent chacun leur organisation', async () => {
    const base = TenantDb.pour(env.DB, 1);

    const r = await base
      .select(
        `SELECT (SELECT COUNT(*) FROM vehicles WHERE {ORG}) AS a,
                (SELECT COUNT(*) FROM customers WHERE {ORG}) AS b`,
      )
      .first<{ a: number; b: number }>();

    // Deux véhicules et un client pour l'organisation 1 — pas les
    // trois véhicules et deux clients de la base entière.
    expect(r?.a).toBe(2);
    expect(r?.b).toBe(1);
  });

  it('deux marqueurs entourés de paramètres gardent chacun leur place', async () => {
    const base = TenantDb.pour(env.DB, 1);

    const r = await base
      .select(
        `SELECT (SELECT COUNT(*) FROM vehicles WHERE brand = ? AND {ORG}) AS a,
                (SELECT COUNT(*) FROM customers WHERE {ORG} AND first_name = ?) AS b`,
        'Renault', 'Aminata',
      )
      .first<{ a: number; b: number }>();

    expect(r?.a).toBe(1);
    expect(r?.b).toBe(1);
  });

  it('et le second marqueur cloisonne vraiment', async () => {
    const base = TenantDb.pour(env.DB, 1);

    const r = await base
      .select(
        `SELECT (SELECT COUNT(*) FROM vehicles WHERE {ORG}) AS a,
                (SELECT COUNT(*) FROM customers WHERE {ORG} AND last_name = ?) AS b`,
        // « Rival » appartient à l'organisation 2 : le second filtre
        // doit l'écarter, pas le compter.
        'Rival',
      )
      .first<{ a: number; b: number }>();

    expect(r?.a).toBe(2);
    expect(r?.b).toBe(0);
  });
});
