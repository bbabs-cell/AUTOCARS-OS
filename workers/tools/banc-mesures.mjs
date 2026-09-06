#!/usr/bin/env node
/**
 * Le banc de mesure
 * ==================================================================
 * Usage, depuis le dossier workers/ :
 *
 *   node tools/banc-donnees.mjs 30000     # d'abord, le volume
 *   node tools/banc-mesures.mjs           # puis la pesée
 *   node tools/banc-mesures.mjs --plans   # avec les plans d'exécution
 *
 * ------------------------------------------------------------------
 * ON MESURE LES REQUÊTES, PAS LES ROUTES
 *
 * L'équivalent PHP appelait l'API en HTTP et chronométrait la
 * réponse. Ici cela mesurerait surtout le démarrage de `wrangler` —
 * une seconde de bruit pour trois millisecondes de signal.
 *
 * On interroge donc la base directement, avec les requêtes que les
 * contrôleurs exécutent réellement, et on lit la durée que D1
 * rapporte lui-même. C'est la même grandeur que celle qu'un index
 * fait bouger.
 *
 * ------------------------------------------------------------------
 * LA MÉDIANE, PAS LA MOYENNE
 *
 * Le premier appel paie le chargement des pages de la base ; une
 * moyenne sur cinq passages en garde la trace et fait paraître une
 * requête deux fois plus lente qu'elle ne l'est. La médiane écarte
 * cet appel-là comme elle écarterait un ralentissement isolé.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const racine = path.resolve(import.meta.dirname, '..');
const avecPlans = process.argv.includes('--plans');
const PASSAGES = 5;

const base = /database_name\s*=\s*"([^"]+)"/
  .exec(fs.readFileSync(path.join(racine, 'wrangler.toml'), 'utf8'))?.[1] ?? 'autocare';

const ACTIFS = "'WAITING','IN_PROGRESS','INSPECTION','WASHING','QUALITY_CHECK','READY'";
const JOUR = (n) => `datetime('now', '-${n} days')`;

/**
 * Les requêtes des écrans les plus ouverts, recopiées des
 * contrôleurs. Quand l'une d'elles change là-bas, la mesure d'ici
 * cesse de vouloir dire quelque chose — c'est pour cela que chacune
 * porte le nom de son écran.
 */
const REQUETES = [
  ['File d’attente (toutes stations)',
    `SELECT o.id, o.priority FROM operations o
      WHERE o.organization_id = 1 AND o.status IN (${ACTIFS})
      ORDER BY o.priority DESC, o.created_at ASC LIMIT 100`],

  ['File d’attente (une station)',
    `SELECT o.id FROM operations o
      WHERE o.organization_id = 1 AND o.status IN (${ACTIFS}) AND o.station_id = 1
      ORDER BY o.priority DESC, o.created_at ASC LIMIT 100`],

  ['Tableau de bord — la journée',
    `SELECT COUNT(*) AS n FROM operations
      WHERE organization_id = 1 AND updated_at >= date('now')`],

  ['Tableau de bord — la recette du jour',
    `SELECT COALESCE(SUM(amount), 0) AS total FROM payments
      WHERE organization_id = 1 AND status = 'PAID' AND paid_at >= date('now')`],

  ['Journal des recettes — 90 jours',
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM payments
      WHERE organization_id = 1 AND status = 'PAID' AND paid_at >= ${JOUR(90)}`],

  ['Statistiques — valeur livrée sur 90 jours',
    `SELECT COUNT(*) AS n, COALESCE(SUM(price), 0) AS valeur FROM operations
      WHERE organization_id = 1 AND status = 'COMPLETED' AND released_at >= ${JOUR(90)}`],

  ['Statistiques — par prestation sur 1 an',
    `SELECT s.name, COUNT(*) AS n, COALESCE(SUM(o.price), 0) AS valeur
       FROM operations o JOIN services s ON s.id = o.service_id
      WHERE o.organization_id = 1 AND o.status <> 'CANCELLED' AND o.created_at >= ${JOUR(365)}
      GROUP BY o.service_id, s.name`],

  ['Statistiques — clients qui reviennent, 1 an',
    `SELECT COALESCE(SUM(CASE WHEN dedans > 0 THEN 1 ELSE 0 END), 0) AS total,
            COALESCE(SUM(CASE WHEN dedans > 0 AND avant > 0 THEN 1 ELSE 0 END), 0) AS revenus
       FROM (SELECT o.customer_id,
                    SUM(CASE WHEN o.created_at >= ${JOUR(365)} THEN 1 ELSE 0 END) AS dedans,
                    SUM(CASE WHEN o.created_at < ${JOUR(365)} THEN 1 ELSE 0 END) AS avant
               FROM operations o
              WHERE o.organization_id = 1 AND o.status <> 'CANCELLED'
              GROUP BY o.customer_id)`],

  ['Statistiques — par heure sur 1 an',
    `SELECT CAST(strftime('%H', o.created_at) AS INTEGER) AS h, COUNT(*) AS n
       FROM operations o
      WHERE o.organization_id = 1 AND o.status <> 'CANCELLED' AND o.created_at >= ${JOUR(365)}
      GROUP BY h`],

  ['Recherche par plaque',
    `SELECT v.id FROM vehicles v JOIN customers c ON c.id = v.customer_id
      WHERE v.organization_id = 1 AND v.plate_number LIKE 'DK0042%' LIMIT 200`],

  ['Fiche véhicule — historique',
    `SELECT o.id, o.reference FROM operations o
      WHERE o.organization_id = 1 AND o.vehicle_id = 42
      ORDER BY o.created_at DESC LIMIT 50`],
];

function execute(sql, json = true) {
  const brut = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', base, '--local', ...(json ? ['--json'] : []),
      '--command', sql],
    { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );

  return json ? JSON.parse(brut) : brut;
}

const volume = execute('SELECT COUNT(*) AS n FROM operations')[0].results[0].n;

console.log('=== Banc de mesure — AUTOCARE OS sur D1 ===\n');
console.log(`  ${Number(volume).toLocaleString('fr-FR')} dossiers en base`);
console.log(`  médiane de ${PASSAGES} passages, durée rapportée par D1\n`);

const mesures = [];

for (const [nom, sql] of REQUETES) {
  const durees = [];

  for (let i = 0; i < PASSAGES; i += 1) {
    durees.push(Number(execute(sql)[0]?.meta?.duration ?? 0));
  }

  durees.sort((a, b) => a - b);

  const mediane = durees[Math.floor(durees.length / 2)];

  mesures.push({ nom, sql, mediane });

  console.log(`  ${`${mediane} ms`.padStart(8)}   ${nom}`);
}

if (avecPlans) {
  console.log(`\n${'='.repeat(62)}`);
  console.log('\nLES PLANS D’EXÉCUTION\n');
  console.log('« SCAN » = la table est parcourue en entier.');
  console.log('« SEARCH … USING INDEX » = un index a été utilisé.\n');

  for (const { nom, sql } of mesures) {
    console.log(`  ${nom}`);

    const plan = execute(`EXPLAIN QUERY PLAN ${sql}`);

    for (const ligne of plan[0]?.results ?? []) {
      console.log(`      ${ligne.detail}`);
    }

    console.log('');
  }
}

const lentes = mesures.filter((m) => m.mediane >= 10);

console.log(`\n${'='.repeat(62)}`);

if (lentes.length === 0) {
  console.log('\nAucune requête au-dessus de 10 ms.');
} else {
  console.log(`\n${lentes.length} requête(s) au-dessus de 10 ms :\n`);

  for (const m of lentes) {
    console.log(`  · ${m.nom} — ${m.mediane} ms`);
  }

  console.log('\n  `node tools/banc-mesures.mjs --plans` pour voir pourquoi.');
}
