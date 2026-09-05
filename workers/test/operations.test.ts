import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jetonPour, prepareBase } from './aide';

const change = async (email: string, id: number, status: string, reason?: string) => {
  const jeton = await jetonPour(email);
  const res = await SELF.fetch(`https://api.test/api/operations/${id}/status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(reason === undefined ? { status } : { status, reason }),
  });
  return { res, corps: (await res.json()) as { success: boolean; message: string; data: Record<string, unknown> } };
};

const ADMIN = 'mamadou@diallo.sn';
const EMPLOYE = 'aliou@diallo.sn';

describe('la file d’attente', () => {
  beforeEach(prepareBase);

  it('renvoie les cinq colonnes de l’écran', async () => {
    const jeton = await jetonPour(ADMIN);
    const res = await SELF.fetch('https://api.test/api/queue', {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    const { data } = (await res.json()) as {
      data: {
        columns: { label: string; drop_status: string; statuses: string[]; count: number; overdue: number; operations: unknown[] }[];
        metrics: { waiting: number; ready: number; overdue: number; longest_wait_minutes: number | null };
        generated_at: string;
      };
    };

    expect(data.columns.map((c) => c.label)).toEqual(
      ['En attente', 'Inspection', 'Lavage', 'Contrôle', 'Prêts'],
    );

    // Les noms EXACTS que le modèle Angular déclare. Une forme
    // voisine laissait l'écran sur « Chargement… ».
    expect(Object.keys(data.columns[0]).sort()).toEqual(
      ['count', 'drop_status', 'label', 'operations', 'overdue', 'statuses'],
    );
    expect(Object.keys(data.metrics).sort()).toEqual(
      ['in_progress', 'longest_wait_minutes', 'overdue', 'ready', 'waiting'],
    );
    expect(data.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(data.metrics.waiting).toBe(1);
    expect(data.metrics.ready).toBe(1);
  });

  it('ne montre jamais les dossiers d’une autre organisation', async () => {
    const jeton = await jetonPour('fatou@concurrent.sn');
    const res = await SELF.fetch('https://api.test/api/queue', {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    const { data } = (await res.json()) as { data: { columns: { operations: { reference: string }[] }[] } };
    const references = data.columns.flatMap((c) => c.operations.map((o) => o.reference));

    expect(references).toEqual(['OP-9001']);
  });

  it('un employé peut voir la file — c’est son écran de travail', async () => {
    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch('https://api.test/api/queue', {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    expect(res.status).toBe(200);
  });
});

describe('les refus de la machine à états, à travers l’API', () => {
  beforeEach(prepareBase);

  it('un employé fait avancer un dossier — c’est son travail', async () => {
    const { res, corps } = await change(EMPLOYE, 1, 'IN_PROGRESS');

    expect(res.status).toBe(200);
    expect(corps.data.status).toBe('IN_PROGRESS');
  });

  it('sauter une étape est refusé, avec la sortie indiquée', async () => {
    const { res, corps } = await change(ADMIN, 1, 'WASHING');

    expect(res.status).toBe(409);
    expect(corps.message).toContain('Étapes possibles');
  });

  it('un dossier ne peut pas revenir en arrière', async () => {
    await change(ADMIN, 1, 'IN_PROGRESS');
    const { res } = await change(ADMIN, 1, 'WAITING');

    expect(res.status).toBe(409);
  });

  it('un statut inventé est refusé', async () => {
    const { res } = await change(ADMIN, 1, 'LAVE_A_LA_MAIN');
    expect(res.status).toBe(409);
  });

  it('un dossier d’une autre organisation est introuvable', async () => {
    // OP-9001 appartient à l'organisation 2.
    const { res } = await change(ADMIN, 3, 'IN_PROGRESS');
    expect(res.status).toBe(404);
  });
});

/**
 * ==================================================================
 * ON NE LAVE PAS UN VÉHICULE SANS INSPECTION D'ENTRÉE
 * ==================================================================
 * Refus n° 1 de l'aide en ligne. Sans le constat d'arrivée, une
 * rayure découverte après le lavage est indéfendable : personne ne
 * peut dire si elle était là avant.
 */
describe('l’inspection d’entrée est obligatoire avant le lavage', () => {
  beforeEach(prepareBase);

  const amene = async () => {
    await change(ADMIN, 1, 'IN_PROGRESS');
    await change(ADMIN, 1, 'INSPECTION');
  };

  it('passer au lavage sans inspection enregistrée est refusé', async () => {
    await amene();
    const { res, corps } = await change(ADMIN, 1, 'WASHING');

    expect(res.status).toBe(409);
    expect(corps.message).toContain("inspection d'entrée");
    expect(corps.message).toContain('indéfendable');
  });

  it('avec l’inspection enregistrée, le lavage passe', async () => {
    await amene();
    await env.DB.prepare(
      `INSERT INTO inspections (organization_id, operation_id, vehicle_id, type, performed_by_user_id)
       VALUES (1, 1, 1, 'ENTRY', 1)`,
    ).run();

    const { res } = await change(ADMIN, 1, 'WASHING');
    expect(res.status).toBe(200);
  });

  it('une inspection de SORTIE ne remplace pas celle d’entrée', async () => {
    await amene();
    await env.DB.prepare(
      `INSERT INTO inspections (organization_id, operation_id, vehicle_id, type, performed_by_user_id)
       VALUES (1, 1, 1, 'EXIT', 1)`,
    ).run();

    expect((await change(ADMIN, 1, 'WASHING')).res.status).toBe(409);
  });
});

/**
 * ==================================================================
 * ON NE REND PAS LES CLÉS D'UN VÉHICULE IMPAYÉ
 * ==================================================================
 * Refus n° 3, le plus dur du produit et celui qui sera le plus
 * contesté en station. La dérogation existe — sinon la règle serait
 * contournée par un mensonge de saisie — mais elle est réservée à un
 * responsable et laisse une trace nominative.
 */
describe('la restitution d’un véhicule impayé', () => {
  beforeEach(prepareBase);

  it('est refusée, avec le code 402 et le reste dû', async () => {
    const { res, corps } = await change(ADMIN, 2, 'COMPLETED');

    expect(res.status).toBe(402);          // Payment Required
    expect(corps.message).toContain('5');  // le montant apparaît
    expect(corps.message).toContain('responsable');
  });

  it('passe une fois le règlement encaissé', async () => {
    await env.DB.prepare(
      `INSERT INTO payments (organization_id, station_id, operation_id, amount, method,
                             status, recorded_by_user_id)
       VALUES (1, 1, 2, 5000, 'CASH', 'PAID', 1)`,
    ).run();

    expect((await change(ADMIN, 2, 'COMPLETED')).res.status).toBe(200);
  });

  it('un paiement PARTIEL ne suffit pas', async () => {
    await env.DB.prepare(
      `INSERT INTO payments (organization_id, station_id, operation_id, amount, method,
                             status, recorded_by_user_id)
       VALUES (1, 1, 2, 3000, 'CASH', 'PAID', 1)`,
    ).run();

    expect((await change(ADMIN, 2, 'COMPLETED')).res.status).toBe(402);
  });

  it('un paiement ANNULÉ ne compte pas', async () => {
    await env.DB.prepare(
      `INSERT INTO payments (organization_id, station_id, operation_id, amount, method,
                             status, recorded_by_user_id)
       VALUES (1, 1, 2, 5000, 'CASH', 'CANCELLED', 1)`,
    ).run();

    expect((await change(ADMIN, 2, 'COMPLETED')).res.status).toBe(402);
  });

  it('un employé ne peut PAS lever le blocage, même avec un motif', async () => {
    const { res } = await change(EMPLOYE, 2, 'COMPLETED', 'Le client reviendra payer demain');

    expect(res.status).toBe(403);
  });

  it('un responsable le peut, en indiquant un motif', async () => {
    const { res } = await change(ADMIN, 2, 'COMPLETED', 'Client de confiance, réglera demain');

    expect(res.status).toBe(200);
  });

  it('la dérogation est tracée NOMINATIVEMENT', async () => {
    await change(ADMIN, 2, 'COMPLETED', 'Client de confiance, réglera demain');

    const t = await env.DB.prepare(
      "SELECT user_id, metadata FROM audit_logs WHERE action = 'operation.released_unpaid'",
    ).first<{ user_id: number; metadata: string }>();

    expect(t?.user_id).toBe(1);
    const m = JSON.parse(t?.metadata ?? '{}') as { reste_du: number; motif: string; reference: string };
    expect(m.reste_du).toBe(5000);
    expect(m.motif).toContain('confiance');
    expect(m.reference).toBe('OP-0002');
  });
});

/**
 * ==================================================================
 * LE CONTRAT D'UNE OPÉRATION, FIGÉ CLÉ PAR CLÉ
 * ==================================================================
 * Ce test est né d'un défaut coûteux à trouver.
 *
 * Une première version n'envoyait qu'une quinzaine de champs sur les
 * trente-six du modèle. L'API répondait 200, la file affichait UNE
 * carte — puis plus rien. Le gabarit Angular lisait
 * `operation.is_overdue`, absent de la réponse, et le rendu
 * s'interrompait là : les quatre colonnes suivantes restaient vides,
 * sans une seule erreur en console.
 *
 * Le symptôme ne désignait pas la cause. On cherchait du côté du
 * chargement, des colonnes, du cache — le problème était un champ
 * manquant dans une carte.
 *
 * D'où cette liste écrite EN DUR : elle vient du modèle
 * `frontend/src/app/core/models/operation.model.ts`, pas du code
 * serveur. Un test qui recopierait l'implémentation ne vérifierait
 * rien.
 */
describe('le contrat d’une opération', () => {
  beforeEach(prepareBase);

  it('porte les trente-six champs que le frontend déclare', async () => {
    const jeton = await jetonPour(ADMIN);
    const res = await SELF.fetch('https://api.test/api/queue', {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    const { data } = (await res.json()) as {
      data: { columns: { operations: Record<string, unknown>[] }[] };
    };

    const operation = data.columns.flatMap((c) => c.operations)[0];

    expect(Object.keys(operation).sort()).toEqual([
      'alert_after_minutes', 'allowed_transitions', 'amount_due', 'assigned_name',
      'assigned_user_id', 'brand', 'color', 'completed_at', 'created_at',
      'currency_code', 'customer_id', 'customer_name', 'customer_phone',
      'discount_amount', 'discount_reason', 'discount_source', 'duration_minutes',
      'has_entry_inspection', 'id', 'is_overdue', 'is_settled', 'minutes_in_status',
      'model', 'notes', 'paid_amount', 'plate_display', 'plate_number', 'price',
      'priority', 'reference', 'released_at', 'service_id', 'service_name',
      'started_at', 'station_id', 'station_name', 'status', 'status_changed_at',
      'status_label', 'vehicle_id', 'vehicle_type',
    ]);
  });

  it('les transitions permises viennent du serveur', async () => {
    const jeton = await jetonPour(ADMIN);
    const res = await SELF.fetch('https://api.test/api/queue', {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    const { data } = (await res.json()) as {
      data: { columns: { operations: { status: string; allowed_transitions: string[] }[] }[] };
    };

    const attente = data.columns.flatMap((c) => c.operations).find((o) => o.status === 'WAITING');

    // L'application n'a pas à recopier la machine à états pour savoir
    // quels boutons proposer : le serveur le lui dit.
    expect(attente?.allowed_transitions).toEqual(['IN_PROGRESS', 'CANCELLED']);
  });

  it('le règlement est calculé par le serveur, pas par l’écran', async () => {
    await env.DB.prepare(
      `INSERT INTO payments (organization_id, station_id, operation_id, amount, method,
                             status, recorded_by_user_id)
       VALUES (1, 1, 2, 5000, 'CASH', 'PAID', 1)`,
    ).run();

    const jeton = await jetonPour(ADMIN);
    const res = await SELF.fetch('https://api.test/api/queue', {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    const { data } = (await res.json()) as {
      data: { columns: { operations: { reference: string; paid_amount: number; is_settled: boolean }[] }[] };
    };

    const dossiers = data.columns.flatMap((c) => c.operations);

    expect(dossiers.find((o) => o.reference === 'OP-0002')?.is_settled).toBe(true);
    expect(dossiers.find((o) => o.reference === 'OP-0001')?.is_settled).toBe(false);
  });
});
