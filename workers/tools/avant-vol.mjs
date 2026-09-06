#!/usr/bin/env node
/**
 * Contrôle avant mise en production
 * ==================================================================
 * « EST-CE QU'ON A PENSÉ À TOUT ? » DEVIENT UNE COMMANDE.
 * ==================================================================
 * Usage, depuis le dossier workers/ :
 *
 *   node tools/avant-vol.mjs            contrôles hors ligne
 *   node tools/avant-vol.mjs --remote   avec la base de production
 *
 * Il sort en erreur si un point BLOQUANT n'est pas satisfait : à
 * placer dans le script de déploiement, pour que la mise en ligne
 * s'arrête plutôt que de partir avec un secret d'exemple.
 *
 * ------------------------------------------------------------------
 * POURQUOI CET OUTIL PLUTÔT QU'UNE LISTE DANS LA DOCUMENTATION
 *
 * Une liste se lit la première fois, puis on la connaît par cœur — et
 * c'est précisément à ce moment qu'on saute une ligne. Les points
 * vérifiés ici sont ceux qu'on oublie en étant pressé, et dont
 * l'oubli ne se voit pas tout de suite :
 *
 *   - un `database_id` resté à sa valeur d'exemple fait échouer le
 *     déploiement au premier appel, pas au déploiement ;
 *   - la clé de signature laissée dans un fichier suivi par Git
 *     laisse fabriquer de faux jetons à qui a lu le dépôt ;
 *   - le jeu de démonstration oublié en base met « Diallo Auto »
 *     dans les données d'un vrai client.
 *
 * Aucun de ces trois-là ne fait planter quoi que ce soit. C'est ce
 * qui les rend dangereux.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const racine = path.resolve(import.meta.dirname, '..');
const avecLaBase = process.argv.includes('--remote');
const resultats = [];

/**
 * CHAQUE CONTRÔLE S'AFFICHE, RÉUSSI OU NON.
 *
 * Un outil qui ne montre que les problèmes laisse croire qu'il n'a
 * rien vérifié quand tout va bien.
 */
function controle(niveau, libelle, ok, detail = '') {
  resultats.push({ niveau, libelle, ok, detail });

  const marque = ok ? '  ok  ' : (niveau === 'BLOQUANT' ? ' STOP ' : ' !!!  ');

  console.log(`[${marque}] ${libelle}${!ok && detail !== '' ? ` — ${detail}` : ''}`);
}

const bloquant = (l, ok, d = '') => controle('BLOQUANT', l, ok, d);
const avertir = (l, ok, d = '') => controle('AVERTIR', l, ok, d);

const toml = fs.readFileSync(path.join(racine, 'wrangler.toml'), 'utf8');
const lis = (cle) => new RegExp(`${cle}\\s*=\\s*"([^"]*)"`).exec(toml)?.[1] ?? '';

console.log('=== Contrôle avant vol — AUTOCARE OS sur Workers ===\n');
console.log('--- Configuration ---');

// ------------------------------------------------------------------
// La base
// ------------------------------------------------------------------
const identifiant = lis('database_id');

bloquant(
  'database_id est renseigné',
  identifiant !== '' && !identifiant.startsWith('a-remplacer'),
  identifiant === '' ? 'absent' : identifiant,
);

bloquant('database_name est renseigné', lis('database_name') !== '');

// ------------------------------------------------------------------
// Les secrets
// ------------------------------------------------------------------
// UN SECRET DANS wrangler.toml EST UN SECRET PUBLIC : ce fichier est
// suivi par Git. C'est le contrôle le plus important de cette liste,
// parce que rien ne le signale au moment de l'erreur.
bloquant(
  "JWT_SECRET n'est pas dans wrangler.toml",
  !/^\s*JWT_SECRET\s*=/m.test(toml),
  'un secret dans un fichier suivi par Git est un secret public',
);

for (const cle of ['MAIL_TOKEN', 'MAIL_ENDPOINT']) {
  bloquant(`${cle} n'est pas dans wrangler.toml`, !new RegExp(`^\\s*${cle}\\s*=`, 'm').test(toml));
}

// APP_ENV décide de l'attribut Secure du cookie de session. Resté à
// « local », le cookie de rafraîchissement voyage en clair.
avertir(
  'APP_ENV vaut « production »',
  lis('APP_ENV') === 'production',
  `vaut « ${lis('APP_ENV')} » — le cookie de session perdrait son attribut Secure`,
);

const frontend = lis('APP_FRONTEND_URL');

avertir(
  'APP_FRONTEND_URL est en HTTPS',
  frontend.startsWith('https://'),
  frontend === '' ? 'absente : le lien de réinitialisation sera incomplet' : frontend,
);

// L'ENVOI DE COURRIEL NE SE VÉRIFIE PAS HORS LIGNE.
//
// MAIL_ENDPOINT et MAIL_TOKEN sont des secrets Wrangler : ils ne sont
// ni dans wrangler.toml, ni dans l'environnement de cette machine.
// La présence d'un `.dev.vars` ne prouve rien — c'est un fichier de
// développement.
//
// Un contrôle qui répondrait « ok » sur cette base donnerait une
// fausse assurance, ce qui est pire que pas de contrôle du tout. On
// le pose donc seulement avec --remote, où `wrangler secret list`
// peut répondre.
if (avecLaBase) {
  let secrets = '';

  try {
    secrets = execFileSync('npx', ['wrangler', 'secret', 'list'], {
      cwd: racine, encoding: 'utf8',
    });
  } catch {
    secrets = '';
  }

  avertir(
    'un service d’envoi de courriel est configuré',
    secrets.includes('MAIL_ENDPOINT') && secrets.includes('MAIL_TOKEN'),
    'sans lui, les liens de réinitialisation partent dans les traces du Worker',
  );
} else {
  console.log('[ passé ] envoi de courriel : non vérifiable hors ligne (--remote)');
}

// ------------------------------------------------------------------
// Le dépôt
// ------------------------------------------------------------------
console.log('\n--- Dépôt ---');

let suivis = '';

try {
  // `stderr: 'ignore'` : hors d'un dépôt Git, la commande écrit
  // « not a git repository » sur la sortie d'erreur avant d'échouer.
  // Ce n'est pas un problème à signaler, c'est un cas prévu.
  suivis = execFileSync('git', ['ls-files'], {
    cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
} catch {
  suivis = '';
}

bloquant(
  ".dev.vars n'est pas suivi par Git",
  !/^\.dev\.vars$/m.test(suivis),
  'il contient le secret de signature',
);

bloquant(
  "aucune sauvegarde n'est suivie par Git",
  !/\.sql\.gz$/m.test(suivis),
  'une archive, c’est toute la base en clair',
);

// ------------------------------------------------------------------
// Les migrations
// ------------------------------------------------------------------
console.log('\n--- Migrations ---');

const migrations = fs.readdirSync(path.join(racine, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();

bloquant('les migrations sont présentes', migrations.length > 0, `${migrations.length} fichier(s)`);

// ------------------------------------------------------------------
// Les sauvegardes
// ------------------------------------------------------------------
console.log('\n--- Sauvegardes ---');

const dossier = path.resolve(
  process.env.BACKUP_DIR ?? path.join(racine, 'storage', 'sauvegardes'),
);

const archives = fs.existsSync(dossier)
  ? fs.readdirSync(dossier).filter((f) => f.endsWith('.sql.gz'))
  : [];

avertir('un dossier de sauvegarde existe', fs.existsSync(dossier), dossier);

if (archives.length > 0) {
  const recente = Math.max(
    ...archives.map((f) => fs.statSync(path.join(dossier, f)).mtimeMs),
  );
  const heures = (Date.now() - recente) / 3_600_000;

  avertir(
    'une sauvegarde date de moins de 48 heures',
    heures < 48,
    `dernière : il y a ${Math.round(heures)} h`,
  );
} else {
  avertir('une sauvegarde existe', false, 'aucune archive');
}

// ------------------------------------------------------------------
// La base, si on la demande
// ------------------------------------------------------------------
if (avecLaBase) {
  console.log('\n--- Base de production ---');

  const interroge = (requete) => {
    const brut = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', lis('database_name'), '--remote', '--json',
        '--command', requete],
      { cwd: racine, encoding: 'utf8' },
    );

    return JSON.parse(brut)[0]?.results ?? [];
  };

  try {
    const tables = interroge(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );

    bloquant('la base répond', true);
    bloquant('les 21 tables sont là', Number(tables[0]?.n ?? 0) >= 21, `${tables[0]?.n} tables`);

    // LE JEU DE DÉMONSTRATION EN PRODUCTION met « Diallo Auto » dans
    // les données d'un vrai client. Il ne fait rien planter : c'est ce
    // qui le rend facile à oublier.
    const demo = interroge(
      "SELECT COUNT(*) AS n FROM organizations WHERE slug IN ('diallo', 'concurrent')",
    );

    bloquant(
      'le jeu de démonstration n’est pas en base',
      Number(demo[0]?.n ?? 0) === 0,
      `${demo[0]?.n} entreprise(s) de démonstration`,
    );

    // Un mot de passe qui ne commence pas par « pbkdf2$ » n'a pas été
    // haché par ce produit.
    const clair = interroge(
      "SELECT COUNT(*) AS n FROM users WHERE password_hash NOT LIKE 'pbkdf2$%'",
    );

    bloquant(
      'aucun mot de passe non haché',
      Number(clair[0]?.n ?? 0) === 0,
      `${clair[0]?.n} compte(s)`,
    );
  } catch (e) {
    bloquant('la base répond', false, e.message.split('\n')[0]);
  }
} else {
  console.log('\n--- Base de production ---');
  console.log('[ passé ] non interrogée (ajoutez --remote)');
}

// ------------------------------------------------------------------
// Le verdict
// ------------------------------------------------------------------
const bloquants = resultats.filter((r) => r.niveau === 'BLOQUANT' && !r.ok);
const avertissements = resultats.filter((r) => r.niveau === 'AVERTIR' && !r.ok);

console.log(`\n${'='.repeat(62)}`);

if (bloquants.length > 0) {
  console.log(`\n${bloquants.length} point(s) BLOQUANT(S) — ne déployez pas :\n`);

  for (const r of bloquants) {
    console.log(`  · ${r.libelle}${r.detail === '' ? '' : ` (${r.detail})`}`);
  }
}

if (avertissements.length > 0) {
  console.log(`\n${avertissements.length} avertissement(s) — à regarder :\n`);

  for (const r of avertissements) {
    console.log(`  · ${r.libelle}${r.detail === '' ? '' : ` (${r.detail})`}`);
  }
}

if (bloquants.length === 0 && avertissements.length === 0) {
  console.log('\nTout est en ordre.');
}

process.exit(bloquants.length > 0 ? 1 : 0);
