# Base de données

## Commandes

```bash
cd backend

php tools/migrate.php            # applique les migrations en attente
php tools/migrate.php --status   # liste sans exécuter
php tools/migrate.php --fresh    # ⚠️ efface tout et rejoue
php tools/seed.php               # jeu de démonstration
php tests/schema_test.php        # vérifie les garde-fous
```

## Organisation

```
database/
├── migrations/   structure : une table par fichier, dans l'ordre
└── seeds/        données de démonstration
```

## Ajouter une migration

1. Crée un fichier `database/migrations/NNN_ce_que_ca_fait.sql`.
   Le numéro détermine l'ordre d'exécution — prends le suivant.
2. Écris le SQL. Une migration ne se modifie **jamais** après avoir
   été appliquée quelque part : on en crée une nouvelle.
3. `php tools/migrate.php`

## Pourquoi les migrations ne sont pas dans une transaction

En MySQL, les instructions de structure (`CREATE TABLE`,
`ALTER TABLE`…) valident automatiquement la transaction en cours :
elles ne peuvent pas être annulées par un `ROLLBACK`. Encadrer une
migration dans une transaction donnerait une fausse impression de
sécurité.

L'outil s'arrête donc au premier échec en indiquant précisément
l'instruction fautive. En développement, on corrige puis on relance
avec `--fresh`.

Les *seeds*, eux, sont bien transactionnels : ce sont des données, pas
de la structure.

Détails complets : [`../../docs/database.md`](../../docs/database.md)
