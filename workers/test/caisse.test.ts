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

const ouvre = (email: string, fond = 10_000, station = 1) =>
  appel(email, '/api/cash/open', 'POST', { station_id: station, opening_float: fond });

const ferme = (email: string, compte: number, station = 1) =>
  appel(email, '/api/cash/close', 'POST', { station_id: station, counted_amount: compte });

describe('ouvrir et fermer la caisse', () => {
  beforeEach(prepareBase);

  it('ouvrir crée une vacation avec son fond', async () => {
    const { res, corps } = await ouvre(ADMIN, 10_000);

    expect(res.status).toBe(200);
    expect(corps.data.session.status).toBe('OPEN');
    expect(corps.data.session.opening_float).toBe(10_000);
    expect(corps.data.session.expected_amount).toBe(10_000);
  });

  it('sans caisse ouverte, l’écran ne montre rien plutôt qu’une erreur', async () => {
    const { res, corps } = await appel(ADMIN, '/api/cash/current?station_id=1');

    expect(res.status).toBe(200);
    expect(corps.data.session).toBeNull();
  });

  /**
   * REFUS N° 8 — UNE SEULE CAISSE OUVERTE PAR STATION.
   *
   * Deux vacations simultanées rendraient tout rapprochement
   * impossible : à qui manque l'argent ?
   */
  it('deux caisses ouvertes sur la même station sont refusées', async () => {
    await ouvre(ADMIN);
    const { res, corps } = await ouvre(ADMIN);

    expect(res.status).toBe(409);
    expect(corps.message).toContain('déjà ouverte');
    expect(corps.message).toContain('rapprochement');
  });

  it('deux stations peuvent avoir chacune la sienne', async () => {
    await ouvre(ADMIN, 10_000, 1);
    expect((await ouvre(ADMIN, 5000, 2)).res.status).toBe(200);
  });

  it('on n’ouvre pas la caisse d’une station où l’on ne travaille pas', async () => {
    // La station 3 appartient à l'organisation concurrente.
    const { res } = await ouvre(ADMIN, 10_000, 3);
    expect(res.status).toBe(422);
  });

  it('un fond de caisse négatif ou décimal est refusé', async () => {
    expect((await ouvre(ADMIN, -500)).res.status).toBe(422);
    expect((await ouvre(ADMIN, 1000.5)).res.status).toBe(422);
  });
});

/**
 * ==================================================================
 * L'ÉCART DE CAISSE
 * ==================================================================
 * C'est tout l'objet de cet écran. Le refus n° 7 dit qu'on ne peut
 * PAS l'ajuster : une caisse dont on peut réécrire le résultat ne
 * prouve plus rien.
 */
describe('l’écart de caisse', () => {
  beforeEach(prepareBase);

  const encaisse = (montant: number, moyen = 'CASH') =>
    appel(ADMIN, '/api/operations/2/payments', 'POST', { amount: montant, method: moyen });

  it('ce qui est attendu, c’est le fond plus les espèces encaissées', async () => {
    await ouvre(ADMIN, 10_000);
    await encaisse(5000);

    const { corps } = await appel(ADMIN, '/api/cash/current?station_id=1');
    expect(corps.data.session.expected_amount).toBe(15_000);
  });

  /**
   * Les paiements par mobile money sont rattachés à la vacation — ce
   * n'est pas un tiroir, c'est une vacation — mais ne sont PAS
   * attendus en espèces. Les confondre ferait apparaître un écart
   * énorme tous les soirs.
   */
  it('le mobile money compte dans la vacation, pas dans le tiroir', async () => {
    await ouvre(ADMIN, 10_000);
    await encaisse(5000, 'MOBILE_MONEY');

    const { corps } = await appel(ADMIN, '/api/cash/current?station_id=1');
    expect(corps.data.session.expected_amount).toBe(10_000);

    const p = await env.DB.prepare(
      'SELECT cash_session_id FROM payments ORDER BY id DESC LIMIT 1',
    ).first<{ cash_session_id: number | null }>();
    expect(p?.cash_session_id).not.toBeNull();
  });

  it('une caisse juste se ferme sans écart', async () => {
    await ouvre(ADMIN, 10_000);
    await encaisse(5000);

    const { corps } = await ferme(ADMIN, 15_000);

    expect(corps.data.session.difference).toBe(0);
    expect(corps.message).toContain('juste');
  });

  it('un MANQUE est enregistré en négatif — et la base l’accepte', async () => {
    await ouvre(ADMIN, 10_000);
    await encaisse(5000);

    const { corps } = await ferme(ADMIN, 13_000);

    // `difference` est la seule colonne signée du schéma, et c'est
    // exactement pour ce cas.
    expect(corps.data.session.difference).toBe(-2000);
    expect(corps.data.session.counted_amount).toBe(13_000);
    expect(corps.data.session.expected_amount).toBe(15_000);
  });

  it('un EXCÉDENT est enregistré aussi', async () => {
    await ouvre(ADMIN, 10_000);
    const { corps } = await ferme(ADMIN, 10_500);

    expect(corps.data.session.difference).toBe(500);
  });

  it('l’écart est journalisé, même quand il est nul', async () => {
    await ouvre(ADMIN, 10_000);
    await ferme(ADMIN, 10_000);

    const t = await env.DB.prepare(
      "SELECT metadata FROM audit_logs WHERE action = 'cash.closed'",
    ).first<{ metadata: string }>();

    // C'est la SUITE des clôtures qui a du sens, pas seulement les
    // mauvaises.
    expect(JSON.parse(t?.metadata ?? '{}').ecart).toBe(0);
  });

  it('une caisse fermée libère la station pour la vacation suivante', async () => {
    await ouvre(ADMIN, 10_000);
    await ferme(ADMIN, 10_000);

    expect((await ouvre(ADMIN, 12_000)).res.status).toBe(200);
  });

  it('on ne ferme pas une caisse qui n’est pas ouverte', async () => {
    expect((await ferme(ADMIN, 10_000)).res.status).toBe(409);
  });

  it('un comptage négatif ou décimal est refusé', async () => {
    await ouvre(ADMIN, 10_000);
    expect((await ferme(ADMIN, -1)).res.status).toBe(422);
    expect((await ferme(ADMIN, 999.5)).res.status).toBe(422);
  });
});

/**
 * LE FRONTEND N'ENVOIE PAS LA STATION.
 *
 * `openCash()` ne transmet que le fond et les notes : au comptoir, on
 * ouvre la caisse de SA station, on ne la choisit pas. Une première
 * version l'exigeait — l'API répondait 422 et l'écran était
 * inutilisable, ce qui ne se voyait qu'en cliquant.
 */
describe('la station se déduit quand elle n’est pas donnée', () => {
  beforeEach(prepareBase);

  it('ouvrir sans station_id ouvre celle de la personne', async () => {
    const { res, corps } = await appel(ADMIN, '/api/cash/open', 'POST',
      { opening_float: 10_000, opening_notes: 'Fond du matin' });

    expect(res.status).toBe(200);
    expect(corps.data.session.station_id).toBe(1);
    expect(corps.data.session.opening_notes).toBe('Fond du matin');
  });

  it('fermer sans station_id ferme celle de la personne', async () => {
    await appel(ADMIN, '/api/cash/open', 'POST', { opening_float: 10_000 });
    const { res, corps } = await appel(ADMIN, '/api/cash/close', 'POST',
      { counted_amount: 10_000, closing_notes: 'RAS' });

    expect(res.status).toBe(200);
    expect(corps.data.session.closing_notes).toBe('RAS');
  });
});

describe('l’état complet de la caisse', () => {
  beforeEach(prepareBase);

  it('porte les quatre clés que l’écran lit', async () => {
    await appel(ADMIN, '/api/cash/open', 'POST', { opening_float: 10_000 });
    const { corps } = await appel(ADMIN, '/api/cash/current?station_id=1');

    expect(Object.keys(corps.data).sort()).toEqual(
      ['cash_outside_session', 'movements', 'session', 'station_id'],
    );
  });

  it('détaille les encaissements par moyen de paiement', async () => {
    await appel(ADMIN, '/api/cash/open', 'POST', { opening_float: 10_000 });
    await appel(ADMIN, '/api/operations/2/payments', 'POST', { amount: 3000, method: 'CASH' });
    await appel(ADMIN, '/api/operations/2/payments', 'POST', { amount: 2000, method: 'MOBILE_MONEY' });

    const { corps } = await appel(ADMIN, '/api/cash/current?station_id=1');

    // « 5 000 F ce matin, dont 3 000 en espèces » : la phrase que le
    // caissier doit pouvoir dire.
    expect(corps.data.movements.CASH).toEqual({ count: 1, total: 3000 });
    expect(corps.data.movements.MOBILE_MONEY).toEqual({ count: 1, total: 2000 });
  });

  it('signale les espèces encaissées SANS caisse ouverte', async () => {
    // On encaisse avant d'ouvrir : c'est permis, mais ça doit se voir.
    await appel(ADMIN, '/api/operations/2/payments', 'POST', { amount: 5000, method: 'CASH' });

    const { corps } = await appel(ADMIN, '/api/cash/current?station_id=1');

    expect(corps.data.session).toBeNull();
    expect(corps.data.cash_outside_session).toBe(5000);
  });
});

describe('qui voit la caisse', () => {
  beforeEach(prepareBase);

  it('un employé ne voit ni la caisse ni son historique', async () => {
    expect((await appel(EMPLOYE, '/api/cash/current')).res.status).toBe(403);
    expect((await appel(EMPLOYE, '/api/cash/sessions')).res.status).toBe(403);
  });

  it('un employé n’ouvre ni ne ferme la caisse', async () => {
    expect((await ouvre(EMPLOYE)).res.status).toBe(403);
    expect((await ferme(EMPLOYE, 1000)).res.status).toBe(403);
  });

  it('l’historique ne montre que les vacations de son organisation', async () => {
    await ouvre(ADMIN, 10_000);
    await ferme(ADMIN, 10_000);

    const { corps } = await appel('fatou@concurrent.sn', '/api/cash/sessions');
    expect(corps.data.sessions).toHaveLength(0);
  });
});
