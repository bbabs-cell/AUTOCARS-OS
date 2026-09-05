/**
 * Le jeu d'essai des tests.
 *
 * DEUX ORGANISATIONS, TOUJOURS.
 *
 * Un jeu d'essai à une seule organisation ne peut pas révéler une
 * fuite entre clients : tout y appartient au même. La seconde
 * organisation n'est pas un ornement, c'est le témoin.
 */

import { env, applyD1Migrations } from 'cloudflare:test';
import { hachePassword } from '../src/core/password';

export const MOT_DE_PASSE = 'Autocare2026!';

export async function prepareBase(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

  // On vide avant de remplir, au lieu de compter sur l'isolation du
  // harnais. Un jeu d'essai qui dépend de ce qu'un autre test a laissé
  // derrière lui produit des échecs qui changent selon l'ordre
  // d'exécution — les pires à diagnostiquer.
  await env.DB.batch(
    ['vehicles', 'customers', 'station_users', 'stations', 'users', 'organizations'].map(
      (table) => env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );

  const empreinte = await hachePassword(MOT_DE_PASSE);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO organizations (id, name, slug) VALUES (1, 'Diallo Auto', 'diallo'), (2, 'Concurrent SA', 'concurrent')`,
    ),
    env.DB.prepare(
      `INSERT INTO stations (id, organization_id, name, code) VALUES
        (1, 1, 'Dakar Plateau', 'DKP'), (2, 1, 'Thiès', 'THS'), (3, 2, 'Rufisque', 'RUF')`,
    ),
    env.DB.prepare(
      `INSERT INTO users (id, organization_id, first_name, last_name, email, password_hash, status) VALUES
        (1, 1, 'Mamadou', 'Diallo', 'mamadou@diallo.sn',  ?1, 'ACTIVE'),
        (2, 1, 'Aliou',   'Sow',    'aliou@diallo.sn',    ?1, 'ACTIVE'),
        (3, 1, 'Ancien',  'Employe','ancien@diallo.sn',   ?1, 'SUSPENDED'),
        (4, 2, 'Fatou',   'Ndiaye', 'fatou@concurrent.sn',?1, 'ACTIVE')`,
    ).bind(empreinte),
    env.DB.prepare(
      `INSERT INTO station_users (organization_id, station_id, user_id, role) VALUES
        (1, 1, 1, 'ADMIN'), (1, 2, 1, 'ADMIN'),
        (1, 1, 2, 'EMPLOYEE'),
        (1, 1, 3, 'EMPLOYEE'),
        (2, 3, 4, 'ADMIN')`,
    ),
    env.DB.prepare(
      `INSERT INTO customers (id, organization_id, first_name, last_name, phone) VALUES
        (1, 1, 'Aminata', 'Sarr',  '+221770000001'),
        (2, 2, 'Client',  'Rival', '+221770000002')`,
    ),
    env.DB.prepare(
      `INSERT INTO vehicles (id, organization_id, customer_id, plate_number, brand, model, vehicle_type) VALUES
        (1, 1, 1, 'DK9087DE', 'Renault', 'Duster', 'SUV'),
        (2, 1, 1, 'DK5678BC', 'Hyundai', 'Tucson', 'SUV'),
        (3, 2, 2, 'RF1111ZZ', 'Toyota',  'Hilux',  'PICKUP')`,
    ),
  ]);
}

/** Se connecte et renvoie le jeton d'accès. */
export async function jetonPour(email: string): Promise<string> {
  const { SELF } = await import('cloudflare:test');
  const res = await SELF.fetch('https://api.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: MOT_DE_PASSE }),
  });

  const corps = (await res.json()) as { data?: { access_token?: string } };
  const jeton = corps.data?.access_token;

  if (typeof jeton !== 'string') {
    throw new Error(`Connexion impossible pour ${email} (HTTP ${res.status})`);
  }

  return jeton;
}
