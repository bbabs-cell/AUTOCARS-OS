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

    // ================================================================
    // POURQUOI 30 SECONDES ET NON LES 5 PAR DÉFAUT
    // ================================================================
    // Ce n'est pas une tolérance accordée à du code lent. Ce qui coûte
    // ici, c'est la MISE EN PLACE, pas le code vérifié :
    // `prepareBase()` applique les 3 migrations, vide 21 tables et
    // réinsère le jeu d'essai — avant CHAQUE test, 658 fois.
    //
    // Mesuré : 111 ms sur cette machine, dont 50 ms de migrations.
    // Sur un poste Windows où les entrées-sorties de workerd sont
    // ~25 fois plus lentes, la même préparation prend ~2,7 s. La
    // limite de 5 s laissait alors 2 s au test lui-même, et 159 tests
    // sur 658 échouaient — tous sur « Test timed out », aucun sur une
    // assertion.
    //
    // Le symptôme était trompeur : un test interrompu en pleine
    // préparation laisse la base à moitié remplie, et la requête
    // suivante échoue sur une clé étrangère. On cherche un défaut de
    // logique là où il n'y a qu'un chronomètre.
    //
    // POURQUOI CE N'EST PAS UN PANSEMENT : la latence du produit est
    // mesurée ailleurs, par `tools/banc-mesures.mjs`, qui n'accepte
    // rien au-dessus de 10 ms. Ce délai-ci ne couvre que le harnais.
    //
    // 30 s ne suffisaient pas : sur le même poste, les mêmes tests
    // passent de 2 s à 40 s selon le moment, sous la charge des
    // travailleurs parallèles. Ce n'est pas une lenteur constante,
    // c'est une IRRÉGULARITÉ — et aucun délai fixe ne la couvre
    // proprement. 60 s laisse la marge nécessaire.
    //
    // LE VRAI LEVIER N'EST PAS ICI, IL EST DANS LA CONCURRENCE.
    // Chaque travailleur refait la mise en place complète en même
    // temps que les autres, et ils se disputent le disque. Sur une
    // machine lente, en réduire le nombre rend chaque test PLUS
    // rapide, même si l'ensemble ne l'est pas :
    //
    //     npm test -- --maxWorkers=2
    //
    // On ne le fixe pas ici : sur une machine normale, la parallélisme
    // complet fait passer la suite en 69 s, et l'imposer à tout le
    // monde coûterait cette vitesse pour le confort d'un poste.
    //
    // CE QU'IL COÛTE : un test réellement bloqué met 60 s à le dire au
    // lieu de 5. C'est le prix, et il est assumé.
    testTimeout: 60_000,
    hookTimeout: 60_000,
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
