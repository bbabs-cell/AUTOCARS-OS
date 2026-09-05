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

Deux classes de `Core/` méritent d'être lues avant tout le reste :
`TenantRepository`, qui rend l'oubli du filtre d'entreprise impossible,
et `PhotoStorage`, qui concentre le traitement des fichiers envoyés.

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

## 9. La machine à états des opérations

Le parcours d'un véhicule est déclaré **une seule fois**, dans
`backend/config/operation_status.php` : les transitions autorisées,
les libellés français, les conditions supplémentaires et les jalons à
horodater.

Trois consommateurs lisent cette même table :

| Qui | Pour quoi |
|---|---|
| `OperationController` | Appliquer la règle, et refuser sinon |
| `QueueController` | Composer les colonnes et lever les alertes |
| Le frontend, via `GET /api/operations/statuses` | N'afficher que les boutons utilisables |
| `tests/state_machine_test.php` | Vérifier la cohérence, sans base ni serveur |

**Pourquoi pas des `if` dans le contrôleur ?** Parce que trois copies
d'une même règle finissent toujours par diverger — en général le jour
où l'une des trois est corrigée seule.

La classe `OperationStatus` sépare deux questions qui se ressemblent :

- `canTransition()` — « ce passage existe-t-il sur le plan ? » Logique
  pure, testable sans base de données.
- `guardFor()` — « ce passage a-t-il une condition en plus ? » Rend le
  nom de la condition (inspection enregistrée, paiement encaissé) ; le
  contrôleur va alors interroger la base.

Cette séparation permet de tester toute la mécanique du parcours en
quelques millisecondes — et un test rapide est un test qu'on lance.

### Les colonnes du tableau

La même configuration déclare les colonnes de la file d'attente. Une
colonne peut regrouper plusieurs statuts — « Inspection » réunit
`IN_PROGRESS` et `INSPECTION`, qui veulent dire la même chose pour
celui qui regarde le tableau.

**On regroupe ce qu'on montre, jamais ce qu'on enregistre.** Les deux
statuts restent distincts en base et dans la machine à états : c'est
ce qui permet d'exiger l'inspection avant le lavage. Le regroupement
ne vit que dans la colonne `board` de la configuration, et le frontend
reçoit les colonnes déjà constituées — il n'a jamais besoin de
connaître le parcours.

### La file d'attente n'est pas une table

Il n'existe pas de table `queue`. La file est une lecture des
opérations actives, groupées et triées.

Une table séparée dupliquerait l'état, et deux copies d'un même état
divergent tôt ou tard : on aurait un véhicule « en lavage » dans la
file et « restitué » dans son dossier, sans moyen de savoir lequel a
raison. La seule dénormalisation assumée est `operations.status_changed_at`,
qui évite de recalculer « depuis quand ? » à partir du journal d'audit
sur la requête la plus fréquente du produit.

---

## 10. Le stockage des photos

`Core/PhotoStorage` est la seule classe qui touche à un fichier envoyé
par un utilisateur. Elle est volontairement isolée : c'est le code le
plus sensible du projet, et il doit se relire d'un bloc.

Les fichiers vivent dans `backend/storage/uploads/`, hors du dossier
web. Aucune URL n'y mène ; `GET /api/photos/{id}` vérifie
l'organisation avant de servir un octet. Le détail des six protections
est dans `docs/security.md` §7.

**Conséquence côté frontend** : un navigateur n'envoie pas l'en-tête
`Authorization` sur une balise `<img>`. Le client télécharge donc le
fichier en `blob` et fabrique une URL locale. C'est un détour assumé —
le seul moyen de garder les preuves derrière une vérification de
droits.

---

## 11. L'argent

Trois principes, empruntés à la comptabilité plutôt qu'au logiciel.

**On ne gomme pas, on contre-passe.** `PaymentRepository` n'expose ni
modification ni suppression, et aucune route ne le permet. Une erreur
se corrige par un remboursement : deux écritures visibles au lieu
d'une ligne réécrite.

**Une clôture est une photo, pas une vue.** Les montants attendu,
compté et l'écart sont figés dans `cash_sessions` à la fermeture. Les
recalculer à l'affichage semblerait plus propre, mais une correction
ultérieure sur un paiement changerait rétroactivement un écart déjà
constaté.

**Une session de caisse est une vacation, le tiroir ne contient que
les espèces.** Tous les encaissements de la session y sont rattachés,
quel que soit leur moyen ; le tri se fait au calcul du montant
attendu. C'est ce qui permet de dire « nous avons fait 45 000 F ce
matin, dont 18 000 en espèces » sans fausser la clôture.

Et la contrainte qui structure tout le module : **aucun fournisseur de
paiement n'est intégré**, ni simulé. Voir `docs/security.md` §7 bis —
la promesse est vérifiée par un test qui relit le code source.

---

## 12. Les droits, écrits une seule fois

La matrice des permissions vit dans `config/permissions.php`, côté
serveur, et nulle part ailleurs.

Depuis le lot 10, `GET /api/auth/me` renvoie la liste des motifs du
rôle (`vehicles.*`, `*`…) pour que la barre latérale n'affiche pas un
lien menant à un « accès refusé ». Le frontend applique la même règle
d'étoile, en cinq lignes.

**Cette liste ne protège rien** : elle arrive dans le navigateur, où
n'importe qui peut la modifier. Elle évite seulement de proposer une
porte fermée — un logiciel qui propose ce qu'il interdit donne
l'impression d'être cassé.

La règle générale du produit s'applique à trois niveaux, et il faut
les distinguer :

| Niveau | Exemple | Ce que ça vaut |
|---|---|---|
| Le serveur REFUSE | `AuthMiddleware` répond 403 | La protection |
| Le serveur N'ENVOIE PAS | Le tableau de bord d'un employé n'a aucun montant | La protection, sur la donnée |
| L'interface CACHE | Le menu « Caisse » disparaît | Le confort, rien de plus |

Le deuxième niveau est celui qu'on oublie le plus souvent : une route
correctement protégée peut quand même renvoyer, dans un coin de sa
réponse, une donnée que l'appelant ne devrait pas voir. C'est ce que
vérifie le test qui relit le JSON **brut** du tableau de bord à la
recherche du moindre champ monétaire.

---

## 13. Les trois zones de routage

Depuis le lot 11, l'application a **trois** zones, et leur ordre dans
`app.routes.ts` est porteur de sens :

| # | Zone | Chemin | Garde |
|---|---|---|---|
| 0 | Vitrine publique | `''` avec `pathMatch: 'full'` | `landingGuard` |
| 1 | Application | `''` avec enfants | `authGuard`, `onboardingGuard` |
| 2 | Installation | `onboarding` | `authGuard`, `onboardingPendingGuard` |
| 3 | Connexion | `''` avec enfants | `guestGuard` |

**`pathMatch: 'full'` sur la zone 0 est indispensable.** Sans lui,
elle avalerait toutes les URL : le chemin vide est le préfixe de tout,
donc `/dashboard` correspondrait aussi. Avec lui, elle ne répond qu'à
la racine exacte, et le reste continue vers la zone 1.

### Le risque de ce lot : la boucle de redirection

Trois gardes qui se renvoient la balle finissent vite en boucle : la
racine renvoie vers le tableau de bord, qui renvoie vers la racine, et
le navigateur tourne en rond. C'est un bogue qu'on ne voit pas en
développant, parce qu'on teste toujours dans le même état de
connexion.

`guestGuard` renvoyait vers `/` : il renvoie désormais vers
`/dashboard`, sinon un utilisateur connecté subissait deux
redirections. `auth.guard.spec.ts` parcourt les deux états — connecté
et déconnecté — et vérifie que chaque chaîne s'arrête.

---

## 14. Ce qui n'est pas encore décidé

- L'hébergement de production (impacte le déploiement, Lot 22).
- **Le rendu côté serveur (Angular SSR).** La page d'accueil est
  construite dans le navigateur : un robot d'indexation qui n'exécute
  pas le JavaScript ne verra qu'une page vide. Le titre et la
  description sont posés, ce qui suffit au partage d'un lien sur
  WhatsApp — le canal principal dans la zone visée — mais pas à un
  référencement naturel. Décision à prendre au lot 22, avec
  l'hébergement.
- Le stockage des photos à grande échelle : disque local pour le
  moment. `PhotoStorage` est l'unique point de contact avec le
  système de fichiers, donc le passage à un stockage objet ne touchera
  que cette classe. La décision se prendra sur des volumes réels, pas
  par anticipation.
- Le prestataire d'envoi de courrier. Depuis le lot 19, `Mailer` a
  deux transports — un fichier en développement, `mail()` en
  production — et c'est le seul point de contact du produit avec le
  courrier. Passer à un service d'envoi ne touchera que cette classe,
  exactement comme `PhotoStorage` pour les fichiers. La décision se
  prendra au lot 22, avec l'hébergement : la délivrabilité dépend du
  domaine et du serveur, pas du code.

- Les fournisseurs de paiement : **aucune intégration ne sera codée
  tant qu'un compte marchand réel n'existe pas.** Les encaissements
  sont saisis manuellement (lot 9), et les colonnes `provider` et
  `external_reference` attendent, vides de toute simulation, le jour
  où une vraie intégration les remplira.
