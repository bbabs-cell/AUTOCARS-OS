import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * ==================================================================
 * LES OUTILS DE SAUVEGARDE, ÉPROUVÉS SANS TOUCHER À LA BASE
 * ==================================================================
 * Le cycle complet — sauvegarder, détruire un témoin, restaurer,
 * vérifier qu'il est revenu — a été fait à la main sur la base
 * locale, et il fonctionne. Il ne peut pas tenir dans ces tests : ils
 * s'exécutent dans le runtime Workers, où `wrangler` n'existe pas, et
 * une restauration détruirait la base des autres tests.
 *
 * Ce fichier vérifie donc ce qui se vérifie sans base : les REFUS et
 * les deux calculs qui décident de tout, extraits des outils par
 * exécution réelle plutôt que recopiés ici.
 *
 * Ces deux calculs sont exactement les endroits où la première
 * version s'est trompée.
 */

const racine = path.resolve(import.meta.dirname, '..');

/** Exécute un fragment de Node et renvoie sa sortie. */
function node(source: string): string {
  const fichier = path.join(os.tmpdir(), `autocare-essai-${Date.now()}-${Math.random()}.mjs`);

  fs.writeFileSync(fichier, source);

  try {
    return execFileSync('node', [fichier], { encoding: 'utf8', cwd: racine });
  } finally {
    fs.rmSync(fichier, { force: true });
  }
}

/**
 * Les deux fonctions d'ordre vivent dans `restauration.mjs`, qui
 * s'exécute de haut en bas. On les en extrait par leur texte plutôt
 * que de les recopier : une copie divergerait, et c'est justement
 * l'ordre qui est en cause.
 */
function extrait(nomFonction: string): string {
  const source = fs.readFileSync(path.join(racine, 'tools', 'restauration.mjs'), 'utf8');
  const debut = source.indexOf(`function ${nomFonction}(`);

  expect(debut, `${nomFonction} introuvable dans restauration.mjs`).toBeGreaterThan(-1);

  // On coupe à la première accolade fermante en début de ligne : les
  // fonctions du fichier sont écrites à plat.
  const fin = source.indexOf('\n}\n', debut);

  return source.slice(debut, fin + 3);
}

describe("l'ordre de suppression des tables", () => {
  /**
   * SQLite refuse de supprimer une table dont une clé étrangère
   * pointe vers une table DÉJÀ supprimée. La première version vidait
   * dans l'ordre reçu et s'arrêtait sur « no such table:
   * main.organizations ».
   */
  it('supprime les enfants avant leurs parents', () => {
    const sortie = node(`
      ${extrait('ordreDeSuppression')}

      const tables = [
        { name: 'organizations', sql: 'CREATE TABLE organizations (id INTEGER)' },
        { name: 'users', sql: 'CREATE TABLE users (FOREIGN KEY (organization_id) REFERENCES organizations(id))' },
        { name: 'operations', sql: 'CREATE TABLE operations (FOREIGN KEY (u) REFERENCES users(id), FOREIGN KEY (o) REFERENCES organizations(id))' },
      ];

      console.log(JSON.stringify(ordreDeSuppression(tables)));
    `);

    const ordre: string[] = JSON.parse(sortie);

    expect(ordre.indexOf('operations')).toBeLessThan(ordre.indexOf('users'));
    expect(ordre.indexOf('users')).toBeLessThan(ordre.indexOf('organizations'));
  });

  // `loyalty_entries.related_entry_id` pointe sur `loyalty_entries` :
  // une table qui se référence elle-même ne s'attend pas elle-même.
  it("ne bloque pas sur une table qui se référence elle-même", () => {
    const sortie = node(`
      ${extrait('ordreDeSuppression')}

      const tables = [
        { name: 'loyalty_entries', sql: 'CREATE TABLE loyalty_entries (FOREIGN KEY (related_entry_id) REFERENCES loyalty_entries(id))' },
      ];

      console.log(JSON.stringify(ordreDeSuppression(tables)));
    `);

    expect(JSON.parse(sortie)).toEqual(['loyalty_entries']);
  });

  it("n'oublie aucune table, même en cas de cycle", () => {
    const sortie = node(`
      ${extrait('ordreDeSuppression')}

      const tables = [
        { name: 'a', sql: 'CREATE TABLE a (FOREIGN KEY (x) REFERENCES b(id))' },
        { name: 'b', sql: 'CREATE TABLE b (FOREIGN KEY (y) REFERENCES a(id))' },
      ];

      console.log(JSON.stringify(ordreDeSuppression(tables).sort()));
    `);

    expect(JSON.parse(sortie)).toEqual(['a', 'b']);
  });
});

describe("le réordonnancement de l'export D1", () => {
  /**
   * ==================================================================
   * L'EXPORT DE D1 N'EST PAS DIRECTEMENT REJOUABLE.
   * ==================================================================
   * Il écrit les tables dans l'ordre ALPHABÉTIQUE : `payments` avant
   * `subscriptions`, qu'elle référence. Constaté en restaurant pour
   * de vrai — « no such table: main.subscriptions ».
   */
  it('crée les parents avant les enfants', () => {
    const sortie = node(`
      ${extrait('reordonneLesTables')}

      const source = [
        'PRAGMA defer_foreign_keys=TRUE;',
        'CREATE TABLE payments (',
        '  id INTEGER,',
        '  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)',
        ');',
        'CREATE TABLE subscriptions (',
        '  id INTEGER',
        ');',
        'INSERT INTO payments VALUES (1);',
      ].join('\\n');

      const resultat = reordonneLesTables(source);

      console.log(JSON.stringify({
        subscriptions: resultat.indexOf('CREATE TABLE subscriptions'),
        payments: resultat.indexOf('CREATE TABLE payments'),
        insert: resultat.indexOf('INSERT INTO payments'),
        pragma: resultat.indexOf('PRAGMA'),
      }));
    `);

    const positions = JSON.parse(sortie);

    expect(positions.subscriptions).toBeLessThan(positions.payments);
    // Ce qui n'est pas une création de table ne bouge pas : le PRAGMA
    // reste en tête, les INSERT restent après.
    expect(positions.pragma).toBe(0);
    expect(positions.insert).toBeGreaterThan(positions.payments);
  });

  /**
   * LES CORPS DE DÉCLENCHEURS CONTIENNENT DES POINTS-VIRGULES.
   *
   * Un découpage naïf du fichier en instructions les couperait en
   * deux. C'est pourquoi on ne découpe PAS : on ne déplace que les
   * blocs `CREATE TABLE`, repérés par leur parenthèse fermante en
   * début de ligne.
   */
  it('ne coupe pas un déclencheur en deux', () => {
    const sortie = node(`
      ${extrait('reordonneLesTables')}

      const source = [
        'CREATE TABLE services (',
        '  id INTEGER',
        ');',
        'CREATE TRIGGER services_maj AFTER UPDATE ON services',
        'BEGIN',
        "  UPDATE services SET updated_at = datetime('now') WHERE id = NEW.id;",
        'END;',
      ].join('\\n');

      console.log(JSON.stringify(reordonneLesTables(source)));
    `);

    const resultat: string = JSON.parse(sortie);

    expect(resultat).toContain('BEGIN');
    expect(resultat).toContain('END;');
    expect(resultat).toContain("UPDATE services SET updated_at = datetime('now')");
  });

  it('rend le fichier inchangé quand il ne contient aucune table', () => {
    const sortie = node(`
      ${extrait('reordonneLesTables')}

      const source = 'PRAGMA defer_foreign_keys=TRUE;\\nINSERT INTO x VALUES (1);';

      console.log(JSON.stringify(reordonneLesTables(source) === source));
    `);

    expect(JSON.parse(sortie)).toBe(true);
  });
});

describe('les refus de la restauration', () => {
  const dossier = path.join(os.tmpdir(), `autocare-sauvegardes-${Date.now()}`);

  /** Écrit une archive et son manifeste, avec l'empreinte demandée. */
  function pose(nom: string, contenu: string, empreinteFausse = false): void {
    fs.mkdirSync(dossier, { recursive: true });

    const compresse = gzipSync(Buffer.from(contenu));

    fs.writeFileSync(path.join(dossier, `${nom}.sql.gz`), compresse);
    fs.writeFileSync(
      path.join(dossier, `${nom}.json`),
      JSON.stringify({
        sql_sha256: empreinteFausse
          ? 'f'.repeat(64)
          : createHash('sha256').update(compresse).digest('hex'),
        tables: (contenu.match(/CREATE TABLE/g) ?? []).length,
      }),
    );
  }

  function restaure(...args: string[]): { code: number; sortie: string } {
    try {
      const sortie = execFileSync(
        'node',
        [path.join(racine, 'tools', 'restauration.mjs'), ...args],
        { encoding: 'utf8', cwd: racine, env: { ...process.env, BACKUP_DIR: dossier } },
      );

      return { code: 0, sortie };
    } catch (e: any) {
      return { code: e.status ?? 1, sortie: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  /**
   * UNE ARCHIVE ABÎMÉE RESTAURÉE PAR-DESSUS DES DONNÉES VIVANTES,
   * C'EST DEUX PERTES AU LIEU D'UNE.
   */
  it('refuse une archive dont l’empreinte ne correspond pas', () => {
    pose('autocare-abimee', 'CREATE TABLE x (id INTEGER);', true);

    const { code, sortie } = restaure('autocare-abimee', '--local');

    expect(code).toBe(1);
    expect(sortie).toContain("l'archive est abîmée");
    // Le refus intervient AVANT le vidage : rien n'a été touché.
    expect(sortie).not.toContain('base vidée');
  });

  it('refuse une archive dont le nombre de tables ne correspond pas', () => {
    fs.mkdirSync(dossier, { recursive: true });

    const contenu = 'CREATE TABLE x (id INTEGER);';
    const compresse = gzipSync(Buffer.from(contenu));

    fs.writeFileSync(path.join(dossier, 'autocare-tronquee.sql.gz'), compresse);
    fs.writeFileSync(
      path.join(dossier, 'autocare-tronquee.json'),
      JSON.stringify({
        sql_sha256: createHash('sha256').update(compresse).digest('hex'),
        // Le manifeste en annonce 21, l'archive n'en a qu'une.
        tables: 21,
      }),
    );

    const { code, sortie } = restaure('autocare-tronquee', '--local');

    expect(code).toBe(1);
    expect(sortie).toContain('le manifeste en annonce 21');
  });

  it('refuse un fichier qui ne se décompresse pas', () => {
    fs.mkdirSync(dossier, { recursive: true });

    const faux = Buffer.from('ceci n’est pas du gzip');

    fs.writeFileSync(path.join(dossier, 'autocare-pas-gzip.sql.gz'), faux);
    fs.writeFileSync(
      path.join(dossier, 'autocare-pas-gzip.json'),
      JSON.stringify({ sql_sha256: createHash('sha256').update(faux).digest('hex') }),
    );

    const { code, sortie } = restaure('autocare-pas-gzip', '--local');

    expect(code).toBe(1);
    expect(sortie).toContain('ne se décompresse pas');
  });

  /**
   * RESTAURER VIDE LA BASE. Sur la production, cela efface les
   * dossiers ouverts ce matin et les encaissements de la journée.
   */
  it('refuse --remote sans le drapeau explicite, et dit lequel', () => {
    pose('autocare-bonne', 'CREATE TABLE x (id INTEGER);');

    const { code, sortie } = restaure('autocare-bonne', '--remote');

    expect(code).toBe(1);
    expect(sortie).toContain('PRODUCTION');
    expect(sortie).toContain('--je-sais-ce-que-je-fais');
    expect(sortie).not.toContain('base vidée');
  });

  it('refuse une archive qui n’existe pas', () => {
    const { code, sortie } = restaure('autocare-fantome', '--local');

    expect(code).toBe(1);
    expect(sortie).toContain('Introuvable');
  });

  it('liste ce qu’il a sous la main', () => {
    pose('autocare-bonne', 'CREATE TABLE x (id INTEGER);');

    const { code, sortie } = restaure('--list');

    expect(code).toBe(0);
    expect(sortie).toContain('autocare-bonne');
  });

  it('signale une archive sans empreinte plutôt que de la refuser', () => {
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(
      path.join(dossier, 'autocare-sans-manifeste.sql.gz'),
      gzipSync(Buffer.from('CREATE TABLE x (id INTEGER);')),
    );

    const { sortie } = restaure('--list');

    expect(sortie).toContain('SANS EMPREINTE');
  });
});

describe('le contrôle avant vol', () => {
  function avantVol(toml: string): { code: number; sortie: string } {
    // On travaille sur une COPIE du dossier : le contrôle lit
    // wrangler.toml, et l'essai ne doit pas modifier le vrai.
    const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'autocare-avant-vol-'));

    fs.mkdirSync(path.join(bac, 'tools'));
    fs.mkdirSync(path.join(bac, 'migrations'));
    fs.copyFileSync(
      path.join(racine, 'tools', 'avant-vol.mjs'),
      path.join(bac, 'tools', 'avant-vol.mjs'),
    );
    fs.writeFileSync(path.join(bac, 'migrations', '0001_x.sql'), '');
    fs.writeFileSync(path.join(bac, 'wrangler.toml'), toml);

    try {
      const sortie = execFileSync('node', [path.join(bac, 'tools', 'avant-vol.mjs')], {
        encoding: 'utf8', cwd: bac,
      });

      return { code: 0, sortie };
    } catch (e: any) {
      return { code: e.status ?? 1, sortie: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  const BON = [
    'database_name = "autocare"',
    'database_id = "0123456789abcdef"',
    'APP_ENV = "production"',
    'APP_FRONTEND_URL = "https://magyapro.com"',
    '[images]',
    'binding = "IMAGES"',
    '[[r2_buckets]]',
    'binding = "PHOTOS"',
    'bucket_name = "autocare-photos"',
  ].join('\n');

  it('laisse passer une configuration complète', () => {
    const { code } = avantVol(BON);

    expect(code).toBe(0);
  });

  // Un identifiant resté à sa valeur d'exemple fait échouer le
  // déploiement au premier appel, pas au déploiement.
  it('bloque sur un database_id resté à sa valeur d’exemple', () => {
    const { code, sortie } = avantVol(BON.replace('0123456789abcdef', 'a-remplacer-au-premier-deploiement'));

    expect(code).toBe(1);
    expect(sortie).toContain('database_id est renseigné');
  });

  /**
   * UN SECRET DANS wrangler.toml EST UN SECRET PUBLIC : ce fichier
   * est suivi par Git. Rien ne le signale au moment de l'erreur.
   */
  it('bloque sur un JWT_SECRET écrit dans wrangler.toml', () => {
    const { code, sortie } = avantVol(`${BON}\nJWT_SECRET = "un-secret-en-clair"`);

    expect(code).toBe(1);
    expect(sortie).toContain('secret public');
  });

  it('bloque sur un jeton de messagerie écrit dans wrangler.toml', () => {
    const { code } = avantVol(`${BON}\nMAIL_TOKEN = "cle-en-clair"`);

    expect(code).toBe(1);
  });

  // APP_ENV resté à « local » fait perdre au cookie de session son
  // attribut Secure : il voyagerait en clair.
  it('avertit sans bloquer sur APP_ENV resté à « local »', () => {
    const { code, sortie } = avantVol(BON.replace('"production"', '"local"'));

    expect(code).toBe(0);
    expect(sortie).toContain('attribut Secure');
  });

  it('avertit sur une adresse de frontend qui n’est pas en HTTPS', () => {
    const { code, sortie } = avantVol(BON.replace('https://', 'http://'));

    expect(code).toBe(0);
    expect(sortie).toContain('APP_FRONTEND_URL est en HTTPS');
  });

  /**
   * UN DÉPLOIEMENT QUI OUBLIE CES LIAISONS ne casse pas au
   * démarrage : il casse à la première inspection, sur le parking,
   * devant un client.
   */
  it('bloque quand le seau des photos n’est pas déclaré', () => {
    const { code, sortie } = avantVol(BON.replace('binding = "PHOTOS"', ''));

    expect(code).toBe(1);
    expect(sortie).toContain('seau R2 des photos');
  });

  it('bloque quand Cloudflare Images n’est pas déclaré', () => {
    const { code, sortie } = avantVol(BON.replace('[images]', ''));

    expect(code).toBe(1);
    expect(sortie).toContain('aucune photo n’est ré-encodée');
  });

  /**
   * L'ENVOI DE COURRIEL NE SE VÉRIFIE PAS HORS LIGNE.
   *
   * Un contrôle qui répondrait « ok » sur la présence d'un fichier de
   * développement donnerait une fausse assurance — pire que pas de
   * contrôle du tout.
   */
  it('ne prétend pas vérifier le courriel hors ligne', () => {
    const { sortie } = avantVol(BON);

    expect(sortie).toContain('non vérifiable hors ligne');
  });
});
