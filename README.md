# AUTOCARE OS

**Le système d'exploitation de votre station automobile.**

Plateforme SaaS de gestion pour stations de lavage, centres de detailing,
centres automobiles et gestionnaires de flottes.

> *Votre station. Vos véhicules. Votre équipe. Un seul logiciel.*

---

## Le problème

Beaucoup de stations fonctionnent aujourd'hui avec un mélange de cahiers,
de fiches papier, de WhatsApp, d'Excel et de mémoire humaine. Résultat :
informations perdues, files d'attente, erreurs de paiement, et surtout
aucune traçabilité quand un client conteste l'état de son véhicule.

AUTOCARE OS remplace cette organisation dispersée par **une chaîne de
traçabilité continue**, du moment où le client confie son véhicule
jusqu'à sa restitution.

---

## Stack technique

| Couche | Technologie | Pourquoi |
|---|---|---|
| Frontend | Angular 20 + Bootstrap 5 | SPA, TypeScript, responsive |
| API | PHP 8.4, sans framework | Code lisible, chaque couche explicable |
| Base | MySQL 8 | Relationnel, PDO + requêtes préparées |
| Format | REST / JSON | Contrat unique, voir `docs/api.md` |

Le choix d'un PHP sans framework est délibéré : ce projet sert aussi
d'apprentissage. Chaque brique (routeur, requête, réponse, connexion)
tient en une centaine de lignes lisibles plutôt que d'être masquée par
la magie d'un framework.

---

## Démarrage rapide

Prérequis : PHP ≥ 8.2, Composer, Node.js ≥ 20.19, MySQL 8.

```bash
# 1. Backend
cd backend
composer install
cp .env.example .env        # puis renseigner les accès MySQL
php tools/check_db.php      # vérifie la connexion
php -S localhost:8000 -t public router.php

# 2. Frontend (dans un second terminal)
cd frontend
npm install
npm start
```

Ouvre ensuite **http://localhost:4200** : tu arrives sur la page du
design system. `/health` vérifie que l'API et la base répondent.

Procédure détaillée et dépannage : **[docs/setup.md](docs/setup.md)**

---

## Structure du dépôt

```
AUTOCARS-OS/
├── backend/            API REST PHP
│   ├── public/         SEUL dossier exposé au web (front controller)
│   ├── src/Core/       Router, Request, Response, Database, Env
│   ├── src/Http/       Contrôleurs
│   ├── config/         Table des routes
│   ├── storage/        Photos d'inspection et journaux (hors web)
│   └── tools/          Outils de diagnostic
├── frontend/           Application Angular
│   └── src/app/
│       ├── core/       Services, modèles, gardes (une seule instance)
│       ├── shared/     Composants réutilisables
│       └── features/   Un dossier par module métier
└── docs/               Documentation technique
```

---

## Documentation

| Document | Contenu |
|---|---|
| [docs/setup.md](docs/setup.md) | Installation pas à pas et dépannage |
| [docs/design-system.md](docs/design-system.md) | Couleurs, typographie, composants, règles visuelles |
| [docs/architecture.md](docs/architecture.md) | Choix techniques et leur justification |
| [docs/api.md](docs/api.md) | Contrat de l'API REST |
| [docs/database.md](docs/database.md) | Modèle de données |
| [docs/security.md](docs/security.md) | Règles de sécurité du projet |

---

## Avancement

Le développement suit 22 lots. Chaque lot est validé avant de passer au
suivant.

**Phase A — Fondations**
- [x] **Lot 1** — Initialisation : Angular, API PHP, configuration, documentation
- [x] **Lot 2** — Design system : jetons, Bootstrap personnalisé, layout, composants, page `/styleguide`
- [x] **Lot 3** — Base de données : 12 tables, migrations, jeu de démonstration, 38 tests de schéma

**Phase B — Cœur du MVP**
- [x] **Lot 4** — Authentification, multi-tenant, permissions : 43 tests de sécurité
- [ ] Lot 5 — Onboarding station et prestations
- [ ] Lot 6 — Clients et véhicules
- [ ] Lot 7 — Inspection, photos, restitution
- [ ] Lot 8 — File d'attente et opérations
- [ ] Lot 9 — Paiements et caisse
- [ ] Lot 10 — Tableau de bord → **MVP utilisable**

**Phase C — Extension** · Lots 11 à 18
**Phase D — Industrialisation** · Lots 19 à 22
