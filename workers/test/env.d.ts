/**
 * Ce que les tests reçoivent en plus des liaisons de production.
 *
 * `env` est typé `Cloudflare.Env` par le harnais — c'est donc CET
 * espace de noms qu'il faut compléter, et non l'interface Env
 * globale : les deux existent, et se tromper de cible donne une
 * augmentation qui compile sans rien changer.
 */
declare namespace Cloudflare {
  interface Env {
    /** Les migrations, passées en liaison par vitest.config.ts. */
    TEST_MIGRATIONS: D1Migration[];
  }
}
