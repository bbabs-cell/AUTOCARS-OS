/**
 * Le nom de la commande `npx`, selon le système
 * ==================================================================
 * Sous Windows, `npx` n'est pas un exécutable : c'est `npx.cmd`, un
 * script de commandes. `execFileSync('npx', …)` échoue donc avec
 * `spawnSync npx ENOENT` — un message qui laisse croire que npm n'est
 * pas installé, alors qu'il l'est.
 *
 * Node ne résout pas `PATHEXT` pour `execFile`, et depuis Node 20 il
 * refuse d'exécuter un `.cmd` sans le dire explicitement — une
 * protection contre l'injection d'arguments par l'interpréteur de
 * commandes de Windows. La bonne réponse est donc de nommer le
 * fichier, pas de repasser par un interpréteur avec `shell: true`,
 * qui rouvrirait précisément cette faille sur des arguments qui
 * contiennent du SQL.
 *
 * Cette constante est partagée par les cinq outils. Elle l'est parce
 * que la valeur avait été écrite six fois : le contrôle avant vol a
 * bloqué la mise en service sur ce défaut, et le corriger six fois
 * aurait laissé la septième à écrire.
 */
export const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
