import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jetonPour, prepareBase } from './aide';

const ADMIN = 'mamadou@diallo.sn';
const EMPLOYE = 'aliou@diallo.sn';

const appel = async (email: string, chemin: string, methode = 'GET', corps?: unknown) => {
  const jeton = await jetonPour(email);
  const res = await SELF.fetch(`https://api.test${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  });
  return { res, corps: (await res.json()) as { message: string; data: any; errors: Record<string, string> } };
};

const constate = (email: string, op: number, champs: Record<string, unknown> = {}) =>
  appel(email, `/api/operations/${op}/inspections`, 'POST', { type: 'ENTRY', ...champs });

describe('enregistrer un constat', () => {
  beforeEach(prepareBase);

  it('un employé le fait — c’est son geste d’accueil', async () => {
    const { res, corps } = await constate(EMPLOYE, 1, {
      fuel_level: 'HALF', mileage: 128_400, observations: 'Pare-chocs avant rayé',
    });

    expect(res.status).toBe(200);
    expect(corps.data.inspection.type).toBe('ENTRY');
    expect(corps.data.inspection.fuel_level).toBe('HALF');
    expect(corps.data.inspection.mileage).toBe(128_400);
    expect(corps.data.inspection.photos).toEqual([]);
  });

  it('porte les quatorze champs que l’écran lit', async () => {
    const { corps } = await constate(ADMIN, 1);

    expect(Object.keys(corps.data.inspection).sort()).toEqual([
      'customer_present', 'damage_notes', 'fuel_level', 'has_damage', 'id',
      'items_left', 'mileage', 'observations', 'operation_id', 'performed_at',
      'photos', 'signature_name', 'type', 'vehicle_id',
    ]);
  });

  /**
   * SQLite ne connaît pas les booléens : ils y sont stockés en 0/1.
   * Le frontend, lui, attend de vrais booléens — `has_damage: 0`
   * serait faux en JavaScript, mais `"0"` serait vrai. On rend donc
   * un booléen, pas l'entier stocké.
   */
  it('rend de vrais booléens, pas les 0/1 de SQLite', async () => {
    const { corps } = await constate(ADMIN, 1, {
      has_damage: true, damage_notes: 'Rayure portière gauche',
      customer_present: true, signature_name: 'Aminata Sarr',
    });

    expect(corps.data.inspection.has_damage).toBe(true);
    expect(corps.data.inspection.customer_present).toBe(true);
  });

  /**
   * L'INSPECTION FAIT AVANCER LE DOSSIER — MAIS NE CONTOURNE PAS LA
   * MACHINE À ÉTATS.
   *
   * Depuis « pris en charge », enregistrer le constat passe le dossier
   * en « inspection » tout seul : sans cela, l'employé devrait changer
   * le statut à la main juste après, et oublierait une fois sur deux.
   *
   * Depuis « en attente », en revanche, rien ne bouge : la table des
   * transitions ne permet pas WAITING → INSPECTION, et cette
   * commodité ne lui passe pas devant. Le véhicule doit d'abord être
   * pris en charge par quelqu'un.
   */
  it('depuis « pris en charge », le constat fait avancer le dossier', async () => {
    await env.DB.prepare("UPDATE operations SET status = 'IN_PROGRESS' WHERE id = 1").run();
    await constate(ADMIN, 1);

    const o = await env.DB.prepare('SELECT status FROM operations WHERE id = 1')
      .first<{ status: string }>();

    expect(o?.status).toBe('INSPECTION');
  });

  it('depuis « en attente », il ne saute pas l’étape de prise en charge', async () => {
    await constate(ADMIN, 1);

    const o = await env.DB.prepare('SELECT status FROM operations WHERE id = 1')
      .first<{ status: string }>();

    // Le constat est bien enregistré, mais le dossier attend toujours
    // que quelqu'un s'en charge.
    expect(o?.status).toBe('WAITING');
  });

  it('le dossier d’une autre organisation est introuvable', async () => {
    expect((await constate(ADMIN, 3)).res.status).toBe(404);
  });
});

/**
 * ==================================================================
 * UN CONSTAT NE SE RÉÉCRIT PAS
 * ==================================================================
 * Un constat modifiable ne prouve rien. C'est toute sa valeur.
 */
describe('un constat ne se réécrit pas', () => {
  beforeEach(prepareBase);

  it('une deuxième inspection d’entrée est refusée', async () => {
    await constate(ADMIN, 1);
    const { res, corps } = await constate(ADMIN, 1);

    expect(res.status).toBe(409);
    expect(corps.message).toContain('ne se réécrit pas');
  });

  it('mais l’inspection de SORTIE reste possible', async () => {
    await constate(ADMIN, 1);
    const { res } = await appel(ADMIN, '/api/operations/1/inspections', 'POST', { type: 'EXIT' });

    expect(res.status).toBe(200);
  });
});

/**
 * ==================================================================
 * L'INSPECTION D'ENTRÉE SE FAIT AVANT LE LAVAGE
 * ==================================================================
 * Enregistrée après, elle ne constate plus l'état d'arrivée mais
 * celui d'un véhicule déjà manipulé : elle perd toute valeur de
 * preuve.
 */
describe('trop tard pour constater', () => {
  beforeEach(prepareBase);

  it('après le début du lavage, l’inspection d’entrée est refusée', async () => {
    await env.DB.prepare("UPDATE operations SET status = 'WASHING' WHERE id = 1").run();

    const { res, corps } = await constate(ADMIN, 1);

    expect(res.status).toBe(409);
    expect(corps.message).toContain("état d'arrivée");
  });

  it('sur un dossier déjà prêt, elle est refusée aussi', async () => {
    // OP-0002 est en READY.
    expect((await constate(ADMIN, 2)).res.status).toBe(409);
  });

  it('mais l’inspection de SORTIE y est justement attendue', async () => {
    const { res } = await appel(ADMIN, '/api/operations/2/inspections', 'POST', { type: 'EXIT' });
    expect(res.status).toBe(200);
  });
});

describe('ce qu’un constat doit dire', () => {
  beforeEach(prepareBase);

  /**
   * « Il y avait une rayure » ne dit ni où, ni laquelle.
   */
  it('cocher « dommage » sans le décrire est refusé', async () => {
    const { res, corps } = await constate(ADMIN, 1, { has_damage: true });

    expect(res.status).toBe(422);
    expect(corps.errors.damage_notes).toContain('la photo seule ne prouve rien');
  });

  /**
   * Le nom saisi vaut accord sur l'état constaté : c'est la seule
   * chose qui transforme un constat interne en constat
   * contradictoire.
   */
  it('client présent sans son nom est refusé', async () => {
    const { res, corps } = await constate(ADMIN, 1, { customer_present: true });

    expect(res.status).toBe(422);
    expect(corps.errors.signature_name).toContain('vaut accord');
  });

  it('client absent, la signature n’est pas exigée', async () => {
    const { res } = await constate(ADMIN, 1, { customer_present: false });
    expect(res.status).toBe(200);
  });

  it('un niveau de carburant inventé est refusé', async () => {
    expect((await constate(ADMIN, 1, { fuel_level: 'PRESQUE_PLEIN' })).res.status).toBe(422);
  });

  it('un kilométrage non numérique ou négatif est refusé', async () => {
    expect((await constate(ADMIN, 1, { mileage: 'beaucoup' })).res.status).toBe(422);
    expect((await constate(ADMIN, 1, { mileage: -5 })).res.status).toBe(422);
  });
});

describe('relire un constat', () => {
  beforeEach(prepareBase);

  it('l’historique d’un véhicule montre ses inspections', async () => {
    await constate(ADMIN, 1, { observations: 'État correct' });

    const { corps } = await appel(ADMIN, '/api/vehicles/1/inspections');

    expect(corps.data).toHaveLength(1);
    expect(corps.data[0].observations).toBe('État correct');
  });

  it('celui d’un véhicule d’une autre organisation est vide', async () => {
    await constate(ADMIN, 1);
    const { corps } = await appel('fatou@concurrent.sn', '/api/vehicles/1/inspections');

    expect(corps.data).toEqual([]);
  });

  it('une inspection d’une autre organisation est introuvable', async () => {
    const { corps } = await constate(ADMIN, 1);
    const id = corps.data.inspection.id;

    expect((await appel('fatou@concurrent.sn', `/api/inspections/${id}`)).res.status).toBe(404);
  });

  it('la création est tracée avec le dommage éventuel', async () => {
    await constate(ADMIN, 1, { has_damage: true, damage_notes: 'Rétroviseur fêlé' });

    const t = await env.DB.prepare(
      "SELECT metadata FROM audit_logs WHERE action = 'inspection.created'",
    ).first<{ metadata: string }>();

    const m = JSON.parse(t?.metadata ?? '{}');
    expect(m.has_damage).toBe(true);
    expect(m.operation_reference).toBe('OP-0001');
  });
});

/**
 * Le lien entre les deux gardes : c'est l'inspection enregistrée ici
 * qui débloque le passage au lavage vérifié dans operations.ts.
 */
describe('l’inspection débloque le lavage', () => {
  beforeEach(prepareBase);

  const passeA = async (etat: string) => {
    const jeton = await jetonPour(ADMIN);
    return SELF.fetch('https://api.test/api/operations/1/status', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: etat }),
    });
  };

  it('sans constat, le lavage reste refusé', async () => {
    await passeA('IN_PROGRESS');
    await passeA('INSPECTION');

    expect((await passeA('WASHING')).status).toBe(409);
  });

  it('avec le constat, il passe', async () => {
    await passeA('IN_PROGRESS');
    await constate(ADMIN, 1);   // enregistre ET avance jusqu'à INSPECTION

    expect((await passeA('WASHING')).status).toBe(200);
  });
});
