/**
 * Les délais des tests, en un seul endroit
 * ==================================================================
 * Il y a DEUX configurations Vitest — `vitest.config.ts` pour ce qui
 * tourne dans le runtime Workers, `vitest.outils.config.ts` pour les
 * outils en ligne de commande qui tournent dans Node. Les deux ont
 * besoin des mêmes délais, et la valeur a déjà divergé une fois :
 * relevée d'un côté, oubliée de l'autre, un test a échoué sur les
 * 5 secondes par défaut alors que le problème était réputé réglé.
 *
 * D'où ce fichier. Une valeur, deux lecteurs.
 *
 * ------------------------------------------------------------------
 * POURQUOI 60 SECONDES ET NON LES 5 PAR DÉFAUT
 *
 * Ce n'est pas une tolérance accordée à du code lent. Ce qui coûte,
 * c'est la MISE EN PLACE, pas le code vérifié :
 *
 *   · côté Workers, `prepareBase()` applique les 3 migrations, vide
 *     21 tables et réinsère le jeu d'essai — avant CHAQUE test.
 *     Mesuré sur une machine de développement : 111 ms.
 *   · côté outils, chaque test lance un VRAI processus `node` et
 *     attend sa sortie. Le démarrage d'un processus est ce que
 *     Windows fait de plus lent.
 *
 * Sur un poste où ces opérations sont irrégulières — mesuré : les
 * mêmes tests entre 2 s et 40 s d'une exécution à l'autre, sous la
 * contention des travailleurs parallèles — la limite de 5 s échoue
 * sur le chronomètre, jamais sur une assertion. Le symptôme trompe :
 * un test interrompu en pleine préparation laisse la base à moitié
 * remplie, et le suivant échoue sur une clé étrangère.
 *
 * CE N'EST PAS UN PANSEMENT : la latence du produit est mesurée
 * ailleurs, par `tools/banc-mesures.mjs`, qui refuse tout au-dessus
 * de 10 ms. Ces délais ne couvrent que le harnais.
 *
 * LE VRAI LEVIER EST AILLEURS. Sur une machine lente, réduire la
 * concurrence rend chaque test plus rapide, là où allonger le délai
 * ne fait que l'autoriser à traîner :
 *
 *     npm test -- --maxWorkers=2
 *
 * CE QUE CE DÉLAI COÛTE : un test réellement bloqué met 60 s à le
 * dire au lieu de 5. C'est le prix, et il est assumé.
 */
export const DELAIS = {
  testTimeout: 60_000,
  hookTimeout: 60_000,
} as const;
