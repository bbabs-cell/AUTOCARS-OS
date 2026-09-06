#!/usr/bin/env node
/**
 * Restauration d'une sauvegarde D1
 * ==================================================================
 * UNE SAUVEGARDE QU'ON N'A JAMAIS RESTAURÉE N'EST PAS UNE SAUVEGARDE.
 * ==================================================================
 * Usage, depuis le dossier workers/ :
 *
 *   node tools/restauration.mjs --list
 *   node tools/restauration.mjs --latest --local
 *   node tools/restauration.mjs autocare-2026-09-06T02-00-00 --local
 *
 * ------------------------------------------------------------------
 * CET OUTIL EXISTE POUR ÊTRE ESSAYÉ, PAS SEULEMENT POUR LES DRAMES
 *
 * Le jour où l'on en a réellement besoin est le pire moment pour
 * découvrir qu'une archive était tronquée, qu'il manque une
 * permission, ou que la commande ne s'appelle pas comme on croyait.
 *
 * Une restauration d'essai devrait être faite tous les trimestres,
 * sur la base locale — jamais sur la production. C'est pourquoi
 * `--remote` exige `--je-sais-ce-que-je-fais`.
 *
 * ------------------------------------------------------------------
 * UN PIÈGE QUE `mysqldump` N'AVAIT PAS
 *
 * L'export de D1 écrit des `CREATE TABLE` SANS `DROP TABLE` devant.
 * Restaurer par-dessus une base qui contient déjà ces tables échoue —
 * vérifié, pas supposé : « UNIQUE constraint failed:
 * d1_migrations.id ».
 *
 * La restauration VIDE donc la base d'abord. C'est aussi ce qui la
 * rend dangereuse, et ce que les garde-fous ci-dessous protègent.
 */

import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const racine = path.resolve(import.meta.dirname, '..');
const options = process.argv.slice(2);
const distant = options.includes('--remote');
const dossier = path.resolve(
  process.env.BACKUP_DIR ?? path.join(racine, 'storage', 'sauvegardes'),
);

function nomDeLaBase() {
  const toml = fs.readFileSync(path.join(racine, 'wrangler.toml'), 'utf8');

  return /database_name\s*=\s*"([^"]+)"/.exec(toml)?.[1] ?? 'autocare';
}

const archives = fs.existsSync(dossier)
  ? fs.readdirSync(dossier).filter((f) => f.endsWith('.sql.gz')).sort()
  : [];

// ------------------------------------------------------------------
// --list : ce qu'on a sous la main
// ------------------------------------------------------------------
if (options.includes('--list') || options.length === 0) {
  console.log('=== Sauvegardes disponibles ===\n');

  if (archives.length === 0) {
    console.log(`  (aucune dans ${dossier})`);
    process.exit(0);
  }

  for (const fichier of archives) {
    const nom = fichier.slice(0, -'.sql.gz'.length);
    const octets = fs.statSync(path.join(dossier, fichier)).size;
    const manifeste = path.join(dossier, `${nom}.json`);

    console.log(
      `  ${nom.padEnd(34)} ${`${Math.round(octets / 1024)} ko`.padStart(8)}`
      + `${fs.existsSync(manifeste) ? '' : '   (SANS EMPREINTE)'}`,
    );
  }

  console.log('\nPour restaurer :  node tools/restauration.mjs --latest --local');
  process.exit(0);
}

// ------------------------------------------------------------------
// Quelle archive ?
// ------------------------------------------------------------------
let nom = null;

if (options.includes('--latest')) {
  nom = archives.at(-1)?.slice(0, -'.sql.gz'.length) ?? null;
} else {
  nom = options.find((o) => !o.startsWith('--'))?.replace(/\.sql\.gz$/, '') ?? null;
}

if (nom === null) {
  console.error('[ERREUR] Aucune archive indiquée. `node tools/restauration.mjs --list`');
  process.exit(1);
}

const archive = path.join(dossier, `${nom}.sql.gz`);
const manifeste = path.join(dossier, `${nom}.json`);

if (!fs.existsSync(archive)) {
  console.error(`[ERREUR] Introuvable : ${archive}`);
  process.exit(1);
}

const base = nomDeLaBase();

console.log(`=== Restauration de ${nom} ===`);
console.log(`    vers « ${base} » (${distant ? 'PRODUCTION' : 'locale'})\n`);

// ------------------------------------------------------------------
// Le garde-fou de production
// ------------------------------------------------------------------
if (distant && !options.includes('--je-sais-ce-que-je-fais')) {
  console.error('[REFUSÉ] --remote vise la base de PRODUCTION.\n');
  console.error('  Restaurer VIDE la base : tout ce qui a été enregistré depuis');
  console.error('  cette sauvegarde disparaît — les dossiers ouverts ce matin,');
  console.error('  les encaissements de la journée.\n');
  console.error('  Si c\'est bien ce que vous voulez, relancez avec :');
  console.error(`      node tools/restauration.mjs ${nom} --remote --je-sais-ce-que-je-fais\n`);
  console.error('  Et faites d\'abord une sauvegarde de l\'état actuel :');
  console.error('      node tools/sauvegarde.mjs --remote');
  process.exit(1);
}

// ------------------------------------------------------------------
// L'EMPREINTE, AVANT DE VIDER QUOI QUE CE SOIT
//
// Une archive abîmée restaurée par-dessus des données vivantes, c'est
// deux pertes au lieu d'une.
// ------------------------------------------------------------------
const compresse = fs.readFileSync(archive);
let tablesAttendues = 0;

if (fs.existsSync(manifeste)) {
  const details = JSON.parse(fs.readFileSync(manifeste, 'utf8'));
  const attendue = String(details.sql_sha256 ?? '');
  const trouvee = createHash('sha256').update(compresse).digest('hex');

  tablesAttendues = Number(details.tables ?? 0);

  if (attendue !== '' && (attendue.length !== trouvee.length
      || !timingSafeEqual(Buffer.from(attendue), Buffer.from(trouvee)))) {
    console.error("[REFUSÉ] L'empreinte ne correspond pas : l'archive est abîmée.");
    console.error(`  attendue : ${attendue}`);
    console.error(`  trouvée  : ${trouvee}\n`);
    console.error('  Une archive abîmée restaurée par-dessus des données vivantes,');
    console.error("  c'est deux pertes au lieu d'une.");
    process.exit(1);
  }

  console.log('  empreinte vérifiée');
} else {
  console.log("  [ATTENTION] Pas d'empreinte pour cette archive : impossible de");
  console.log('              vérifier qu\'elle est complète.');
}

let sql;

try {
  sql = gunzipSync(compresse).toString('utf8');
} catch (e) {
  console.error(`[REFUSÉ] L'archive ne se décompresse pas : ${e.message}`);
  process.exit(1);
}

const dansLArchive = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?[`"]?(\w+)/g)].length;

if (tablesAttendues > 0 && dansLArchive !== tablesAttendues) {
  console.error(
    `[REFUSÉ] L'archive contient ${dansLArchive} tables, le manifeste en annonce `
    + `${tablesAttendues}.`,
  );
  process.exit(1);
}

/**
 * ==================================================================
 * L'EXPORT DE D1 N'EST PAS DIRECTEMENT REJOUABLE.
 * ==================================================================
 * Il écrit les tables dans l'ordre ALPHABÉTIQUE. `payments` arrive
 * donc avant `subscriptions`, qu'elle référence, et la restauration
 * s'arrête sur « no such table: main.subscriptions ».
 *
 * L'en-tête `PRAGMA defer_foreign_keys=TRUE` que Cloudflare place en
 * tête ne suffit pas : il diffère la vérification des LIGNES, pas la
 * résolution des NOMS de tables.
 *
 * Constaté en restaurant pour de vrai — une sauvegarde qu'on n'a
 * jamais restaurée n'est pas une sauvegarde, et c'est exactement le
 * genre de chose qu'on découvre le mauvais jour.
 *
 * On réordonne donc les seuls blocs `CREATE TABLE`, parents avant
 * enfants, et on ne touche à rien d'autre : les index, les
 * déclencheurs et les `INSERT` gardent leur place et leur ordre.
 */
function reordonneLesTables(source) {
  const blocs = [];
  // Un bloc va de « CREATE TABLE » jusqu'à une ligne réduite à « ); ».
  // Les corps de déclencheurs, eux, contiennent des points-virgules :
  // on ne découpe donc PAS le fichier entier en instructions.
  const motif = /CREATE TABLE (?:IF NOT EXISTS )?[`"]?(\w+)[\s\S]*?\n\);/g;

  const jalonne = source.replace(motif, (bloc, nom) => {
    blocs.push({ nom, bloc });

    return `--@@BLOC_${blocs.length - 1}@@`;
  });

  if (blocs.length === 0) {
    return source;
  }

  const noms = new Set(blocs.map((b) => b.nom));
  const parentsDe = new Map(
    blocs.map((b) => [
      b.nom,
      new Set(
        [...b.bloc.matchAll(/REFERENCES\s+[`"]?(\w+)/gi)]
          .map((m) => m[1])
          .filter((n) => n !== b.nom && noms.has(n)),
      ),
    ]),
  );

  const ordonnes = [];
  const poses = new Set();
  const restants = [...blocs];

  while (restants.length > 0) {
    // Ceux dont tous les parents sont déjà créés.
    const prets = restants.filter(
      (b) => [...parentsDe.get(b.nom)].every((p) => poses.has(p)),
    );

    // Un cycle laisserait `prets` vide : on pose alors le reste tel
    // quel plutôt que de boucler sans fin.
    const lot = prets.length > 0 ? prets : [...restants];

    for (const b of lot) {
      ordonnes.push(b.bloc);
      poses.add(b.nom);
      restants.splice(restants.indexOf(b), 1);
    }
  }

  // Les blocs reprennent leur place à l'emplacement du PREMIER
  // d'entre eux ; les autres jalons disparaissent.
  return jalonne
    .replace('--@@BLOC_0@@', ordonnes.join('\n\n'))
    .replace(/^--@@BLOC_\d+@@\n?/gm, '');
}

const cible = distant ? '--remote' : '--local';
const wrangler = (args) =>
  execFileSync('npx', ['wrangler', 'd1', ...args], { cwd: racine, encoding: 'utf8' });

// ------------------------------------------------------------------
// Vider la base
// ------------------------------------------------------------------
const listees = JSON.parse(wrangler([
  'execute', base, cible, '--json',
  '--command',
  "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
]));

const existantes = (listees[0]?.results ?? [])
  // `_cf_METADATA` appartient à D1 lui-même : la supprimer casserait
  // la base au lieu de la nettoyer.
  .filter((r) => r.name !== '_cf_METADATA');

/**
 * ==================================================================
 * L'ORDRE DES SUPPRESSIONS N'EST PAS LIBRE.
 * ==================================================================
 * SQLite refuse de supprimer une table dont une clé étrangère
 * pointe vers une table DÉJÀ supprimée : « no such table:
 * main.organizations ». Vérifié sur D1, pas supposé — la première
 * version de ce script vidait dans l'ordre alphabétique et
 * s'arrêtait là.
 *
 * `PRAGMA defer_foreign_keys` ne suffit pas : il diffère la
 * VÉRIFICATION des lignes, pas la résolution des noms.
 *
 * On supprime donc les enfants avant leurs parents. Le graphe est lu
 * dans le schéma de la base elle-même — `pragma_foreign_key_list`
 * n'est pas autorisée sur D1 — et non recopié dans une liste qu'une
 * table ajoutée rendrait fausse.
 */
function ordreDeSuppression(tables) {
  const noms = new Set(tables.map((t) => t.name));
  const parents = new Map();

  for (const t of tables) {
    const cites = [...String(t.sql ?? '').matchAll(/REFERENCES\s+[`"]?(\w+)/gi)]
      .map((m) => m[1])
      // Une table qui se référence elle-même — `loyalty_entries` et
      // son écriture inverse — ne s'attend pas elle-même.
      .filter((n) => n !== t.name && noms.has(n));

    parents.set(t.name, new Set(cites));
  }

  const ordre = [];
  const restants = new Set(noms);

  while (restants.size > 0) {
    // Les tables que plus personne ne référence : ce sont les
    // feuilles, elles partent en premier.
    const feuilles = [...restants].filter(
      (n) => ![...restants].some((autre) => autre !== n && parents.get(autre).has(n)),
    );

    // Un cycle rendrait `feuilles` vide. Il n'y en a pas dans ce
    // schéma, mais on préfère supprimer dans un ordre imparfait que
    // boucler sans fin.
    const lot = feuilles.length > 0 ? feuilles : [...restants];

    for (const n of lot) {
      ordre.push(n);
      restants.delete(n);
    }
  }

  return ordre;
}

if (existantes.length > 0) {
  const vidage = path.join(os.tmpdir(), `autocare-vidage-${Date.now()}.sql`);

  fs.writeFileSync(
    vidage,
    ordreDeSuppression(existantes).map((t) => `DROP TABLE IF EXISTS "${t}";`).join('\n'),
  );

  try {
    wrangler(['execute', base, cible, '--file', vidage, '--yes']);
    console.log(`  base vidée (${existantes.length} tables)`);
  } finally {
    fs.rmSync(vidage, { force: true });
  }
}

// ------------------------------------------------------------------
// La restauration
// ------------------------------------------------------------------
const fichier = path.join(os.tmpdir(), `autocare-restauration-${Date.now()}.sql`);

fs.writeFileSync(fichier, reordonneLesTables(sql));

try {
  wrangler(['execute', base, cible, '--file', fichier, '--yes']);
  console.log('  base restaurée');
} catch (e) {
  console.error(`\n[ERREUR] La restauration a échoué : ${e.message}`);
  console.error('\n  LA BASE EST VIDE OU INCOMPLÈTE. Relancez la restauration,');
  console.error('  ou réappliquez les migrations :');
  console.error(`      npx wrangler d1 migrations apply ${base} ${cible}`);
  process.exit(1);
} finally {
  fs.rmSync(fichier, { force: true });
}

// ------------------------------------------------------------------
// LA VÉRIFICATION D'APRÈS — sans elle, on ne sait pas si ça a marché
// ------------------------------------------------------------------
const compte = (requete) => {
  const r = JSON.parse(wrangler(['execute', base, cible, '--json', '--command', requete]));

  return Number(Object.values(r[0]?.results?.[0] ?? { n: 0 })[0] ?? 0);
};

const tables = compte(
  "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
);
const organisations = compte('SELECT COUNT(*) AS n FROM organizations');
const operations = compte('SELECT COUNT(*) AS n FROM operations');

console.log(`\n  ${tables} tables, ${organisations} entreprise(s), ${operations} dossier(s)`);

if (tables < 20) {
  console.error("\n[ATTENTION] Moins de tables qu'attendu : vérifiez l'archive.");
  process.exit(1);
}

console.log('\nRestauration terminée.');
