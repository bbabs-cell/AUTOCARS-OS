import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { prepareBase } from './aide';

/** Une insertion qui doit être refusée par la base. */
async function refuse(sql: string, ...p: unknown[]): Promise<string> {
  try {
    await env.DB.prepare(sql).bind(...p).run();
  } catch (e) {
    return String(e);
  }
  throw new Error(`La base a ACCEPTÉ ce qu'elle devait refuser : ${sql}`);
}

describe('le schéma complet', () => {
  beforeEach(prepareBase);

  it('les 21 tables métier existent', async () => {
    const r = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'`,
    ).all<{ name: string }>();

    const tables = r.results.map((t) => t.name).sort();

    expect(tables).toEqual([
      'audit_logs', 'bookings', 'cash_sessions', 'customers',
      'inspection_photos', 'inspections', 'loyalty_entries', 'loyalty_programs',
      'operations', 'organizations', 'password_resets', 'payments',
      'refresh_tokens', 'services', 'station_users', 'stations',
      'subscription_plans', 'subscriptions', 'time_entries', 'users', 'vehicles',
    ]);
  });
});

/**
 * ==================================================================
 * LES CONTRAINTES REFUSENT-ELLES VRAIMENT ?
 * ==================================================================
 * Une contrainte qu'on n'a jamais vue refuser quelque chose n'est pas
 * une contrainte : c'est un commentaire. MySQL garantissait ces règles
 * par ses types (ENUM, UNSIGNED) ; en SQLite elles ne tiennent que par
 * les CHECK écrits à la main. Il faut donc les voir mordre.
 */
describe('les garanties perdues de MySQL, rétablies par CHECK', () => {
  beforeEach(prepareBase);

  it('un prix négatif est refusé', async () => {
    const e = await refuse(
      `INSERT INTO services (organization_id, name, category, price, duration_minutes)
       VALUES (1, 'Test', 'LAVAGE', -5000, 30)`,
    );
    expect(e).toMatch(/CHECK|constraint/i);
  });

  it('un montant de paiement négatif est refusé', async () => {
    const e = await refuse(
      `INSERT INTO payments (organization_id, station_id, operation_id, amount, method, recorded_by_user_id)
       VALUES (1, 1, 1, -1, 'CASH', 1)`,
    );
    expect(e).toMatch(/CHECK|constraint/i);
  });

  it('un statut inventé est refusé', async () => {
    const e = await refuse(
      `INSERT INTO cash_sessions (organization_id, station_id, opened_by_user_id, status, opening_float)
       VALUES (1, 1, 1, 'PEUT-ETRE', 0)`,
    );
    expect(e).toMatch(/CHECK|constraint/i);
  });

  it('un type de véhicule inconnu est refusé', async () => {
    const e = await refuse(
      `INSERT INTO vehicles (organization_id, customer_id, plate_number, brand, model, vehicle_type)
       VALUES (1, 1, 'XX0000XX', 'Marque', 'Modele', 'HELICOPTERE')`,
    );
    expect(e).toMatch(/CHECK|constraint/i);
  });

  it('un JSON invalide dans le journal d’audit est refusé', async () => {
    const e = await refuse(
      `INSERT INTO audit_logs (organization_id, action, metadata) VALUES (1, 'test', 'pas du json')`,
    );
    expect(e).toMatch(/CHECK|constraint/i);
  });

  /**
   * L'EXCEPTION, ET ELLE EST VOULUE.
   *
   * `difference` est le seul entier signé du schéma : c'est l'écart de
   * caisse, et une caisse peut manquer. Lui coller un CHECK >= 0 par
   * réflexe aurait rendu impossible d'enregistrer un manque — c'est-à-dire
   * exactement la situation que le lot 12 voulait rendre visible.
   */
  it('un écart de caisse NÉGATIF est accepté', async () => {
    await env.DB.prepare(
      `INSERT INTO cash_sessions (id, organization_id, station_id, opened_by_user_id,
                                  status, opening_float, counted_amount, difference)
       VALUES (77, 1, 1, 1, 'CLOSED', 10000, 8000, -2000)`,
    ).run();

    const r = await env.DB.prepare('SELECT difference FROM cash_sessions WHERE id = 77')
      .first<{ difference: number }>();

    expect(r?.difference).toBe(-2000);
  });
});

/**
 * ==================================================================
 * UNE RÈGLE MÉTIER PORTÉE PAR LE SCHÉMA, ET NON PAR LE CODE
 * ==================================================================
 * « Une seule caisse ouverte par station » est le refus n° 8 de
 * l'aide en ligne. Il ne tient pas à une vérification dans un
 * contrôleur — qu'on peut oublier — mais à une clé unique sur
 * `open_station_id`, laissée à NULL dès que la caisse est fermée.
 *
 * SQLite autorise plusieurs NULL dans une colonne unique, comme
 * MySQL : la règle traverse donc la migration intacte. Encore
 * fallait-il le vérifier plutôt que de le supposer.
 */
describe('une seule caisse ouverte par station', () => {
  beforeEach(prepareBase);

  const ouvre = (id: number, station: number, ouverte: boolean) =>
    env.DB.prepare(
      `INSERT INTO cash_sessions (id, organization_id, station_id, opened_by_user_id,
                                  status, opening_float, open_station_id)
       VALUES (?, 1, ?, 1, ?, 0, ?)`,
    ).bind(id, station, ouverte ? 'OPEN' : 'CLOSED', ouverte ? station : null).run();

  it('deux caisses ouvertes sur la même station sont refusées', async () => {
    await ouvre(1, 1, true);
    await expect(ouvre(2, 1, true)).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it('deux stations peuvent avoir chacune leur caisse ouverte', async () => {
    await ouvre(1, 1, true);
    await expect(ouvre(2, 2, true)).resolves.toBeDefined();
  });

  it('plusieurs caisses FERMÉES sur la même station sont possibles', async () => {
    await ouvre(1, 1, false);
    await ouvre(2, 1, false);
    await ouvre(3, 1, false);

    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM cash_sessions').first<{ n: number }>();
    expect(r?.n).toBe(3);
  });
});

/**
 * ==================================================================
 * D1 APPLIQUE-T-IL LES CLÉS ÉTRANGÈRES ?
 * ==================================================================
 * Question posée avant l'étape 2, parce qu'elle ne se suppose pas :
 * SQLite, historiquement, ne les applique QUE si `PRAGMA foreign_keys`
 * est activé — et il ne l'est pas par défaut. Si D1 les ignorait, il
 * faudrait remplacer chaque clé étrangère par une vérification écrite
 * à la main dans le code, avec le risque d'oubli que cela suppose.
 *
 * RÉPONSE : D1 les applique. Ces tests le prouvent, et ils échoueraient
 * si un changement de plateforme revenait un jour là-dessus.
 *
 * Ce n'est pas une curiosité : c'est ce qui empêche un dossier de
 * pointer vers un véhicule qui n'existe pas, et une photo d'inspection
 * de survivre à l'inspection qu'elle documente.
 */
describe('les clés étrangères sont appliquées par D1', () => {
  beforeEach(prepareBase);

  it('un dossier ne peut pas désigner un véhicule inexistant', async () => {
    const e = await refuse(
      `INSERT INTO operations (organization_id, station_id, vehicle_id, customer_id,
                               service_id, reference, price, created_by_user_id)
       VALUES (1, 1, 999999, 1, 1, 'OP-TEST', 5000, 1)`,
    );
    expect(e).toMatch(/FOREIGN KEY/i);
  });

  it('un véhicule ne peut pas appartenir à un client inexistant', async () => {
    const e = await refuse(
      `INSERT INTO vehicles (organization_id, customer_id, plate_number, brand, model)
       VALUES (1, 999999, 'ZZ0000ZZ', 'Marque', 'Modele')`,
    );
    expect(e).toMatch(/FOREIGN KEY/i);
  });

  it('supprimer un client qui a des véhicules est refusé', async () => {
    const e = await refuse('DELETE FROM customers WHERE id = 1');
    expect(e).toMatch(/FOREIGN KEY/i);
  });
});

/**
 * Les déclencheurs qui remplacent ON UPDATE CURRENT_TIMESTAMP.
 * SQLite n'a pas cet automatisme : sans eux, `updated_at` resterait
 * figé à la création, et l'écran « modifié récemment » mentirait.
 */
describe('updated_at se met à jour tout seul', () => {
  beforeEach(prepareBase);

  it('modifier une ligne avance son updated_at', async () => {
    // On pose la date ancienne par un INSERT : un UPDATE déclencherait
    // justement le mécanisme qu'on veut observer, et le test ne
    // prouverait plus rien.
    await env.DB.prepare(
      `INSERT INTO vehicles (id, organization_id, customer_id, plate_number, brand, model, updated_at)
       VALUES (50, 1, 1, 'AA1111AA', 'Marque', 'Modele', '2020-01-01 00:00:00')`,
    ).run();

    const avant = await env.DB.prepare('SELECT updated_at FROM vehicles WHERE id = 50').first<{ updated_at: string }>();
    expect(avant?.updated_at).toBe('2020-01-01 00:00:00');

    await env.DB.prepare("UPDATE vehicles SET color = 'Vert' WHERE id = 50").run();

    const apres = await env.DB.prepare('SELECT updated_at FROM vehicles WHERE id = 50').first<{ updated_at: string }>();
    expect(apres?.updated_at).not.toBe('2020-01-01 00:00:00');
    expect(apres?.updated_at.startsWith('20')).toBe(true);
  });

  /**
   * La règle, plutôt qu'un nombre.
   *
   * Compter les déclencheurs obligerait à corriger ce test à chaque
   * table ajoutée — et un test qu'on corrige machinalement finit par
   * ne plus rien vérifier. On exprime ce qui doit être vrai : toute
   * table portant `updated_at` doit avoir son déclencheur, sinon la
   * colonne resterait figée à la création.
   */
  it('toute table avec updated_at a son déclencheur', async () => {
    const tables = await env.DB.prepare(
      `SELECT m.name FROM sqlite_master m
        WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
          AND m.name NOT LIKE '_cf_%' AND m.name != 'd1_migrations'
          AND m.sql LIKE '%updated_at%'`,
    ).all<{ name: string }>();

    const declencheurs = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger'",
    ).all<{ name: string }>();

    const avecTrigger = new Set(declencheurs.results.map((t) => t.name));
    const sansTrigger = tables.results
      .map((t) => t.name)
      .filter((t) => !avecTrigger.has(`trg_${t}_updated`));

    expect(sansTrigger).toEqual([]);
    expect(tables.results.length).toBeGreaterThan(10);
  });
});
