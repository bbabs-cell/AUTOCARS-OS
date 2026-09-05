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
  return { res, corps: (await res.json()) as { data: any; errors: Record<string, string> } };
};

const nouveau = {
  first_name: 'Ousmane',
  last_name: 'Ba',
  phone: '+221775555555',
  email: 'ousmane@exemple.sn',
};

describe('la liste des clients', () => {
  beforeEach(prepareBase);

  it('porte les quinze champs que l’écran lit', async () => {
    const { corps } = await appel(ADMIN, '/api/customers');

    expect(Object.keys(corps.data[0]).sort()).toEqual([
      'address', 'created_at', 'email', 'first_name', 'full_name', 'id',
      'last_name', 'last_visit_at', 'notes', 'phone', 'status', 'total_spent',
      'vehicle_count', 'visit_count',
    ]);
  });

  it('compte les véhicules et les passages', async () => {
    const { corps } = await appel(ADMIN, '/api/customers');
    const aminata = corps.data.find((c: any) => c.first_name === 'Aminata');

    expect(aminata.vehicle_count).toBe(2);
    expect(aminata.visit_count).toBe(2);
    expect(aminata.full_name).toBe('Aminata Sarr');
  });

  /**
   * `total_spent` ne compte QUE les paiements encaissés. Un dossier
   * créé mais impayé ne fait pas d'un client un bon client.
   */
  it('ne compte comme dépensé que ce qui est réellement encaissé', async () => {
    let { corps } = await appel(ADMIN, '/api/customers');
    expect(corps.data.find((c: any) => c.first_name === 'Aminata').total_spent).toBe(0);

    await appel(ADMIN, '/api/operations/2/payments', 'POST', { amount: 5000, method: 'CASH' });

    ({ corps } = await appel(ADMIN, '/api/customers'));
    expect(corps.data.find((c: any) => c.first_name === 'Aminata').total_spent).toBe(5000);
  });

  it('cherche par téléphone, par nom et par e-mail', async () => {
    await appel(ADMIN, '/api/customers', 'POST', nouveau);

    expect((await appel(ADMIN, '/api/customers?search=775555')).corps.data).toHaveLength(1);
    expect((await appel(ADMIN, '/api/customers?search=Ousmane')).corps.data).toHaveLength(1);
    expect((await appel(ADMIN, '/api/customers?search=exemple.sn')).corps.data).toHaveLength(1);
    expect((await appel(ADMIN, '/api/customers?search=introuvable')).corps.data).toHaveLength(0);
  });

  it('ne montre jamais les clients d’une autre organisation', async () => {
    const { corps } = await appel('fatou@concurrent.sn', '/api/customers');

    expect(corps.data).toHaveLength(1);
    expect(corps.data[0].first_name).toBe('Client');
  });
});

describe('créer un client', () => {
  beforeEach(prepareBase);

  it('un employé peut le faire — c’est son travail à l’accueil', async () => {
    const { res, corps } = await appel(EMPLOYE, '/api/customers', 'POST', nouveau);

    expect(res.status).toBe(200);
    expect(corps.data.customer.full_name).toBe('Ousmane Ba');
    expect(corps.data.vehicles).toEqual([]);
  });

  /**
   * LE TÉLÉPHONE EST OBLIGATOIRE.
   *
   * C'est le seul moyen fiable de rappeler quelqu'un dont la voiture
   * est prête. Un client sans numéro est un véhicule qu'on ne peut
   * pas rendre.
   */
  it('sans téléphone, la création est refusée', async () => {
    const { res, corps } = await appel(ADMIN, '/api/customers', 'POST',
      { ...nouveau, phone: '' });

    expect(res.status).toBe(422);
    expect(corps.errors.phone).toContain('prévenir le client');
  });

  it('les autres champs obligatoires sont signalés un par un', async () => {
    const { corps } = await appel(ADMIN, '/api/customers', 'POST', {});

    expect(Object.keys(corps.errors).sort()).toEqual(['first_name', 'last_name', 'phone']);
  });

  /**
   * Deux fiches pour le même numéro, ce sont deux historiques pour une
   * seule personne — et une fidélité coupée en deux.
   */
  it('un numéro déjà connu est refusé, en disant à qui il est', async () => {
    const { res, corps } = await appel(ADMIN, '/api/customers', 'POST',
      { ...nouveau, phone: '+221770000001' });

    expect(res.status).toBe(422);
    expect(corps.errors.phone).toContain('Aminata Sarr');
  });

  it('le même numéro reste libre dans une AUTRE organisation', async () => {
    const { res } = await appel('fatou@concurrent.sn', '/api/customers', 'POST',
      { ...nouveau, phone: '+221770000001' });

    expect(res.status).toBe(200);
  });

  it('une adresse e-mail invalide est refusée', async () => {
    const { res } = await appel(ADMIN, '/api/customers', 'POST',
      { ...nouveau, email: 'pas-une-adresse' });

    expect(res.status).toBe(422);
  });
});

describe('modifier un client', () => {
  beforeEach(prepareBase);

  it('met à jour les champs fournis', async () => {
    const { res, corps } = await appel(ADMIN, '/api/customers/1', 'PUT',
      { notes: 'Préfère être appelé le matin' });

    expect(res.status).toBe(200);
    expect(corps.data.customer.notes).toBe('Préfère être appelé le matin');
    expect(corps.data.customer.first_name).toBe('Aminata');   // inchangé
  });

  /**
   * LA LISTE BLANCHE.
   *
   * Sans elle, un corps de requête portant `organization_id`
   * déplacerait un client chez un concurrent. C'est le genre de
   * défaut qu'on ne trouve jamais par hasard.
   */
  it('un champ hors de la liste blanche est ignoré', async () => {
    await appel(ADMIN, '/api/customers/1', 'PUT',
      { notes: 'ok', organization_id: 2, id: 999 });

    const c = await env.DB.prepare('SELECT organization_id, id FROM customers WHERE id = 1')
      .first<{ organization_id: number; id: number }>();

    expect(c?.organization_id).toBe(1);
    expect(c?.id).toBe(1);
  });

  it('on ne vide pas un champ obligatoire', async () => {
    expect((await appel(ADMIN, '/api/customers/1', 'PUT', { phone: '' })).res.status).toBe(422);
    expect((await appel(ADMIN, '/api/customers/1', 'PUT', { last_name: '  ' })).res.status).toBe(422);
  });

  it('le client d’une autre organisation est introuvable', async () => {
    expect((await appel(ADMIN, '/api/customers/2', 'PUT', { notes: 'x' })).res.status).toBe(404);
  });
});

describe('la fiche d’un client', () => {
  beforeEach(prepareBase);

  it('renvoie le client et ses véhicules', async () => {
    const { corps } = await appel(ADMIN, '/api/customers/1');

    expect(corps.data.customer.full_name).toBe('Aminata Sarr');
    expect(corps.data.vehicles).toHaveLength(2);
    expect(corps.data.vehicles[0]).toHaveProperty('plate_number');
  });

  it('celle d’une autre organisation est introuvable', async () => {
    expect((await appel(ADMIN, '/api/customers/2')).res.status).toBe(404);
  });
});
