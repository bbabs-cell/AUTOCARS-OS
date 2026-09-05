import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jetonPour, prepareBase } from './aide';

const ADMIN = 'mamadou@diallo.sn';
const EMPLOYE = 'aliou@diallo.sn';

const bord = async (email: string, requete = '') => {
  const jeton = await jetonPour(email);
  const res = await SELF.fetch(`https://api.test/api/dashboard${requete}`, {
    headers: { Authorization: `Bearer ${jeton}` },
  });
  return { res, corps: (await res.json()) as { data: any } };
};

describe('le tableau de bord', () => {
  beforeEach(prepareBase);

  it('tous les rôles peuvent l’ouvrir', async () => {
    expect((await bord(ADMIN)).res.status).toBe(200);
    expect((await bord(EMPLOYE)).res.status).toBe(200);
  });

  it('porte les clés que l’écran lit', async () => {
    const { corps } = await bord(ADMIN);

    for (const cle of [
      'station_id', 'generated_at', 'today', 'yesterday', 'alerts',
      'top_services', 'average_turnaround_minutes', 'operations_by_status', 'can_see_money',
    ]) {
      expect(corps.data).toHaveProperty(cle);
    }
  });

  it('compte ce qui se passe dans la station', async () => {
    const { corps } = await bord(ADMIN);

    expect(corps.data.today.waiting).toBe(1);      // OP-0001
    expect(corps.data.operations_by_status.WAITING).toBe(1);
    expect(corps.data.operations_by_status.READY).toBe(1);
    // Les huit étapes actives sont toujours présentes, même à zéro :
    // une clé absente et une valeur nulle ne s'affichent pas pareil.
    expect(corps.data.operations_by_status.WASHING).toBe(0);
  });

  it('ne compte jamais les dossiers d’une autre organisation', async () => {
    const { corps } = await bord('fatou@concurrent.sn');

    expect(corps.data.operations_by_status.WAITING).toBe(1);   // le sien
    expect(corps.data.today.waiting).toBe(1);
  });
});

/**
 * ==================================================================
 * LES BLOCS FINANCIERS NE SONT PAS MASQUÉS : ILS NE SONT PAS ENVOYÉS
 * ==================================================================
 * Masquer un bloc dans Angular ne protégerait rien : l'onglet réseau
 * du navigateur montre la réponse brute. Ces tests vérifient que la
 * décision est prise SUR LE SERVEUR.
 */
describe('ce qu’un employé ne reçoit pas', () => {
  beforeEach(prepareBase);

  const encaisse = async () => {
    const jeton = await jetonPour(ADMIN);
    await SELF.fetch('https://api.test/api/operations/2/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 5000, method: 'CASH' }),
    });
  };

  it('aucun chiffre d’affaires ne figure dans sa réponse', async () => {
    await encaisse();
    const { corps } = await bord(EMPLOYE);

    expect(corps.data.can_see_money).toBe(false);
    expect(corps.data.today.revenue).toBeUndefined();
    expect(corps.data.yesterday.revenue).toBeUndefined();
    expect(corps.data.revenue_series).toBeUndefined();
    expect(corps.data.payment_split).toBeUndefined();
    expect(corps.data.ready_unpaid).toBeUndefined();
  });

  it('le montant n’apparaît nulle part dans le corps brut', async () => {
    await encaisse();
    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch('https://api.test/api/dashboard', {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    // La vérification la plus bête et la plus sûre : le montant
    // encaissé ne doit pas se trouver dans la réponse, sous quelque
    // forme que ce soit.
    expect(await res.text()).not.toContain('5000');
  });

  it('les prestations les plus demandées lui parviennent SANS montant', async () => {
    const { corps } = await bord(EMPLOYE);

    for (const s of corps.data.top_services) {
      expect(s).not.toHaveProperty('total');
      expect(s).toHaveProperty('count');
    }
  });

  it('il ne voit pas la caisse', async () => {
    const { corps } = await bord(EMPLOYE, '?station_id=1');
    expect(corps.data.cash).toBeUndefined();
  });

  it('un responsable, lui, reçoit tout', async () => {
    await encaisse();
    const { corps } = await bord(ADMIN, '?station_id=1');

    expect(corps.data.can_see_money).toBe(true);
    expect(corps.data.today.revenue).toBe(5000);
    expect(corps.data.revenue_series).toHaveLength(7);
    expect(corps.data.payment_split[0]).toEqual({ method: 'CASH', total: 5000, count: 1 });
    expect(corps.data.cash).toBeDefined();
  });
});

/**
 * Une alerte qu'on ne peut pas faire disparaître n'est pas une
 * alerte : c'est une décoration qu'on cesse de regarder au bout d'une
 * semaine. Chacune doit s'éteindre quand le problème est réglé.
 */
describe('les alertes', () => {
  beforeEach(prepareBase);

  const cles = async (email: string, requete = '') =>
    ((await bord(email, requete)).corps.data.alerts as { key: string }[]).map((a) => a.key);

  it('un véhicule prêt et impayé est signalé', async () => {
    expect(await cles(ADMIN)).toContain('ready_unpaid');
  });

  it('et l’alerte disparaît une fois le règlement encaissé', async () => {
    const jeton = await jetonPour(ADMIN);
    await SELF.fetch('https://api.test/api/operations/2/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 5000, method: 'CASH' }),
    });

    expect(await cles(ADMIN)).not.toContain('ready_unpaid');
  });

  it('un employé ne reçoit pas l’alerte des impayés', async () => {
    // Elle porte un montant : elle est réservée à qui voit l'argent.
    expect(await cles(EMPLOYE)).not.toContain('ready_unpaid');
  });

  it('un client qui attend depuis plus de 20 minutes est signalé', async () => {
    await env.DB.prepare(
      "UPDATE operations SET created_at = datetime('now','-45 minutes'), status_changed_at = NULL WHERE id = 1",
    ).run();

    const k = await cles(ADMIN);
    expect(k).toContain('waiting_too_long');
    expect(k).toContain('overdue');
  });

  it('des espèces encaissées sans caisse ouverte sont signalées', async () => {
    const jeton = await jetonPour(ADMIN);
    await SELF.fetch('https://api.test/api/operations/2/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 5000, method: 'CASH' }),
    });

    expect(await cles(ADMIN, '?station_id=1')).toContain('cash_closed');
  });

  it('et elle disparaît dès qu’une caisse est ouverte', async () => {
    const jeton = await jetonPour(ADMIN);
    await SELF.fetch('https://api.test/api/operations/2/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 5000, method: 'CASH' }),
    });
    await SELF.fetch('https://api.test/api/cash/open', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ opening_float: 0 }),
    });

    expect(await cles(ADMIN, '?station_id=1')).not.toContain('cash_closed');
  });
});
