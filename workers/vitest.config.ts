import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Les tests tournent DANS le runtime Workers, pas dans Node.
 *
 * C'est la seule façon de vérifier ce qui compte vraiment : le
 * comportement réel de D1, le coût en temps de calcul, et l'absence
 * des API Node dont le code PHP disposait sans y penser. Un test qui
 * passerait dans Node ne prouverait rien sur la plateforme cible.
 *
 * Depuis Vitest 4, l'intégration se déclare en plugin Vite et non plus
 * via `poolOptions` — c'est la transformation qu'applique le codemod
 * livré avec le paquet.
 */
const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

export default defineConfig({
  test: {
    // `test-outils/` contient les essais des scripts en ligne de
    // commande : ils tournent dans Node, avec leur propre
    // configuration. Sans cette exclusion, ils seraient chargés ici
    // aussi et échoueraient à la première lecture de fichier.
    include: ['test/**/*.test.ts'],
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          // Les migrations sont passées en liaison : chaque test part
          // d'une base vide et les applique lui-même, donc d'un état
          // connu. Aucun test ne dépend de ce qu'un autre a laissé.
          TEST_MIGRATIONS: migrations,
          // Secret de test, sans rapport avec la production : là-bas
          // c'est un secret Wrangler, jamais une variable de fichier.
          JWT_SECRET: 'secret-de-test-uniquement-64-caracteres-minimum-pour-etre-realiste',
        },
      },
    }),
  ],
});
