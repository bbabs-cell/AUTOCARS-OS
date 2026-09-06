import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jetonPour, prepareBase } from './aide';

const ADMIN = 'mamadou@diallo.sn';

const appel = async (email: string, chemin: string, methode = 'GET', corps?: unknown) => {
  const jeton = await jetonPour(email);
  const res = await SELF.fetch(`https://api.test${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
  });
  return { res, corps: (await res.json()) as { message: string; data: any; errors: Record<string, string> } };
};

const dans = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);

const prend = (champs: Record<string, unknown> = {}) =>
  appel(ADMIN, '/api/bookings', 'POST', {
    customer_name: 'Aminata Sarr',
    customer_phone: '+221770000001',
    customer_id: 1,
    vehicle_id: 1,
    service_id: 1,
    station_id: 1,
    scheduled_at: dans(120),
    ...champs,
  });

describe('prendre un rendez-vous', () => {
  beforeEach(prepareBase);

  it('enregistre le créneau et son prix', async () => {
    const { res, corps } = await prend();

    expect(res.status).toBe(200);
    expect(corps.data.status).toBe('SCHEDULED');
    expect(corps.data.price).toBe(5000);
    expect(corps.data.duration_minutes).toBe(30);
    expect(corps.data.is_open).toBe(true);
  });

  it('porte les vingt-huit champs que l’écran lit', async () => {
    const { corps } = await prend();

    expect(Object.keys(corps.data).sort()).toEqual([
      'allowed_next', 'created_at', 'created_by_name', 'customer_id', 'customer_name',
      'customer_phone', 'duration_minutes', 'id', 'is_open', 'notes', 'operation_id',
      'operation_reference', 'outcome_at', 'outcome_by_name', 'outcome_reason',
      'plate_number', 'price', 'scheduled_at', 'scheduled_date', 'scheduled_time',
      'service_id', 'service_name', 'station_id', 'station_name', 'status',
      'status_label', 'vehicle_id', 'vehicle_label',
    ]);
  });

  it('« arrivé » ne figure jamais dans les suites proposées', async () => {
    const { corps } = await prend();

    // L'arrivée ouvre un dossier : elle a sa propre route.
    expect(corps.data.allowed_next).not.toContain('ARRIVED');
    expect(corps.data.allowed_next).toEqual(['CONFIRMED', 'NO_SHOW', 'CANCELLED']);
  });

  it('un rendez-vous dans le passé est refusé', async () => {
    const { res } = await prend({ scheduled_at: dans(-60) });
    expect(res.status).toBe(422);
  });

  it('au-delà d’un an, c’est une erreur d’année', async () => {
    const { res, corps } = await prend({ scheduled_at: dans(400 * 24 * 60) });

    expect(res.status).toBe(422);
    expect(corps.errors.scheduled_at).toContain("erreur d'année");
  });

  it('sans téléphone, il est refusé', async () => {
    const { res, corps } = await prend({ customer_phone: '' });

    expect(res.status).toBe(422);
    expect(corps.errors.customer_phone).toContain('rappeler');
  });

  it('une prestation d’une autre organisation est refusée', async () => {
    const { res } = await prend({ service_id: 2 });
    expect(res.status).toBe(422);
  });
});

/**
 * ==================================================================
 * LE PRIX PROMIS NE BOUGE PAS
 * ==================================================================
 * Refus n° 12. Changer son tarif ne doit pas changer ce qu'on a
 * annoncé à quelqu'un : c'est la parole donnée.
 */
describe('le prix promis', () => {
  beforeEach(prepareBase);

  it('reste celui du jour de la prise, même si le tarif change', async () => {
    const { corps } = await prend();
    const id = corps.data.id;

    await env.DB.prepare('UPDATE services SET price = 9000 WHERE id = 1').run();

    const relu = await appel(ADMIN, `/api/bookings/${id}`);
    expect(relu.corps.data.price).toBe(5000);
  });

  it('changer la prestation met à jour la durée, pas le prix', async () => {
    const { corps } = await prend();
    await env.DB.prepare(
      "INSERT INTO services (id, organization_id, name, category, price, duration_minutes) VALUES (9, 1, 'Express', 'LAVAGE', 2000, 15)",
    ).run();

    const modifie = await appel(ADMIN, `/api/bookings/${corps.data.id}`, 'PUT', { service_id: 9 });

    expect(modifie.corps.data.duration_minutes).toBe(15);
    expect(modifie.corps.data.price).toBe(5000);
  });
});

/**
 * ==================================================================
 * ON NE DÉCLARE PAS UNE ABSENCE AVANT L'HEURE
 * ==================================================================
 * Quinze minutes de grâce. Déclarer quelqu'un absent pendant qu'il
 * cherche une place de stationnement est le meilleur moyen de perdre
 * un client.
 */
describe('le délai de grâce', () => {
  beforeEach(prepareBase);

  it('avant l’heure, l’absence est refusée — en rappelant l’heure prévue', async () => {
    const { corps } = await prend();
    const { res, corps: r } = await appel(ADMIN, `/api/bookings/${corps.data.id}/status`, 'PUT',
      { status: 'NO_SHOW' });

    expect(res.status).toBe(409);
    expect(r.message).toContain('15 minutes');
    expect(r.message).toContain(corps.data.scheduled_time);
  });

  /**
   * L'API refuse un rendez-vous dans le passé, et elle a raison. Pour
   * éprouver le délai de grâce, on antidate donc en base : c'est le
   * temps qui passe qu'on simule, pas une saisie qu'on contourne.
   */
  const antidate = async (id: number, minutes: number) => {
    await env.DB.prepare("UPDATE bookings SET scheduled_at = datetime('now', ?) WHERE id = ?")
      .bind(`${minutes} minutes`, id).run();
  };

  it('pendant le délai de grâce, elle est encore refusée', async () => {
    const { corps } = await prend();
    await antidate(corps.data.id, -10);

    const { res } = await appel(ADMIN, `/api/bookings/${corps.data.id}/status`, 'PUT',
      { status: 'NO_SHOW' });

    expect(res.status).toBe(409);
  });

  it('passé le délai, elle est acceptée', async () => {
    const { corps } = await prend();
    await antidate(corps.data.id, -30);

    const { res, corps: r } = await appel(ADMIN, `/api/bookings/${corps.data.id}/status`, 'PUT',
      { status: 'NO_SHOW', reason: 'Client jamais venu' });

    expect(res.status).toBe(200);
    expect(r.data.status).toBe('NO_SHOW');
    expect(r.data.outcome_reason).toBe('Client jamais venu');
    expect(r.data.is_open).toBe(false);
  });
});

describe('un rendez-vous terminé ne bouge plus', () => {
  beforeEach(prepareBase);

  const annule = async () => {
    const { corps } = await prend();
    await appel(ADMIN, `/api/bookings/${corps.data.id}/status`, 'PUT', { status: 'CANCELLED' });
    return corps.data.id;
  };

  it('on ne le modifie plus', async () => {
    const id = await annule();
    const { res, corps } = await appel(ADMIN, `/api/bookings/${id}`, 'PUT', { notes: 'x' });

    expect(res.status).toBe(409);
    expect(corps.message).toContain('ne se modifie plus');
  });

  it('on ne change plus son statut', async () => {
    const id = await annule();
    expect((await appel(ADMIN, `/api/bookings/${id}/status`, 'PUT', { status: 'CONFIRMED' })).res.status).toBe(409);
  });

  it('et on ne peut plus déclarer l’arrivée', async () => {
    const id = await annule();
    expect((await appel(ADMIN, `/api/bookings/${id}/arrive`, 'POST', {})).res.status).toBe(409);
  });
});

/**
 * ==================================================================
 * L'ARRIVÉE OUVRE UN DOSSIER
 * ==================================================================
 * Deux écritures qui n'ont de sens qu'ensemble. Un rendez-vous
 * « arrivé » sans dossier serait un client dans la station dont
 * personne ne suit la voiture.
 */
describe('l’arrivée', () => {
  beforeEach(prepareBase);

  it('ne se coche pas comme un statut', async () => {
    const { corps } = await prend();
    const { res, corps: r } = await appel(ADMIN, `/api/bookings/${corps.data.id}/status`, 'PUT',
      { status: 'ARRIVED' });

    expect(res.status).toBe(409);
    expect(r.message).toContain('sans trace de sa voiture');
  });

  it('ouvre le dossier et relie les deux', async () => {
    const { corps } = await prend();
    const { res, corps: r } = await appel(ADMIN, `/api/bookings/${corps.data.id}/arrive`, 'POST', {});

    expect(res.status).toBe(200);
    expect(r.data.status).toBe('ARRIVED');
    expect(r.data.operation_id).not.toBeNull();
    expect(r.data.operation_reference).toMatch(/^RDV-/);
  });

  it('le dossier créé porte le prix promis et attend en file', async () => {
    const { corps } = await prend();
    await env.DB.prepare('UPDATE services SET price = 9000 WHERE id = 1').run();
    const { corps: r } = await appel(ADMIN, `/api/bookings/${corps.data.id}/arrive`, 'POST', {});

    const o = await env.DB.prepare('SELECT status, price FROM operations WHERE id = ?')
      .bind(r.data.operation_id).first<{ status: string; price: number }>();

    expect(o?.status).toBe('WAITING');
    expect(o?.price).toBe(5000);
  });

  it('sans véhicule, elle est refusée plutôt que de créer un dossier vide', async () => {
    const { corps } = await prend({ vehicle_id: null });
    const { res } = await appel(ADMIN, `/api/bookings/${corps.data.id}/arrive`, 'POST', {});

    expect(res.status).toBe(422);
  });
});

describe('la liste et le cloisonnement', () => {
  beforeEach(prepareBase);

  it('filtre sur les rendez-vous encore ouverts', async () => {
    await prend();
    const passe = await prend();
    await env.DB.prepare("UPDATE bookings SET scheduled_at = datetime('now','-30 minutes') WHERE id = ?")
      .bind(passe.corps.data.id).run();
    await appel(ADMIN, `/api/bookings/${passe.corps.data.id}/status`, 'PUT', { status: 'NO_SHOW' });

    const { corps } = await appel(ADMIN, '/api/bookings?open=1');
    expect(corps.data).toHaveLength(1);
  });

  it('cherche par nom, téléphone ou plaque', async () => {
    await prend();

    expect((await appel(ADMIN, '/api/bookings?search=Aminata')).corps.data).toHaveLength(1);
    expect((await appel(ADMIN, '/api/bookings?search=DK9087')).corps.data).toHaveLength(1);
    expect((await appel(ADMIN, '/api/bookings?search=personne')).corps.data).toHaveLength(0);
  });

  it('ne montre jamais ceux d’une autre organisation', async () => {
    await prend();
    const { corps } = await appel('fatou@concurrent.sn', '/api/bookings');

    expect(corps.data).toEqual([]);
  });

  it('les statuts et le délai de grâce sont annoncés par le serveur', async () => {
    const { corps } = await appel(ADMIN, '/api/bookings/statuses');

    expect(corps.data.no_show_grace_minutes).toBe(15);
    expect(corps.data.max_days_ahead).toBe(365);
    expect(corps.data.statuses).toHaveLength(5);
  });
});
