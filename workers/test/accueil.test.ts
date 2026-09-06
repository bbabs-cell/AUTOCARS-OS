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

const accueille = (champs: Record<string, unknown> = {}) =>
  appel(EMPLOYE, '/api/operations', 'POST', {
    vehicle_id: 1, service_id: 1, station_id: 1, ...champs,
  });

describe('accueillir un véhicule', () => {
  beforeEach(prepareBase);

  // Le véhicule 1 a déjà un dossier ouvert dans le jeu d'essai : on
  // le clôt d'abord pour les cas nominaux.
  const libere = () =>
    env.DB.prepare("UPDATE operations SET status = 'COMPLETED' WHERE id = 1").run();

  it('ouvre un dossier avec sa référence', async () => {
    await libere();

    const { res, corps } = await accueille();

    expect(res.status).toBe(201);
    expect(corps.data.operation.status).toBe('WAITING');
    // DKP = le code de la station Dakar Plateau.
    expect(corps.data.operation.reference).toMatch(/^DKP-\d{4}-0001$/);
    expect(corps.message).toContain('ouvert');
  });

  /**
   * LE PRIX EST FIGÉ À L'ACCUEIL.
   *
   * Si le tarif change le mois prochain, ce dossier continue
   * d'afficher ce qui a réellement été annoncé au client.
   */
  it('recopie le prix du catalogue, et ne le suit plus', async () => {
    await libere();
    const { corps } = await accueille();
    const id = corps.data.operation.id;

    expect(corps.data.operation.price).toBe(5000);

    await appel(ADMIN, '/api/services/1', 'PUT', {
      name: 'Lavage standard', price: 9000, duration_minutes: 30,
    });

    const { corps: apres } = await appel(ADMIN, `/api/operations/${id}`);

    expect(apres.data.operation.price).toBe(5000);
  });

  /**
   * LE CLIENT EST DÉDUIT DU VÉHICULE, jamais lu dans la requête.
   *
   * Un formulaire modifié ne peut donc pas rattacher un dossier au
   * client de quelqu'un d'autre.
   */
  it('déduit le client du véhicule, sans écouter la requête', async () => {
    await libere();

    // On tente d'imposer le client du concurrent.
    const { corps } = await accueille({ customer_id: 2 });

    expect(corps.data.operation.customer_id).toBe(1);
    expect(corps.data.operation.customer_name).toBe('Aminata Sarr');
  });

  /**
   * DEUX DOSSIERS OUVERTS SUR UN MÊME VÉHICULE, c'est deux
   * inspections contradictoires et un litige garanti sur « laquelle
   * des deux fait foi ».
   */
  it('refuse un second dossier sur un véhicule déjà en cours', async () => {
    const { res, corps } = await accueille();

    expect(res.status).toBe(409);
    expect(corps.message).toContain('OP-0001');
    expect(corps.errors.vehicle_id).toContain('OP-0001');
  });

  it('accepte à nouveau une fois le premier dossier clos', async () => {
    await libere();

    expect((await accueille()).res.status).toBe(201);
  });

  it("une prestation retirée du catalogue ne s'accueille plus", async () => {
    await libere();
    await appel(ADMIN, '/api/services/1/status', 'PUT', {});

    const { res, corps } = await accueille();

    expect(res.status).toBe(422);
    expect(corps.errors.service_id).toContain("n'est plus proposée");
  });

  /**
   * UNE STATION FERMÉE N'ACCUEILLE PLUS DE VÉHICULE.
   *
   * Sans ce refus, « fermer une station » ne serait qu'une étiquette :
   * le travail continuerait d'y être enregistré, et le gérant
   * découvrirait des dossiers ouverts sur un site qu'il croyait clos.
   */
  it("une station fermée n'accueille plus", async () => {
    await libere();
    await env.DB.prepare("UPDATE stations SET status = 'INACTIVE' WHERE id = 1").run();

    const { res, corps } = await accueille();

    expect(res.status).toBe(422);
    expect(corps.errors.station_id).toContain('fermée');
  });

  // La séparation se joue À L'INTÉRIEUR d'une même entreprise : le
  // cloisonnement par organisation ne suffit pas ici.
  it("on n'accueille pas dans une station où l'on n'est pas rattaché", async () => {
    await libere();

    const { res, corps } = await accueille({ station_id: 2 });

    expect(res.status).toBe(403);
    expect(corps.message).toContain('rattaché');
  });

  it("le véhicule d'un concurrent n'existe pas", async () => {
    const { res, corps } = await accueille({ vehicle_id: 3 });

    expect(res.status).toBe(422);
    expect(corps.errors.vehicle_id).toBeDefined();
  });

  it('la priorité est bornée à trois niveaux', async () => {
    await libere();

    const { corps } = await accueille({ priority: 47 });

    expect(corps.data.operation.priority).toBe(3);
  });

  it('les références se suivent sans se répéter', async () => {
    await libere();
    const { corps: a } = await accueille();

    await env.DB.prepare("UPDATE operations SET status = 'COMPLETED' WHERE id = ?")
      .bind(a.data.operation.id).run();

    const { corps: b } = await accueille();

    expect(a.data.operation.reference).toMatch(/-0001$/);
    expect(b.data.operation.reference).toMatch(/-0002$/);
  });

  // Le tri alphabétique ne donne le bon numéro que parce que le
  // suffixe est rempli de zéros : sans cela « 9 » passerait après
  // « 10 » et le compteur reculerait.
  it('passe de 0009 à 0010 sans reculer', async () => {
    await libere();

    const mois = new Date().toISOString().slice(2, 7).replace('-', '');

    await env.DB
      .prepare(
        `INSERT INTO operations (organization_id, station_id, vehicle_id, customer_id,
                                 service_id, reference, status, price, created_by_user_id)
         VALUES (1, 1, 2, 1, 1, ?, 'COMPLETED', 5000, 1)`,
      )
      .bind(`DKP-${mois}-0009`)
      .run();

    const { corps } = await accueille();

    expect(corps.data.operation.reference).toBe(`DKP-${mois}-0010`);
  });
});

// ====================================================================

describe('la liste des dossiers', () => {
  beforeEach(prepareBase);

  it('renvoie les dossiers et le compte par statut', async () => {
    const { res, corps } = await appel(ADMIN, '/api/operations');

    expect(res.status).toBe(200);
    expect(corps.data.operations).toHaveLength(2);

    // TOUTES LES CLÉS SONT PRÉSENTES, même à zéro : sans cela le
    // frontend devrait tester l'existence de chaque colonne.
    expect(Object.keys(corps.data.counts).sort()).toEqual([
      'CANCELLED', 'COMPLETED', 'INSPECTION', 'IN_PROGRESS',
      'QUALITY_CHECK', 'READY', 'WAITING', 'WASHING',
    ]);
    expect(corps.data.counts.WAITING).toBe(1);
    expect(corps.data.counts.COMPLETED).toBe(0);
  });

  it('?active=1 écarte ce qui est clos', async () => {
    await env.DB.prepare("UPDATE operations SET status = 'COMPLETED' WHERE id = 1").run();

    const { corps } = await appel(ADMIN, '/api/operations?active=1');

    expect(corps.data.operations).toHaveLength(1);
    expect(corps.data.operations[0].reference).toBe('OP-0002');
  });

  it('filtre par statut et par véhicule', async () => {
    const { corps: parStatut } = await appel(ADMIN, '/api/operations?status=READY');
    const { corps: parVehicule } = await appel(ADMIN, '/api/operations?vehicle_id=1');

    expect(parStatut.data.operations).toHaveLength(1);
    expect(parVehicule.data.operations[0].reference).toBe('OP-0001');
  });

  it('cherche par référence, par nom et par plaque', async () => {
    const { corps: ref } = await appel(ADMIN, '/api/operations?search=OP-0001');
    const { corps: nom } = await appel(ADMIN, '/api/operations?search=Sarr');

    expect(ref.data.operations).toHaveLength(1);
    expect(nom.data.operations).toHaveLength(2);
  });

  // La plaque est stockée normalisée : un client qui tape
  // « DK 9087 DE » doit trouver son véhicule.
  it('trouve une plaque tapée avec des espaces', async () => {
    const { corps } = await appel(ADMIN, '/api/operations?search=dk 9087');

    expect(corps.data.operations).toHaveLength(1);
    expect(corps.data.operations[0].plate_number).toBe('DK9087DE');
  });

  it("l'autre entreprise ne voit que ses dossiers", async () => {
    const { corps } = await appel(RIVAL, '/api/operations');

    expect(corps.data.operations).toHaveLength(1);
    expect(corps.data.operations[0].reference).toBe('OP-9001');
  });
});

// ====================================================================

describe('la fiche d’un dossier', () => {
  beforeEach(prepareBase);

  it('renvoie le dossier et ses inspections', async () => {
    await appel(EMPLOYE, '/api/operations/1/inspections', 'POST', {
      type: 'ENTRY', has_damage: true, damage_notes: 'Rayure aile avant',
      // Le client présent doit signer : c'est ce qui vaut accord sur
      // l'état constaté.
      customer_present: true, signature_name: 'Aminata Sarr',
    });

    const { res, corps } = await appel(ADMIN, '/api/operations/1');

    expect(res.status).toBe(200);
    expect(corps.data.operation.reference).toBe('OP-0001');
    expect(corps.data.inspections).toHaveLength(1);
    expect(Object.keys(corps.data.inspections[0]).sort()).toEqual([
      'has_damage', 'id', 'performed_at', 'performed_by_name', 'type',
    ]);
    expect(corps.data.inspections[0].has_damage).toBe(true);
    expect(corps.data.inspections[0].performed_by_name).toBe('Aliou Sow');
  });

  it("le dossier d'un concurrent est introuvable", async () => {
    const { res } = await appel(ADMIN, '/api/operations/3');

    expect(res.status).toBe(404);
  });

  /**
   * « /statuses » N'EST PAS UN IDENTIFIANT.
   *
   * Les deux adresses ont la même forme ; un routeur qui teste
   * l'identifiant d'abord répondrait « ce dossier n'existe pas » sur
   * une adresse qui n'en désigne aucun.
   */
  it('la machine à états s’expose sans être prise pour un dossier', async () => {
    const { res, corps } = await appel(ADMIN, '/api/operations/statuses');

    expect(res.status).toBe(200);
    expect(corps.data.statuses).toHaveLength(8);

    const attente = corps.data.statuses.find((s: any) => s.value === 'WAITING');

    expect(attente.label).toBe('En attente');
    expect(attente.allowed_next).toEqual(['IN_PROGRESS', 'CANCELLED']);
    expect(attente.is_final).toBe(false);
    expect(attente.is_active).toBe(true);

    const restitue = corps.data.statuses.find((s: any) => s.value === 'COMPLETED');

    expect(restitue.is_final).toBe(true);
    expect(restitue.is_active).toBe(false);
  });
});

// ====================================================================

describe('la priorité et l’affectation', () => {
  beforeEach(prepareBase);

  it('un responsable fait passer un véhicule devant', async () => {
    const { res, corps } = await appel(ADMIN, '/api/operations/1/priority', 'PUT', {
      priority: 2,
    });

    expect(res.status).toBe(200);
    expect(corps.data.operation.priority).toBe(2);
    expect(corps.message).toContain('passe devant');
  });

  it('la priorité reste bornée à trois', async () => {
    const { corps } = await appel(ADMIN, '/api/operations/1/priority', 'PUT', {
      priority: 99,
    });

    expect(corps.data.operation.priority).toBe(3);
  });

  it('un employé ne réorganise pas la file', async () => {
    const { res } = await appel(EMPLOYE, '/api/operations/1/priority', 'PUT', { priority: 2 });

    expect(res.status).toBe(403);
  });

  it('confier un dossier, puis le remettre dans la file commune', async () => {
    const { corps } = await appel(ADMIN, '/api/operations/1/assign', 'PUT', {
      assigned_user_id: 2,
    });

    expect(corps.data.operation.assigned_user_id).toBe(2);
    expect(corps.data.operation.assigned_name).toBe('Aliou Sow');

    const { corps: rendu } = await appel(ADMIN, '/api/operations/1/assign', 'PUT', {
      assigned_user_id: null,
    });

    expect(rendu.data.operation.assigned_user_id).toBeNull();
    expect(rendu.message).toContain('file commune');
  });

  /**
   * L'EMPLOYÉ DOIT APPARTENIR À LA MÊME ENTREPRISE.
   *
   * Sans ce contrôle, une requête fabriquée confierait un véhicule à
   * l'employé d'un concurrent.
   */
  it("on ne confie pas un dossier à l'employé d'un concurrent", async () => {
    const { res, corps } = await appel(ADMIN, '/api/operations/1/assign', 'PUT', {
      assigned_user_id: 4,
    });

    expect(res.status).toBe(422);
    expect(corps.errors.assigned_user_id).toContain('votre équipe');
  });

  it("ni à un compte désactivé", async () => {
    const { res, corps } = await appel(ADMIN, '/api/operations/1/assign', 'PUT', {
      assigned_user_id: 3,
    });

    expect(res.status).toBe(422);
    expect(corps.errors.assigned_user_id).toContain("n'est plus actif");
  });

  it("un dossier clos n'a plus rien à confier", async () => {
    await env.DB.prepare("UPDATE operations SET status = 'COMPLETED' WHERE id = 1").run();

    const { res, corps } = await appel(ADMIN, '/api/operations/1/assign', 'PUT', {
      assigned_user_id: 2,
    });

    expect(res.status).toBe(409);
    expect(corps.message).toContain('clos');
  });
});

// ====================================================================

describe('la liste de vérification avant restitution', () => {
  beforeEach(prepareBase);

  it('dit ce qui bloque avant que le client soit devant le comptoir', async () => {
    const { res, corps } = await appel(ADMIN, '/api/operations/2/release-check');

    expect(res.status).toBe(200);
    expect(corps.data.checklist.map((l: any) => l.key)).toEqual([
      'status', 'identity', 'payment', 'exit_inspection',
    ]);

    const paiement = corps.data.checklist.find((l: any) => l.key === 'payment');

    expect(paiement.passed).toBe(false);
    expect(paiement.blocking).toBe(true);
    expect(paiement.detail).toContain('Reste');
  });

  it('la ligne du paiement passe une fois encaissé', async () => {
    await env.DB.prepare(
      `INSERT INTO payments (organization_id, station_id, operation_id, amount, method,
                             status, recorded_by_user_id)
       VALUES (1, 1, 2, 5000, 'CASH', 'PAID', 1)`,
    ).run();

    const { corps } = await appel(ADMIN, '/api/operations/2/release-check');
    const paiement = corps.data.checklist.find((l: any) => l.key === 'payment');

    expect(paiement.passed).toBe(true);
    expect(paiement.detail).toContain('encaissés');
  });

  /**
   * LA LIGNE « identity » N'EST JAMAIS COCHÉE D'AVANCE.
   *
   * Elle se vérifie à la saisie : c'est tout son objet.
   */
  it("la ligne d'identité ne se coche jamais d'avance", async () => {
    const { corps } = await appel(ADMIN, '/api/operations/2/release-check');
    const identite = corps.data.checklist.find((l: any) => l.key === 'identity');

    expect(identite.passed).toBe(false);
    expect(identite.blocking).toBe(true);
    // La plaque est affichée mise en forme, pour être lue à voix haute.
    expect(identite.detail).toBe('DK-5678-BC');
  });

  /**
   * L'INSPECTION DE SORTIE EST RECOMMANDÉE, PAS EXIGÉE.
   *
   * Le contrôle qualité a déjà eu lieu ; bloquer une remise sur une
   * seconde inspection ferait attendre un client dont la voiture est
   * prête.
   */
  it("l'inspection de sortie ne bloque pas la remise", async () => {
    const { corps } = await appel(ADMIN, '/api/operations/2/release-check');
    const sortie = corps.data.checklist.find((l: any) => l.key === 'exit_inspection');

    expect(sortie.passed).toBe(false);
    expect(sortie.blocking).toBe(false);
    expect(sortie.detail).toContain('Recommandée');
  });
});
