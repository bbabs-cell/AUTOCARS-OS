#!/usr/bin/env node
/**
 * Sauvegarde de la base D1
 * ==================================================================
 * Usage, depuis le dossier workers/ :
 *
 *   node tools/sauvegarde.mjs --local     la base de développement
 *   node tools/sauvegarde.mjs --remote    la base de production
 *
 * À placer dans une tâche planifiée. Exemple, toutes les nuits à 2 h :
 *
 *   0 2 * * * cd /chemin/workers && node tools/sauvegarde.mjs --remote
 *
 * ------------------------------------------------------------------
 * POURQUOI CET OUTIL, ALORS QUE D1 A « TIME TRAVEL » ?
 *
 * D1 sait revenir en arrière jusqu'à trente jours, à la seconde près,
 * sans qu'on ait rien à faire. C'est meilleur que ce script pour le
 * cas courant : une table effacée par erreur ce matin.
 *
 * Il ne couvre pas le cas qui fait perdre une entreprise : le compte
 * Cloudflare lui-même. Suspendu, fermé, facture impayée, identifiants
 * perdus — et Time Travel disparaît avec la base qu'il protège.
 *
 * CE SCRIPT EXISTE POUR SORTIR LES DONNÉES DE CHEZ CLOUDFLARE. C'est
 * sa seule raison d'être, et c'est pour cela que son archive doit
 * finir ailleurs (voir deploy/backup-offsite.sh).
 *
 * ------------------------------------------------------------------
 * UNE EMPREINTE ACCOMPAGNE CHAQUE ARCHIVE
 *
 * Une sauvegarde silencieusement tronquée — disque plein, connexion
 * coupée — ressemble à une bonne sauvegarde jusqu'au jour où on en a
 * besoin. L'empreinte permet à la restauration de refuser une archive
 * abîmée AVANT d'écraser quoi que ce soit.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const racine = path.resolve(import.meta.dirname, '..');
const options = process.argv.slice(2);
const distant = options.includes('--remote');
const dossier = path.resolve(
  process.env.BACKUP_DIR ?? path.join(racine, 'storage', 'sauvegardes'),
);
const conserver = Math.max(1, Number.parseInt(process.env.BACKUP_KEEP ?? '14', 10) || 14);

/** Le nom de la base, lu dans wrangler.toml — jamais recopié ici. */
function nomDeLaBase() {
  const toml = fs.readFileSync(path.join(racine, 'wrangler.toml'), 'utf8');
  const trouve = /database_name\s*=\s*"([^"]+)"/.exec(toml);

  if (trouve === null) {
    console.error('[ERREUR] Pas de database_name dans wrangler.toml.');
    process.exit(1);
  }

  return trouve[1];
}

/**
 * UNE ARCHIVE COMMITÉE PAR ERREUR, C'EST TOUTE LA BASE SUR GITHUB.
 *
 * L'équivalent PHP refusait d'écrire dans le dossier exposé au web.
 * Ici le danger n'est pas le web, c'est Git : une sauvegarde déposée
 * dans le dépôt part au premier `git add -A`. On refuse donc tant que
 * le chemin n'est pas ignoré.
 */
function refuseSiSuiviParGit(cible) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: racine, stdio: 'ignore',
    });
  } catch {
    return; // Pas de dépôt Git : rien à craindre de ce côté.
  }

  const dansLeDepot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: racine, encoding: 'utf8',
  }).trim();

  if (!cible.startsWith(dansLeDepot + path.sep)) {
    return; // Hors du dépôt : très bien.
  }

  const temoin = path.join(cible, 'temoin.sql.gz');
  let ignore = false;

  try {
    execFileSync('git', ['check-ignore', '-q', temoin], { cwd: racine, stdio: 'ignore' });
    ignore = true;
  } catch {
    ignore = false;
  }

  if (!ignore) {
    console.error(
      `[REFUSÉ] ${cible} est dans le dépôt Git et n'est pas ignoré.\n\n`
      + '  Une archive de sauvegarde, c\'est TOUTE la base en clair :\n'
      + '  clients, chiffre d\'affaires, empreintes de mots de passe.\n'
      + '  Un seul `git add -A` la publierait.\n\n'
      + `  Ajoutez la ligne suivante à .gitignore, ou choisissez un\n`
      + '  BACKUP_DIR hors du dépôt :\n\n'
      + `      ${path.relative(dansLeDepot, cible)}/\n`,
    );
    process.exit(1);
  }
}

// ------------------------------------------------------------------

const base = nomDeLaBase();
const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const nom = `autocare-${horodatage}`;

fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
refuseSiSuiviParGit(dossier);

console.log(`=== Sauvegarde AUTOCARE OS — ${horodatage} ===`);
console.log(`    base « ${base} » (${distant ? 'production' : 'locale'})\n`);

const brut = path.join(dossier, `${nom}.sql`);

try {
  execFileSync(
    'npx',
    [
      'wrangler', 'd1', 'export', base,
      distant ? '--remote' : '--local',
      '--output', brut,
      '--skip-confirmation',
    ],
    { cwd: racine, stdio: 'inherit' },
  );
} catch (e) {
  fs.rmSync(brut, { force: true });
  console.error(`\n[ERREUR] L'export D1 a échoué : ${e.message}`);
  process.exit(1);
}

const sql = fs.readFileSync(brut);

// UNE ARCHIVE MINUSCULE EST LE SIGNE QUI NE TROMPE PAS : l'export a
// pu se terminer « sans erreur » en n'écrivant qu'un en-tête.
if (sql.length < 1024) {
  fs.rmSync(brut, { force: true });
  console.error(`\n[ERREUR] L'export fait ${sql.length} octets : la sauvegarde a échoué.`);
  process.exit(1);
}

// La liste des tables attendues sert de second contrôle : un export
// vidé de son contenu passerait le test de taille si le schéma est
// long.
const tables = [...sql.toString('utf8').matchAll(/CREATE TABLE (?:IF NOT EXISTS )?[`"]?(\w+)/g)]
  .map((m) => m[1]);

if (tables.length < 20) {
  fs.rmSync(brut, { force: true });
  console.error(
    `\n[ERREUR] L'export ne contient que ${tables.length} table(s), 21 attendues.`,
  );
  process.exit(1);
}

const compresse = gzipSync(sql, { level: 9 });
const archive = path.join(dossier, `${nom}.sql.gz`);

fs.writeFileSync(archive, compresse, { mode: 0o600 });
fs.rmSync(brut, { force: true });

const empreinte = createHash('sha256').update(compresse).digest('hex');

fs.writeFileSync(
  path.join(dossier, `${nom}.json`),
  `${JSON.stringify({
    created_at: new Date().toISOString(),
    database: base,
    source: distant ? 'remote' : 'local',
    sql: `${nom}.sql.gz`,
    sql_sha256: empreinte,
    sql_bytes: compresse.length,
    // Le nombre de tables est relu à la restauration : c'est ce qui
    // permet de dire « cette archive est incomplète » plutôt que de
    // la restaurer et de le découvrir après.
    tables: tables.length,
  }, null, 2)}\n`,
  { mode: 0o600 },
);

const taille = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.round(n / 1024)} ko`);

console.log(`\n  archive  ${nom}.sql.gz  (${taille(compresse.length)}, ${tables.length} tables)`);
console.log(`  empreinte ${empreinte.slice(0, 16)}…`);

// ------------------------------------------------------------------
// La rétention
// ------------------------------------------------------------------
const archives = fs.readdirSync(dossier)
  .filter((f) => f.startsWith('autocare-') && f.endsWith('.sql.gz'))
  .sort();

for (const vieille of archives.slice(0, Math.max(0, archives.length - conserver))) {
  const racineNom = vieille.slice(0, -'.sql.gz'.length);

  for (const f of [`${racineNom}.sql.gz`, `${racineNom}.json`]) {
    fs.rmSync(path.join(dossier, f), { force: true });
  }

  console.log(`  retirée  ${racineNom} (au-delà des ${conserver} conservées)`);
}

const restantes = fs.readdirSync(dossier).filter((f) => f.endsWith('.sql.gz')).length;

console.log(`\nTerminé. ${restantes} sauvegarde(s) dans ${dossier}`);
console.log('\nRAPPEL : une sauvegarde qui reste chez Cloudflare ne protège pas');
console.log('         d\'un compte perdu. Copiez-la ailleurs (deploy/backup-offsite.sh).');
