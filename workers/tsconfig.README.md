# Pourquoi deux tsconfig

`tsconfig.json` couvre `src/` et `test/`, **sans les types de Node**.

Ce n'est pas une coquetterie : les Workers n'ont ni `fs`, ni `process`,
ni `Buffer`. Si les types de Node étaient chargés pour le code source,
un appel à `process.env` compilerait sans broncher et n'échouerait
qu'en production. En les excluant, la vérification de types devient un
garde-fou réel contre le réflexe hérité du serveur.

`tsconfig.node.json` ne couvre que `vitest.config.ts`, qui lui tourne
bel et bien dans Node.
