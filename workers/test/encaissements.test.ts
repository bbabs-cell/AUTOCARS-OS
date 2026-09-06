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
  return { res, corps: (await res.json()) as { success: boolean; message: string; data: any; errors: Record<string, string> } };
};

const encaisse = (email: string, op: number, montant: number, moyen = 'CASH') =>
  appel(email, `/api/operations/${op}/payments`, 'POST', { amount: montant, method: moyen });

describe('encaisser', () => {
  beforeEach(prepareBase);

  it('un employé encaisse — c’est son travail au comptoir', async () => {
    const { res, corps } = await encaisse(EMPLOYE, 2, 5000);

    // 201 : un encaissement CRÉE une ligne. Le PHP répondait déjà
    // cela, et Angular traite tout le 2xx de la même façon.
    expect(res.status).toBe(201);
    expect(corps.data.is_settled).toBe(true);
    expect(corps.data.remaining).toBe(0);
  });

  it("renvoie les clés que `PaymentResult` déclare", async () => {
    const { corps } = await encaisse(ADMIN, 2, 5000);

    expect(Object.keys(corps.data).sort()).toEqual([
      'is_settled', 'loyalty_balance', 'outside_cash_session',
      'paid_amount', 'payment', 'remaining',
    ]);
    expect(corps.data.payment.amount).toBe(5000);
  });

  /**
   * `provider` et `external_reference` SONT CONSERVÉS.
   *
   * Ils sont saisis à la main — le nom du service et le numéro
   * recopié depuis le téléphone du client. Aucune API n'est appelée,
   * rien n'est vérifié : c'est pourtant la seule trace exploitable en
   * cas de contestation. Une version les acceptait et les jetait.
   */
  it('garde le fournisseur et la référence saisis à la main', async () => {
    const { corps } = await appel(ADMIN, '/api/operations/2/payments', 'POST', {
      amount: 5000, method: 'MOBILE_MONEY',
      provider: 'Wave', external_reference: 'TX-889912',
    });

    expect(corps.data.payment.provider).toBe('Wave');
    expect(corps.data.payment.external_reference).toBe('TX-889912');

    const r = await env.DB
      .prepare('SELECT provider, external_reference FROM payments WHERE operation_id = 2')
      .first<{ provider: string; external_reference: string }>();

    expect(r?.provider).toBe('Wave');
    expect(r?.external_reference).toBe('TX-889912');
  });

  /**
   * LE CAISSIER DOIT SAVOIR TOUT DE SUITE que son encaissement en
   * espèces n'est rattaché à aucune caisse : c'est au moment de la
   * saisie qu'on peut encore ouvrir le tiroir.
   */
  it('signale un encaissement en espèces hors caisse ouverte', async () => {
    const { corps } = await encaisse(ADMIN, 2, 5000);

    expect(corps.data.outside_cash_session).toBe(true);
  });

  it('ne le signale pas quand la caisse est ouverte', async () => {
    await appel(ADMIN, '/api/cash/open', 'POST', { opening_float: 10_000 });

    const { corps } = await encaisse(ADMIN, 2, 5000);

    expect(corps.data.outside_cash_session).toBe(false);
  });

  it("ne le signale pas pour un paiement qui ne passe pas par le tiroir", async () => {
    const { corps } = await encaisse(ADMIN, 2, 5000, 'MOBILE_MONEY');

    expect(corps.data.outside_cash_session).toBe(false);
  });

  it('un règlement partiel laisse un reste', async () => {
    const { corps } = await encaisse(ADMIN, 2, 3000);

    expect(corps.data.paid_amount).toBe(3000);
    expect(corps.data.remaining).toBe(2000);
    expect(corps.data.is_settled).toBe(false);
  });

  /**
   * LE TROP-PERÇU EST REFUSÉ.
   *
   * Ce n'est pas de la rigidité : c'est presque toujours une faute de
   * frappe — 50 000 au lieu de 5 000 — et une fois enregistrée, elle
   * fausse la caisse du soir sans que personne ne comprenne pourquoi.
   */
  it('un montant supérieur au dû est refusé, en disant ce qui reste', async () => {
    const { res, corps } = await encaisse(ADMIN, 2, 50_000);

    expect(res.status).toBe(422);
    expect(corps.errors.amount).toContain('5');
  });

  it('encaisser deux fois au-delà du dû est refusé', async () => {
    await encaisse(ADMIN, 2, 4000);
    const { res, corps } = await encaisse(ADMIN, 2, 2000);

    expect(res.status).toBe(422);
    expect(corps.errors.amount).toContain('1');
  });

  it('un dossier déjà réglé le dit clairement', async () => {
    await encaisse(ADMIN, 2, 5000);
    const { corps } = await encaisse(ADMIN, 2, 1000);

    expect(corps.errors.amount).toContain('déjà entièrement réglé');
  });

  /**
   * Le franc CFA n'a pas de centimes. Accepter « 5000,50 » créerait
   * des arrondis dans une caisse qui doit tomber juste.
   */
  it('un montant décimal ou nul est refusé', async () => {
    expect((await encaisse(ADMIN, 2, 4999.5)).res.status).toBe(422);
    expect((await encaisse(ADMIN, 2, 0)).res.status).toBe(422);
    expect((await encaisse(ADMIN, 2, -1000)).res.status).toBe(422);
  });

  it('un moyen de paiement inventé est refusé', async () => {
    expect((await encaisse(ADMIN, 2, 5000, 'BITCOIN')).res.status).toBe(422);
  });

  it('le dossier d’une autre organisation est introuvable', async () => {
    expect((await encaisse(ADMIN, 3, 1000)).res.status).toBe(404);
  });
});

describe('le journal de la recette', () => {
  beforeEach(prepareBase);

  it('un EMPLOYÉ ne voit pas la recette du jour', async () => {
    // Il voit ce qui a été réglé sur le dossier qu'il rend
    // (payments.view), pas le journal (payments.journal).
    expect((await appel(EMPLOYE, '/api/payments')).res.status).toBe(403);
  });

  it('un responsable la voit', async () => {
    await encaisse(ADMIN, 2, 5000);
    const { res, corps } = await appel(ADMIN, '/api/payments');

    expect(res.status).toBe(200);
    expect(corps.data.total_amount).toBe(5000);
    expect(corps.data.count).toBe(1);
  });

  it('le total est un agrégat, pas la somme des lignes affichées', async () => {
    // Le lot 20 avait trouvé ce défaut dans le PHP : le total sommait
    // les 500 lignes du journal, donc un total faux dès la 501e.
    for (let i = 0; i < 5; i++) {
      await env.DB.prepare(
        `INSERT INTO payments (organization_id, station_id, operation_id, amount, method,
                               status, recorded_by_user_id, paid_at)
         VALUES (1, 1, 1, 1000, 'CASH', 'PAID', 1, datetime('now'))`,
      ).run();
    }

    const { corps } = await appel(ADMIN, '/api/payments');
    expect(corps.data.total_amount).toBe(5000);
  });

  it('la recette d’une autre organisation reste invisible', async () => {
    await encaisse(ADMIN, 2, 5000);
    const { corps } = await appel('fatou@concurrent.sn', '/api/payments');

    expect(corps.data.total_amount).toBe(0);
  });
});

/**
 * ==================================================================
 * ON NE CORRIGE PAS UN ENCAISSEMENT : ON LE REMBOURSE
 * ==================================================================
 * Refus n° 6. Modifier le montant d'une ligne enregistrée effacerait
 * la trace de l'erreur — et une caisse dont on peut réécrire
 * l'histoire ne prouve plus rien.
 */
describe('rembourser', () => {
  beforeEach(prepareBase);

  const premierPaiement = async () => {
    await encaisse(ADMIN, 2, 5000);
    const r = await env.DB.prepare(
      "SELECT id FROM payments WHERE status = 'PAID' ORDER BY id DESC LIMIT 1",
    ).first<{ id: number }>();
    return r?.id ?? 0;
  };

  it('un employé ne rembourse pas', async () => {
    const id = await premierPaiement();
    const { res } = await appel(EMPLOYE, `/api/payments/${id}/refund`, 'POST', { reason: 'erreur' });

    expect(res.status).toBe(403);
  });

  it('un remboursement doit être motivé', async () => {
    const id = await premierPaiement();
    const { res } = await appel(ADMIN, `/api/payments/${id}/refund`, 'POST', { reason: '  ' });

    expect(res.status).toBe(422);
  });

  it('écrit DEUX lignes et remet le dossier à découvert', async () => {
    const id = await premierPaiement();
    const { res } = await appel(ADMIN, `/api/payments/${id}/refund`, 'POST',
      { reason: 'Montant saisi deux fois' });

    expect(res.status).toBe(200);

    const lignes = await env.DB.prepare(
      'SELECT status FROM payments ORDER BY id',
    ).all<{ status: string }>();

    // L'originale ET la sortie, toutes deux hors du total.
    expect(lignes.results.map((l) => l.status)).toEqual(['REFUNDED', 'REFUNDED']);

    const { corps } = await appel(ADMIN, '/api/operations/2/payments');
    expect(corps.data.paid_amount).toBe(0);
    expect(corps.data.is_settled).toBe(false);
  });

  it('on ne rembourse pas deux fois le même encaissement', async () => {
    const id = await premierPaiement();
    await appel(ADMIN, `/api/payments/${id}/refund`, 'POST', { reason: 'erreur' });

    const { res } = await appel(ADMIN, `/api/payments/${id}/refund`, 'POST', { reason: 'encore' });
    expect(res.status).toBe(409);
  });

  it('le remboursement est tracé avec son motif', async () => {
    const id = await premierPaiement();
    await appel(ADMIN, `/api/payments/${id}/refund`, 'POST', { reason: 'Montant saisi deux fois' });

    const t = await env.DB.prepare(
      "SELECT metadata FROM audit_logs WHERE action = 'payment.refunded'",
    ).first<{ metadata: string }>();

    expect(JSON.parse(t?.metadata ?? '{}').motif).toContain('deux fois');
  });
});
