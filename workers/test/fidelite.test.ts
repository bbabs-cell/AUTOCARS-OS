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

/** Un programme actif : 10 tampons, 5 000 F offerts. */
const programme = (champs: Record<string, unknown> = {}) =>
  appel(ADMIN, '/api/loyalty/program', 'PUT', {
    name: 'Carte Diallo', stamps_required: 10, reward_amount: 5000,
    min_operation_amount: 0, status: 'ACTIVE', ...champs,
  });

/**
 * Pose `n` tampons au client 1, sans passer par la caisse.
 *
 * L'identifiant du programme est RELU : `AUTOINCREMENT` ne réutilise
 * jamais un numéro, et le programme créé par le test précédent a
 * laissé le compteur plus loin. Écrire « 1 » ici marchait au premier
 * test et échouait aux suivants sur une clé étrangère.
 */
async function tampons(n: number): Promise<void> {
  const p = await env.DB
    .prepare('SELECT id FROM loyalty_programs WHERE organization_id = 1 LIMIT 1')
    .first<{ id: number }>();

  if (p === null) {
    throw new Error('Aucun programme : appelez programme() avant tampons().');
  }

  for (let i = 0; i < n; i += 1) {
    await env.DB
      .prepare(
        `INSERT INTO loyalty_entries (organization_id, program_id, customer_id, type, points,
                                      created_by_user_id)
         VALUES (1, ?, 1, 'EARN', 1, 1)`,
      )
      .bind(p.id)
      .run();
  }
}

// ====================================================================

describe('les règles du programme', () => {
  beforeEach(prepareBase);

  it("l'écran répond même sans programme : il n'y a rien à afficher, pas une erreur", async () => {
    const { res, corps } = await appel(ADMIN, '/api/loyalty');

    expect(res.status).toBe(200);
    expect(corps.data.program).toBeNull();
    expect(corps.data.summary).toEqual({ earned: 0, redeemed: 0, reversed: 0, cost: 0 });
    expect(corps.data.ready).toEqual([]);
  });

  it('un administrateur crée le programme', async () => {
    const { res, corps } = await programme();

    expect(res.status).toBe(200);
    expect(corps.data.program.stamps_required).toBe(10);
    expect(corps.data.program.is_active).toBe(true);
    expect(corps.message).toContain('Programme actif');
  });

  it("un employé ne le règle pas : le client qui collecte a une promesse en cours", async () => {
    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch('https://api.test/api/loyalty/program', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ stamps_required: 3, reward_amount: 1000, status: 'ACTIVE' }),
    });

    expect(res.status).toBe(403);
  });

  it('moins de 3 tampons est refusé : ce serait une remise permanente', async () => {
    const { res, corps } = await programme({ stamps_required: 2 });

    expect(res.status).toBe(422);
    expect(corps.errors.stamps_required).toContain('Entre 3 et 50');
  });

  it("plus de 50 est refusé : personne n'irait au bout", async () => {
    const { res } = await programme({ stamps_required: 51 });

    expect(res.status).toBe(422);
  });

  it("une récompense sans montant est refusée", async () => {
    const { res, corps } = await programme({ reward_amount: 0 });

    expect(res.status).toBe(422);
    expect(corps.errors.reward_amount).toBeDefined();
  });

  it('modifier le programme ne le duplique pas', async () => {
    await programme();
    await programme({ stamps_required: 12, reward_amount: 6000 });

    const r = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM loyalty_programs WHERE organization_id = 1')
      .first<{ n: number }>();

    expect(r?.n).toBe(1);
  });

  // Le programme désactivé reste lisible : un gérant qui le rouvre
  // doit retrouver ses réglages, pas un formulaire vide.
  it('un programme désactivé reste affiché avec ses réglages', async () => {
    await programme({ stamps_required: 8 });
    await programme({ stamps_required: 8, status: 'INACTIVE' });

    const { corps } = await appel(ADMIN, '/api/loyalty');

    expect(corps.data.program.stamps_required).toBe(8);
    expect(corps.data.program.is_active).toBe(false);
  });

  it("l'écran porte les clés que le modèle Angular lit", async () => {
    await programme();
    const { corps } = await appel(ADMIN, '/api/loyalty');

    expect(Object.keys(corps.data).sort()).toEqual(['period', 'program', 'ready', 'summary']);
    expect(Object.keys(corps.data.program).sort()).toEqual([
      'id', 'is_active', 'min_operation_amount', 'name', 'reward_amount',
      'stamps_required', 'status',
    ]);
  });
});

// ====================================================================

describe('la carte du client', () => {
  beforeEach(prepareBase);

  it("répond sans programme plutôt que d'échouer", async () => {
    const { res, corps } = await appel(ADMIN, '/api/loyalty/customers/1');

    expect(res.status).toBe(200);
    expect(corps.data.card.has_program).toBe(false);
    expect(corps.data.history).toEqual([]);
  });

  it('un client inconnu est un 404', async () => {
    const { res } = await appel(ADMIN, '/api/loyalty/customers/999');

    expect(res.status).toBe(404);
  });

  it('le client d’une autre entreprise est introuvable, pas interdit', async () => {
    await programme();
    const { res } = await appel(ADMIN, '/api/loyalty/customers/2');

    expect(res.status).toBe(404);
  });

  it('annonce ce qui reste à faire', async () => {
    await programme();
    await tampons(7);

    const { corps } = await appel(ADMIN, '/api/loyalty/customers/1');

    expect(corps.data.card.balance).toBe(7);
    expect(corps.data.card.rewards_available).toBe(0);
    expect(corps.data.card.stamps_to_next).toBe(3);
  });

  // LE PIÈGE : à 12 tampons sur 10, « il t'en manque 8 » serait faux.
  // Le client a DÉJÀ droit à un lavage ; on ne lui parle pas du
  // suivant.
  it("n'annonce rien à attendre quand une récompense est déjà gagnée", async () => {
    await programme();
    await tampons(12);

    const { corps } = await appel(ADMIN, '/api/loyalty/customers/1');

    expect(corps.data.card.rewards_available).toBe(1);
    expect(corps.data.card.stamps_to_next).toBe(0);
  });

  it("l'historique porte les clés que l'écran lit", async () => {
    await programme();
    await tampons(1);

    const { corps } = await appel(ADMIN, '/api/loyalty/customers/1');

    expect(Object.keys(corps.data.history[0]).sort()).toEqual([
      'created_at', 'created_by_name', 'id', 'label', 'note',
      'operation_id', 'operation_reference', 'points', 'type',
    ]);
    expect(corps.data.history[0].label).toBe('Tampon gagné');
  });
});

// ====================================================================

describe('utiliser une récompense', () => {
  beforeEach(prepareBase);

  it('applique une REMISE, et non un faux encaissement', async () => {
    await programme();
    await tampons(10);

    const { res, corps } = await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    expect(res.status).toBe(200);
    expect(corps.data.operation.discount_amount).toBe(5000);
    expect(corps.data.operation.discount_source).toBe('LOYALTY');
    expect(corps.data.operation.amount_due).toBe(0);
    expect(corps.data.card.balance).toBe(0);

    // La recette du jour ne doit RIEN voir passer : un lavage offert
    // n'est pas de l'argent dans le tiroir.
    const p = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM payments WHERE operation_id = 1')
      .first<{ n: number }>();

    expect(p?.n).toBe(0);
  });

  it('renvoie le dossier complet, dans la forme que la file d’attente lit', async () => {
    await programme();
    await tampons(10);

    const { corps } = await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    // On ne recopie pas la liste des champs : on la COMPARE à celle
    // que la file d'attente envoie déjà. Deux listes écrites à la main
    // finissent par diverger, et c'est un champ manquant — `is_overdue`
    // — qui avait un jour arrêté le rendu d'Angular après la première
    // carte, sans la moindre erreur en console.
    const { corps: file } = await appel(ADMIN, '/api/queue');
    const attendus = Object.keys(file.data.columns.flatMap((c: any) => c.operations)[0]).sort();

    expect(attendus.length).toBeGreaterThan(30);
    expect(Object.keys(corps.data.operation).sort()).toEqual(attendus);
  });

  it('sans assez de tampons, elle est refusée — et le message dit combien il en faut', async () => {
    await programme();
    await tampons(4);

    const { res, corps } = await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    expect(res.status).toBe(409);
    expect(corps.message).toContain('4 tampon(s)');
    expect(corps.message).toContain('10');
  });

  it('deux fois sur le même dossier : refusé', async () => {
    await programme();
    await tampons(20);
    await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    const { res, corps } = await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    expect(res.status).toBe(409);
    expect(corps.message).toContain('déjà appliquée');
  });

  it('sur un dossier clos : refusé', async () => {
    await programme();
    await tampons(10);
    await env.DB.prepare("UPDATE operations SET status = 'COMPLETED' WHERE id = 1").run();

    const { res, corps } = await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    expect(res.status).toBe(409);
    expect(corps.message).toContain('clos');
  });

  it("sans programme actif : refusé", async () => {
    // Le programme existe mais il est éteint : les tampons déjà
    // gagnés restent, la récompense ne s'utilise plus.
    await programme();
    await tampons(10);
    await programme({ status: 'INACTIVE' });

    const { res } = await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    expect(res.status).toBe(409);
  });

  // LA REMISE NE DÉPASSE JAMAIS LE PRIX : sinon la station devrait de
  // l'argent à un client parce qu'il est fidèle. Le surplus est perdu,
  // et le serveur le DIT — au comptoir on peut alors proposer de
  // garder la récompense pour un lavage plus cher.
  it('ne dépasse pas le prix du dossier, et prévient que le reste est perdu', async () => {
    await programme({ reward_amount: 8000 });
    await tampons(10);

    const { corps } = await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    expect(corps.data.operation.discount_amount).toBe(5000);
    expect(corps.data.operation.amount_due).toBe(0);
    expect(corps.data.warnings).toHaveLength(1);
    expect(corps.data.warnings[0]).toContain('le reste est perdu');
  });

  it("ne prévient de rien quand la récompense tient dans le dossier", async () => {
    await programme({ reward_amount: 3000 });
    await tampons(10);

    const { corps } = await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    expect(corps.data.warnings).toEqual([]);
    expect(corps.data.operation.amount_due).toBe(2000);
  });

  it("le dossier d'une autre entreprise est introuvable", async () => {
    await programme();
    await tampons(10);

    const { res } = await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 3 });

    expect(res.status).toBe(404);
  });

  it('un employé peut appliquer la récompense : c’est un geste de comptoir', async () => {
    await programme();
    await tampons(10);

    const { res } = await appel(EMPLOYE, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    expect(res.status).toBe(200);
  });
});

// ====================================================================

describe('annuler une récompense appliquée par erreur', () => {
  beforeEach(prepareBase);

  const applique = async () => {
    await programme();
    await tampons(10);
    await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });
  };

  it('rend les tampons par une écriture INVERSE, sans rien effacer', async () => {
    await applique();

    const { res, corps } = await appel(ADMIN, '/api/loyalty/redeem/1/cancel', 'POST');

    expect(res.status).toBe(200);
    expect(corps.data.card.balance).toBe(10);
    expect(corps.data.operation.discount_amount).toBe(0);
    expect(corps.data.operation.discount_source).toBeNull();

    // Les trois lignes doivent TOUTES être là : le REDEEM reste
    // lisible, c'est tout l'intérêt d'un grand livre.
    const lignes = await env.DB
      .prepare("SELECT type FROM loyalty_entries WHERE customer_id = 1 AND type != 'EARN' ORDER BY id")
      .all<{ type: string }>();

    expect(lignes.results.map((l) => l.type)).toEqual(['REDEEM', 'REVERSAL']);
  });

  it("deux fois : la seconde est refusée — sinon on rendrait deux fois les tampons", async () => {
    await applique();
    await appel(ADMIN, '/api/loyalty/redeem/1/cancel', 'POST');

    const { res, corps } = await appel(ADMIN, '/api/loyalty/redeem/1/cancel', 'POST');

    expect(res.status).toBe(409);
    expect(corps.message).toContain('Aucune récompense');
  });

  it("sur un dossier sans remise : refusé", async () => {
    await programme();

    const { res } = await appel(ADMIN, '/api/loyalty/redeem/1/cancel', 'POST');

    expect(res.status).toBe(409);
  });

  it('après restitution : refusé, le client est parti', async () => {
    await applique();
    await env.DB.prepare("UPDATE operations SET status = 'COMPLETED' WHERE id = 1").run();

    const { res, corps } = await appel(ADMIN, '/api/loyalty/redeem/1/cancel', 'POST');

    expect(res.status).toBe(409);
    expect(corps.message).toContain('restitué');
  });

  // LE CAS QUI FAIT LE PLUS MAL AU COMPTOIR : le client a déjà payé
  // le montant remisé, et retirer la remise fait remonter ce qu'il
  // doit. Personne ne va le lui réclamer sur le parking sans le
  // savoir.
  it('prévient quand le dossier redevient dû après un paiement partiel', async () => {
    await programme({ reward_amount: 3000 });
    await tampons(10);
    await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });
    await appel(ADMIN, '/api/operations/1/payments', 'POST', { amount: 2000, method: 'CASH' });

    const { corps } = await appel(ADMIN, '/api/loyalty/redeem/1/cancel', 'POST');

    expect(corps.data.warnings).toHaveLength(1);
    expect(corps.data.warnings[0]).toContain('redevient dû');
  });
});

// ====================================================================

describe('un lavage payé donne un tampon', () => {
  beforeEach(prepareBase);

  const regle = (montant = 5000, op = 1) =>
    appel(ADMIN, `/api/operations/${op}/payments`, 'POST', { amount: montant, method: 'CASH' });

  it('le tampon est posé à l’encaissement, pas à la restitution', async () => {
    await programme();

    const { res, corps } = await regle();

    expect(res.status).toBe(201);
    expect(corps.data.loyalty_balance).toBe(1);
  });

  it("un dossier réglé en deux fois ne donne qu'un tampon", async () => {
    await programme();
    await regle(2000);
    const { corps } = await regle(3000);

    expect(corps.data.loyalty_balance).toBe(1);

    const r = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM loyalty_entries WHERE type = 'EARN'")
      .first<{ n: number }>();

    expect(r?.n).toBe(1);
  });

  it("un dossier PARTIELLEMENT payé n'en donne aucun", async () => {
    await programme();

    const { corps } = await regle(2000);

    expect(corps.data.loyalty_balance).toBeNull();
  });

  it('sans programme actif, l’encaissement se passe normalement', async () => {
    const { res, corps } = await regle();

    expect(res.status).toBe(201);
    expect(corps.data.loyalty_balance).toBeNull();
    expect(corps.data.is_settled).toBe(true);
  });

  it('sous le montant plancher, pas de tampon', async () => {
    await programme({ min_operation_amount: 10_000 });

    const { corps } = await regle();

    expect(corps.data.loyalty_balance).toBeNull();
  });

  // LE PROGRAMME NE SE NOURRIT PAS LUI-MÊME : dix lavages offerts n'en
  // produisent pas un onzième.
  it("un lavage entièrement offert par la fidélité ne rapporte pas de tampon", async () => {
    await programme();
    await tampons(10);
    await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    // Le dû est tombé à zéro : le dossier est réglé sans qu'un franc
    // ait été encaissé. Rien ne doit être gagné.
    const r = await env.DB
      .prepare("SELECT COUNT(*) AS n FROM loyalty_entries WHERE type = 'EARN' AND operation_id = 1")
      .first<{ n: number }>();

    expect(r?.n).toBe(0);
  });

  // Le plancher se mesure sur le PRIX, pas sur ce qui a été encaissé :
  // sinon un lavage à moitié payé par une récompense passerait sous le
  // plancher, et le client serait puni d'être fidèle.
  it('le plancher se mesure sur le prix, pas sur ce qui reste à payer', async () => {
    await programme({ reward_amount: 3000, min_operation_amount: 4000 });
    await tampons(10);
    await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    // Reste 2 000 à payer sur un lavage à 5 000 : le plancher de
    // 4 000 est franchi par le PRIX.
    const { corps } = await regle(2000);

    expect(corps.data.loyalty_balance).toBe(1);
  });
});

// ====================================================================

describe('le bilan du programme', () => {
  beforeEach(prepareBase);

  it('compte le coût sur les remises réellement appliquées', async () => {
    await programme({ reward_amount: 8000 });
    await tampons(10);
    await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 1 });

    const { corps } = await appel(ADMIN, '/api/loyalty');

    // La récompense annoncée vaut 8 000, le dossier n'en coûte que
    // 5 000 : le programme a coûté 5 000, pas 8 000.
    expect(corps.data.summary.cost).toBe(5000);
    expect(corps.data.summary.earned).toBe(10);
    expect(corps.data.summary.redeemed).toBe(10);
  });

  it('liste les clients qui ont une récompense à prendre', async () => {
    await programme();
    await tampons(10);

    const { corps } = await appel(ADMIN, '/api/loyalty');

    expect(corps.data.ready).toHaveLength(1);
    expect(corps.data.ready[0].customer_name).toBe('Aminata Sarr');
    expect(corps.data.ready[0].balance).toBe(10);
  });

  it("ne liste pas ceux qui n'y sont pas encore", async () => {
    await programme();
    await tampons(9);

    const { corps } = await appel(ADMIN, '/api/loyalty');

    expect(corps.data.ready).toEqual([]);
  });
});

// ====================================================================

describe('le cloisonnement', () => {
  beforeEach(prepareBase);

  it("l'autre entreprise ne voit ni le programme ni les tampons", async () => {
    await programme();
    await tampons(10);

    const { corps } = await appel(RIVAL, '/api/loyalty');

    expect(corps.data.program).toBeNull();
    expect(corps.data.ready).toEqual([]);
    expect(corps.data.summary.earned).toBe(0);
  });

  it("chaque entreprise a son propre programme actif", async () => {
    await programme();
    await appel(RIVAL, '/api/loyalty/program', 'PUT', {
      stamps_required: 5, reward_amount: 2000, status: 'ACTIVE',
    });

    const { corps } = await appel(RIVAL, '/api/loyalty');

    expect(corps.data.program.stamps_required).toBe(5);

    const { corps: chezNous } = await appel(ADMIN, '/api/loyalty');

    expect(chezNous.data.program.stamps_required).toBe(10);
  });
});
