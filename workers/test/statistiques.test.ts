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

const jour = () => new Date().toISOString().slice(0, 10);

/** Restitue le dossier, à l'instant présent. */
const restitue = (id: number) =>
  env.DB
    .prepare(
      `UPDATE operations SET status = 'COMPLETED', released_at = datetime('now'),
              started_at = datetime('now', '-40 minutes'),
              completed_at = datetime('now', '-5 minutes')
        WHERE id = ?`,
    )
    .bind(id)
    .run();

describe('la période', () => {
  beforeEach(prepareBase);

  it('trente jours par défaut', async () => {
    const { res, corps } = await appel(ADMIN, '/api/analytics');

    expect(res.status).toBe(200);
    expect(corps.data.period.days).toBe(30);
    expect(corps.data.period.to).toBe(jour());
    expect(corps.data.daily).toHaveLength(30);
  });

  // DES BORNES INVERSÉES sont une faute de saisie, pas une demande :
  // on les remet à l'endroit plutôt que de renvoyer un écran vide que
  // l'utilisateur croira être la réalité.
  it('des bornes inversées sont remises à l’endroit', async () => {
    const { corps } = await appel(ADMIN, '/api/analytics?from=2026-03-31&to=2026-03-01');

    expect(corps.data.period.from).toBe('2026-03-01');
    expect(corps.data.period.to).toBe('2026-03-31');
    expect(corps.data.period.days).toBe(31);
  });

  // AU-DELÀ D'UN AN, les chiffres mélangent des tarifs, des équipes et
  // des prestations qui n'ont plus rien à voir.
  it('au-delà d’un an, c’est refusé avec sa raison', async () => {
    const { res, corps } = await appel(ADMIN, '/api/analytics?from=2024-01-01&to=2026-01-01');

    expect(res.status).toBe(422);
    expect(corps.errors.from).toContain('tarifs');
  });

  it('exactement 366 jours passe', async () => {
    const { res } = await appel(ADMIN, '/api/analytics?from=2025-01-01&to=2026-01-01');

    expect(res.status).toBe(200);
  });

  // ON REMPLIT LES JOURS VIDES : un graphique qui saute les dimanches
  // fermés écrase l'axe du temps.
  it('les jours sans activité sont présents, à zéro', async () => {
    const { corps } = await appel(ADMIN, '/api/analytics?from=2026-03-01&to=2026-03-05');

    expect(corps.data.daily).toHaveLength(5);
    expect(corps.data.daily[0]).toEqual({ day: '2026-03-01', vehicles: 0, revenue: 0 });
    expect(corps.data.daily.map((d: any) => d.day)).toEqual([
      '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
    ]);
  });

  it('porte les clés que le modèle Angular lit', async () => {
    const { corps } = await appel(ADMIN, '/api/analytics');

    expect(Object.keys(corps.data).sort()).toEqual([
      'collected', 'customers', 'daily', 'delivered', 'durations',
      'hours', 'period', 'services', 'weekdays',
    ]);
  });
});

// ====================================================================

describe('la décomposition de ce qui a été livré', () => {
  beforeEach(prepareBase);

  /**
   * ==================================================================
   * LE PANNEAU QUI VÉRIFIE QUE LE PRODUIT NE SE CONTREDIT PAS
   * ==================================================================
   *   valeur livrée = encaissé + offert + prépayé + impayé
   *
   * Les quatre termes viennent de quatre modules différents. Ce test
   * les fait tous jouer sur la même journée : un dossier payé, un
   * offert par la fidélité, un couvert par un forfait, un impayé.
   */
  it('les quatre modules tombent juste ensemble', async () => {
    // Deux dossiers de plus, pour avoir les quatre cas.
    await env.DB
      .prepare(
        `INSERT INTO operations (id, organization_id, station_id, vehicle_id, customer_id,
                                 service_id, reference, status, price, created_by_user_id)
         VALUES (4, 1, 1, 1, 1, 1, 'OP-0004', 'WAITING', 5000, 1),
                (5, 1, 1, 2, 1, 1, 'OP-0005', 'WAITING', 5000, 1)`,
      )
      .run();

    // 1. PAYÉ : 5 000 encaissés.
    await appel(ADMIN, '/api/operations/1/payments', 'POST', { amount: 5000, method: 'CASH' });

    // 2. OFFERT : une récompense de fidélité couvre le dossier 2.
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

    await appel(ADMIN, '/api/loyalty/redeem', 'POST', { operation_id: 2 });

    // 3. PRÉPAYÉ : un forfait couvre le dossier 4.
    const { corps: plan } = await appel(ADMIN, '/api/subscriptions/plans', 'POST', {
      name: 'Forfait', service_id: 1, washes: 10, price: 40_000,
      validity_days: 180, status: 'ACTIVE',
    });
    await appel(ADMIN, '/api/subscriptions', 'POST', {
      customer_id: 1, plan_id: plan.data.plan.id, station_id: 1, method: 'CASH',
    });
    await appel(ADMIN, '/api/subscriptions/use', 'POST', { operation_id: 4 });

    // 4. IMPAYÉ : le dossier 5 part sans rien.
    for (const id of [1, 2, 4, 5]) {
      await restitue(id);
    }

    const { corps } = await appel(ADMIN, '/api/analytics');
    const d = corps.data.delivered;

    expect(d.operations).toBe(4);
    expect(d.delivered).toBe(20_000);
    expect(d.paid).toBe(5000);
    expect(d.gifted).toBe(5000);
    expect(d.prepaid).toBe(5000);
    expect(d.unpaid).toBe(5000);
    expect(d.reconciles).toBe(true);
  });

  /**
   * L'ENCAISSÉ ET LE LIVRÉ NE SONT PAS LE MÊME CHIFFRE.
   *
   * L'écart s'explique par les forfaits : 40 000 F reçus aujourd'hui
   * pour des lavages qui seront livrés sur six mois.
   */
  it("l'argent reçu comprend les forfaits, la valeur livrée non", async () => {
    const { corps: plan } = await appel(ADMIN, '/api/subscriptions/plans', 'POST', {
      name: 'Forfait', service_id: 1, washes: 10, price: 40_000,
      validity_days: 180, status: 'ACTIVE',
    });
    await appel(ADMIN, '/api/subscriptions', 'POST', {
      customer_id: 1, plan_id: plan.data.plan.id, station_id: 1, method: 'CASH',
    });

    await appel(ADMIN, '/api/operations/1/payments', 'POST', { amount: 5000, method: 'CASH' });
    await restitue(1);

    const { corps } = await appel(ADMIN, '/api/analytics');

    expect(corps.data.collected.total).toBe(45_000);
    expect(corps.data.collected.on_subscriptions).toBe(40_000);
    expect(corps.data.collected.on_operations).toBe(5000);

    // La valeur livrée, elle, ne compte que le lavage rendu.
    expect(corps.data.delivered.delivered).toBe(5000);
  });

  // Un dossier non restitué n'est pas « livré » : il est encore sur le
  // parking.
  it('un dossier encore ouvert ne compte pas comme livré', async () => {
    await appel(ADMIN, '/api/operations/1/payments', 'POST', { amount: 5000, method: 'CASH' });

    const { corps } = await appel(ADMIN, '/api/analytics');

    expect(corps.data.delivered.operations).toBe(0);
    // Mais l'argent est bien entré dans le tiroir.
    expect(corps.data.collected.total).toBe(5000);
  });
});

// ====================================================================

describe('ce qui se vend, et quand', () => {
  beforeEach(prepareBase);

  // VOLUME ET VALEUR ENSEMBLE : séparés, ils mentent.
  it('donne le volume, la valeur et la moyenne par prestation', async () => {
    const { corps } = await appel(ADMIN, '/api/analytics');
    const lavage = corps.data.services.find((s: any) => s.service === 'Lavage standard');

    expect(lavage.operations).toBe(2);
    expect(lavage.value).toBe(10_000);
    expect(lavage.average).toBe(5000);
  });

  it("un dossier annulé ne compte dans aucune statistique", async () => {
    await env.DB.prepare("UPDATE operations SET status = 'CANCELLED' WHERE id = 1").run();

    const { corps } = await appel(ADMIN, '/api/analytics');
    const lavage = corps.data.services.find((s: any) => s.service === 'Lavage standard');

    expect(lavage.operations).toBe(1);
  });

  // LES 24 HEURES SONT TOUJOURS RENVOYÉES : un axe du temps troué se
  // lit de travers.
  it('les vingt-quatre heures sont là, même vides', async () => {
    const { corps } = await appel(ADMIN, '/api/analytics');

    expect(corps.data.hours).toHaveLength(24);
    expect(corps.data.hours.map((h: any) => h.hour)).toEqual(
      Array.from({ length: 24 }, (_, i) => i),
    );
    expect(corps.data.hours.reduce((t: number, h: any) => t + h.operations, 0)).toBe(2);
  });

  /**
   * LA SEMAINE COMMENCE LE LUNDI.
   *
   * `strftime('%w')` renvoie 0 pour dimanche. On convertit ici, une
   * fois — c'est exactement le genre de décalage qu'on ne remarque
   * qu'en production, quand le gérant dit « mais le samedi n'est pas
   * mon plus gros jour ».
   */
  it('la semaine commence le lundi et le compte tombe sur le bon jour', async () => {
    expect(new Date('2026-03-08T10:00:00Z').getUTCDay()).toBe(0); // un dimanche

    await env.DB
      .prepare("UPDATE operations SET created_at = '2026-03-08 10:00:00' WHERE id = 1")
      .run();

    const { corps } = await appel(ADMIN, '/api/analytics?from=2026-03-01&to=2026-03-31');

    expect(corps.data.weekdays.map((j: any) => j.label)).toEqual([
      'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche',
    ]);
    expect(corps.data.weekdays[0].weekday).toBe(1);

    const dimanche = corps.data.weekdays.find((j: any) => j.label === 'Dimanche');

    expect(dimanche.operations).toBe(1);
    expect(corps.data.weekdays.find((j: any) => j.label === 'Samedi').operations).toBe(0);
  });
});

// ====================================================================

describe('le temps annoncé contre le temps réel', () => {
  beforeEach(prepareBase);

  /**
   * `n` dossiers terminés, chacun ayant duré `minutes`.
   *
   * Un compteur global pour la référence : elle est unique par
   * entreprise, et deux appels dans le même test se heurteraient.
   */
  let numero = 0;

  async function mesures(n: number, minutes: number, depuis = 10): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      numero += 1;

      await env.DB
        .prepare(
          `INSERT INTO operations (organization_id, station_id, vehicle_id, customer_id,
                                   service_id, reference, status, price, created_by_user_id,
                                   started_at, completed_at)
           VALUES (1, 1, 1, 1, 1, ?, 'COMPLETED', 5000, 1,
                   datetime('now', '-${depuis} hours'),
                   datetime('now', '-${depuis} hours', '+${minutes} minutes'))`,
        )
        .bind(`OP-M${numero}`)
        .run();
    }
  }

  // UNE MOYENNE SUR UN SEUL PASSAGE EST UNE ANECDOTE, pas une mesure.
  it("rien n'est annoncé en dessous de trois mesures", async () => {
    await mesures(2, 45);

    const { corps } = await appel(ADMIN, '/api/analytics');

    expect(corps.data.durations).toEqual([]);
  });

  it('à partir de trois, la moyenne apparaît', async () => {
    await mesures(3, 45);

    const { corps } = await appel(ADMIN, '/api/analytics');

    expect(corps.data.durations).toHaveLength(1);
    expect(corps.data.durations[0].service).toBe('Lavage standard');
    // Le catalogue annonce 30 minutes ; la station en met 45.
    expect(corps.data.durations[0].announced).toBe(30);
    expect(corps.data.durations[0].actual).toBe(45);
    expect(corps.data.durations[0].samples).toBe(3);
    expect(corps.data.durations[0].excluded).toBe(0);
  });

  /**
   * ON EXCLUT LES DOSSIERS DE PLUS DE HUIT HEURES.
   *
   * Un véhicule laissé pour la nuit n'est pas un lavage long ; le
   * compter tirerait la moyenne au point de la rendre inutile. On dit
   * combien ont été écartés plutôt que de le taire.
   */
  it('un véhicule laissé pour la nuit est écarté, et compté comme tel', async () => {
    await mesures(3, 45);
    await mesures(1, 700, 20);

    const { corps } = await appel(ADMIN, '/api/analytics');

    expect(corps.data.durations[0].actual).toBe(45);
    expect(corps.data.durations[0].samples).toBe(3);
    expect(corps.data.durations[0].excluded).toBe(1);
  });
});

// ====================================================================

describe('les clients qui reviennent', () => {
  beforeEach(prepareBase);

  /**
   * UN CLIENT « QUI REVIENT » EST DÉJÀ VENU AVANT LE DÉBUT DE LA
   * PÉRIODE — pas quelqu'un venu deux fois cette semaine. La première
   * mesure la fidélité, la seconde mesure surtout la longueur de la
   * période qu'on regarde.
   */
  it('deux visites dans la période ne font pas un client fidèle', async () => {
    // Les deux dossiers du jeu d'essai appartiennent au même client,
    // tous deux dans la période.
    const { corps } = await appel(ADMIN, '/api/analytics');

    expect(corps.data.customers.total).toBe(1);
    expect(corps.data.customers.returning).toBe(0);
    expect(corps.data.customers.new).toBe(1);
  });

  it('une visite antérieure à la période en fait un client fidèle', async () => {
    await env.DB
      .prepare(
        `INSERT INTO operations (organization_id, station_id, vehicle_id, customer_id,
                                 service_id, reference, status, price, created_by_user_id,
                                 created_at)
         VALUES (1, 1, 1, 1, 1, 'OP-ANCIEN', 'COMPLETED', 5000, 1,
                 datetime('now', '-120 days'))`,
      )
      .run();

    const { corps } = await appel(ADMIN, '/api/analytics');

    expect(corps.data.customers.total).toBe(1);
    expect(corps.data.customers.returning).toBe(1);
    expect(corps.data.customers.new).toBe(0);
  });

  /**
   * ==================================================================
   * LA RÉÉCRITURE DONNE EXACTEMENT LE MÊME RÉSULTAT.
   * ==================================================================
   * La requête a été réécrite à l'étape 7 : 168 ms → 5 ms sur 30 000
   * dossiers. Une optimisation qui change les chiffres n'est pas une
   * optimisation, c'est un bogue — ce test compare les deux formes
   * sur les mêmes données.
   *
   * L'ancienne forme est écrite ici, et nulle part ailleurs : c'est
   * un témoin de comparaison, pas du code qui tourne.
   */
  it('donne les mêmes chiffres que la forme qu’elle remplace', async () => {
    // De quoi rendre la comparaison intéressante : un fidèle, un
    // nouveau, et un client de l'autre entreprise.
    await env.DB
      .prepare(
        `INSERT INTO customers (id, organization_id, first_name, last_name, phone)
         VALUES (5, 1, 'Nouveau', 'Venu', '+221770000005')`,
      ).run();

    await env.DB
      .prepare(
        `INSERT INTO operations (organization_id, station_id, vehicle_id, customer_id,
                                 service_id, reference, status, price, created_by_user_id,
                                 created_at)
         VALUES (1, 1, 1, 1, 1, 'OP-VIEUX', 'COMPLETED', 5000, 1, datetime('now', '-200 days')),
                (1, 1, 1, 5, 1, 'OP-NEUF',  'COMPLETED', 5000, 1, datetime('now', '-2 days')),
                (1, 1, 1, 5, 1, 'OP-ANNUL', 'CANCELLED', 5000, 1, datetime('now', '-1 days'))`,
      ).run();

    const depuis = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const jusqua = jour();

    const { corps } = await appel(ADMIN, `/api/analytics?from=${depuis}&to=${jusqua}`);

    const ancienne = await env.DB
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN avant.customer_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS revenus
           FROM (SELECT DISTINCT o.customer_id FROM operations o
                  WHERE o.organization_id = 1 AND o.status <> 'CANCELLED'
                    AND o.created_at >= ? AND o.created_at <= ?) periode
      LEFT JOIN (SELECT DISTINCT a.customer_id FROM operations a
                  WHERE a.organization_id = 1 AND a.status <> 'CANCELLED'
                    AND a.created_at < ?) avant
             ON avant.customer_id = periode.customer_id`,
      )
      .bind(`${depuis} 00:00:00`, `${jusqua} 23:59:59`, `${depuis} 00:00:00`)
      .first<{ total: number; revenus: number }>();

    expect(corps.data.customers.total).toBe(ancienne?.total);
    expect(corps.data.customers.returning).toBe(ancienne?.revenus);

    // Et les chiffres eux-mêmes tiennent debout : deux clients vus
    // sur la période, dont un seul déjà venu avant.
    expect(corps.data.customers.total).toBe(2);
    expect(corps.data.customers.returning).toBe(1);
    expect(corps.data.customers.new).toBe(1);
  });

  /**
   * LE SECOND ENSEMBLE EST CLOISONNÉ LUI AUSSI.
   *
   * La requête porte DEUX filtres d'organisation — « venus pendant »
   * et « venus avant ». Si le second manquait, la visite ancienne
   * d'un client d'une AUTRE entreprise ferait passer un nouveau
   * client pour un fidèle.
   */
  it("l'ancienneté d'un client d'une autre entreprise ne déteint pas", async () => {
    await env.DB
      .prepare(
        `INSERT INTO operations (organization_id, station_id, vehicle_id, customer_id,
                                 service_id, reference, status, price, created_by_user_id,
                                 created_at)
         VALUES (2, 3, 3, 2, 2, 'OP-RIVAL-VIEUX', 'COMPLETED', 4000, 4,
                 datetime('now', '-120 days'))`,
      )
      .run();

    const { corps } = await appel(RIVAL, '/api/analytics');

    // Le client rival est bien un fidèle CHEZ LUI…
    expect(corps.data.customers.returning).toBe(1);

    // …et n'a rien changé chez nous.
    const { corps: nous } = await appel(ADMIN, '/api/analytics');

    expect(nous.data.customers.returning).toBe(0);
  });
});

// ====================================================================

describe('les droits et le cloisonnement', () => {
  beforeEach(prepareBase);

  it("un employé ne voit pas les chiffres de l'entreprise", async () => {
    const { res } = await appel(EMPLOYE, '/api/analytics');

    expect(res.status).toBe(403);
  });

  it("l'autre entreprise ne voit rien de notre activité", async () => {
    await appel(ADMIN, '/api/operations/1/payments', 'POST', { amount: 5000, method: 'CASH' });

    const { corps } = await appel(RIVAL, '/api/analytics');

    expect(corps.data.collected.total).toBe(0);
    expect(corps.data.services.map((s: any) => s.service)).toEqual(['Lavage rival']);
  });

  it('filtrer sur une station est possible', async () => {
    const { corps } = await appel(ADMIN, '/api/analytics?station_id=1');

    expect(corps.data.services[0].operations).toBe(2);

    const { corps: thies } = await appel(ADMIN, '/api/analytics?station_id=2');

    expect(thies.data.services).toEqual([]);
  });

  /**
   * 403, ET NON « 200, RIEN À VOIR ICI ».
   *
   * Le cloisonnement renverrait zéro ligne de toute façon — c'est la
   * défense en profondeur. Mais l'API doit répondre « cette station
   * n'est pas la vôtre », pas laisser croire qu'elle est vide.
   */
  it("la station d'un concurrent est refusée, pas vidée", async () => {
    const { res, corps } = await appel(ADMIN, '/api/analytics?station_id=3');

    expect(res.status).toBe(403);
    expect(corps.message).toContain('rattaché');
  });
});
