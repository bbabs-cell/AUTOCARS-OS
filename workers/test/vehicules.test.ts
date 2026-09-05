import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jetonPour, prepareBase } from './aide';
import { affiche, normalise } from '../src/core/plate';

const liste = async (requete = '') => {
  const jeton = await jetonPour('mamadou@diallo.sn');
  const res = await SELF.fetch(`https://api.test/api/vehicles${requete}`, {
    headers: { Authorization: `Bearer ${jeton}` },
  });
  return { res, corps: (await res.json()) as { success: boolean; data: Record<string, unknown>[]; message: string } };
};

describe('GET /api/vehicles', () => {
  beforeEach(prepareBase);

  /**
   * LE TEST QUI JUSTIFIE TOUTE L'ÉTAPE 1.
   *
   * L'enveloppe et les clés doivent être IDENTIQUES à celles du
   * backend PHP, sans quoi l'application Angular devrait être
   * modifiée — et la démonstration ne prouverait plus rien.
   *
   * Les noms sont donc figés ici, en dur, plutôt que dérivés du code :
   * un test qui recopie l'implémentation ne vérifie rien.
   */
  it('renvoie exactement les clés que le frontend lit déjà', async () => {
    const { corps } = await liste();

    expect(Object.keys(corps).sort()).toEqual(['data', 'message', 'success']);
    expect(corps.success).toBe(true);

    expect(Object.keys(corps.data[0]).sort()).toEqual([
      'brand',
      'color',
      'customer_id',
      'customer_name',
      'customer_phone',
      'id',
      'model',
      'notes',
      'plate_display',
      'plate_number',
      'vehicle_type',
    ]);
  });

  it('expose la plaque sous ses deux formes', async () => {
    const { corps } = await liste();
    const duster = corps.data.find((v) => v.plate_number === 'DK9087DE');

    expect(duster?.plate_number).toBe('DK9087DE');
    expect(duster?.plate_display).toBe('DK-9087-DE');
  });

  it('assemble le nom du client', async () => {
    const { corps } = await liste();
    expect(corps.data[0].customer_name).toBe('Aminata Sarr');
  });

  it('cherche par marque, par modèle et par nom de client', async () => {
    expect((await liste('?search=Duster')).corps.data).toHaveLength(1);
    expect((await liste('?search=Renault')).corps.data).toHaveLength(1);
    expect((await liste('?search=Aminata')).corps.data).toHaveLength(2);
    expect((await liste('?search=IntrouvableXYZ')).corps.data).toHaveLength(0);
  });

  it('trouve une plaque écrite avec des tirets ou des espaces', async () => {
    // Le frontend affiche « DK-9087-DE » : un utilisateur qui recopie
    // ce qu'il voit doit trouver le véhicule.
    expect((await liste('?search=DK-9087-DE')).corps.data).toHaveLength(1);
    expect((await liste('?search=dk 9087 de')).corps.data).toHaveLength(1);
  });

  it('filtre sur un client', async () => {
    expect((await liste('?customer_id=1')).corps.data).toHaveLength(2);
  });

  it('un customer_id absurde ne fait pas planter la route', async () => {
    const { res } = await liste('?customer_id=pas-un-nombre');
    expect(res.status).toBe(200);
  });
});

describe('formatage des plaques', () => {
  it('normalise en majuscules sans séparateurs', () => {
    expect(normalise('dk-9087-de')).toBe('DK9087DE');
    expect(normalise(' dk 9087 de ')).toBe('DK9087DE');
  });

  it('affiche les deux formats sénégalais', () => {
    expect(affiche('DK9087DE')).toBe('DK-9087-DE');
    expect(affiche('TH4412CDE')).toBe('TH-4412-CDE');
  });

  it('rend telle quelle une plaque hors format', () => {
    expect(affiche('ABC123')).toBe('ABC123');
    expect(affiche('')).toBe('');
  });
});
