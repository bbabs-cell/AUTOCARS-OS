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

describe("la liste de l'équipe", () => {
  beforeEach(prepareBase);

  // UNE LIGNE PAR PERSONNE, PAS PAR RATTACHEMENT. Mamadou est
  // rattaché à deux stations : il ne doit apparaître qu'une fois.
  it("n'affiche pas deux fois qui travaille sur deux stations", async () => {
    const { res, corps } = await appel(ADMIN, '/api/team');

    expect(res.status).toBe(200);

    const mamadou = corps.data.filter((m: any) => m.email === ADMIN);

    expect(mamadou).toHaveLength(1);
    expect(mamadou[0].station_count).toBe(2);
    expect(mamadou[0].station_names).toBe('Dakar Plateau, Thiès');
    expect(mamadou[0].station_ids).toEqual([1, 2]);
  });

  /**
   * LE RÔLE LE PLUS ÉLEVÉ, SANS DEVINER L'ORDRE.
   *
   * Trier les rôles sur leur texte donnerait
   * ADMIN < EMPLOYEE < MANAGER : le bon résultat par accident, et un
   * faux le jour où quelqu'un est responsable quelque part et employé
   * ailleurs.
   */
  it('donne le rôle le plus élevé à qui en a deux', async () => {
    await env.DB
      .prepare(
        `INSERT INTO station_users (organization_id, station_id, user_id, role)
         VALUES (1, 2, 2, 'MANAGER')`,
      )
      .run();

    const { corps } = await appel(ADMIN, '/api/team');
    const aliou = corps.data.find((m: any) => m.email === EMPLOYE);

    expect(aliou.role).toBe('MANAGER');
  });

  it('porte les clés que le modèle Angular lit', async () => {
    const { corps } = await appel(ADMIN, '/api/team');

    expect(Object.keys(corps.data[0]).sort()).toEqual([
      'email', 'first_name', 'full_name', 'id', 'last_login_at', 'last_name',
      'phone', 'role', 'station_count', 'station_id', 'station_ids',
      'station_name', 'station_names', 'status',
    ]);
  });

  it("un employé ne voit pas la liste de l'équipe", async () => {
    const { res } = await appel(EMPLOYE, '/api/team');

    expect(res.status).toBe(403);
  });

  it("l'autre entreprise ne voit que les siens", async () => {
    const { corps } = await appel(RIVAL, '/api/team');

    expect(corps.data).toHaveLength(1);
    expect(corps.data[0].email).toBe(RIVAL);
  });
});

// ====================================================================

describe("l'activité de chacun", () => {
  beforeEach(prepareBase);

  it('compte les dossiers pris en charge', async () => {
    await env.DB.prepare('UPDATE operations SET assigned_user_id = 2 WHERE id IN (1, 2)').run();

    const { corps } = await appel(ADMIN, '/api/team/activity');
    const aliou = corps.data.members.find((m: any) => m.full_name === 'Aliou Sow');

    expect(aliou.operations).toBe(2);
    expect(aliou.revenue).toBe(10_000);
  });

  it("un dossier annulé ne compte pour personne", async () => {
    await env.DB
      .prepare("UPDATE operations SET assigned_user_id = 2, status = 'CANCELLED' WHERE id = 1")
      .run();

    const { corps } = await appel(ADMIN, '/api/team/activity');
    const aliou = corps.data.members.find((m: any) => m.full_name === 'Aliou Sow');

    expect(aliou.operations).toBe(0);
  });

  /**
   * LE CHIFFRE D'AFFAIRES N'EST PAS MASQUÉ, IL N'EST PAS ENVOYÉ.
   *
   * `revenue` ne part que si l'appelant a `reports.view`. Comme au
   * tableau de bord, la clé est ABSENTE de la réponse — pas mise à
   * zéro, pas cachée par l'écran.
   *
   * ------------------------------------------------------------------
   * CE TEST NE VÉRIFIE QUE LA MOITIÉ ACCESSIBLE DE LA RÈGLE.
   *
   * Aujourd'hui, tous les rôles qui ont `employees.view` ont aussi
   * `reports.view` : ADMIN et MANAGER. Le cas « voit l'équipe sans
   * voir les montants » n'est donc atteignable par AUCUN appel, et
   * l'affirmer ici reviendrait à tester une fiction.
   *
   * La garde reste écrite : elle protège le jour où un rôle recevra
   * `employees.view` seul — un écran d'activité par station, par
   * exemple. Ce test-là s'écrira ce jour-là, quand il pourra échouer.
   */
  it('envoie les montants à un responsable, qui a le droit de les voir', async () => {
    await env.DB.prepare("UPDATE station_users SET role = 'MANAGER' WHERE user_id = 2").run();
    await env.DB.prepare('UPDATE operations SET assigned_user_id = 2 WHERE id = 1').run();

    const { corps } = await appel(EMPLOYE, '/api/team/activity');

    expect(corps.data.can_see_money).toBe(true);
    expect(corps.data.members.find((m: any) => m.id === 2).revenue).toBe(5000);
  });

  it('refuse une date illisible', async () => {
    const { res, corps } = await appel(ADMIN, '/api/team/activity?from=hier');

    expect(res.status).toBe(422);
    expect(corps.errors.from).toBeDefined();
  });
});

// ====================================================================

describe('ajouter quelqu’un', () => {
  beforeEach(prepareBase);

  const ajoute = (champs: Record<string, unknown> = {}) =>
    appel(ADMIN, '/api/team', 'POST', {
      first_name: 'Awa', last_name: 'Fall', email: 'awa@diallo.sn',
      password: 'MotDePasse2026!', role: 'EMPLOYEE', station_id: 1, ...champs,
    });

  it('crée le compte et le rattache à sa station', async () => {
    const { res, corps } = await ajoute();

    expect(res.status).toBe(201);
    expect(corps.message).toContain('mot de passe');

    const { corps: liste } = await appel(ADMIN, '/api/team');
    const awa = liste.data.find((m: any) => m.email === 'awa@diallo.sn');

    expect(awa.role).toBe('EMPLOYEE');
    expect(awa.station_ids).toEqual([1]);
  });

  it('le nouveau venu peut se connecter', async () => {
    await ajoute();

    const res = await SELF.fetch('https://api.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'awa@diallo.sn', password: 'MotDePasse2026!' }),
    });

    expect(res.status).toBe(200);
  });

  it('le mot de passe n’est jamais stocké en clair', async () => {
    await ajoute();

    const u = await env.DB
      .prepare('SELECT password_hash FROM users WHERE email = ?')
      .bind('awa@diallo.sn')
      .first<{ password_hash: string }>();

    expect(u?.password_hash).not.toContain('MotDePasse2026!');
    expect(u?.password_hash).toMatch(/^pbkdf2\$\d+\$/);
  });

  it('une adresse déjà utilisée est refusée', async () => {
    const { res, corps } = await ajoute({ email: ADMIN });

    expect(res.status).toBe(422);
    expect(corps.errors.email).toContain('déjà utilisée');
  });

  it('un mot de passe trop court est refusé', async () => {
    const { res, corps } = await ajoute({ password: 'court' });

    expect(res.status).toBe(422);
    expect(corps.errors.password).toBeDefined();
  });

  /**
   * LA STATION DOIT APPARTENIR À L'ENTREPRISE.
   *
   * Sans cette vérification, on rattacherait un employé à la station
   * d'un concurrent en modifiant simplement le formulaire.
   */
  it("la station d'un concurrent n'existe pas", async () => {
    const { res, corps } = await ajoute({ station_id: 3 });

    expect(res.status).toBe(422);
    expect(corps.errors.station_id).toBeDefined();
  });

  it("un employé n'ajoute personne", async () => {
    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch('https://api.test/api/team', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: 'X', last_name: 'Y', email: 'x@diallo.sn',
        password: 'MotDePasse2026!', role: 'ADMIN', station_id: 1,
      }),
    });

    expect(res.status).toBe(403);
  });

  it("rien n'est écrit quand la création échoue", async () => {
    await ajoute({ email: ADMIN });

    const n = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM users WHERE organization_id = 1')
      .first<{ n: number }>();

    // Les quatre du jeu d'essai, pas un de plus.
    expect(n?.n).toBe(4);
  });
});

// ====================================================================

describe('changer le rôle ou fermer un compte', () => {
  beforeEach(prepareBase);

  it("désactiver garde l'historique", async () => {
    const { res, corps } = await appel(ADMIN, '/api/team/2', 'PUT', {
      role: 'EMPLOYEE', status: 'DISABLED',
    });

    expect(res.status).toBe(200);
    expect(corps.message).toContain('historique');

    // La ligne est toujours là : son nom figure sur des inspections
    // et des encaissements.
    const u = await env.DB
      .prepare('SELECT status, deleted_at FROM users WHERE id = 2')
      .first<{ status: string; deleted_at: string | null }>();

    expect(u?.status).toBe('DISABLED');
    expect(u?.deleted_at).toBeNull();
  });

  it("l'accès est coupé immédiatement", async () => {
    const jeton = await jetonPour(EMPLOYE);
    await appel(ADMIN, '/api/team/2', 'PUT', { role: 'EMPLOYEE', status: 'DISABLED' });

    // Le jeton était valide il y a une seconde : c'est la base qui
    // tranche à chaque requête, pas le jeton.
    const res = await SELF.fetch('https://api.test/api/queue', {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    expect(res.status).toBe(401);
  });

  it('promouvoir quelqu’un lui donne ses droits tout de suite', async () => {
    await appel(ADMIN, '/api/team/2', 'PUT', { role: 'MANAGER', status: 'ACTIVE' });

    const { res } = await appel(EMPLOYE, '/api/team');

    expect(res.status).toBe(200);
  });

  // ON NE SE RETIRE PAS SOI-MÊME SES PROPRES DROITS : le seul effet
  // garanti serait de ne plus pouvoir revenir en arrière.
  it('on ne modifie pas son propre rôle', async () => {
    const { res, corps } = await appel(ADMIN, '/api/team/1', 'PUT', {
      role: 'EMPLOYEE', status: 'ACTIVE',
    });

    expect(res.status).toBe(409);
    expect(corps.message).toContain('autre administrateur');
  });

  // LE DERNIER ADMINISTRATEUR ACTIF EST INTOUCHABLE : sinon
  // l'entreprise est enfermée dehors, et il faut intervenir en base
  // pour la rouvrir.
  it("le dernier administrateur ne peut pas être rétrogradé", async () => {
    // Un second administrateur, pour que ce ne soit pas lui-même qui
    // se modifie.
    await env.DB
      .prepare(
        `INSERT INTO users (id, organization_id, first_name, last_name, email, password_hash)
         VALUES (10, 1, 'Second', 'Admin', 'second@diallo.sn', 'x')`,
      ).run();
    await env.DB
      .prepare(
        `INSERT INTO station_users (organization_id, station_id, user_id, role)
         VALUES (1, 1, 10, 'ADMIN')`,
      ).run();
    // …puis on le désactive : il ne reste qu'un administrateur actif.
    await env.DB.prepare("UPDATE users SET status = 'DISABLED' WHERE id = 10").run();

    const jeton = await jetonPour(ADMIN);
    const res = await SELF.fetch('https://api.test/api/team/1', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'MANAGER', status: 'ACTIVE' }),
    });

    expect(res.status).toBe(409);
  });

  it("quelqu'un d'une autre entreprise ne fait pas partie de l'équipe", async () => {
    const { res } = await appel(ADMIN, '/api/team/4', 'PUT', {
      role: 'EMPLOYEE', status: 'DISABLED',
    });

    expect(res.status).toBe(404);
  });

  it('un rôle inconnu est refusé', async () => {
    const { res, corps } = await appel(ADMIN, '/api/team/2', 'PUT', {
      role: 'PATRON', status: 'ACTIVE',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.role).toBeDefined();
  });
});

// ====================================================================

describe('où travaille cette personne', () => {
  beforeEach(prepareBase);

  it('rattache quelqu’un à plusieurs stations', async () => {
    const { res, corps } = await appel(ADMIN, '/api/team/2/stations', 'PUT', {
      station_ids: [1, 2],
    });

    expect(res.status).toBe(200);
    expect(corps.data.station_ids).toEqual([1, 2]);
    expect(corps.message).toContain('2 stations');

    const { corps: liste } = await appel(ADMIN, '/api/team');
    const aliou = liste.data.find((m: any) => m.id === 2);

    expect(aliou.station_count).toBe(2);
  });

  // LE RÔLE N'EST PAS RENVOYÉ PAR CE FORMULAIRE : déplacer quelqu'un
  // d'une station à l'autre ne doit pas réécrire son rôle à une
  // valeur périmée qu'un écran aurait chargée avant un changement.
  it('déplacer quelqu’un ne touche pas à son rôle', async () => {
    await appel(ADMIN, '/api/team/2', 'PUT', { role: 'MANAGER', status: 'ACTIVE' });
    await appel(ADMIN, '/api/team/2/stations', 'PUT', { station_ids: [2] });

    const { corps } = await appel(ADMIN, '/api/team');
    const aliou = corps.data.find((m: any) => m.id === 2);

    expect(aliou.role).toBe('MANAGER');
    expect(aliou.station_ids).toEqual([2]);
  });

  // UNE PERSONNE SANS STATION N'A AUCUN RÔLE, DONC AUCUN DROIT. Elle
  // pourrait se connecter et ne rien pouvoir faire — un état qui
  // ressemble à une panne.
  it('une liste vide est refusée, et renvoie vers la désactivation', async () => {
    const { res, corps } = await appel(ADMIN, '/api/team/2/stations', 'PUT', {
      station_ids: [],
    });

    expect(res.status).toBe(422);
    expect(corps.errors.station_ids).toContain('désactivez son compte');
  });

  it('les doublons ne font pas échouer la contrainte d’unicité', async () => {
    const { res, corps } = await appel(ADMIN, '/api/team/2/stations', 'PUT', {
      station_ids: [1, '1', 1],
    });

    expect(res.status).toBe(200);
    expect(corps.data.station_ids).toEqual([1]);
  });

  it("la station d'un concurrent n'existe pas", async () => {
    const { res, corps } = await appel(ADMIN, '/api/team/2/stations', 'PUT', {
      station_ids: [3],
    });

    expect(res.status).toBe(422);
    expect(corps.errors.station_ids).toContain("n'existe pas");
  });

  it("on n'affecte personne sur une station fermée", async () => {
    await env.DB.prepare("UPDATE stations SET status = 'INACTIVE' WHERE id = 2").run();

    const { res, corps } = await appel(ADMIN, '/api/team/2/stations', 'PUT', {
      station_ids: [1, 2],
    });

    expect(res.status).toBe(422);
    expect(corps.errors.station_ids).toContain('fermée');
  });

  // MAIS ON N'OBLIGE PAS À RETIRER CEUX QUI Y ÉTAIENT DÉJÀ : sinon,
  // fermer une station rendrait impossible le moindre enregistrement
  // de la fiche des personnes qui y travaillaient.
  it('on garde qui y était déjà, même station fermée', async () => {
    await env.DB.prepare("UPDATE stations SET status = 'INACTIVE' WHERE id = 2").run();

    const { res } = await appel(ADMIN, '/api/team/1/stations', 'PUT', {
      station_ids: [1, 2],
    });

    expect(res.status).toBe(200);
  });
});

// ====================================================================

describe('le pointage', () => {
  beforeEach(prepareBase);

  it("un employé pointe son arrivée et son départ", async () => {
    const { res, corps } = await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {});

    expect(res.status).toBe(201);
    expect(corps.data.entry.is_open).toBe(true);
    expect(corps.data.entry.user_name).toBe('Aliou Sow');
    expect(corps.data.entry.station_name).toBe('Dakar Plateau');

    const { corps: sortie } = await appel(EMPLOYE, '/api/attendance/clock-out', 'POST', {});

    expect(sortie.data.entry.is_open).toBe(false);
    expect(sortie.data.entry.duration_minutes).toBe(0);
    expect(sortie.message).toContain('présence');
  });

  it('porte les clés que le modèle Angular lit', async () => {
    const { corps } = await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {});

    expect(Object.keys(corps.data.entry).sort()).toEqual([
      'clock_in_at', 'clock_out_at', 'corrected_at', 'corrected_by_name',
      'correction_reason', 'duration_minutes', 'hours_open', 'id', 'is_corrected',
      'is_open', 'minutes_present', 'notes', 'station_id', 'station_name',
      'user_id', 'user_name',
    ]);
  });

  it('pointer deux fois est refusé', async () => {
    await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {});

    const { res, corps } = await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {});

    expect(res.status).toBe(409);
    expect(corps.message).toContain('déjà pointé');
  });

  // LA BASE EST LE FILET : la colonne calculée `open_user_id` est
  // unique, donc un double appui sur un téléphone lent ne peut pas
  // créer deux pointages ouverts même si les deux requêtes passent la
  // vérification en même temps.
  it("la base refuse un second pointage ouvert, même écrit directement", async () => {
    await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {});

    await expect(
      env.DB
        .prepare(
          `INSERT INTO time_entries (organization_id, station_id, user_id)
           VALUES (1, 1, 2)`,
        )
        .run(),
    ).rejects.toThrow(/UNIQUE|constraint/i);
  });

  it("pointer son départ sans être pointé est refusé", async () => {
    const { res, corps } = await appel(EMPLOYE, '/api/attendance/clock-out', 'POST', {});

    expect(res.status).toBe(409);
    expect(corps.message).toContain("n'êtes pas pointé");
  });

  it('après un départ, on peut repointer', async () => {
    await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {});
    await appel(EMPLOYE, '/api/attendance/clock-out', 'POST', {});

    const { res } = await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {});

    expect(res.status).toBe(201);
  });

  it('chacun voit son propre pointage et ses dix derniers', async () => {
    await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {});

    const { corps } = await appel(EMPLOYE, '/api/attendance/me');

    expect(corps.data.is_clocked_in).toBe(true);
    expect(corps.data.current.user_id).toBe(2);
    expect(corps.data.recent).toHaveLength(1);
  });

  // UN EMPLOYÉ ENVOYÉ EN RENFORT AILLEURS : ses heures appartiennent
  // à la station où il a travaillé.
  it('on peut pointer sur une autre de ses stations', async () => {
    await appel(ADMIN, '/api/team/2/stations', 'PUT', { station_ids: [1, 2] });

    const { corps } = await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {
      station_id: 2,
    });

    expect(corps.data.entry.station_name).toBe('Thiès');
  });

  it("pointer sur la station d'un concurrent est refusé", async () => {
    const { res } = await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {
      station_id: 3,
    });

    expect(res.status).toBe(403);
  });

  it("un employé ne voit pas le registre de l'équipe", async () => {
    const { res } = await appel(EMPLOYE, '/api/attendance');

    expect(res.status).toBe(403);
  });
});

// ====================================================================

describe("le registre de l'équipe", () => {
  beforeEach(prepareBase);

  /** Un pointage fermé, posé directement pour maîtriser les dates. */
  const pointage = (
    id: number, userId: number, entree: string, sortie: string | null, minutes: number | null,
  ) =>
    env.DB
      .prepare(
        `INSERT INTO time_entries (id, organization_id, station_id, user_id,
                                   clock_in_at, clock_out_at, duration_minutes)
         VALUES (?, 1, 1, ?, ?, ?, ?)`,
      )
      .bind(id, userId, entree, sortie, minutes)
      .run();

  it('totalise les JOURS travaillés, pas seulement les heures', async () => {
    const mois = new Date().toISOString().slice(0, 7);

    await pointage(1, 2, `${mois}-02 08:00:00`, `${mois}-02 12:00:00`, 240);
    await pointage(2, 2, `${mois}-02 14:00:00`, `${mois}-02 18:00:00`, 240);
    await pointage(3, 2, `${mois}-03 08:00:00`, `${mois}-03 16:00:00`, 480);

    const { corps } = await appel(ADMIN, '/api/attendance');
    const aliou = corps.data.totals.find((t: any) => t.user_id === 2);

    // Trois pointages, DEUX jours : c'est le chiffre qui sert à payer
    // dans une station de lavage.
    expect(aliou.entries).toBe(3);
    expect(aliou.days).toBe(2);
    expect(aliou.minutes).toBe(960);
  });

  // LES POINTAGES ENCORE OUVERTS SONT EXCLUS DES TOTAUX : leur durée
  // n'est pas connue, et l'estimer fausserait un total qui sert à
  // payer.
  it("un pointage ouvert ne compte pas dans les totaux", async () => {
    await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {});

    const { corps } = await appel(ADMIN, '/api/attendance');

    expect(corps.data.totals).toEqual([]);
    expect(corps.data.present).toHaveLength(1);
  });

  /**
   * ON NE FERME JAMAIS UN POINTAGE AUTOMATIQUEMENT.
   *
   * Quelqu'un qui oublie de pointer en partant laisse une ligne
   * ouverte toute la nuit. Inventer une heure de sortie, c'est
   * fabriquer une donnée de paie. On signale l'anomalie.
   */
  it('signale les pointages oubliés', async () => {
    await env.DB
      .prepare(
        `INSERT INTO time_entries (organization_id, station_id, user_id, clock_in_at)
         VALUES (1, 1, 2, datetime('now', '-30 hours'))`,
      )
      .run();

    const { corps } = await appel(ADMIN, '/api/attendance');

    expect(corps.data.stale).toHaveLength(1);
    expect(corps.data.stale[0].hours_open).toBeGreaterThanOrEqual(29);

    // ET IL N'EST PAS COMPTÉ COMME PRÉSENT : « présent depuis 30 h »
    // ferait douter de tout le panneau.
    expect(corps.data.present).toEqual([]);
  });

  it('filtre par personne', async () => {
    const mois = new Date().toISOString().slice(0, 7);

    await pointage(1, 1, `${mois}-02 08:00:00`, `${mois}-02 12:00:00`, 240);
    await pointage(2, 2, `${mois}-02 08:00:00`, `${mois}-02 12:00:00`, 240);

    const { corps } = await appel(ADMIN, '/api/attendance?user_id=2');

    expect(corps.data.entries).toHaveLength(1);
    expect(corps.data.entries[0].user_id).toBe(2);
  });

  // LES BORNES PORTENT SUR L'ARRIVÉE : un pointage commencé à 22 h et
  // fermé à 2 h du matin appartient à la journée où la personne a
  // pris son poste.
  it("range un pointage de nuit dans la journée où il a commencé", async () => {
    await pointage(1, 2, '2026-03-10 22:00:00', '2026-03-11 02:00:00', 240);

    const { corps: le10 } = await appel(ADMIN, '/api/attendance?from=2026-03-10&to=2026-03-10');
    const { corps: le11 } = await appel(ADMIN, '/api/attendance?from=2026-03-11&to=2026-03-11');

    expect(le10.data.entries).toHaveLength(1);
    expect(le11.data.entries).toEqual([]);
  });

  it("l'autre entreprise ne voit rien de ce registre", async () => {
    await appel(EMPLOYE, '/api/attendance/clock-in', 'POST', {});

    const { corps } = await appel(RIVAL, '/api/attendance');

    expect(corps.data.entries).toEqual([]);
    expect(corps.data.present).toEqual([]);
  });
});

// ====================================================================

describe('corriger un pointage', () => {
  beforeEach(prepareBase);

  const oublie = () =>
    env.DB
      .prepare(
        `INSERT INTO time_entries (id, organization_id, station_id, user_id, clock_in_at)
         VALUES (7, 1, 1, 2, datetime('now', '-30 hours'))`,
      )
      .run();

  /**
   * UNE CORRECTION EST VISIBLE.
   *
   * Sans cela, un employé payé sur des heures qu'il n'a pas reconnues
   * n'aurait aucun moyen de s'en apercevoir.
   */
  it('porte le nom de qui a corrigé, et pourquoi', async () => {
    await oublie();

    const { res, corps } = await appel(ADMIN, '/api/attendance/7', 'PUT', {
      clock_in_at: '2026-03-10 08:00:00',
      clock_out_at: '2026-03-10 17:00:00',
      reason: 'Oubli de pointage, départ confirmé par le gérant',
    });

    expect(res.status).toBe(200);
    expect(corps.data.entry.is_corrected).toBe(true);
    expect(corps.data.entry.corrected_by_name).toBe('Mamadou Diallo');
    expect(corps.data.entry.correction_reason).toContain('Oubli de pointage');
    expect(corps.data.entry.duration_minutes).toBe(540);
  });

  it("l'avant et l'après sont au journal d'audit", async () => {
    await oublie();
    await appel(ADMIN, '/api/attendance/7', 'PUT', {
      clock_in_at: '2026-03-10 08:00:00',
      clock_out_at: '2026-03-10 17:00:00',
      reason: 'Oubli',
    });

    const trace = await env.DB
      .prepare("SELECT metadata FROM audit_logs WHERE action = 'attendance.corrected'")
      .first<{ metadata: string }>();

    const detail = JSON.parse(trace!.metadata);

    expect(detail.from.clock_out_at).toBeNull();
    expect(detail.to.clock_out_at).toBe('2026-03-10 17:00:00');
  });

  it('le motif est obligatoire', async () => {
    await oublie();

    const { res, corps } = await appel(ADMIN, '/api/attendance/7', 'PUT', {
      clock_in_at: '2026-03-10 08:00:00', reason: '',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.reason).toBeDefined();
  });

  it("un départ avant l'arrivée est refusé", async () => {
    await oublie();

    const { res, corps } = await appel(ADMIN, '/api/attendance/7', 'PUT', {
      clock_in_at: '2026-03-10 17:00:00',
      clock_out_at: '2026-03-10 08:00:00',
      reason: 'Inversion',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.clock_out_at).toContain('postérieur');
  });

  // PLUS DE 16 HEURES est presque toujours une faute de saisie — ou
  // un pointage jamais fermé qu'on essaie de rattraper au jugé. On
  // refuse plutôt que de laisser entrer un chiffre qui servira à
  // payer.
  it('une journée de plus de seize heures est refusée', async () => {
    await oublie();

    const { res, corps } = await appel(ADMIN, '/api/attendance/7', 'PUT', {
      clock_in_at: '2026-03-10 06:00:00',
      clock_out_at: '2026-03-10 23:30:00',
      reason: 'Longue journée',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.clock_out_at).toContain('16 heures');
  });

  // UN POINTAGE DANS LE FUTUR n'a aucun sens et fausserait les totaux
  // du mois en cours.
  it('une date future est refusée', async () => {
    await oublie();

    const demain = new Date(Date.now() + 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

    const { res, corps } = await appel(ADMIN, '/api/attendance/7', 'PUT', {
      clock_in_at: demain, reason: 'Anticipation',
    });

    expect(res.status).toBe(422);
    expect(corps.errors.clock_in_at).toContain('futur');
  });

  // CHACUN POINTE POUR SOI : corriger le pointage de quelqu'un
  // d'autre est réservé aux responsables, et c'est tracé.
  it("un employé ne corrige aucun pointage, pas même le sien", async () => {
    await oublie();

    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch('https://api.test/api/attendance/7', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clock_in_at: '2026-03-10 08:00:00', reason: 'Moi-même' }),
    });

    expect(res.status).toBe(403);
  });

  it("le pointage d'une autre entreprise est introuvable", async () => {
    await oublie();

    const { res } = await appel(RIVAL, '/api/attendance/7', 'PUT', {
      clock_in_at: '2026-03-10 08:00:00', reason: 'Curiosité',
    });

    expect(res.status).toBe(404);
  });

  // Corriger sans fermer : le responsable rectifie l'heure d'arrivée
  // d'une personne encore présente.
  it("une correction peut laisser le pointage ouvert", async () => {
    await oublie();

    const { corps } = await appel(ADMIN, '/api/attendance/7', 'PUT', {
      clock_in_at: '2026-03-10 08:00:00', clock_out_at: null, reason: 'Arrivée réelle',
    });

    expect(corps.data.entry.is_open).toBe(true);
    expect(corps.data.entry.duration_minutes).toBeNull();
  });
});
