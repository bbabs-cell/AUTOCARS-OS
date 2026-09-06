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

// ====================================================================

describe("les paramètres de l'entreprise", () => {
  beforeEach(prepareBase);

  it('porte les clés que le modèle Angular lit', async () => {
    const { res, corps } = await appel(ADMIN, '/api/organization');

    expect(res.status).toBe(200);
    expect(Object.keys(corps.data).sort()).toEqual([
      'country_code', 'created_at', 'currency_code', 'email', 'id', 'member_count',
      'name', 'onboarding_completed_at', 'phone', 'slug', 'station_count', 'timezone',
    ]);
    expect(corps.data.name).toBe('Diallo Auto');
    expect(corps.data.station_count).toBe(2);
    expect(corps.data.member_count).toBe(4);
  });

  it('modifie les coordonnées', async () => {
    const { res, corps } = await appel(ADMIN, '/api/organization', 'PUT', {
      name: 'Diallo Auto SARL', phone: '+221338000000', email: 'contact@diallo.sn',
    });

    expect(res.status).toBe(200);
    expect(corps.data.name).toBe('Diallo Auto SARL');
    expect(corps.data.email).toBe('contact@diallo.sn');
  });

  /**
   * ==================================================================
   * LA DEVISE NE SE CHANGE PAS DEPUIS UN ÉCRAN.
   * ==================================================================
   * Tous les montants sont des entiers dans la plus petite unité :
   * 5000 se lit « 5 000 F ». Passer à l'euro ne convertirait rien —
   * les 5000 déjà en base deviendraient « 50,00 € », et le chiffre
   * d'affaires serait divisé par cent en silence.
   */
  it('ignore la devise, le pays et le fuseau envoyés dans le formulaire', async () => {
    const { corps } = await appel(ADMIN, '/api/organization', 'PUT', {
      name: 'Diallo Auto',
      currency_code: 'EUR', country_code: 'FR', timezone: 'Europe/Paris',
    });

    expect(corps.data.currency_code).toBe('XOF');
    expect(corps.data.country_code).toBe('SN');
    expect(corps.data.timezone).toBe('Africa/Dakar');

    // Et rien n'a bougé en base non plus.
    const o = await env.DB
      .prepare('SELECT currency_code FROM organizations WHERE id = 1')
      .first<{ currency_code: string }>();

    expect(o?.currency_code).toBe('XOF');
  });

  // Le slug apparaît dans les URL et les références : le modifier
  // casserait des liens déjà envoyés.
  it('ignore le slug envoyé dans le formulaire', async () => {
    const { corps } = await appel(ADMIN, '/api/organization', 'PUT', {
      name: 'Diallo Auto', slug: 'autre-slug',
    });

    expect(corps.data.slug).toBe('diallo');
  });

  it('refuse une raison sociale vide et un e-mail invalide', async () => {
    const { res, corps } = await appel(ADMIN, '/api/organization', 'PUT', {
      name: '', email: 'pas-une-adresse',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.name).toBeDefined();
    expect(corps.errors.email).toBeDefined();
  });

  // Ce ne sont pas des réglages d'exploitation quotidienne.
  it("un employé ne voit pas les paramètres de l'entreprise", async () => {
    const { res } = await appel(EMPLOYE, '/api/organization');

    expect(res.status).toBe(403);
  });

  it("chaque entreprise ne voit que la sienne", async () => {
    const { corps } = await appel(RIVAL, '/api/organization');

    expect(corps.data.name).toBe('Concurrent SA');
    expect(corps.data.station_count).toBe(1);
  });

  it("modifier la sienne ne touche pas celle du voisin", async () => {
    await appel(ADMIN, '/api/organization', 'PUT', { name: 'Renommée' });

    const { corps } = await appel(RIVAL, '/api/organization');

    expect(corps.data.name).toBe('Concurrent SA');
  });
});

// ====================================================================

describe("l'installation guidée", () => {
  beforeEach(prepareBase);

  it('dit où en est le gérant', async () => {
    const { res, corps } = await appel(ADMIN, '/api/onboarding/status');

    expect(res.status).toBe(200);
    expect(Object.keys(corps.data).sort()).toEqual([
      'completed', 'organization_name', 'services_count', 'station', 'team_count',
    ]);
    expect(corps.data.completed).toBe(false);
    expect(corps.data.organization_name).toBe('Diallo Auto');
    expect(corps.data.station.code).toBe('DKP');
    expect(corps.data.services_count).toBe(1);
    expect(corps.data.team_count).toBe(4);
  });

  it('se termine et le reste', async () => {
    const { res, corps } = await appel(ADMIN, '/api/onboarding/complete', 'POST', {});

    expect(res.status).toBe(200);
    expect(corps.message).toContain('prête');

    const { corps: apres } = await appel(ADMIN, '/api/onboarding/status');

    expect(apres.data.completed).toBe(true);
  });

  /**
   * SANS CATALOGUE, le gérant arriverait sur un tableau de bord d'où
   * il ne pourrait rien faire : on ne peut pas accueillir un véhicule
   * sans prestation.
   */
  it('refuse de se terminer sans aucune prestation', async () => {
    await env.DB.prepare('DELETE FROM operations WHERE organization_id = 1').run();
    await env.DB.prepare('DELETE FROM services WHERE organization_id = 1').run();

    const { res, corps } = await appel(ADMIN, '/api/onboarding/complete', 'POST', {});

    expect(res.status).toBe(422);
    expect(corps.errors.services).toBeDefined();
  });

  it("l'installation d'une entreprise ne termine pas celle d'une autre", async () => {
    await appel(ADMIN, '/api/onboarding/complete', 'POST', {});

    const { corps } = await appel(RIVAL, '/api/onboarding/status');

    expect(corps.data.completed).toBe(false);
  });
});

// ====================================================================

describe('les stations', () => {
  beforeEach(prepareBase);

  it('la liste porte le nombre de véhicules sur place', async () => {
    const { corps } = await appel(ADMIN, '/api/stations');

    const plateau = corps.data.find((s: any) => s.code === 'DKP');

    // Les deux dossiers du jeu d'essai sont ouverts sur cette station.
    expect(plateau.vehicles_on_site).toBe(2);
  });

  it('la fiche d’une station', async () => {
    const { res, corps } = await appel(ADMIN, '/api/stations/1');

    expect(res.status).toBe(200);
    expect(Object.keys(corps.data).sort()).toEqual([
      'address', 'city', 'closes_at', 'code', 'id', 'name', 'opens_at', 'phone', 'status',
    ]);
  });

  it('crée une station', async () => {
    const { res, corps } = await appel(ADMIN, '/api/stations', 'POST', {
      name: 'Mbour', code: 'mbr', city: 'Mbour', opens_at: '08:00', closes_at: '19:30',
    });

    expect(res.status).toBe(201);
    // Le code est normalisé en majuscules : il apparaît dans les
    // références remises au client.
    expect(corps.data.code).toBe('MBR');
    // HH:MM et non HH:MM:SS — c'est ce qu'attend `<input type="time">`.
    expect(corps.data.opens_at).toBe('08:00');
    expect(corps.data.closes_at).toBe('19:30');
  });

  it('refuse un code avec un espace : la référence deviendrait ambiguë', async () => {
    const { res, corps } = await appel(ADMIN, '/api/stations', 'POST', {
      name: 'Mbour', code: 'MB R',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.code).toContain('sans espace');
  });

  it('refuse un code déjà utilisé', async () => {
    const { res, corps } = await appel(ADMIN, '/api/stations', 'POST', {
      name: 'Autre', code: 'DKP',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.code).toContain('déjà ce code');
  });

  it("le code d'une autre entreprise reste disponible", async () => {
    const { res } = await appel(ADMIN, '/api/stations', 'POST', { name: 'Copie', code: 'RUF' });

    expect(res.status).toBe(201);
  });

  it('un horaire mal formé est ignoré plutôt qu’enregistré de travers', async () => {
    const { corps } = await appel(ADMIN, '/api/stations', 'POST', {
      name: 'Mbour', code: 'MBR', opens_at: '25:99',
    });

    expect(corps.data.opens_at).toBeNull();
  });

  it('modifie une station', async () => {
    const { res, corps } = await appel(ADMIN, '/api/stations/1', 'PUT', {
      name: 'Dakar Plateau Centre', code: 'DKP', city: 'Dakar',
    });

    expect(res.status).toBe(200);
    expect(corps.data.name).toBe('Dakar Plateau Centre');
  });

  it('un employé ne crée ni ne modifie de station', async () => {
    const { res: creation } = await appel(EMPLOYE, '/api/stations', 'POST', {
      name: 'X', code: 'XX',
    });
    const { res: modification } = await appel(EMPLOYE, '/api/stations/1', 'PUT', {
      name: 'X', code: 'DKP',
    });

    expect(creation.status).toBe(403);
    expect(modification.status).toBe(403);
  });

  it("la station d'un concurrent est introuvable", async () => {
    const { res } = await appel(ADMIN, '/api/stations/3');

    expect(res.status).toBe(404);
  });
});

// ====================================================================

describe('fermer une station', () => {
  beforeEach(prepareBase);

  const ferme = (id: number) =>
    appel(ADMIN, `/api/stations/${id}/status`, 'PUT', { status: 'INACTIVE' });

  /**
   * REFUS 1 — DES CLIENTS VONT REVENIR CHERCHER CES VÉHICULES, et
   * leur dossier doit pouvoir aller jusqu'à la restitution.
   */
  it('refuse tant que des véhicules sont sur place, et les compte', async () => {
    const { res, corps } = await ferme(1);

    expect(res.status).toBe(409);
    expect(corps.message).toContain('2 véhicules');
  });

  it('le message s’accorde au singulier', async () => {
    await env.DB.prepare("UPDATE operations SET status = 'COMPLETED' WHERE id = 1").run();

    const { corps } = await ferme(1);

    expect(corps.message).toContain('Un véhicule est encore sur place');
  });

  it('accepte une fois les dossiers terminés', async () => {
    await env.DB
      .prepare("UPDATE operations SET status = 'COMPLETED' WHERE organization_id = 1")
      .run();

    const { res, corps } = await ferme(1);

    expect(res.status).toBe(200);
    expect(corps.data.status).toBe('INACTIVE');
    expect(corps.message).toContain('historique reste consultable');
  });

  /**
   * REFUS 2 — L'ENTREPRISE SE RETROUVERAIT SANS AUCUN POINT DE
   * SERVICE OUVERT, donc incapable d'enregistrer quoi que ce soit.
   */
  it('refuse de fermer la dernière station ouverte', async () => {
    await env.DB
      .prepare("UPDATE operations SET status = 'COMPLETED' WHERE organization_id = 1")
      .run();
    await ferme(1);

    const { res, corps } = await ferme(2);

    expect(res.status).toBe(409);
    expect(corps.message).toContain('dernière station ouverte');
  });

  it('une station fermée se rouvre', async () => {
    await env.DB
      .prepare("UPDATE operations SET status = 'COMPLETED' WHERE organization_id = 1")
      .run();
    await ferme(1);

    const { res, corps } = await appel(ADMIN, '/api/stations/1/status', 'PUT', {
      status: 'ACTIVE',
    });

    expect(res.status).toBe(200);
    expect(corps.data.status).toBe('ACTIVE');
    expect(corps.message).toBe('Station rouverte.');
  });

  // IL N'Y A PAS DE SUPPRESSION : la station fermée reste en base,
  // elle figure sur des milliers de dossiers passés.
  it('fermer ne supprime rien', async () => {
    await env.DB
      .prepare("UPDATE operations SET status = 'COMPLETED' WHERE organization_id = 1")
      .run();
    await ferme(1);

    const { corps } = await appel(ADMIN, '/api/stations');

    expect(corps.data).toHaveLength(2);
    expect(corps.data.find((s: any) => s.id === 1).status).toBe('INACTIVE');
  });
});

// ====================================================================

describe('les véhicules : fiche, création, modification', () => {
  beforeEach(prepareBase);

  it('la fiche porte le véhicule et son historique', async () => {
    const { res, corps } = await appel(ADMIN, '/api/vehicles/1');

    expect(res.status).toBe(200);
    expect(corps.data.vehicle.plate_display).toBe('DK-9087-DE');
    expect(corps.data.vehicle.operation_count).toBe(1);
    expect(corps.data.history).toHaveLength(1);
    expect(Object.keys(corps.data.history[0]).sort()).toEqual([
      'created_at', 'employee_name', 'id', 'price', 'reference',
      'released_at', 'service_name', 'status',
    ]);
  });

  it('enregistre un véhicule', async () => {
    const { res, corps } = await appel(EMPLOYE, '/api/vehicles', 'POST', {
      plate_number: 'dk 4321-zz', customer_id: 1, brand: 'Peugeot',
      model: '308', vehicle_type: 'CAR',
    });

    expect(res.status).toBe(201);
    // STOCKÉE NORMALISÉE : sinon l'historique d'un même véhicule se
    // scinde entre deux écritures de la même plaque.
    expect(corps.data.plate_number).toBe('DK4321ZZ');
    expect(corps.data.plate_display).toBe('DK-4321-ZZ');
  });

  it('refuse une plaque déjà enregistrée, et dit quoi faire', async () => {
    const { res, corps } = await appel(EMPLOYE, '/api/vehicles', 'POST', {
      plate_number: 'DK-9087-DE', customer_id: 1, brand: 'X', model: 'Y',
      vehicle_type: 'CAR',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.plate_number).toContain('Recherchez-le');
  });

  /**
   * ON NE VALIDE PAS UN FORMAT NATIONAL PRÉCIS.
   *
   * Un véhicule immatriculé en Gambie ou au Mali peut se présenter à
   * la station, et refuser sa plaque empêcherait de le servir.
   */
  it('accepte une plaque étrangère, refuse une plaque inexploitable', async () => {
    const { res: etrangere } = await appel(EMPLOYE, '/api/vehicles', 'POST', {
      plate_number: 'BJ 4471 RB', customer_id: 1, brand: 'Toyota',
      model: 'Corolla', vehicle_type: 'CAR',
    });

    expect(etrangere.status).toBe(201);

    const { res, corps } = await appel(EMPLOYE, '/api/vehicles', 'POST', {
      plate_number: 'AB', customer_id: 1, brand: 'X', model: 'Y', vehicle_type: 'CAR',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.plate_number).toContain('incomplète');
  });

  // Sans ce contrôle, un formulaire modifié rattacherait un véhicule
  // au client d'un concurrent.
  it("on n'enregistre pas un véhicule pour le client d'un concurrent", async () => {
    const { res, corps } = await appel(EMPLOYE, '/api/vehicles', 'POST', {
      plate_number: 'DK1111AA', customer_id: 2, brand: 'X', model: 'Y',
      vehicle_type: 'CAR',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.customer_id).toBeDefined();
  });

  it('modifie un véhicule', async () => {
    const { res, corps } = await appel(EMPLOYE, '/api/vehicles/1', 'PUT', {
      plate_number: 'DK9087DE', customer_id: 1, brand: 'Renault',
      model: 'Duster', color: 'Blanc', vehicle_type: 'SUV',
    });

    expect(res.status).toBe(200);
    expect(corps.data.color).toBe('Blanc');
  });

  it("le véhicule d'un concurrent est introuvable", async () => {
    const { res: lecture } = await appel(ADMIN, '/api/vehicles/3');
    const { res: ecriture } = await appel(ADMIN, '/api/vehicles/3', 'PUT', {
      plate_number: 'RF1111ZZ', customer_id: 1, brand: 'X', model: 'Y',
      vehicle_type: 'CAR',
    });

    expect(lecture.status).toBe(404);
    expect(ecriture.status).toBe(404);
  });
});

// ====================================================================

describe('le doublon de numéro de téléphone', () => {
  beforeEach(prepareBase);

  /**
   * LA COMPARAISON SE FAIT PAR LA FIN.
   *
   * La base contient « +221770000001 ». L'employé tape
   * « 770000001 » sans l'indicatif — c'est ainsi qu'on donne son
   * numéro au Sénégal. Une égalité stricte ne trouverait jamais rien,
   * et l'avertissement de doublon ne se déclencherait jamais.
   */
  it('reconnaît un numéro tapé sans indicatif', async () => {
    const { res, corps } = await appel(EMPLOYE, '/api/customers/check-phone?phone=770000001');

    expect(res.status).toBe(200);
    expect(corps.data).toHaveLength(1);
    expect(corps.data[0].full_name).toBe('Aminata Sarr');
  });

  it('reconnaît le même numéro écrit avec des espaces', async () => {
    const { corps } = await appel(EMPLOYE, '/api/customers/check-phone?phone=77 00 00 001');

    expect(corps.data).toHaveLength(1);
  });

  // En dessous de huit chiffres, le résultat serait trop large pour
  // signifier quoi que ce soit.
  it('ne cherche pas en dessous de huit chiffres', async () => {
    const { corps } = await appel(EMPLOYE, '/api/customers/check-phone?phone=7700');

    expect(corps.data).toEqual([]);
  });

  it('ne trouve rien pour un numéro inconnu', async () => {
    const { corps } = await appel(EMPLOYE, '/api/customers/check-phone?phone=770999999');

    expect(corps.data).toEqual([]);
  });

  it("ne révèle pas le client d'un concurrent", async () => {
    const { corps } = await appel(EMPLOYE, '/api/customers/check-phone?phone=770000002');

    expect(corps.data).toEqual([]);
  });
});
