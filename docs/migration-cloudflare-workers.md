# Migrer le backend vers Cloudflare Workers + D1

> Chiffrage demandé avant décision. Ce document dit ce que la
> migration coûte réellement, mesuré sur le code existant — pas estimé
> à vue.

---

## 1. Ce dont il s'agit vraiment

Ce n'est pas un changement d'hébergeur. **Cloudflare n'exécute pas
PHP.** Migrer vers Workers signifie réécrire l'intégralité du backend
en TypeScript, et remplacer MySQL par D1, qui est du SQLite.

Autrement dit : le backend n'est pas déplacé, il est **refait**.

Il faut le dire clairement une fois, puis passer à l'organisation du
travail — c'est l'objet des sections suivantes.

---

## 2. Ce qui survit, ce qui disparaît

| Survit intact | Est à refaire |
|---|---|
| **Toute l'application Angular** — 73 tests, la charte figée au lot 2, les 28 refus documentés | Les 20 contrôleurs |
| Le **cahier des charges** : 77 exigences, 11 règles métier | Les 20 dépôts de données |
| Les **règles métier en tant que spécification** — elles sont écrites, testées, connues | Les 88 routes |
| La **grille d'observation terrain** | Les 22 migrations |
| `vercel.json`, le domaine, R2, les DNS | Les 19 suites de tests (900 tests) |
| Les décisions de conception (multi-tenance, permissions serveur, refus) | L'outillage : sauvegarde, restauration, contrôle d'avant-vol, banc de mesure |

**Ce qui se garde est ce qui a demandé le plus de réflexion ; ce qui se
perd est ce qui a demandé le plus de frappe.** C'est la seule bonne
nouvelle de ce document, mais elle est réelle : on ne repart pas d'une
page blanche, on repart d'une spécification éprouvée.

---

## 3. L'inventaire, mesuré

| | Quantité |
|---|---|
| Lignes de PHP dans `src/` | **15 963**, en 60 fichiers |
| Total avec l'outillage | **19 163**, en 74 fichiers |
| Contrôleurs | 20 |
| Dépôts de données | 20 |
| Routes | 88 |
| Tables | 22 |
| Migrations | 22 |
| Requêtes SQL écrites à la main | 132 |
| Appels PDO à réécrire | **271** |
| Suites de tests | 19 (900 tests) |

---

## 4. Les six obstacles, et ce qu'ils coûtent

### 4.1 PDO → D1 · **271 endroits**

Chaque requête passe aujourd'hui par PDO avec `ATTR_EMULATE_PREPARES`
à `false`. L'API de D1 (`prepare().bind().all()`) est différente dans
sa forme comme dans son comportement.

Le point délicat : **9 transactions** (`beginTransaction` / `commit` /
`rollBack`), dont celle qui crée une organisation et son
administrateur en un seul tout. D1 **n'a pas de transaction
interactive** : il propose `batch()`, qui exécute une liste
d'instructions préparées d'avance, sans possibilité de décider de la
suivante d'après le résultat de la précédente.

Les neuf transactions doivent donc être réexaminées une par une.
Certaines entrent dans un `batch()`. Les autres demandent de repenser
la logique. Aucun verrou `FOR UPDATE` n'est utilisé — c'est autant de
gagné.

### 4.2 MySQL → SQLite · les 22 migrations

| Ce qui n'existe pas en SQLite | Occurrences | Remplacement |
|---|---|---|
| `ENUM(...)` | 22 | `TEXT` + contrainte `CHECK` |
| `AUTO_INCREMENT` | 21 | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `utf8mb4` / `COLLATE` | 22 | rien à faire : SQLite est UTF-8 |
| `ON UPDATE CURRENT_TIMESTAMP` | 16 | un déclencheur par table, ou le faire dans le code |
| `UNSIGNED` | (dans 124 lignes) | contrainte `CHECK (colonne >= 0)` |

**Le `UNSIGNED` mérite qu'on s'y arrête.** Aujourd'hui, MySQL refuse
physiquement un prix négatif. En SQLite, sans un `CHECK` explicite,
plus rien ne l'empêche. Ce serait une protection perdue en silence,
exactement le genre de régression que ce projet a passé son temps à
traquer.

**La bonne nouvelle :** l'argent est stocké en `BIGINT` — des FCFA
entiers, jamais en décimal. Le portage vers `INTEGER` est exact, sans
le moindre risque d'arrondi. La décision prise aux premiers lots paie
ici.

Les fonctions de date sont à réécrire : `CURDATE()` (17 usages),
`NOW()` (17), `TIMESTAMPDIFF` (6), `GROUP_CONCAT` (3), `DATE_ADD` (2).
`COALESCE` (40) existe en SQLite et ne bouge pas.

### 4.3 bcrypt → PBKDF2 · **et c'est gratuit aujourd'hui, cher demain**

Les mots de passe utilisent `password_hash` (bcrypt). Les Workers
n'ont que la Web Crypto, qui **ne fait pas bcrypt**. Il faut passer à
PBKDF2, ou embarquer bcrypt en WebAssembly.

Conséquence : **les empreintes existantes deviennent invérifiables.**
Chaque utilisateur devrait refaire son mot de passe.

Or, aujourd'hui, il n'y a **aucun compte réel** — le produit n'est pas
en service. Ce coût est donc **nul en ce moment, et seulement en ce
moment**. C'est l'argument le plus solide en faveur de migrer
maintenant plutôt qu'après le test terrain.

### 4.4 Les images · **une régression de sécurité à décider**

`PhotoStorage` fait deux choses que Workers ne sait pas faire :

1. **`finfo`** lit le type réel dans les premiers octets du fichier, au
   lieu de croire son extension. Remplaçable à la main par une lecture
   des octets de signature — une trentaine de lignes.
2. **`gd` ré-encode l'image** (14 appels). C'est ce ré-encodage qui
   neutralise une charge malveillante dissimulée dans un fichier
   image : on ne réutilise jamais les octets reçus, on en fabrique de
   nouveaux à partir des pixels.

**Il n'y a pas d'équivalent gratuit du point 2 sur Workers.** Trois
issues, à choisir en connaissance de cause :

| Option | Ce qu'elle coûte |
|---|---|
| Faire confiance au WebP produit par le navigateur | Une protection perdue. Le client compresse déjà, mais un client n'est jamais une garantie : n'importe qui peut appeler l'API directement |
| **Cloudflare Images** | Un service payant en plus, qui fait le ré-encodage |
| Ré-encoder en WebAssembly dans le Worker | Faisable, mais coûteux en temps de calcul et en travail |

### 4.5 Les sauvegardes · tout l'outillage

`mysqldump` n'existe plus. D1 a son propre export. Sont à refaire :
`backup.php`, `restore.php`, le manifeste SHA-256, la rétention, et
les **18 tests** qui sauvegardent, détruisent un témoin, restaurent et
vérifient qu'il est revenu.

`deploy/backup-offsite.sh` **reste valable** : la destination R2 ne
change pas, seule la source change.

### 4.6 Les mesures du lot 20 · à refaire entièrement

Les cinq index de performance ont été choisis en lisant le plan
d'exécution de MySQL, sur 76 041 opérations réelles. **Le planificateur
de SQLite est différent.** Ces index ne sont pas transposables par
copie : ils sont à re-mesurer, ou ils ne veulent plus rien dire.

Le banc de mesure (`benchmark.php`, `benchmark_seed.php`) est lui aussi
à réécrire. Il faudra aussi vérifier les limites propres à D1 — taille
maximale de base et débit — sur des volumes réalistes.

---

## 5. Ce que ça coûte

Exprimé dans l'unité de ce projet — le lot — et non en semaines, qui
ne voudraient rien dire sans connaître votre rythme :

| Chantier | Lots |
|---|---|
| Socle : routeur, authentification, multi-tenance, permissions | 3 |
| Schéma D1 et les 22 migrations | 2 |
| Les 20 dépôts et les 132 requêtes | 3 |
| Les 20 contrôleurs et 88 routes | 3 |
| Photos, stockage R2, sécurité des envois | 1 |
| Sauvegarde, restauration, contrôle d'avant-vol | 1 |
| Réécriture des 900 tests | 2 |
| Performance : re-mesurer et ré-indexer | 1 |
| **Total** | **≈ 16 lots** |

À titre de comparaison : **le produit entier en a demandé 22**, dont la
partie frontend qui, elle, ne bouge pas.

**Le test terrain recule d'autant.** C'est le vrai coût, plus que le
temps de développement : le produit attend depuis le lot 10 que
quelqu'un s'en serve pour travailler.

---

## 6. Le plan, si vous confirmez

Chaque étape s'arrête et attend votre validation, comme les 22
précédentes.

| # | Étape | Ce qui la termine |
|---|---|---|
| 1 | ~~**Une tranche verticale d'abord** : connexion + liste des véhicules~~ **— FAITE** | ✅ 45 tests dans le runtime Workers ; l'application Angular affiche ses véhicules sans avoir été modifiée. Voir [`workers/README.md`](../workers/README.md) |
| 2 | Le schéma D1 complet et ses contraintes `CHECK` | Les 22 tables, avec les garde-fous que `UNSIGNED` assurait |
| 3 | Le socle : multi-tenance, permissions, jetons | Les tests d'isolation repassent, réécrits |
| 4 | Les dépôts et contrôleurs, par domaine métier | Domaine par domaine, avec ses tests |
| 5 | Photos et envois | Après votre décision du §4.4 |
| 6 | Sauvegarde, restauration, avant-vol | Une restauration d'essai réussie |
| 7 | Performance | Des mesures neuves, pas des index copiés |

**L'étape 1 est la plus importante.** Elle coûte peu et elle répond
avant tout engagement à la seule question qui compte : est-ce que ce
produit tient sur cette pile ? Si une contrainte de D1 ou de Workers
rend l'une des règles métier impraticable, il vaut mieux le découvrir
en une étape qu'en seize.

---

## 6 bis. Ce que l'étape 1 a appris — et qui change une ligne du tableau

**La pile tient.** Les deux routes fonctionnent de bout en bout, le
cloisonnement multi-clients est vérifié, et le frontend n'a pas bougé
d'une ligne.

Un constat, en revanche, n'était pas dans le chiffrage initial :

> **Le plan gratuit de Cloudflare ne peut pas héberger la connexion.**
>
> Il limite chaque requête à 10 ms de temps de calcul. Le hachage du
> mot de passe en coûte 92 ms à la valeur recommandée — et déjà 8 ms
> à 50 000 itérations, en dessous de toute recommandation sérieuse.
> Un plan payant (5 $/mois) est nécessaire, et suffit largement.

Cela ne remet pas la migration en cause, mais cela corrige le tableau
du §7 : l'hébergement Cloudflare n'est pas gratuit pour cet usage.
C'est précisément le genre de contrainte que la tranche verticale
devait faire apparaître en une étape plutôt qu'en seize.

---

## 7. Ce que je dois dire une fois, puis plus

Vous avez tranché en connaissance de cause, et ce document sert à
préparer le travail, pas à rouvrir le débat. Un seul rappel factuel,
pour qu'il soit écrit quelque part :

| | Rester sur PHP/MySQL | Aller sur Workers/D1 |
|---|---|---|
| Développement | 0 lot | ≈ 16 lots |
| Test terrain | possible dès l'hébergement en place | repoussé d'autant |
| Hébergement | 2 à 5 €/mois (mutualisé) ou 5 à 10 € (VPS) | ~~inclus~~ **5 $/mois minimum** — le plan gratuit ne peut pas hacher un mot de passe (mesuré à l'étape 1) |
| Serveur à administrer | aucun en mutualisé | aucun |
| Ré-encodage des images | gratuit, déjà là | payant ou perdu |

Le gain réel de Workers n'est pas l'économie — un mutualisé coûte le
prix de deux cafés. C'est de **n'avoir qu'un seul fournisseur** et
aucune machine à surveiller. Si c'est ce que vous cherchez, la
migration se défend ; si c'est le prix ou l'administration, un
hébergement mutualisé donne le même résultat pour zéro lot.

**Un point de calendrier, lui, est objectif :** si cette migration doit
se faire, elle doit se faire **avant** la mise en service. Les
empreintes de mots de passe (§4.3) et les données réelles rendraient
l'opération nettement plus coûteuse ensuite.

---

## 8. Ce que j'attends de vous

1. **Confirmez** la migration, ou dites-moi que le chiffrage change
   votre avis — les deux réponses sont utiles et aucune ne me fera
   perdre de travail.
2. Si vous confirmez : **la décision du §4.4** sur le ré-encodage des
   images. Elle conditionne l'étape 5, mais pas les étapes 1 à 4 : je
   peux commencer sans.
3. Je lancerai alors **l'étape 1 seule**, et je m'arrêterai.
