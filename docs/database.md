# Base de données — AUTOCARE OS

> **État : implémentée au Lot 3.** 12 tables métier, plus la table
> technique `migrations`.

---

## Démarrage

```bash
cd backend

php tools/migrate.php            # applique les migrations en attente
php tools/migrate.php --status   # liste sans rien exécuter
php tools/migrate.php --fresh    # efface tout et rejoue depuis zéro
php tools/seed.php               # charge le jeu de démonstration
php tests/schema_test.php        # vérifie que les garde-fous fonctionnent
```

`--fresh` **détruit toutes les données**. La commande refuse de
s'exécuter si `APP_ENV=production`.

### Pourquoi un outil de migration ?

À plusieurs personnes et sur plusieurs mois, « est-ce que j'ai déjà
passé le script qui ajoute la colonne devise ? » devient une question
impossible à trancher.

L'outil tient un registre : la table `migrations` mémorise chaque
fichier appliqué. Relancer la commande ne rejoue donc rien. C'est ce
qui permet de déployer sans se demander où on en était.

---

## Configuration

```sql
CREATE DATABASE autocare_os
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

`utf8mb4` est obligatoire : il permet de stocker les accents français
et les emojis. L'ancien `utf8` de MySQL est incomplet.

Moteur **InnoDB** partout : seul à gérer les clés étrangères et les
transactions.

---

## Les 14 tables

```
organizations                    l'entreprise cliente du SaaS
   ├── users                     comptes de connexion
   ├── stations                  points de service
   │      └── station_users      qui travaille où, avec quel rôle
   ├── customers                 clients de la station
   │      └── vehicles           véhicules, rattachés à un client
   ├── services                  catalogue des prestations
   ├── cash_sessions             journées de caisse (une par station)
   └── operations         ◄──────  LA TABLE CENTRALE
          ├── inspections           état constaté du véhicule
          │      └── inspection_photos   les preuves
          └── payments              encaissements

audit_logs                       qui a fait quoi, et quand
```

Deux tables techniques s'y ajoutent — `refresh_tokens` et
`password_resets` — plus `migrations`, tenue par l'outil.

### Trois tables volontairement absentes

| Écartée | Pourquoi |
|---|---|
| `cash_registers` | Un tiroir-caisse n'a pas d'existence propre : ce qui compte, c'est la **journée** de caisse. Une table de « caisses » n'aurait porté qu'un nom et un identifiant de station, déjà présents ailleurs. → `cash_sessions` suffit. |
| `queue` | La file d'attente n'est pas une entité mais une **vue** des opérations en cours, triées par priorité. Une table séparée dupliquerait l'état et finirait par diverger : on aurait un véhicule « en lavage » dans la file et « restitué » dans son dossier, sans savoir lequel a raison. → `priority` et `status_changed_at` sur `operations` suffisent. *(Confirmé au lot 8 : `GET /api/queue` est bien une lecture.)* |
| `employees` | Un employé **est** un `user` rattaché à une station via `station_users`. On créera cette table le jour où il y aura de vraies données RH. |
| `roles` / `permissions` | Le rôle est un `ENUM` de trois valeurs, la matrice des droits vit dans un fichier PHP : lisible, testable, sans jointure. On passera en base quand un client voudra des rôles sur mesure. |

---

## Règles appliquées partout

1. **Clé primaire** `id BIGINT UNSIGNED AUTO_INCREMENT`.
2. **`organization_id` sur toute table métier** — voir isolation.
3. **Horodatage** `created_at` / `updated_at`, stockés en UTC.
4. **Clés étrangères en `RESTRICT`** par défaut : on ne supprime pas
   un client qui a un historique.
5. **Index** sur toute colonne servant à filtrer ou à joindre.
6. **Suppression logique** (`deleted_at`) sur `users`, `customers`,
   `vehicles`.
7. **Montants en entiers**, jamais en nombres à virgule.

### Pourquoi les montants sont des entiers

Le franc CFA n'a pas de décimales. Surtout, un `FLOAT` introduit des
erreurs d'arrondi : `0.1 + 0.2` ne vaut pas exactement `0.3` en
binaire. Sur une caisse qu'un gérant doit équilibrer au franc près,
c'est inacceptable.

Pour une devise à décimales, on stockera les centimes dans ce même
entier.

---

## Isolation entre entreprises

C'est **le** point de sécurité du produit.

```
organizations → stations → station_users → données métier
```

Toute table métier porte `organization_id`, y compris quand
l'information serait déduisible par jointure (`station_users` en est
un exemple). Cette duplication est **volontaire** : elle permet à la
couche d'accès aux données d'appliquer le filtre d'isolation de façon
uniforme, sans exception à retenir. Une exception est une occasion de
l'oublier.

**Le risque :** une seule requête sans `WHERE organization_id = ?`
expose les données d'une entreprise à une autre.

**La parade (Lot 4) :** aucun contrôleur n'écrira de SQL librement.
Toutes les lectures passeront par une couche qui injecte le filtre
automatiquement, plus des tests d'isolation automatisés.

---

## Machine à états des opérations

> ✅ **Validée.** Les transitions ci-dessous font foi ; elles seront
> verrouillées côté API au Lot 8. La base garantit les *valeurs*
> possibles (via l'`ENUM`), pas l'*ordre* dans lequel on y passe.

```
WAITING ──► IN_PROGRESS ──► INSPECTION ──► WASHING
                                              │
                                              ▼
COMPLETED ◄── READY ◄── QUALITY_CHECK ────────┘
                             │
                             └──► WASHING   (contrôle non conforme)

CANCELLED : accessible depuis tout état non terminal
```

| Depuis | Transitions autorisées |
|---|---|
| `WAITING` | `IN_PROGRESS`, `CANCELLED` |
| `IN_PROGRESS` | `INSPECTION`, `CANCELLED` |
| `INSPECTION` | `WASHING`, `CANCELLED` |
| `WASHING` | `QUALITY_CHECK`, `CANCELLED` |
| `QUALITY_CHECK` | `READY`, `WASHING`, `CANCELLED` |
| `READY` | `COMPLETED`, `CANCELLED` |
| `COMPLETED` | *(état final)* |
| `CANCELLED` | *(état final)* |

**Pourquoi cette rigueur ?** Parce que la traçabilité est le cœur du
produit. Si on pouvait passer directement de `WAITING` à `COMPLETED`,
un véhicule serait rendu sans inspection ni contrôle — exactement le
litige que le produit doit empêcher.

Trois règles supplémentaires, validées :

- **`QUALITY_CHECK` → `WASHING`** est autorisé : si le contrôle n'est
  pas conforme, on relave. C'est le seul retour en arrière du parcours.
- **`READY` → `COMPLETED`** (la restitution) exigera un paiement au
  statut `PAID`, ou l'accord explicite d'un manager, tracé dans le
  journal d'audit.
- **L'inspection d'entrée est obligatoire** : on ne peut pas passer de
  `IN_PROGRESS` à `WASHING` sans passer par `INSPECTION`. C'est ce qui
  protège la station des litiges, et c'est la raison d'être du produit.
- **Le contrôle qualité est obligatoire** : `WASHING` mène toujours à
  `QUALITY_CHECK` avant `READY`. Dans une petite station, la même
  personne lave et contrôle — le statut reste une étape explicite,
  tracée, même si elle ne dure que quelques secondes.

Chaque transition sera journalisée dans `audit_logs` avec son auteur
et son horodatage.

---

## Détails de conception à connaître

### La caisse : une colonne calculée pour garantir l'unicité

`cash_sessions` (lot 9, migration 017) porte une contrainte qui mérite
d'être connue : **une seule caisse ouverte par station**, garantie par
la base et non par le code.

Deux sessions ouvertes sur le même tiroir, et les encaissements se
répartissent au hasard entre elles : les deux clôtures sont fausses et
l'on ne sait pas laquelle croire. L'API vérifie avant d'ouvrir, mais
deux caissiers qui cliquent à la même seconde passeraient tous les
deux la vérification avant que l'un n'écrive.

```sql
open_station_id BIGINT UNSIGNED
    AS (IF(status = 'OPEN', station_id, NULL)) STORED,
UNIQUE KEY uq_cash_sessions_one_open (open_station_id)
```

La colonne vaut `station_id` tant que la session est ouverte, `NULL`
une fois fermée. Comme une contrainte `UNIQUE` autorise autant de
`NULL` qu'on veut, on peut fermer mille sessions sur une station et
n'en ouvrir qu'une.

⚠️ **Piège rencontré** : la clé étrangère sur `station_id` est en
`ON UPDATE RESTRICT`, et non `CASCADE` comme partout ailleurs. MySQL
comme MariaDB refusent qu'une colonne calculée s'appuie sur une
colonne qui se met à jour en cascade. Le message d'erreur —
*« Function or expression 'station_id' cannot be used in the GENERATED
ALWAYS AS clause »* — ne le dit pas du tout. La perte est nulle :
l'identifiant d'une station est auto-incrémenté, il ne change jamais.

### `time_entries` : un seul pointage ouvert par personne

`time_entries` (lot 12, migration 018) reprend **exactement** le
mécanisme de la caisse, pour la même raison :

```sql
open_user_id BIGINT UNSIGNED
    AS (IF(clock_out_at IS NULL, user_id, NULL)) STORED,
UNIQUE KEY uq_time_entries_one_open (open_user_id)
```

Deux pointages ouverts pour la même personne, et la question « depuis
quand est-elle là ? » n'a plus de réponse. Le cas n'a rien de
théorique : sur un téléphone lent, un employé appuie deux fois sur
« Pointer mon arrivée ». Le contrôleur vérifie avant d'écrire, mais
deux requêtes parties à la même seconde passent toutes les deux la
vérification. La base, elle, ne peut pas se tromper.

Même piège que pour la caisse : la clé étrangère sur `user_id` est en
`ON UPDATE RESTRICT`.

**`duration_minutes` est figée à la fermeture**, et n'est pas
recalculée à l'affichage. Une durée qui sert à payer ne doit pas
changer parce qu'on a rouvert l'écran six mois plus tard. Elle est
recalculée à un seul moment : quand un responsable corrige la ligne —
et cette correction laisse une trace.

**Aucun `DELETE` sur cette table.** Un pointage effacé, c'est une
journée de travail qui disparaît de la paie sans que personne ne
puisse le démontrer. Une erreur se corrige, et la correction se voit :
`corrected_by_user_id`, `corrected_at` et `correction_reason` sont
**sur la ligne**, pas seulement dans un journal qu'il faudrait penser
à ouvrir.

### Ce que `time_entries` ne contient PAS

Ni latitude, ni longitude, ni photo, ni adresse IP, ni identifiant
d'appareil.

Le module est un **registre, pas une caméra**. Géolocaliser un
pointage réglerait le problème de la personne qui pointe pour un
collègue — et créerait celui d'un logiciel qui suit ses employés à la
trace. Sur une station où tout le monde se connaît et se voit, la
seconde nuisance est bien plus grande que la première. Le jour où le
besoin sera réel, il faudra le décider explicitement, pas le découvrir
dans un schéma.

### `payments.cash_session_id` : quelle vacation ?

On aurait pu rattacher les encaissements à leur session **par la
date**. C'est fragile : un paiement enregistré à la seconde de la
clôture tombe d'un côté ou de l'autre selon l'ordre des écritures, et
l'écart change sans que personne ne comprenne pourquoi.

Le lien explicite supprime la question, et rend visible le cas où le
tiroir n'était pas ouvert : la colonne reste `NULL`.

**Elle est posée sur TOUS les encaissements**, pas seulement les
espèces : une session est une *vacation* au comptoir. Le tri « qu'y
a-t-il dans le tiroir ? » se fait au calcul, en ne retenant que
`method = 'CASH'`.

### `status_changed_at` : depuis quand ce véhicule est-il à cette étape ?

Ajoutée au lot 8 (migration 016), c'est la colonne qui rend la file
d'attente utile. « 6 véhicules en lavage » n'appelle aucune décision ;
« cette voiture est en lavage depuis 1 h 06 pour une prestation vendue
45 minutes » en appelle une immédiatement.

L'information existe déjà dans `audit_logs` : chaque changement de
statut y est tracé. On pourrait donc la recalculer par une
sous-requête. Mais la file est rechargée en permanence, sur tous les
postes — c'est **la requête la plus fréquente du produit**. Une
dénormalisation assumée, au service d'une lecture qu'on fait mille
fois plus souvent qu'on ne l'écrit. Même logique que `started_at` et
`completed_at`.

**Pourquoi pas `updated_at`, qui existe déjà ?** Parce qu'il change à
chaque modification : assigner un employé ou monter la priorité
remettrait le compteur à zéro. Un véhicule oublié depuis deux heures
paraîtrait arrivé à l'instant — exactement le contraire de ce qu'on
cherche à voir.

### Le prix est recopié sur l'opération

`operations.price` duplique `services.price` au moment de la
création. C'est **volontaire** : si le gérant augmente le tarif du
lavage premium le mois prochain, les opérations passées doivent
continuer à montrer ce qui a réellement été facturé. Lire le prix par
une jointure réécrirait le passé à chaque changement.

### Le téléphone client n'est pas unique

Il est obligatoire — c'est l'identifiant naturel d'une personne au
Sénégal, bien avant l'e-mail — mais **pas unique** : un couple partage
souvent un numéro. Une contrainte d'unicité bloquerait un
enregistrement légitime en pleine affluence. Le doublon sera signalé
par l'application (Lot 6), pas interdit par la base.

### La plaque est unique par entreprise

Une plaque désigne un seul véhicule dans une organisation, ce qui
évite les fiches en double qui casseraient l'historique. Mais deux
entreprises concurrentes peuvent servir le même véhicule : l'unicité
est donc `(organization_id, plate_number)`, jamais la plaque seule.

Les plaques sont stockées **normalisées** (majuscules, sans
séparateur : `DK1234AA`) pour que « dk 1234 aa » et « DK-1234-AA »
désignent bien le même véhicule. L'affichage remet les tirets.

### L'e-mail est unique globalement

C'est l'identifiant de connexion : il ne peut pas y en avoir deux.
Conséquence assumée : une personne travaillant pour deux entreprises
clientes aura besoin de deux adresses.

### Les encaissements ne se modifient pas

Même principe que les photos et le journal d'audit. Il n'existe ni
route ni méthode de dépôt pour modifier ou supprimer une ligne de
`payments`. Une erreur se corrige par une **contre-écriture** — un
remboursement — qui laisse les deux lignes visibles.

C'est la règle de base de toute comptabilité : on ne gomme pas, on
contre-passe. Un montant qu'on peut réécrire après coup ne prouve
rien, et c'est précisément le soir où la caisse ne tombe pas juste que
quelqu'un voudrait le réécrire.

### Les photos ne se suppriment pas

`inspection_photos` a un statut `ARCHIVED` mais pas de `deleted_at` :
une preuve effaçable ne vaut rien. On stocke aussi l'empreinte
SHA-256 du fichier — si quelqu'un remplace l'image sur le disque,
l'empreinte ne correspond plus et la substitution devient détectable.

### `audit_logs` est en ajout seul

Pas de `updated_at`, pas de `deleted_at` : leur présence suggérerait
qu'une ligne peut changer. Pas de clé étrangère sur
`entity_type` / `entity_id` non plus — elle empêcherait de conserver
la trace d'un élément supprimé, exactement ce qu'un journal doit
garder.

---

## Index et performance

L'index le plus important du produit :

```sql
KEY idx_operations_queue (organization_id, station_id, status, priority)
```

C'est la requête de la file d'attente, rechargée en permanence sur
tous les postes. L'ordre des colonnes suit celui du filtrage réel —
MySQL ne peut utiliser un index composé que de la gauche vers la
droite.

**Mesuré sur 2 000 opérations** (`php tests/schema_test.php`) :
l'index est retenu par l'optimiseur et n'examine que 60 à 180 lignes
au lieu des 2 004.

> Piège à connaître : sur une table de quatre lignes, l'optimiseur
> **ignore volontairement** les index — lire quatre lignes coûte moins
> cher que consulter un index puis la table. Vérifier l'usage d'un
> index sur des données de démonstration ne prouve donc rien. C'est
> pourquoi le test charge un volume réaliste, avec une répartition
> réaliste des statuts (2 % d'opérations actives, le reste terminé).

---

## Jeu de démonstration

`php tools/seed.php` crée une station sénégalaise plausible :

- 1 entreprise (Groupe Diallo Auto), 2 stations (Dakar, Thiès)
- 4 utilisateurs couvrant les 3 rôles
- 5 prestations, 4 clients, 5 véhicules
- 4 opérations à différents stades du parcours
- 3 inspections, 5 photos (fichiers réels, empreintes recalculées)
- 13 dossiers clos répartis sur les six jours précédents, avec leurs
  15 encaissements — sans quoi la courbe du tableau de bord n'aurait
  qu'une barre, et un graphique à une barre fait croire que l'écran
  est cassé

**Les dates sont relatives à maintenant** (`NOW() - INTERVAL n MINUTE`),
jamais écrites en dur. La file d'attente ne montre pas un état mais une
durée : avec des dates figées, la démonstration afficherait au bout
d'une semaine « en attente depuis 7 jours » sur chaque carte, et
l'écran paraîtrait cassé alors qu'il fonctionne. Un dossier est
volontairement en retard — l'écran doit montrer à quoi ressemble un
oubli.

**Comptes** — mot de passe `Autocare2026!` :

| Adresse | Rôle |
|---|---|
| `mamadou.diallo@dialloauto.sn` | Administrateur |
| `awa.ndiaye@dialloauto.sn` | Manager |
| `aliou.sow@dialloauto.sn` | Employé |

Ces données sont volontairement réalistes. Une base remplie de
« test1 » et « aaa » ne permet pas de juger si une interface tient
debout avec de vrais noms.

---

## Tests

`php tests/schema_test.php` — 38 vérifications.

Un schéma qui « se crée sans erreur » ne prouve rien. Ce qui compte,
c'est qu'il **refuse** ce qu'il doit refuser :

- supprimer un client qui a un historique → refusé
- enregistrer deux fois la même plaque → refusé
- deux inspections d'entrée sur une opération → refusé
- un statut d'opération inventé → refusé
- la même plaque dans une **autre** entreprise → autorisé

Le test est **rejouable** : il nettoie ses données avant et après, y
compris après un plantage.

---

## Compatibilité MySQL / MariaDB

Le SQL est volontairement conservateur pour fonctionner sur les deux.
Il a été **exécuté et testé sur MariaDB 10.11**, tandis que
l'environnement de référence du projet est **MySQL 8.4**.

Points d'attention, tous évités ici :

| Sujet | Traitement |
|---|---|
| Type `JSON` | Natif sur MySQL 8, alias de `LONGTEXT` sur MariaDB. On se contente de stocker et relire, ce qui marche sur les deux. |
| Collation | `utf8mb4_unicode_ci`, présente sur les deux (MySQL 8 utilise `utf8mb4_0900_ai_ci` par défaut mais accepte l'autre). |
| Longueur des index | Colonnes indexées limitées à 190 caractères, sûr sur toutes les versions. |
| `DEFAULT (expression)` | Non utilisé. |

Si une différence apparaît sur MySQL 8.4, le message d'erreur de
`php tools/migrate.php` indique le fichier et l'instruction exacte.
