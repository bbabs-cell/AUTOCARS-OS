/**
 * Lancer Wrangler depuis un outil, sur les trois systèmes
 * ==================================================================
 * ON N'APPELLE PAS `npx`. Deux tentatives ont échoué avant celle-ci,
 * et l'histoire vaut d'être écrite parce qu'elle mène à la seule
 * bonne réponse.
 *
 *   1. `execFileSync('npx', …)` → `spawnSync npx ENOENT` sous
 *      Windows. `npx` y est un script de commandes, `npx.cmd`, et
 *      Node ne résout pas PATHEXT pour `execFile`.
 *
 *   2. `execFileSync('npx.cmd', …)` → `spawnSync npx.cmd EINVAL`.
 *      Le fichier est trouvé, mais depuis Node 20 l'exécution d'un
 *      `.cmd` sans interpréteur explicite est refusée.
 *
 * La sortie apparente serait `shell: true`. C'est précisément ce
 * qu'il ne faut pas faire ICI : les arguments de ces outils
 * contiennent du SQL, avec des guillemets et des apostrophes. Les
 * faire traverser `cmd.exe` rouvrirait la faille d'injection
 * d'arguments que Node 20 a fermée — sur les commandes qui parlent à
 * la base de production.
 *
 * ------------------------------------------------------------------
 * CE QU'ON FAIT À LA PLACE
 *
 * `npx` ne sert qu'à trouver un exécutable dans `node_modules`. On
 * sait où il est. On appelle donc le fichier JavaScript de Wrangler
 * avec le Node courant : aucun interpréteur de commandes, les
 * arguments passés un par un, et la version EXACTE que
 * `package-lock.json` fixe — là où `npx` pourrait en télécharger une
 * autre si le paquet manquait.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const racine = path.resolve(import.meta.dirname, '..');
const BINAIRE = path.join(racine, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/**
 * Lance Wrangler. Les arguments s'écrivent SANS « wrangler » devant :
 *
 *     lanceWrangler(['d1', 'execute', base, '--remote', '--json', …])
 */
export function lanceWrangler(args, options = {}) {
  if (!fs.existsSync(BINAIRE)) {
    throw new Error(
      `Wrangler est introuvable (${BINAIRE}). Lancez « npm ci » dans le dossier workers.`,
    );
  }

  return execFileSync(process.execPath, [BINAIRE, ...args], { cwd: racine, ...options });
}
