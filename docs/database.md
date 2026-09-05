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

## Les 21 tables

> **Ce titre annonçait « 14 tables » jusqu'au lot 19**, et le schéma
> ci-dessous s'arrêtait au lot 3. Les six tables ajoutées entre-temps
> étaient bien décrites plus bas dans ce document, mais absentes de la
> vue d'ensemble — c'est-à-dire du seul endroit qu'on lit vraiment
> quand on découvre le projet.

```
organizations                    l'entreprise cliente du SaaS
   ├── users                     comptes de connexion
   ├── stations                  points de service
   │      └── station_users      qui travaille où, avec quel rôle
   ├── customers                 clients de la station
   │      └── vehicles           véhicules, rattachés à un client
   ├── services                  catalogue des prestations
   ├── cash_sessions             journées de caisse (une par station)
   ├── time_entries              pointages (lot 12)
   ├── bookings                  rendez-vous (lot 13)
   ├── loyalty_programs          règles de la carte à tampons (lot 14)
   │      └── loyalty_entries    le grand livre des points
   ├── subscription_plans        forfaits proposés (lot 15)
   │      └── subscriptions      forfaits vendus
   └── operations         ◄──────  LA TABLE CENTRALE
          ├── inspections           état constaté du véhicule
          │      └── inspection_photos   les preuves
          └── payments              encaissements

audit_logs                       qui a fait quoi, et quand
```

Deux tables techniques s'y ajoutent — `refresh_tokens` et
`password_resets` — plus `migrations`, tenue par l'outil.

**Les lots 16, 17 et 18 n'ont ajouté aucune table.** Les statistiques
se contentent d'interroger l'existant ; le multi-stations était prévu
dans le schéma depuis le lot 3 ; l'aide et les écrans d'erreur ne
touchent pas aux données.

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

### `bookings` : une table à part, et pourquoi

Au lot 8, on a écrit qu'il n'y aurait **pas** de table `queue` : la
file d'attente n'est qu'une vue des opérations en cours, et une table
séparée aurait dupliqué un état qui finirait par diverger.

Le lot 13 crée pourtant `bookings`. Ce n'est pas une contradiction, et
la différence est exactement la question à se poser avant de créer
n'importe quelle table :

| | File d'attente | Rendez-vous |
|---|---|---|
| Existe sans opération ? | Non | **Oui** — un client qui ne vient pas laisse une réservation, pas une opération |
| États propres ? | Non, ceux des opérations | **Oui** — `NO_SHOW` n'a aucun sens pour un véhicule présent |
| Client obligatoire en base ? | Oui | **Non** — au téléphone, on note un nom et un numéro |

Une réservation n'est donc pas une opération à un autre statut : c'est
autre chose. Le lien entre les deux est explicite et posé une seule
fois, à l'arrivée : `operation_id`.

### `scheduled_at` est un DATETIME, pas un TIMESTAMP

C'est la seule colonne de date du projet qui ne soit pas un
`TIMESTAMP`, et ce n'est pas une inattention.

Un `created_at` est un **instant** : le moment précis où la ligne a été
écrite. Un rendez-vous est une **lecture d'horloge murale** : « mardi
10 h à la station ». MySQL convertit un `TIMESTAMP` selon le fuseau de
la session ; le jour où le serveur change de fuseau, tous les
rendez-vous passés se décaleraient d'une heure. Un `DATETIME` est
stocké tel qu'écrit.

### Le prix et la durée sont recopiés

Comme sur `operations`, et pour une raison plus forte encore : un
rendez-vous est un **engagement**. Le client a réservé à 5 000 F trois
semaines plus tôt ; le tarif est passé à 6 000 F. Il paie 5 000 F.

C'est ce prix, et non le tarif du jour, que l'opération reprend à
l'arrivée. Voir `docs/api.md`.

### Une seule issue pour les trois fins

Arrivée, absence et annulation sont trois façons de terminer un
rendez-vous. Trois jeux de colonnes (`arrived_at`, `no_show_at`,
`cancelled_at`…) auraient garanti qu'un jour l'une soit renseignée et
l'autre oubliée, et qu'il faille lire les trois pour savoir ce qui
s'est passé.

Un seul triplet : `outcome_at`, `outcome_by_user_id`,
`outcome_reason`. **`status` dit CE QUI s'est passé ; le triplet dit
QUAND, PAR QUI et POURQUOI.**

### La contrainte d'unicité qu'on n'a PAS posée

Les lots 9 et 12 ont chacun ajouté une colonne calculée sous contrainte
`UNIQUE` pour interdire un doublon — une seule caisse ouverte, un seul
pointage ouvert. Le réflexe était de recommencer ici, sur (station,
heure, téléphone), pour qu'un double appui sur « Enregistrer » ne crée
pas deux rendez-vous.

**Ce serait une erreur.** Un gestionnaire de flotte qui envoie trois
véhicules de son entreprise à 10 h donne trois fois le même numéro : la
contrainte refuserait un vrai client, avec un message que personne ne
comprendrait. Le cas est fréquent dans la zone visée.

> **Une contrainte ne se pose que sur une règle vraie TOUJOURS.**
> Contre le double appui, il reste le bouton désactivé pendant
> l'appel — et un doublon visible s'annule en un clic, alors qu'un
> client refusé s'en va.

Un test le vérifie explicitement : deux rendez-vous, même numéro, même
créneau, même station, tous deux acceptés.

### La fidélité : un grand livre, pas un compteur

La tentation était une colonne `customers.loyalty_points` qu'on
incrémente. Elle aurait été fausse au premier incident : un paiement
rejoué, une remise annulée, une transaction interrompue au mauvais
moment, et le nombre affiché ne correspond plus à rien. Personne ne
peut alors dire s'il est trop haut ou trop bas, ni depuis quand.

`loyalty_entries` est un **grand livre** : une ligne par événement, en
ajout seul, et le solde est la **somme** des lignes.

```sql
type   ENUM('EARN', 'REDEEM', 'REVERSAL')
points SMALLINT NOT NULL     -- SIGNÉ : +1, −10, +10
```

`points` est la seule colonne numérique **signée** du projet, et c'est
le propre d'un grand livre : le solde s'obtient par une simple somme,
sans soustraction à faire ni cas particulier à connaître.

On ne modifie jamais une ligne — on en écrit une qui la compense. Même
règle que pour les encaissements (lot 9), et pour la même raison : un
solde qu'on ne peut pas expliquer ne vaut rien.

### Trois colonnes calculées, chacune pour une règle vraie toujours

C'est la troisième fois que le projet emploie le mécanisme des lots 9
et 12 — une colonne calculée sous contrainte `UNIQUE` :

```sql
-- Un seul programme actif par entreprise
active_organization_id AS (IF(status = 'ACTIVE', organization_id, NULL)) STORED

-- Un lavage ne donne qu'un seul tampon
earn_operation_id AS (IF(type = 'EARN', operation_id, NULL)) STORED

-- Une utilisation ne s'annule qu'une fois
reversed_entry_id AS (IF(type = 'REVERSAL', related_entry_id, NULL)) STORED
```

Chacune interdit un doublon que le contrôleur vérifie déjà, mais qu'il
ne peut pas garantir : deux encaissements partis à la même seconde
soldent le dossier en même temps, deux appuis sur « Annuler » rendent
deux fois les tampons. Le contrôleur est la règle ; la base est le
filet.

Le contraste avec le lot 13 est volontaire : là-bas, la contrainte
« évidente » sur (station, heure, téléphone) aurait refusé un vrai
client. **Une contrainte ne se pose que sur une règle vraie toujours.**

⚠️ Les clés étrangères lues par ces colonnes sont en `ON UPDATE
RESTRICT` — MySQL et MariaDB refusent une colonne calculée qui
s'appuie sur une colonne en cascade (erreur 1901). Voir la note de
`cash_sessions`.

### Ce qui était vrai le jour de l'écriture

`loyalty_entries.reward_amount` recopie la valeur de la récompense au
moment de l'écriture. Les règles peuvent changer ; un client qui a
collecté sous « 10 tampons, 5 000 F » ne doit pas se retrouver avec un
historique réécrit parce que le gérant est passé à « 12 tampons,
6 000 F » hier soir.

C'est la même règle que le prix figé d'une opération (lot 7) et d'un
rendez-vous (lot 13).

### `operations.discount_amount` : une remise, pas un encaissement

Quatre colonnes ajoutées à `operations` : `discount_amount`,
`discount_reason`, `discount_by_user_id`, `discounted_at`.

Le raisonnement complet est dans `docs/api.md`. En deux lignes : un
faux paiement « fidélité » aurait fait compter un lavage offert dans
la recette du jour. Une remise diminue **ce qui est dû**, la recette
reste vraie, et le coût du programme devient un chiffre lisible.

Les colonnes sont volontairement **génériques** et non nommées
`loyalty_*` : un geste commercial suivra un jour le même chemin. Elles
ne sont pour autant écrites aujourd'hui que par la fidélité — aucune
route ne permet une remise à la main, parce qu'une remise décidée au
comptoir est une décision d'argent qui mérite son propre examen.

**Conséquence directe :** la formule « ce que le client doit » n'est
plus `price`. Elle était recopiée à cinq endroits ; elle est désormais
écrite une seule fois, dans `OperationRepository::amountDue()`. Une
règle d'argent s'écrit une fois.

### Les abonnements : ce qu'on a choisi de NE PAS stocker

Deux tables, `subscription_plans` et `subscriptions`, et deux absences
volontaires qui résument la philosophie du projet.

**Pas de compteur `washes_used`.** Le nombre de lavages consommés est
`COUNT(operations WHERE subscription_id = X AND status <> 'CANCELLED')`.
Une consommation **est** une opération : il n'y a rien d'autre à
enregistrer. Même raisonnement qu'au lot 8 pour la file d'attente, et
même conséquence heureuse — un lavage annulé revient tout seul dans le
solde du client. Un compteur stocké aurait fallu penser à le
décrémenter là, et personne n'y pense jamais.

**Pas de statuts `EXPIRED` ni `EXHAUSTED`.** « Périmé » se lit dans
`expires_at`, « épuisé » se compte dans les opérations. Les stocker,
c'est promettre de les tenir à jour — donc écrire une tâche planifiée
qui passe chaque nuit, et vivre avec un forfait qui reste actif parce
que la tâche a échoué. La colonne `status` ne connaît donc que
`ACTIVE` et `CANCELLED` : **seule l'annulation est une décision
humaine.**

> **UN STATUT QUI SE CALCULE NE SE STOCKE PAS.**

### Tout est recopié au moment de la vente

`service_id`, `washes_total`, `price_paid` : troisième application de
la règle après le prix d'une opération (lot 7) et celui d'un
rendez-vous (lot 13). Le gérant qui passe son forfait de 10 à
8 lavages le mois prochain ne doit pas en retirer deux à ceux qui ont
déjà payé.

### La validité est obligatoire

Un forfait sans date de fin est une **dette éternelle**. Le client qui
revient trois ans plus tard avec quatre lavages non utilisés a raison
de les réclamer, et la station a encaissé cet argent depuis longtemps.
La durée borne l'engagement, et elle est annoncée au client à l'achat.

### `operations.discount_source` : deux remises qui se ressemblent

Un lavage couvert par un forfait ramène le dû à zéro, exactement comme
une récompense de fidélité. Ils empruntent donc la même colonne
`discount_amount` — mais ne veulent pas dire la même chose :

| `LOYALTY` | La station **donne**. C'est un coût. |
|---|---|
| `SUBSCRIPTION` | Le client a **déjà payé**. C'est une dette qu'on solde. |

Sans cette distinction, le « coût du programme de fidélité » de
l'écran `/loyalty` compterait les lavages d'abonnés.

**La migration 021 rattrape le passé** : les remises antérieures
venaient toutes de la fidélité, elles reçoivent donc
`discount_source = 'LOYALTY'`. Une migration qui ajoute une colonne à
des lignes existantes doit toujours se demander ce que cette colonne
vaut pour le passé — sans quoi un chiffre baisse tout seul le jour de
la mise à jour, et personne ne comprend pourquoi.

### `payments.subscription_id` : un encaissement sans dossier

`payments.operation_id` était **déjà nullable** depuis le lot 9 : un
encaissement n'a jamais été obligé de porter sur un dossier. La vente
d'un forfait s'y glisse donc sans rien casser, et hérite de la
session de caisse, du journal, de la recette et du remboursement.

Un circuit parallèle aurait fallu tout reconstruire — et aurait fini
par en oublier un.

### Une contrainte de plus qu'on ne pose pas

Troisième refus du projet, après (station, heure, téléphone) au lot 13
et « un seul forfait actif » ici : une station en propose plusieurs,
c'est même tout l'intérêt. **On ne contraint que ce qui est vrai
toujours.**

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

> Détail complet des mesures, avant/après : **[docs/performance.md](performance.md)**.

L'index posé au lot 3 pour la file d'attente :

```sql
KEY idx_operations_queue (organization_id, station_id, status, priority)
```

L'ordre des colonnes suit celui du filtrage réel — MySQL ne peut
utiliser un index composé que **de la gauche vers la droite**.

> Piège à connaître : sur une table de quatre lignes, l'optimiseur
> **ignore volontairement** les index — lire quatre lignes coûte moins
> cher que consulter un index puis la table. Vérifier l'usage d'un
> index sur des données de démonstration ne prouve donc rien. C'est
> pourquoi le test charge un volume réaliste, avec une répartition
> réaliste des statuts (2 % d'opérations actives, le reste terminé).

### Ce que le lot 20 a corrigé

Cet index a une limite que seule une mesure à l'échelle a révélée :
`station_id` est en **deuxième** position. Il sert donc parfaitement
quand on filtre sur une station, et presque pas quand on ne filtre pas
— c'est-à-dire pour un propriétaire qui regarde tout son réseau.
Mesuré sur 76 000 opérations : **10 ms filtré, 87 ms sans filtre**.

Quatre index ont été ajoutés (migration 022), chacun après une mesure :

| Index | Ce qu'il sert | Gain mesuré |
|---|---|---|
| `idx_operations_org_status_priority` | File d'attente et dossiers en cours, sans filtre de station | 87 ms → 1,4 ms |
| `idx_operations_org_customer_created` | « Quels clients reviennent ? » | 80 ms → 24 ms |
| `idx_operations_analytics` | Balayages de statistiques (index **couvrant**) | ×1,5 |
| `idx_operations_org_updated` | Compteurs du jour au tableau de bord | 50 ms → 0,8 ms |
| `idx_payments_org_paid` | Recette par date (couvrant) | 21 ms → 0,2 ms |

### Deux règles apprises

**Un index couvrant évite d'ouvrir la table.** Quand toutes les
colonnes lues par la requête sont dans l'index, MySQL n'a plus besoin
de la table — le plan l'annonce par « Using index ». Ajouter `status`
(un octet) à un index a divisé un parcours par trois.

**`DATE(colonne) = …` interdit tout index.** Appliquer une fonction à
une colonne oblige MySQL à la calculer sur chaque ligne. La même
question posée en intervalle (`>= …` et `< … + 1 jour`) se lit
directement dans l'index. Le motif était présent dans cinq requêtes,
toutes écrites de bonne foi.

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
