# AUTOCARE OS — Frontend

Application Angular 20. Voir la documentation à la racine du dépôt :

- Installation : [`../docs/setup.md`](../docs/setup.md)
- Architecture : [`../docs/architecture.md`](../docs/architecture.md)
- Contrat d'API : [`../docs/api.md`](../docs/api.md)

## Commandes

```bash
npm start          # serveur de développement sur http://localhost:4200
npm run build      # build de production dans dist/
npm test           # tests unitaires
```

Le backend PHP doit tourner en parallèle sur le port 8000.

## Organisation

```
src/app/
├── core/       services, modèles, gardes — une seule instance
├── shared/     composants réutilisables, sans logique métier
└── features/   un dossier par module métier
```

Règle : `features/` peut utiliser `core/` et `shared/`, mais deux
`features/` ne se parlent jamais directement.
