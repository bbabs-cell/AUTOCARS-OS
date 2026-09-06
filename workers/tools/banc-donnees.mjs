#!/usr/bin/env node
/**
 * Le jeu de mesure : de quoi peser les requêtes
 * ==================================================================
 * Usage, depuis le dossier workers/ :
 *
 *   node tools/banc-donnees.mjs            30 000 dossiers (défaut)
 *   node tools/banc-donnees.mjs 76041      le volume du lot 20
 *
 * ------------------------------------------------------------------
 * POURQUOI CE VOLUME
 *
 * Une entreprise de trois stations qui traite 70 véhicules par jour
 * atteint ce nombre en trois ans. C'est le volume auquel un index
 * commence à compter — en dessous, SQLite lit la table entière plus
 * vite qu'il ne consulterait un index, et toute mesure conclurait
 * « rien à faire », à tort.
 *
 * ------------------------------------------------------------------
 * IL S'ÉCRIT DANS LA BASE LOCALE, JAMAIS EN PRODUCTION
 *
 * Il n'y a pas de drapeau `--remote` : ce script n'a aucune raison
 * d'exister ailleurs que sur une machine de développement, et une
 * faute de frappe qui déverserait 76 000 faux dossiers chez un client
 * ne se rattrape pas.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const racine = path.resolve(import.meta.dirname, '..');
const combien = Math.max(1000, Number.parseInt(process.argv[2] ?? '30000', 10) || 30_000);

const base = /database_name\s*=\s*"([^"]+)"/
  .exec(fs.readFileSync(path.join(racine, 'wrangler.toml'), 'utf8'))?.[1] ?? 'autocare';

// Des proportions tirées de ce que fait une station réelle, et non
// d'une distribution uniforme : la moitié des dossiers sont restitués
// et payés, une petite part annulée, le reste en cours.
const CLIENTS = Math.round(combien / 12);
const VEHICULES = Math.round(combien / 10);
const JOURS = 1095;

const MARQUES = [
  ['Toyota', 'Corolla'], ['Renault', 'Duster'], ['Hyundai', 'Tucson'],
  ['Peugeot', '208'], ['Nissan', 'Qashqai'], ['Kia', 'Sportage'],
  ['Mercedes', 'Classe C'], ['Ford', 'Ranger'],
];

const PRENOMS = ['Aminata', 'Moussa', 'Fatou', 'Ibrahima', 'Awa', 'Cheikh', 'Mariama', 'Ousmane'];
const NOMS = ['Diallo', 'Ndiaye', 'Sow', 'Fall', 'Ba', 'Sarr', 'Diop', 'Gueye'];

let graine = 20260906;

/** Un générateur reproductible : deux mesures doivent porter sur les mêmes données. */
function alea() {
  graine = (graine * 1103515245 + 12345) & 0x7fffffff;

  return graine / 0x7fffffff;
}

const parmi = (liste) => liste[Math.floor(alea() * liste.length)];

const jourAvant = (n) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

console.log(`=== Jeu de mesure — ${combien.toLocaleString('fr-FR')} dossiers ===\n`);

const lignes = [];

// Deux entreprises, TOUJOURS : mesurer le cloisonnement sur une base
// mono-client ne prouverait rien — un index sur organization_id
// paraîtrait inutile s'il n'y avait qu'une valeur.
// L'ORDRE DE VIDAGE N'EST PAS LIBRE : D1 applique les clés
// étrangères. On part des feuilles pour remonter vers les racines —
// la même liste que le jeu d'essai des tests, pour la même raison.
const ORDRE_VIDAGE = [
  'inspection_photos', 'inspections', 'payments',
  'bookings', 'loyalty_entries', 'operations',
  'loyalty_programs', 'subscriptions', 'subscription_plans',
  'time_entries', 'cash_sessions', 'audit_logs',
  'refresh_tokens', 'password_resets', 'services',
  'vehicles', 'customers', 'station_users', 'stations', 'users', 'organizations',
];

lignes.push(
  ORDRE_VIDAGE.map((t) => `DELETE FROM ${t};`).join('\n'),
  "INSERT INTO organizations (id, name, slug) VALUES (1, 'Banc dEssai', 'banc'), (2, 'Voisin', 'voisin');",
  "INSERT INTO users (id, organization_id, first_name, last_name, email, password_hash) VALUES"
  + " (1, 1, 'Mesure', 'Un', 'un@banc.sn', 'pbkdf2$600000$x$y'),"
  + " (2, 1, 'Mesure', 'Deux', 'deux@banc.sn', 'pbkdf2$600000$x$y'),"
  + " (3, 2, 'Voisin', 'Trois', 'trois@voisin.sn', 'pbkdf2$600000$x$y');",
  "INSERT INTO stations (id, organization_id, name, code) VALUES"
  + " (1, 1, 'Plateau', 'PLT'), (2, 1, 'Thies', 'THS'), (3, 1, 'Mbour', 'MBR'), (4, 2, 'Voisin', 'VSN');",
  "INSERT INTO station_users (organization_id, station_id, user_id, role) VALUES"
  + " (1, 1, 1, 'ADMIN'), (1, 2, 1, 'ADMIN'), (1, 3, 1, 'ADMIN'),"
  + " (1, 1, 2, 'EMPLOYEE'), (2, 4, 3, 'ADMIN');",
  "INSERT INTO services (id, organization_id, name, category, price, duration_minutes) VALUES"
  + " (1, 1, 'Lavage simple', 'LAVAGE', 3000, 20),"
  + " (2, 1, 'Lavage complet', 'LAVAGE', 5000, 45),"
  + " (3, 1, 'Interieur', 'LAVAGE', 8000, 90),"
  + " (4, 1, 'Integral', 'LAVAGE', 15000, 150),"
  + " (5, 2, 'Lavage voisin', 'LAVAGE', 4000, 30);",
);

const valeurs = [];

for (let i = 1; i <= CLIENTS; i += 1) {
  valeurs.push(
    `(${i}, 1, '${parmi(PRENOMS)}', '${parmi(NOMS)}', '+2217${String(i).padStart(8, '0')}')`,
  );
}

/**
 * SQLite refuse une instruction de plus d'un mégaoctet
 * (« statement too long »). On écrit donc par paquets — constaté en
 * essayant d'insérer 3 000 véhicules d'un coup.
 */
const PAQUET = 500;

function parPaquets(entete, toutes) {
  for (let i = 0; i < toutes.length; i += PAQUET) {
    lignes.push(`${entete} VALUES\n${toutes.slice(i, i + PAQUET).join(',\n')};`);
  }
}

parPaquets(
  'INSERT INTO customers (id, organization_id, first_name, last_name, phone)',
  [...valeurs],
);

valeurs.length = 0;

for (let i = 1; i <= VEHICULES; i += 1) {
  const [marque, modele] = parmi(MARQUES);
  const client = 1 + Math.floor(alea() * CLIENTS);

  valeurs.push(
    `(${i}, 1, ${client}, 'DK${String(i).padStart(4, '0')}AA', '${marque}', '${modele}', 'CAR')`,
  );
}

parPaquets(
  'INSERT INTO vehicles (id, organization_id, customer_id, plate_number, brand, model,'
  + ' vehicle_type)',
  [...valeurs],
);

const PRIX = { 1: 3000, 2: 5000, 3: 8000, 4: 15_000 };
let paiements = [];
let numeroPaiement = 0;

for (let debut = 1; debut <= combien; debut += 5000) {
  valeurs.length = 0;

  for (let i = debut; i < debut + 5000 && i <= combien; i += 1) {
    const service = 1 + Math.floor(alea() * 4);
    const station = 1 + Math.floor(alea() * 3);
    const vehicule = 1 + Math.floor(alea() * VEHICULES);
    const client = 1 + Math.floor(alea() * CLIENTS);
    const age = Math.floor(alea() * JOURS);
    const cree = jourAvant(age);
    const tirage = alea();

    // 80 % restitués, 5 % annulés, 15 % encore dans la station : la
    // proportion d'une entreprise qui tourne depuis trois ans.
    const statut = tirage < 0.8 ? 'COMPLETED' : tirage < 0.85 ? 'CANCELLED' : 'WAITING';
    const rendu = statut === 'COMPLETED' ? `'${jourAvant(age)}'` : 'NULL';
    const prix = PRIX[service];

    valeurs.push(
      `(${i}, 1, ${station}, ${vehicule}, ${client}, ${service}, 'PLT-${i}', '${statut}',`
      + ` ${prix}, ${Math.floor(alea() * 4)}, '${cree}', '${cree}', ${rendu}, 1)`,
    );

    if (statut === 'COMPLETED') {
      numeroPaiement += 1;
      paiements.push(
        `(${numeroPaiement}, 1, ${station}, ${i}, ${prix}, 'CASH', 'PAID', '${cree}', 1)`,
      );
    }
  }

  parPaquets(
    'INSERT INTO operations (id, organization_id, station_id, vehicle_id, customer_id,'
    + ' service_id, reference, status, price, priority, created_at, updated_at,'
    + ' released_at, created_by_user_id)',
    [...valeurs],
  );
}

parPaquets(
  'INSERT INTO payments (id, organization_id, station_id, operation_id, amount, method,'
  + ' status, paid_at, recorded_by_user_id)',
  paiements,
);

const fichier = path.join(os.tmpdir(), `autocare-banc-${Date.now()}.sql`);

fs.writeFileSync(fichier, lignes.join('\n'));

console.log(`  ${CLIENTS.toLocaleString('fr-FR')} clients`);
console.log(`  ${VEHICULES.toLocaleString('fr-FR')} véhicules`);
console.log(`  ${combien.toLocaleString('fr-FR')} dossiers sur ${JOURS} jours`);
console.log(`  ${paiements.length.toLocaleString('fr-FR')} encaissements`);
console.log(`\n  écriture dans la base locale…`);

try {
  execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', base, '--local', '--file', fichier, '--yes'],
    { cwd: racine, stdio: ['ignore', 'ignore', 'inherit'] },
  );
} catch (e) {
  console.error(`\n[ERREUR] L'écriture a échoué : ${e.message.split('\n')[0]}`);
  process.exit(1);
} finally {
  fs.rmSync(fichier, { force: true });
}

console.log('\nTerminé. `node tools/banc-mesures.mjs` pour peser les requêtes.');
