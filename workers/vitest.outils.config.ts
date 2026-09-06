import { defineConfig } from 'vitest/config';

/**
 * Les outils en ligne de commande se testent dans NODE, pas dans le
 * runtime Workers.
 *
 * `sauvegarde.mjs`, `restauration.mjs` et `avant-vol.mjs` lisent des
 * fichiers, lancent `wrangler` et écrivent des archives : rien de
 * tout cela n'existe dans workerd. Les faire tourner dans la même
 * suite que le reste échouait à la première lecture de fichier.
 *
 * Deux configurations plutôt qu'une, donc — et c'est la bonne
 * séparation : ce qui s'exécute chez Cloudflare est vérifié chez
 * Cloudflare, ce qui s'exécute sur la machine de l'exploitant est
 * vérifié sur une machine.
 */
export default defineConfig({
  test: {
    include: ['test-outils/**/*.test.ts'],
    environment: 'node',
  },
});
