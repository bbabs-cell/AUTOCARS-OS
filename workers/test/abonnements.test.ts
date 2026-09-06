import { SELF, env } from 'cloudflare:test';
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

/** Un forfait : 10 lavages standard à 40 000 F, valables 180 jours. */
const forfait = (champs: Record<string, unknown> = {}) =>
  appel(ADMIN, '/api/subscriptions/plans', 'POST', {
    name: 'Forfait 10 lavages', service_id: 1, washes: 10,
    price: 40_000, validity_days: 180, status: 'ACTIVE', ...champs,
  });

/** Vend le forfait `id` au client 1, station 1. */
const vend = (planId: number, champs: Record<string, unknown> = {}) =>
  appel(ADMIN, '/api/subscriptions', 'POST', {
    customer_id: 1, plan_id: planId, station_id: 1, method: 'CASH', ...champs,
  });

/** Crée le forfait, le vend, et renvoie l'identifiant de l'abonnement. */
async function abonne(): Promise<number> {
  const { corps: plan } = await forfait();
  const { corps } = await vend(plan.data.plan.id);

  return corps.data.subscription.id;
}

// ====================================================================

describe('les forfaits proposés', () => {
  beforeEach(prepareBase);

  it('un administrateur crée un forfait', async () => {
    const { res, corps } = await forfait();

    expect(res.status).toBe(201);
    expect(corps.data.plan.washes).toBe(10);
    expect(corps.data.plan.is_active).toBe(true);
  });

  // L'ARGUMENT DE VENTE EST CALCULÉ PAR LE SERVEUR : 10 lavages à
  // 5 000 valent 50 000 à l'unité, le forfait en coûte 40 000. Le
  // calculer à l'écran l'aurait fait diverger d'un écran à l'autre.
  it("calcule l'économie, pour qu'elle soit la même partout", async () => {
    const { corps } = await forfait();

    expect(corps.data.plan.service_price).toBe(5000);
    expect(corps.data.plan.full_price).toBe(50_000);
    expect(corps.data.plan.saving).toBe(10_000);
  });

  it('un employé ne crée pas de forfait', async () => {
    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch('https://api.test/api/subscriptions/plans', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X', service_id: 1, washes: 5, price: 1000 }),
    });

    expect(res.status).toBe(403);
  });

  it("un forfait d'un seul lavage est refusé : ce n'est pas un forfait", async () => {
    const { res, corps } = await forfait({ washes: 1 });

    expect(res.status).toBe(422);
    expect(corps.errors.washes).toContain('Entre 2 et 50');
  });

  it('un forfait sans date de fin est refusé : ce serait une dette éternelle', async () => {
    const { res, corps } = await forfait({ validity_days: 3000 });

    expect(res.status).toBe(422);
    expect(corps.errors.validity_days).toContain('dette éternelle');
  });

  it('une prestation inconnue est refusée', async () => {
    const { res, corps } = await forfait({ service_id: 999 });

    expect(res.status).toBe(422);
    expect(corps.errors.service_id).toBeDefined();
  });

  it("la prestation d'une autre entreprise est inconnue", async () => {
    const { res } = await forfait({ service_id: 2 });

    expect(res.status).toBe(422);
  });

  it('porte les clés que le modèle Angular lit', async () => {
    await forfait();
    const { corps } = await appel(ADMIN, '/api/subscriptions/plans');

    expect(Object.keys(corps.data.plans[0]).sort()).toEqual([
      'full_price', 'id', 'is_active', 'name', 'price', 'saving',
      'service_id', 'service_name', 'service_price', 'sold_count',
      'status', 'validity_days', 'washes',
    ]);
  });

  it('?active=1 ne renvoie que ce qui est encore proposé', async () => {
    await forfait();
    await forfait({ name: 'Ancien forfait', status: 'INACTIVE' });

    const { corps: tous } = await appel(ADMIN, '/api/subscriptions/plans');
    const { corps: actifs } = await appel(ADMIN, '/api/subscriptions/plans?active=1');

    expect(tous.data.plans).toHaveLength(2);
    expect(actifs.data.plans).toHaveLength(1);
  });

  // MODIFIER UN FORFAIT NE TOUCHE PAS AUX ABONNEMENTS DÉJÀ VENDUS :
  // tout a été recopié le jour de la vente.
  it('modifier un forfait ne change rien à ce qui est déjà vendu', async () => {
    const { corps: plan } = await forfait();
    const { corps: vente } = await vend(plan.data.plan.id);

    await appel(ADMIN, `/api/subscriptions/plans/${plan.data.plan.id}`, 'PUT', {
      name: 'Forfait 10 lavages', service_id: 1, washes: 5,
      price: 25_000, validity_days: 90, status: 'ACTIVE',
    });

    const { corps } = await appel(ADMIN, `/api/subscriptions/${vente.data.subscription.id}`);

    expect(corps.data.subscription.washes_total).toBe(10);
    expect(corps.data.subscription.price_paid).toBe(40_000);
  });
});

// ====================================================================

describe('vendre un forfait', () => {
  beforeEach(prepareBase);

  it("crée l'abonnement ET l'encaissement, dans le même geste", async () => {
    const { corps: plan } = await forfait();
    const { res, corps } = await vend(plan.data.plan.id);

    expect(res.status).toBe(201);
    expect(corps.data.subscription.washes_left).toBe(10);
    expect(corps.data.subscription.state).toBe('ACTIVE');
    expect(corps.message).toContain('10 lavages');

    // L'ENCAISSEMENT PASSE PAR LA TABLE HABITUELLE : il entre donc
    // dans la caisse, dans le journal et dans la recette du jour sans
    // qu'on ait rien à ajouter.
    const p = await env.DB
      .prepare('SELECT amount, subscription_id, operation_id FROM payments WHERE organization_id = 1')
      .first<{ amount: number; subscription_id: number; operation_id: number | null }>();

    expect(p?.amount).toBe(40_000);
    expect(p?.subscription_id).toBe(corps.data.subscription.id);
    expect(p?.operation_id).toBeNull();
  });

  it("le vendeur est prévenu quand la caisse n'est pas ouverte", async () => {
    const { corps: plan } = await forfait();
    const { corps } = await vend(plan.data.plan.id);

    expect(corps.data.warnings).toHaveLength(1);
    expect(corps.data.warnings[0]).toContain('clôture du soir');
  });

  it('aucun avertissement quand la caisse est ouverte', async () => {
    await appel(ADMIN, '/api/cash/open', 'POST', { opening_float: 10_000 });
    const { corps: plan } = await forfait();
    const { corps } = await vend(plan.data.plan.id);

    expect(corps.data.warnings).toEqual([]);

    const p = await env.DB
      .prepare('SELECT cash_session_id FROM payments WHERE organization_id = 1')
      .first<{ cash_session_id: number | null }>();

    expect(p?.cash_session_id).not.toBeNull();
  });

  it("un forfait retiré du catalogue ne se vend plus", async () => {
    const { corps: plan } = await forfait({ status: 'INACTIVE' });
    const { res, corps } = await vend(plan.data.plan.id);

    expect(res.status).toBe(422);
    expect(corps.errors.plan_id).toContain("n'est plus proposé");
  });

  // VENDRE DIX LAVAGES D'UNE PRESTATION RETIRÉE DU CATALOGUE, c'est
  // vendre quelque chose qu'on ne sait plus faire.
  it("un forfait dont la prestation a été retirée ne se vend plus", async () => {
    const { corps: plan } = await forfait();
    await env.DB.prepare("UPDATE services SET status = 'INACTIVE' WHERE id = 1").run();

    const { res, corps } = await vend(plan.data.plan.id);

    expect(res.status).toBe(422);
    expect(corps.errors.plan_id).toContain('prestation');
  });

  it("le client d'une autre entreprise n'existe pas", async () => {
    const { corps: plan } = await forfait();
    const { res, corps } = await vend(plan.data.plan.id, { customer_id: 2 });

    expect(res.status).toBe(422);
    expect(corps.errors.customer_id).toBeDefined();
  });

  it("la station d'une autre entreprise est interdite, et le dit", async () => {
    const { corps: plan } = await forfait();
    const { res, corps } = await vend(plan.data.plan.id, { station_id: 3 });

    // 403 et non « 200, rien à voir ici » : le problème n'est pas
    // qu'il n'y a rien à montrer, c'est que cette station n'est pas
    // la sienne.
    expect(res.status).toBe(403);
    expect(corps.message).toContain('rattaché');
  });

  it('un employé vend — c’est un geste de comptoir', async () => {
    const { corps: plan } = await forfait();
    const { res } = await appel(EMPLOYE, '/api/subscriptions', 'POST', {
      customer_id: 1, plan_id: plan.data.plan.id, station_id: 1, method: 'CASH',
    });

    expect(res.status).toBe(201);
  });

  it("garde la référence de transaction saisie à la main", async () => {
    const { corps: plan } = await forfait();
    await vend(plan.data.plan.id, {
      method: 'MOBILE_MONEY', provider: 'Wave', external_reference: 'TX-4412',
    });

    const p = await env.DB
      .prepare('SELECT provider, external_reference FROM payments WHERE organization_id = 1')
      .first<{ provider: string; external_reference: string }>();

    expect(p?.provider).toBe('Wave');
    expect(p?.external_reference).toBe('TX-4412');
  });

  it('porte les clés que le modèle Angular lit', async () => {
    const { corps: plan } = await forfait();
    const { corps } = await vend(plan.data.plan.id);

    expect(Object.keys(corps.data.subscription).sort()).toEqual([
      'cancellation_reason', 'cancelled_at', 'created_at', 'customer_id',
      'customer_name', 'customer_phone', 'days_left', 'expires_at', 'id',
      'is_usable', 'notes', 'plan_id', 'plan_name', 'price_paid', 'service_id',
      'service_name', 'sold_by_name', 'starts_at', 'state', 'state_label',
      'station_id', 'station_name', 'washes_left', 'washes_total', 'washes_used',
    ]);
  });
});

// ====================================================================

describe("l'état d'un abonnement est calculé, jamais stocké", () => {
  beforeEach(prepareBase);

  it('un forfait périmé se lit dans sa date', async () => {
    const id = await abonne();
    await env.DB
      .prepare("UPDATE subscriptions SET expires_at = date('now', '-1 day') WHERE id = ?")
      .bind(id).run();

    const { corps } = await appel(ADMIN, `/api/subscriptions/${id}`);

    expect(corps.data.subscription.state).toBe('EXPIRED');
    expect(corps.data.subscription.state_label).toBe('Périmé');
    expect(corps.data.subscription.is_usable).toBe(false);
    expect(corps.data.subscription.days_left).toBe(0);
  });

  it('un forfait épuisé se compte dans les dossiers rattachés', async () => {
    const { corps: plan } = await forfait({ washes: 2 });
    const { corps: vente } = await vend(plan.data.plan.id);
    const id = vente.data.subscription.id;

    await env.DB
      .prepare('UPDATE operations SET subscription_id = ? WHERE id IN (1, 2)')
      .bind(id).run();

    const { corps } = await appel(ADMIN, `/api/subscriptions/${id}`);

    expect(corps.data.subscription.washes_used).toBe(2);
    expect(corps.data.subscription.state).toBe('EXHAUSTED');
    expect(corps.data.subscription.is_usable).toBe(false);
  });

  // Un dossier ANNULÉ ne consomme rien : le lavage n'a pas eu lieu.
  it("un dossier annulé ne décompte pas un lavage", async () => {
    const id = await abonne();
    await env.DB
      .prepare("UPDATE operations SET subscription_id = ?, status = 'CANCELLED' WHERE id = 1")
      .bind(id).run();

    const { corps } = await appel(ADMIN, `/api/subscriptions/${id}`);

    expect(corps.data.subscription.washes_used).toBe(0);
  });
});

// ====================================================================

describe('consommer un lavage', () => {
  beforeEach(prepareBase);

  it('couvre tout le dossier, et le dû tombe à zéro', async () => {
    const id = await abonne();

    const { res, corps } = await appel(ADMIN, '/api/subscriptions/use', 'POST', {
      operation_id: 1,
    });

    expect(res.status).toBe(200);
    expect(corps.data.operation.discount_amount).toBe(5000);
    expect(corps.data.operation.discount_source).toBe('SUBSCRIPTION');
    expect(corps.data.operation.amount_due).toBe(0);
    expect(corps.data.subscription.id).toBe(id);
    expect(corps.data.subscription.washes_left).toBe(9);
    expect(corps.message).toContain('reste 9');
  });

  // LA SOURCE DE LA REMISE COMPTE AUTANT QUE LE MONTANT : la fidélité
  // est un coût, l'abonnement une dette qu'on solde. Sans la
  // distinction, l'écran de fidélité annoncerait au gérant qu'il offre
  // un argent qu'il a encaissé six mois plus tôt.
  it("n'entre pas dans le coût du programme de fidélité", async () => {
    await abonne();
    await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    const { corps } = await appel(ADMIN, '/api/loyalty');

    expect(corps.data.summary.cost).toBe(0);
  });

  // UN LAVAGE D'ABONNÉ RAPPORTE UN TAMPON : il a été payé — d'avance,
  // mais payé. Le contraire punirait le client le plus fidèle.
  it('rapporte un tampon de fidélité', async () => {
    await appel(ADMIN, '/api/loyalty/program', 'PUT', {
      name: 'Carte', stamps_required: 10, reward_amount: 5000, status: 'ACTIVE',
    });
    await abonne();

    const { corps } = await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    expect(corps.data.loyalty_balance).toBe(1);
  });

  it('sans programme de fidélité, rien à annoncer', async () => {
    await abonne();
    const { corps } = await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    expect(corps.data.loyalty_balance).toBeNull();
  });

  // LE SERVEUR CHOISIT : celui qui expire le plus tôt, dans l'intérêt
  // du client — il ne perd pas le forfait dont la date approche
  // pendant qu'on entame le suivant.
  it('choisit le forfait qui expire le plus tôt', async () => {
    const { corps: plan } = await forfait();
    const { corps: a } = await vend(plan.data.plan.id);
    const { corps: b } = await vend(plan.data.plan.id);

    // Le second est daté plus loin ; c'est le premier qui doit servir.
    await env.DB
      .prepare("UPDATE subscriptions SET expires_at = date('now', '+300 days') WHERE id = ?")
      .bind(b.data.subscription.id).run();

    const { corps } = await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    expect(corps.data.subscription.id).toBe(a.data.subscription.id);
  });

  it("sans forfait utilisable, c'est refusé — et le message nomme la prestation", async () => {
    const { res, corps } = await appel(ADMIN, '/api/subscriptions/use', 'POST', {
      operation_id: 1,
    });

    expect(res.status).toBe(409);
    expect(corps.message).toContain('Lavage standard');
  });

  it('un forfait périmé ne sert plus', async () => {
    const id = await abonne();
    await env.DB
      .prepare("UPDATE subscriptions SET expires_at = date('now', '-1 day') WHERE id = ?")
      .bind(id).run();

    const { res } = await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    expect(res.status).toBe(409);
  });

  it('un forfait annulé ne sert plus', async () => {
    const id = await abonne();
    await appel(ADMIN, `/api/subscriptions/${id}/cancel`, 'POST', { reason: 'Erreur de saisie' });

    const { res } = await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    expect(res.status).toBe(409);
  });

  it("un forfait d'une autre prestation ne sert pas", async () => {
    await env.DB
      .prepare(
        `INSERT INTO services (id, organization_id, name, category, price, duration_minutes)
         VALUES (9, 1, 'Lavage intégral', 'LAVAGE', 12000, 90)`,
      )
      .run();

    const { corps: plan } = await forfait({ service_id: 9, price: 100_000 });
    await vend(plan.data.plan.id);

    const { res } = await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    expect(res.status).toBe(409);
  });

  it('deux fois sur le même dossier : refusé', async () => {
    await abonne();
    await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    const { res, corps } = await appel(ADMIN, '/api/subscriptions/use', 'POST', {
      operation_id: 1,
    });

    expect(res.status).toBe(409);
    expect(corps.message).toContain('déjà couvert');
  });

  // LES DEUX REMISES RAMÈNENT LE DÛ À ZÉRO : les cumuler ferait
  // perdre des tampons au client pour rien.
  it("sur un dossier déjà remisé par la fidélité : refusé", async () => {
    await appel(ADMIN, '/api/loyalty/program', 'PUT', {
      name: 'Carte', stamps_required: 3, reward_amount: 5000, status: 'ACTIVE',
    });

    const p = await env.DB
      .prepare('SELECT id FROM loyalty_programs WHERE organization_id = 1')
      .first<{ id: number }>();

    for (let i = 0; i < 3; i += 1) {
      await env.DB
        .prepare(
          `INSERT INTO loyalty_entries (organization_id, program_id, customer_id, type, points,
                                        created_by_user_id)
           VALUES (1, ?, 1, 'EARN', 1, 1)`,
        ).bind(p!.id).run();
    }

    await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });
    await abonne();

    const { res, corps } = await appel(ADMIN, '/api/subscriptions/use', 'POST', {
      operation_id: 1,
    });

    expect(res.status).toBe(409);
    expect(corps.message).toContain('Retirez-la');
  });

  it('sur un dossier déjà réglé en partie : refusé', async () => {
    await abonne();
    await appel(ADMIN, '/api/operations/1/payments', 'POST', { amount: 2000, method: 'CASH' });

    const { res, corps } = await appel(ADMIN, '/api/subscriptions/use', 'POST', {
      operation_id: 1,
    });

    expect(res.status).toBe(409);
    expect(corps.message).toContain('réglé en partie');
  });

  it('sur un dossier clos : refusé', async () => {
    await abonne();
    await env.DB.prepare("UPDATE operations SET status = 'COMPLETED' WHERE id = 1").run();

    const { res } = await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    expect(res.status).toBe(409);
  });

  it('un employé décompte un lavage : c’est son geste', async () => {
    await abonne();
    const { res } = await appel(EMPLOYE, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    expect(res.status).toBe(200);
  });
});

// ====================================================================

describe('retirer un forfait appliqué au mauvais dossier', () => {
  beforeEach(prepareBase);

  const applique = async () => {
    await abonne();
    await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });
  };

  it('rend le lavage au client', async () => {
    await applique();

    const { res, corps } = await appel(ADMIN, '/api/subscriptions/use/1/cancel', 'POST');

    expect(res.status).toBe(200);
    expect(corps.data.operation.discount_amount).toBe(0);
    expect(corps.data.operation.discount_source).toBeNull();
    expect(corps.data.operation.amount_due).toBe(5000);
    expect(corps.data.subscription.washes_left).toBe(10);
  });

  it('sur un dossier sans forfait : refusé', async () => {
    const { res, corps } = await appel(ADMIN, '/api/subscriptions/use/1/cancel', 'POST');

    expect(res.status).toBe(409);
    expect(corps.message).toContain('Aucun forfait');
  });

  it('après restitution : refusé, le client est parti', async () => {
    await applique();
    await env.DB.prepare("UPDATE operations SET status = 'COMPLETED' WHERE id = 1").run();

    const { res, corps } = await appel(ADMIN, '/api/subscriptions/use/1/cancel', 'POST');

    expect(res.status).toBe(409);
    expect(corps.message).toContain('restitué');
  });
});

// ====================================================================

describe('annuler un abonnement', () => {
  beforeEach(prepareBase);

  // LE MOTIF EST OBLIGATOIRE : de l'argent a été encaissé. Un client
  // qui réclame six mois plus tard doit trouver une explication, pas
  // une ligne muette.
  it('sans motif : refusé', async () => {
    const id = await abonne();

    const { res, corps } = await appel(ADMIN, `/api/subscriptions/${id}/cancel`, 'POST', {
      reason: '',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.reason).toBeDefined();
  });

  it("l'annulation arrête le forfait et garde le motif", async () => {
    const id = await abonne();

    const { res, corps } = await appel(ADMIN, `/api/subscriptions/${id}/cancel`, 'POST', {
      reason: 'Client parti à l’étranger',
    });

    expect(res.status).toBe(200);
    expect(corps.data.subscription.state).toBe('CANCELLED');
    expect(corps.data.subscription.cancellation_reason).toBe('Client parti à l’étranger');
  });

  // ON N'INVENTE AUCUN REMBOURSEMENT AU PRORATA : combien rendre est
  // une décision commerciale, pas un calcul. Le message renvoie vers
  // le journal des encaissements.
  it('renvoie vers le journal des encaissements, sans rien rembourser', async () => {
    const id = await abonne();

    const { corps } = await appel(ADMIN, `/api/subscriptions/${id}/cancel`, 'POST', {
      reason: 'Doublon',
    });

    expect(corps.message).toContain('10 lavage(s)');
    expect(corps.message).toContain('remboursement');

    // Aucune contre-écriture n'a été inventée.
    const p = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM payments WHERE organization_id = 1 AND status = 'REFUNDED'")
      .first<{ n: number }>();

    expect(p?.n).toBe(0);
  });

  it('deux fois : refusé', async () => {
    const id = await abonne();
    await appel(ADMIN, `/api/subscriptions/${id}/cancel`, 'POST', { reason: 'Doublon' });

    const { res } = await appel(ADMIN, `/api/subscriptions/${id}/cancel`, 'POST', {
      reason: 'Doublon',
    });

    expect(res.status).toBe(409);
  });

  it("un employé n'annule pas un abonnement payé", async () => {
    const id = await abonne();
    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch(`https://api.test/api/subscriptions/${id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Parce que' }),
    });

    expect(res.status).toBe(403);
  });
});

// ====================================================================

describe('le bilan', () => {
  beforeEach(prepareBase);

  // LA DETTE : le chiffre qui n'existerait pas sans ce module. Une
  // station qui a vendu 200 lavages d'avance DOIT 200 lavages.
  it('montre ce qui reste à livrer', async () => {
    await abonne();

    const { corps } = await appel(ADMIN, '/api/subscriptions/overview');

    expect(corps.data.sold).toEqual({ count: 1, amount: 40_000 });
    expect(corps.data.outstanding.subscriptions).toBe(1);
    expect(corps.data.outstanding.washes).toBe(10);
    // 10 lavages à 5 000 au catalogue d'aujourd'hui.
    expect(corps.data.outstanding.value).toBe(50_000);
  });

  it('la dette diminue à chaque lavage livré', async () => {
    await abonne();
    await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    const { corps } = await appel(ADMIN, '/api/subscriptions/overview');

    expect(corps.data.outstanding.washes).toBe(9);
    expect(corps.data.delivered.washes).toBe(1);
    // La valeur livrée n'est PAS de la recette : elle a été encaissée
    // le jour de la vente. C'est de la dette soldée.
    expect(corps.data.delivered.value).toBe(5000);
  });

  it('un forfait périmé ne compte plus dans la dette : la station ne le doit plus', async () => {
    const id = await abonne();
    await env.DB
      .prepare("UPDATE subscriptions SET expires_at = date('now', '-1 day') WHERE id = ?")
      .bind(id).run();

    const { corps } = await appel(ADMIN, '/api/subscriptions/overview');

    expect(corps.data.outstanding.washes).toBe(0);
  });

  it('un forfait annulé ne compte plus dans la dette', async () => {
    const id = await abonne();
    await appel(ADMIN, `/api/subscriptions/${id}/cancel`, 'POST', { reason: 'Doublon' });

    const { corps } = await appel(ADMIN, '/api/subscriptions/overview');

    expect(corps.data.outstanding.subscriptions).toBe(0);
  });

  // LE SEUL BLOC ACTIONNABLE DE L'ÉCRAN : un appel, et le client vient
  // user ce qu'il a payé.
  it('liste les forfaits qui périment dans les trente jours', async () => {
    const id = await abonne();

    const { corps: loin } = await appel(ADMIN, '/api/subscriptions/overview');

    expect(loin.data.expiring).toEqual([]);

    await env.DB
      .prepare("UPDATE subscriptions SET expires_at = date('now', '+10 days') WHERE id = ?")
      .bind(id).run();

    const { corps } = await appel(ADMIN, '/api/subscriptions/overview');

    expect(corps.data.expiring).toHaveLength(1);
    expect(corps.data.expiring[0].days_left).toBe(10);
  });

  it('porte les clés que le modèle Angular lit', async () => {
    const { corps } = await appel(ADMIN, '/api/subscriptions/overview');

    expect(Object.keys(corps.data).sort()).toEqual([
      'delivered', 'expiring', 'outstanding', 'period', 'sold',
    ]);
  });
});

// ====================================================================

describe('la liste et le cloisonnement', () => {
  beforeEach(prepareBase);

  it('?usable=1 écarte les forfaits périmés, épuisés et annulés', async () => {
    const a = await abonne();
    const b = await abonne();
    await appel(ADMIN, `/api/subscriptions/${b}/cancel`, 'POST', { reason: 'Doublon' });

    const { corps: tous } = await appel(ADMIN, '/api/subscriptions');
    const { corps: utilisables } = await appel(ADMIN, '/api/subscriptions?usable=1');

    expect(tous.data.subscriptions).toHaveLength(2);
    expect(utilisables.data.subscriptions).toHaveLength(1);
    expect(utilisables.data.subscriptions[0].id).toBe(a);
  });

  it('cherche par nom et par téléphone', async () => {
    await abonne();

    const { corps: nom } = await appel(ADMIN, '/api/subscriptions?search=Aminata');
    const { corps: tel } = await appel(ADMIN, '/api/subscriptions?search=770000001');
    const { corps: rien } = await appel(ADMIN, '/api/subscriptions?search=Personne');

    expect(nom.data.subscriptions).toHaveLength(1);
    expect(tel.data.subscriptions).toHaveLength(1);
    expect(rien.data.subscriptions).toEqual([]);
  });

  it("l'autre entreprise ne voit ni les forfaits ni les abonnements", async () => {
    await abonne();

    const { corps: plans } = await appel(RIVAL, '/api/subscriptions/plans');
    const { corps: abos } = await appel(RIVAL, '/api/subscriptions');
    const { corps: bilan } = await appel(RIVAL, '/api/subscriptions/overview');

    expect(plans.data.plans).toEqual([]);
    expect(abos.data.subscriptions).toEqual([]);
    expect(bilan.data.outstanding.washes).toBe(0);
  });

  it("l'abonnement d'une autre entreprise est introuvable", async () => {
    const id = await abonne();
    const { res } = await appel(RIVAL, `/api/subscriptions/${id}`);

    expect(res.status).toBe(404);
  });

  it('la fiche montre les lavages déjà pris', async () => {
    const id = await abonne();
    await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 1 });

    const { corps } = await appel(ADMIN, `/api/subscriptions/${id}`);

    expect(corps.data.operations).toHaveLength(1);
    expect(corps.data.operations[0].reference).toBe('OP-0001');
  });
});
