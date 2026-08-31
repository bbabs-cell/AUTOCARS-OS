# Architecture d'AUTOCARE OS

Ce document explique **les choix techniques et leurs raisons**. Chaque
décision structurante y est justifiée, ainsi que les alternatives
écartées.

---

## 1. Vue d'ensemble

```
   NAVIGATEUR
   ┌──────────────────────────┐
   │  Angular 20 + Bootstrap  │   composants, services, routage
   └───────────┬──────────────┘
               │  HTTPS, JSON
               ▼
   ┌──────────────────────────┐
   │   API REST — PHP 8.4     │   public/index.php = entrée unique
   │   Router → Controller    │
   │        → Service         │   règles métier
   │        → Model           │   accès aux données (PDO)
   └───────────┬──────────────┘
               │  PDO, requêtes préparées
               ▼
   ┌──────────────────────────┐
   │        MySQL 8           │
   └──────────────────────────┘
```

Frontend et backend sont **deux applications séparées**. L'API ne
produit jamais de HTML, uniquement du JSON. Conséquence utile : une
application mobile native pourra plus tard consommer la même API sans
qu'une ligne du backend ne change.

---

## 2. Pourquoi PHP sans framework ?

**Décision :** PHP « vanilla structuré » — un routeur maison, une
organisation MVC légère, PDO. Composer sert uniquement à l'autoloading
et à deux ou trois librairies ciblées.

**Raisons :**

1. **Objectif pédagogique.** Le projet doit apprendre le développement
   web, pas un framework. Ici, chaque brique est lisible :
   `Router.php` fait 100 lignes, `Response.php` en fait 80.
2. **Aucune magie.** Quand une requête arrive, on peut suivre son
   parcours ligne par ligne du premier au dernier fichier.
3. **Déploiement simple.** N'importe quel hébergement PHP mutualisé
   suffit — un vrai critère sur le marché visé.

**Alternatives écartées :**

| Option | Pourquoi non |
|---|---|
| Laravel | Auth, ORM et migrations offerts, mais on apprendrait Laravel plutôt que le web. Beaucoup de comportements implicites. |
| Slim | Bon compromis, mais le routeur maison est justement l'exercice utile. |

**Le risque assumé :** sans framework, la sécurité repose entièrement
sur notre rigueur. On le compense en **centralisant** : une seule porte
d'entrée, un seul endroit pour l'authentification, un seul pour l'accès
aux données. Voir `docs/security.md`.

---

## 3. Le front controller

`backend/public/` est le **seul dossier exposé au web**, et il ne
contient qu'un fichier PHP : `index.php`.

Tout le reste (`src/`, `config/`, `storage/`, `.env`) est en dehors.
Un visiteur ne peut donc pas appeler un contrôleur directement ni lire
un fichier de configuration.

Bénéfice concret : les protections (en-têtes de sécurité, CORS,
authentification, gestion d'erreurs) sont appliquées **à un seul
endroit**. Il devient structurellement impossible d'oublier une
protection sur une route.

---

## 4. Rôle de chaque couche du backend

| Couche | Responsabilité | Ne doit **jamais** |
|---|---|---|
| `Core/Router` | Associer une URL à une méthode | contenir de logique métier |
| `Http/Controllers` | Lire la requête, appeler un service, renvoyer une réponse | écrire du SQL |
| `Services` *(Lot 4+)* | Les règles métier (« peut-on restituer ce véhicule ? ») | connaître HTTP |
| `Models` *(Lot 3+)* | Lire et écrire en base | décider des règles métier |

Cette séparation permet de tester une règle métier sans lancer de
serveur HTTP.

---

## 5. Organisation du frontend

```
src/app/
├── core/       Chargé une seule fois : services, modèles, gardes,
│               intercepteurs. Une instance unique dans toute l'app.
├── shared/     Composants réutilisés partout : bouton, badge, table,
│               états vides. Aucune logique métier.
└── features/   Un dossier par module : vehicles/, queue/, payments/…
                Chaque dossier est autonome.
```

**Pourquoi cette séparation ?** Sur un projet de 20 modules, sans
règle claire, tout finit par dépendre de tout. Ici la règle est
simple : `features/` peut utiliser `core/` et `shared/`, mais deux
`features/` ne se parlent jamais directement.

Chaque page est chargée à la demande (*lazy loading*, voir
`app.routes.ts`). C'est important pour ce produit : les employés
travaillent sur mobile avec une connexion limitée, inutile de leur
faire télécharger le module Analytics pour afficher une page de
connexion.

---

## 6. Le contrat d'API

L'API répond **toujours** avec la même structure :

```json
{ "success": true,  "data": {}, "message": "" }
{ "success": false, "message": "", "errors": {} }
```

C'est `Core/Response.php` qui le garantit — aucun contrôleur n'écrit
de JSON lui-même. Côté Angular, `ApiResponse<T>` décrit ce contrat en
TypeScript : si le backend change de format, la compilation échoue au
lieu de produire un bug silencieux.

Détails : `docs/api.md`.

---

## 7. Multi-tenancy (préparé, implémenté au Lot 4)

AUTOCARE OS est un SaaS : une même installation sert plusieurs
entreprises clientes.

**Modèle retenu :** base unique, colonne `organization_id` sur toutes
les tables métier.

```
organizations  →  stations  →  station_users  →  données métier
```

**Alternatives écartées :** une base par client (migrations
ingérables dès quelques dizaines de clients) ; la *row-level security*
(inexistante nativement en MySQL).

**Le risque, et il est majeur :** une seule requête SQL sans
`WHERE organization_id = ?` expose les données d'une entreprise à une
autre. C'est le pire incident possible pour un SaaS.

**La parade, non négociable :** aucun contrôleur n'écrira de SQL
librement. Toutes les lectures passeront par une couche qui **injecte
le filtre automatiquement** — on ne peut pas l'oublier puisqu'on n'a
pas la possibilité de l'écrire. Des tests d'isolation seront écrits
dès le Lot 4, avant tout autre module.

---

## 8. Dates et montants

**Dates :** stockées en UTC, affichées en heure locale
(`Africa/Dakar`) par le frontend. Règle universelle qui évite les
bugs lors des changements de serveur ou d'horaire.

**Montants :** stockés en **entiers** (`BIGINT`), pas en `FLOAT`.
Le franc CFA n'a pas de décimales, et surtout les nombres à virgule
flottante produisent des erreurs d'arrondi — inacceptable sur une
caisse qu'un gérant doit pouvoir équilibrer au franc près.

---

## 9. Ce qui n'est pas encore décidé

- L'hébergement de production (impacte le déploiement, Lot 22).
- Le stockage des photos à grande échelle : disque local au départ,
  stockage objet si le volume l'exige (décision au Lot 7).
- Les fournisseurs de paiement : **aucune intégration ne sera codée
  tant qu'un compte marchand réel n'existe pas.** Les paiements sont
  saisis manuellement au MVP, l'architecture reste prête à accueillir
  un fournisseur.
