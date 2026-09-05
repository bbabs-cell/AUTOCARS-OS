# Performance — AUTOCARE OS

> Lot 20. Mesuré sur **76 041 opérations, 74 484 encaissements,
> 2 200 clients et 2 750 véhicules** — trois stations, trois ans.

---

## 1. Le premier travail n'était pas de mesurer

Le jeu de démonstration contient une quinzaine d'opérations. Toutes
les requêtes du produit y répondent en une milliseconde, y compris
celles qui parcourent la table entière : MySQL lit quinze lignes plus
vite qu'il ne lit un index.

**Une mesure sur ce jeu-là ne dit rien.** Elle dit seulement que
quinze lignes tiennent en mémoire. Le premier travail de ce lot a donc
été de se donner quelque chose à mesurer.

```bash
php tools/benchmark_seed.php     # ~13 s, fabrique le volume
php tools/benchmark.php          # mesure les écrans
php tools/benchmark_seed.php --purge
```

Les volumes viennent d'une hypothèse assumée : une station bien
remplie traite 25 à 40 véhicules par jour ; trois stations ouvertes
six jours sur sept pendant trois ans font environ 936 jours
d'ouverture chacune. Les chiffres sont regroupés en tête du fichier et
se corrigent en une ligne après le test terrain.

Tout est écrit dans **une entreprise à part** (`banc-de-mesure`), que
`--purge` supprime : on doit pouvoir mesurer le lundi et faire une
capture d'écran le mardi sans reconstruire la base.

---

## 2. Ce qu'on mesure, et comment

**Des écrans, pas des requêtes SQL.** Chronométrer un `SELECT` isolé
donne un chiffre juste et inutile : un écran, c'est une requête HTTP
qui traverse le routeur, le contrôle du jeton, la vérification des
permissions, plusieurs requêtes, puis la mise en forme de la réponse.

**Le 95e centile, pas la moyenne.** Dix-neuf réponses à 40 ms et une à
2 secondes font une moyenne de 138 ms — un chiffre rassurant qui
décrit une expérience que personne n'a vécue.

### Les budgets

Ils sont **décidés**, d'après ce que l'écran sert à faire — jamais
calés sur ce qu'il mesure aujourd'hui. Un budget calé sur la mesure du
jour ne peut pas échouer, donc ne protège de rien.

| Budget | Pour quoi |
|---|---|
| **200 ms** | Ce qu'on ouvre au comptoir, un client devant soi |
| **400 ms** | Ce qu'on consulte assis, une ou deux fois par jour |
| **800 ms** | Ce qui balaie des mois de données, le dimanche soir |

---

## 3. Le résultat

| Écran | Avant | Après | Gain |
|---|---:|---:|---:|
| File d'attente | 84 ms | **4 ms** | ×21 |
| Accueil (dossiers en cours) | 113 ms | **16 ms** | ×7 |
| Tableau de bord | 161 ms | **31 ms** | ×5 |
| Journal des recettes | 213 ms | **76 ms** | ×3 |
| Caisse du jour | 17 ms | **2 ms** | ×8 |
| Statistiques — 90 jours | 208 ms | **125 ms** | ×1,7 |
| Statistiques — 1 an | 644 ms | **326 ms** | ×2 |

Les écrans les plus utilisés sont ceux qui ont le plus gagné, et ce
n'est pas un hasard : ce sont eux qui filtraient sans station, et les
index existants étaient tous construits *avec* la station en tête.

> **Ce sont des rapports, pas des vérités absolues.** Chaque paire
> avant/après a été mesurée à quelques minutes d'intervalle sur la
> même machine, dans le même état — c'est ce qui rend la comparaison
> honnête. Les valeurs elles-mêmes, non : une relance de MySQL, qui
> vide son cache de pages, a donné 481 ms au lieu de 326 pour les
> statistiques sur un an, sans qu'une ligne change.
>
> C'est aussi pourquoi les budgets sont larges. Un budget calé au plus
> près de la mesure du jour se déclencherait au premier redémarrage du
> serveur, et on apprendrait à ignorer l'alerte.

---

## 4. Ce que la mesure a trouvé

### 4.1 Un index qui ne servait qu'à moitié

`idx_operations_queue (organization_id, station_id, status, priority)`
sert parfaitement quand on filtre **sur une station**. Sans ce filtre
— c'est-à-dire pour un propriétaire qui regarde tout son réseau —
MySQL ne peut utiliser que sa première colonne.

La mesure le disait sans ambiguïté : **10 ms filtré sur une station,
87 ms sans filtre**. Pire, faute d'index utilisable, l'optimiseur
partait de la table `services` et triait le résultat dans un fichier
temporaire.

→ `idx_operations_org_status_priority (organization_id, status, priority)`

### 4.2 Une question mal posée, qu'aucun index ne rattrape

« Quels clients reviennent ? » interrogeait une sous-requête corrélée,
réexécutée **pour chaque ligne** de la période : 38 000 fois sur un an,
alors qu'il n'y a que quelques milliers de clients distincts.

Le plan d'exécution était bon. C'est la question qui était mal posée :
on ne peut pas indexer sa sortie d'un mauvais raisonnement. Réécrite
en deux ensembles calculés séparément puis joints, **282 ms → 47 ms**.

L'index qui l'accompagne porte `status` en dernière colonne, et c'est
lui qui fait la différence : sans lui, MySQL trouve les bonnes entrées
puis ouvre chaque ligne pour vérifier qu'elle n'est pas annulée.
**Une colonne d'un octet pour un facteur trois.**

### 4.3 Un écran dont le coût grandissait pour toujours

Les compteurs du tableau de bord — accueillis, restitués, annulés
aujourd'hui — étaient calculés **sans aucun filtre de date**. La
requête parcourait l'historique entier de l'entreprise à chaque
ouverture de l'écran du matin.

Sur quinze opérations, invisible. Sur trois ans, 76 000 lignes lues
pour compter ce qui s'est passé depuis ce matin — et le coût
augmentait avec l'âge du client, indéfiniment.

Les quatre compteurs répondaient en fait à deux questions
différentes : *ce qui a bougé aujourd'hui* (toute ligne concernée
porte un `updated_at` du jour) et *ce qui occupe la station
maintenant* (sans rapport avec une date). Deux requêtes bornées :
**50 ms → 0,8 ms**.

### 4.4 `DATE(colonne) = …` : le défaut le plus répandu du produit

Appliquer une fonction à une colonne oblige MySQL à la calculer sur
**chaque ligne** pour savoir si elle correspond. Aucun index ne peut
alors servir.

Le motif était présent dans cinq requêtes, toutes écrites de bonne foi
parce qu'il se lit très bien. La même question posée en intervalle se
lit directement dans l'index.

Avec l'index qui va avec — `idx_payments_org_paid (organization_id,
paid_at, status, amount)`, couvrant, donc résolu sans jamais ouvrir la
table :

| Requête | Avant | Après |
|---|---:|---:|
| Recette du jour | 21 ms | **0,2 ms** |
| Répartition par moyen de paiement | 21 ms | **0,3 ms** |
| Journal sur 90 jours | 108 ms | **6 ms** |

### 4.5 Un total faux — le meilleur des trouvailles

`PaymentRepository::totals()` calculait la recette d'une période en
**additionnant les lignes du journal**, lui-même limité à 500.

Au-delà de 500 encaissements, le total affiché sous le journal était
**silencieusement inférieur à la recette réelle**. Sur les 90 jours
que propose l'écran, une station active dépasse ce seuil sans rien
remarquer.

Ce n'est pas un problème de performance : c'est un **mensonge sur un
montant**, trouvé par un lot de performance. Il était invisible sur
quinze encaissements de démonstration. Un test écrit 600
encaissements et vérifie que le total les compte tous.

---

## 5. Deux leçons sur l'instrument lui-même

### Un banc de mesure faux est pire que pas de banc

La première version du générateur ne posait pas `updated_at` : les
76 000 dossiers portaient donc tous la date d'**aujourd'hui**. Le
tableau de bord, qui borne ses compteurs à `updated_at >= CURDATE()`,
retrouvait l'historique entier dans cette borne — et le banc accusait
un code qui venait justement d'être corrigé.

Il donne des chiffres, et on les croit. C'est ce qui le rend
dangereux.

### Après une insertion massive, MySQL se trompe d'index

L'optimiseur choisit d'après des statistiques échantillonnées. Après
un chargement en masse, elles décrivent encore une table presque vide.

La file d'attente est passée de **12 ms à 3 ms sur un simple
`ANALYZE TABLE`**, sans qu'une ligne de code change. Le générateur le
fait maintenant en dernier geste — et la leçon vaut aussi en
production, après une restauration de sauvegarde.

---

## 6. Deux tests corrigés, et pourquoi c'est normal

| Test | Ce qu'il vérifiait | Ce qu'il vérifie maintenant |
|---|---|---|
| Index de la file | `key === 'idx_operations_queue'` | Qu'**un** index évite de relire la table (lignes examinées) |
| Données de contrôle | Identifiants `99` | Un numéro hors de portée de toute séquence |

Le premier a échoué le jour où un index **meilleur** a été ajouté : il
nommait une implémentation au lieu de vérifier une propriété. Le
second se croyait seul sur la base ; 2 750 véhicules plus tard, l'un
d'eux portait le numéro 99.

---

## 7. Ce qui reste, et ce qui n'a pas été mesuré

**Les statistiques sur un an coûtent 326 ms**, dans leur budget mais
loin devant le reste. Elles balaient réellement 38 000 lignes : le
coût est en grande partie inhérent. Le jour où il gênera, la réponse
ne sera pas un index de plus mais un **pré-calcul quotidien** — et
c'est une décision qui se prend sur des mesures d'usage réel, pas sur
une hypothèse.

**Le banc ne génère ni rendez-vous, ni fidélité, ni abonnements, ni
pointages.** Ces écrans mesurent donc quelques millisecondes sur des
tables presque vides, et leur mesure ne veut rien dire. Le motif
`DATE(colonne) = …` subsiste d'ailleurs dans deux requêtes de
`BookingRepository` : il n'a pas été corrigé parce qu'aucune mesure ne
l'a montré, et ce lot s'interdit de corriger ce qu'il n'a pas mesuré.
C'est le premier chantier d'une prochaine passe.

**Rien n'a été mesuré côté navigateur.** Le temps d'affichage d'un
écran Angular sur un téléphone d'entrée de gamme, sur une connexion
lente, est une tout autre question — et elle se mesure sur le terrain,
pas ici.
