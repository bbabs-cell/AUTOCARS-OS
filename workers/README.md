# API AUTOCARE OS sur Cloudflare Workers

> **Étapes 1 à 3 faites, étape 4 commencée.** La tranche verticale, le
> schéma complet, le socle d'authentification, puis le cœur métier :
> les opérations et la file d'attente. Le backend PHP reste la
> référence en service dans `../backend/` tant que la migration n'est
> pas terminée.

---

## Ce que cette étape devait prouver

Avant de s'engager sur seize lots de réécriture, une seule question
méritait une réponse : **ce produit tient-il sur cette pile ?**

Deux routes suffisent à la poser, à condition de les prendre
entières : `POST /api/auth/login` et `GET /api/vehicles` traversent le
jeton, la relecture du rôle en base, le contrôle de permission côté
serveur, une jointure, une recherche, et le cloisonnement entre
clients. Si ces deux-là sont justes, l'architecture tient.

**Réponse : oui, la pile tient.** 197 tests le vérifient dans le vrai
runtime Workers, et l'application Angular existante fonctionne contre
cette API **sans une ligne modifiée**.

---

## Ce que la mesure a révélé, et qu'aucune lecture n'aurait donné

### Le plan gratuit de Cloudflare ne peut pas héberger la connexion

Le plan gratuit limite chaque requête à **10 ms de temps de calcul**.
Coût de PBKDF2 mesuré dans le runtime Workers :

| Itérations | Temps |
|---:|---:|
| 50 000 | 8 ms |
| 100 000 | 14 ms |
| 150 000 | 23 ms |
| 210 000 | 32 ms |
| 300 000 | 47 ms |
| **600 000** *(valeur retenue)* | **92 ms** |

Même 50 000 itérations — en dessous de toute recommandation — frôlent
déjà la limite, avant même de compter la requête à la base et la
signature du jeton. **Un plan payant est nécessaire.** Le plan payant
(30 s de calcul) l'absorbe sans difficulté, et 92 ms par connexion
restent négligeables à l'échelle d'une station.

Mesure faite en local ; l'ordre de grandeur, lui, ne dépend pas de la
machine.

### Les autres constats

| Constat | Conséquence |
|---|---|
| `Date.now()` et `performance.now()` avancent bien dans le runtime | On peut mesurer le coût réel, donc l'encadrer par un test |
| D1 applique `CHECK` sans difficulté | Les `ENUM` et `UNSIGNED` de MySQL sont remplaçables sans perte |
| Le contrat d'API se reproduit à l'identique | Le frontend n'a pas bougé — c'est vérifié, pas supposé |
| Aucune API Node n'est disponible | La séparation des `tsconfig` en fait un garde-fou, pas une surprise |

---

## Démarrer

```bash
npm install --legacy-peer-deps   # voir la note plus bas
cp .dev.vars.example .dev.vars   # puis remplir JWT_SECRET
npm run types                    # engendre worker-configuration.d.ts

npm test                         # 197 tests, dans le runtime Workers
npm run typecheck                # les deux tsconfig
npm run dev                      # API locale sur :8787
```

> **`--legacy-peer-deps`** contourne un défaut d'`npm` 10.9.7
> (`Cannot read properties of null (reading 'edgesOut')`) sur ce graphe
> de dépendances. Ce n'est pas un vrai conflit de versions :
> `@cloudflare/vitest-pool-workers` demande `vitest ^4.1.0` et c'est
> bien la 4.1.11 qui est installée.

---

## Étape 2 — le schéma complet

**21 tables, 289 colonnes, portées à l'identique.** La comparaison
colonne par colonne avec MySQL ne montre aucun écart.

La conversion a été faite par un script, puis **relue** — et la
relecture a payé trois fois :

| Trouvé | Ce que ça aurait donné |
|---|---|
| Le script écrivait les valeurs d'`ENUM` en minuscules (`'open'`) alors que le défaut est `'OPEN'` | **Aucune ligne n'aurait pu être insérée** dans onze tables |
| Dix-sept colonnes manquaient aux tables de l'étape 1, écrites à la main et minimales | Une erreur au premier écran qui les lit |
| `users.status` acceptait `('ACTIVE','SUSPENDED')` là où MySQL déclare `('ACTIVE','INVITED','DISABLED')` | Un compte invité refusé par la base |

Le troisième est le plus instructif : une énumération recopiée de
mémoire plutôt que du schéma, invisible tant que rien n'y touchait.
Les deux migrations ont donc été **régénérées** depuis MySQL par le
même script — possible sans danger uniquement parce que rien n'est
déployé.

### Ce que D1 fait, vérifié et non supposé

| Question | Réponse |
|---|---|
| **Les clés étrangères sont-elles appliquées ?** | **Oui.** SQLite ne les applique historiquement que si un `PRAGMA` l'active ; D1 le fait. Trois tests le prouvent — un dossier ne peut pas désigner un véhicule inexistant |
| Les `CHECK` refusent-ils vraiment ? | Oui : prix négatif, statut inventé, type de véhicule inconnu, JSON invalide — chacun a son test |
| Une colonne unique accepte-t-elle plusieurs `NULL` ? | Oui, comme MySQL. C'est ce qui fait tenir la règle « une seule caisse ouverte par station » sans code |
| Les déclencheurs remplacent-ils `ON UPDATE` ? | Oui. Un test vérifie la règle — toute table avec `updated_at` a le sien — plutôt que de compter |

### L'exception qui prouve la fidélité du port

`cash_sessions.difference` est le **seul entier signé** du schéma : il
n'a pas de `CHECK (>= 0)`, parce que c'est l'écart de caisse et qu'une
caisse peut manquer. Lui coller la contrainte par réflexe aurait rendu
impossible d'enregistrer un manque — exactement ce que le lot 12
voulait rendre visible. La conversion l'a préservé parce que MySQL ne
le déclarait pas `unsigned`.

---

## Étape 3 — le socle d'authentification

**L'application reste connectée.** C'est ce qui manquait : un
rechargement de page la renvoyait à l'écran de connexion. Le
rafraîchissement par cookie tournant du lot 21 est porté, et la
session survit désormais à un rechargement complet.

### Ce que le chiffrage croyait perdu, et qui ne l'est pas

Le §4.1 annonçait les 9 transactions du PHP comme le point le plus
délicat : D1 n'a pas de transaction interactive, et il faudrait
« repenser la logique » de celles qui ont besoin du résultat d'une
insertion pour la suivante.

**Deux essais ont montré que ce n'est pas nécessaire :**

| Vérifié | Conséquence |
|---|---|
| `last_insert_rowid()` fonctionne **à l'intérieur** d'un `batch()` | La seconde insertion peut désigner la ligne créée par la première |
| Un `batch()` qui échoue en cours de route ne laisse **rien** | Il est bien atomique |

`POST /api/auth/register` crée donc l'organisation, l'administrateur,
sa station et son rattachement en un seul `batch()` — même garantie
qu'en PHP, écriture différente, logique inchangée.
`test/transactions.test.ts` fige ces deux comportements de la
plateforme.

### La rotation et la détection de rejeu

Chaque rafraîchissement révoque le jeton présenté et en émet un
nouveau. Si un jeton **déjà révoqué** revient, deux personnes
détiennent la même session : on ne sait pas laquelle se présente, donc
on ferme **tout** pour cet utilisateur et on l'inscrit au journal
d'audit.

C'est brutal — le propriétaire légitime est déconnecté lui aussi — et
c'est le comportement voulu au lot 21 : mieux vaut une reconnexion
qu'un intrus qui reste. Quatorze tests couvrent la rotation, le rejeu,
la déconnexion sélective et la révocation immédiate.

> Cette détection n'est utilisable que parce que l'application
> Angular ne lance **qu'un seul rafraîchissement à la fois**. Livrée
> seule au lot 21, elle déconnectait tout le monde à chaque
> expiration : une quinzaine de requêtes parallèles déclenchaient
> chacune leur rafraîchissement, et le second passait pour un rejeu.
> Le correctif client existe déjà — rien à changer au frontend.

### Le cookie, et ce qui n'y est pas

`HttpOnly` (une faille XSS ne donne pas la session) · `SameSite=Strict`
(protection CSRF sans jeton supplémentaire) · `Path=/api/auth` (les 88
autres routes ne le voient jamais) · `Secure` hors développement.

Le **jeton d'accès**, lui, n'est pas dans un cookie : il vit en mémoire
dans l'application. Un cookie serait envoyé automatiquement partout,
ce qui est exactement ce qu'on ne veut pas d'un jeton porteur. Un test
vérifie qu'il n'apparaît dans aucun en-tête `Set-Cookie`.

---

## Étape 4 (en cours) — le cœur métier

**La file d'attente fonctionne**, avec ses cinq colonnes, ses cartes
et ses alertes de dépassement. La machine à états et ses refus sont
portés à l'identique.

### Le défaut qui a coûté le plus cher à trouver

L'API répondait 200. La file affichait **une** carte, puis plus rien :
quatre colonnes vides, aucune erreur en console, et le sous-titre
figé sur « Chargement… ».

La cause : sur les trente-six champs du modèle `Operation`, la
première version n'en envoyait qu'une quinzaine. Le gabarit Angular
lisait `operation.is_overdue`, absent — et le rendu s'arrêtait là, en
silence.

**Le symptôme ne désignait pas la cause.** On cherche du côté du
chargement, du cache, des colonnes ; le problème est un champ manquant
dans une carte. Trois vérifications successives ont été nécessaires
pour l'établir : `curl` (correct), une requête authentifiée depuis la
page (correcte), puis l'inspection du DOM — cinq colonnes présentes,
quatre sans titre.

Un test fige désormais la liste des trente-six clés, **recopiée du
modèle du frontend et non du code serveur** : un test qui recopierait
l'implémentation ne vérifierait rien.

### Ce que la construction a révélé d'autre

| Trouvé | Ce que ça aurait donné |
|---|---|
| **Dix droits manquaient à l'employé** dans la matrice, recopiée à l'étape 1 depuis une sortie de terminal tronquée | Un employé ne pouvait ni accueillir un véhicule, ni faire avancer un dossier, ni pointer |
| `TenantDb` liait toujours l'organisation **en premier** | Dans `UPDATE … SET x = ? WHERE {ORG}`, l'organisation partait dans la colonne `x` : la mise à jour ne touchait aucune ligne, sans erreur |
| Le statut d'un paiement réglé est `PAID`, pas `CONFIRMED` | Le garde « véhicule impayé » aurait bloqué **toute** restitution, même payée |
| Le droit s'appelle `operations.update_status` | Aucun employé n'aurait pu déplacer une carte |

Les trois premiers étaient muets. C'est la construction du domaine
métier qui les a fait apparaître — pas une relecture.

### L'argent — encaissements et caisse

| Refus | Ce qui l'exerce |
|---|---|
| **Un trop-perçu** est refusé | C'est presque toujours une faute de frappe — 50 000 au lieu de 5 000 — et une fois enregistrée, elle fausse la caisse du soir sans que personne ne comprenne pourquoi |
| Un montant **décimal** est refusé | Le franc CFA n'a pas de centimes ; l'accepter créerait des arrondis dans une caisse qui doit tomber juste |
| **On ne corrige pas un encaissement**, on le rembourse | Modifier une ligne enregistrée effacerait la trace de l'erreur. Le remboursement écrit deux lignes, motif obligatoire, et aucune ne compte plus dans le total |
| **Une seule caisse ouverte** par station | Une clé unique dans le schéma, pas une vérification qu'un contrôleur pourrait oublier |
| **L'écart ne s'ajuste pas** | Une caisse dont on peut réécrire le résultat ne prouve plus rien. Il se constate, il se commente, il ne s'efface pas |
| La recette **n'est pas visible de tous** | `payments.journal` et `cash.view`, vérifiés côté serveur. Un employé voit ce qui a été réglé sur le dossier qu'il rend, pas la recette du jour |

Deux distinctions que la migration a préservées :

- **`difference` est le seul entier signé du schéma.** Un manque
  s'enregistre en négatif, et la base l'accepte — c'était l'objet de
  l'exception notée à l'étape 2.
- **Le mobile money compte dans la vacation, pas dans le tiroir.** Une
  session de caisse n'est pas un tiroir mais une vacation au comptoir ;
  confondre les deux ferait apparaître un écart énorme tous les soirs.

### Le tableau de bord — la sécurité par ce qu'on n'envoie pas

Tous les rôles peuvent l'ouvrir ; le **contenu** dépend des droits, et
c'est une décision de sécurité, pas d'ergonomie.

**Les blocs financiers ne sont pas masqués : ils ne sont pas envoyés.**
Masquer un bloc dans Angular ne protégerait rien — l'onglet réseau du
navigateur montre la réponse brute, et n'importe qui peut appeler
l'API directement.

Un test le vérifie de la façon la plus bête et la plus sûre : le
montant encaissé **ne doit apparaître nulle part dans le corps de la
réponse** d'un employé, sous aucune forme. Même les prestations les
plus demandées lui parviennent sans leur total.

Les alertes suivent la même règle qu'en PHP : **une alerte qu'on ne
peut pas faire disparaître n'est pas une alerte**, c'est une
décoration qu'on cesse de regarder au bout d'une semaine. Chacune a
son test d'extinction — l'impayé disparaît quand on encaisse, l'alerte
de caisse quand on ouvre la vacation.

### Les clients — le téléphone comme clé

Le téléphone est **obligatoire** : c'est le seul moyen fiable de
rappeler quelqu'un dont la voiture est prête. Un client sans numéro
est un véhicule qu'on ne peut pas rendre.

Il est aussi **unique par organisation** : deux fiches pour un même
numéro, ce sont deux historiques pour une seule personne — et une
fidélité coupée en deux. Le refus dit à qui appartient le numéro.

`total_spent` ne compte que les paiements **réellement encaissés** :
un dossier créé mais impayé ne fait pas d'un client un bon client.

La modification passe par une **liste blanche de colonnes**. Sans
elle, un corps de requête portant `organization_id` déplacerait un
client chez un concurrent — le genre de défaut qu'on ne trouve jamais
par hasard. Un test l'essaie.

### Encore un contrat deviné plutôt que lu

Même défaut qu'avec les opérations, en plus petit : mon `/api/cash/open`
exigeait un `station_id` que **le frontend n'envoie pas** — au comptoir
on ouvre la caisse de sa station, on ne la choisit pas. L'API répondait
422 et l'écran était inutilisable, ce qui ne se voyait qu'en cliquant.

`/api/cash/current` avait le même défaut : il manquait `movements` et
`cash_outside_session`, et l'écran affichait « aucun encaissement »
alors qu'il y en avait un.

**La règle, désormais appliquée sans exception : lire le modèle du
frontend avant d'écrire le contrôleur.**

### Les refus, tenus par le serveur

| Refus | Ce qui l'exerce |
|---|---|
| Aucune étape ne se saute | La table de transitions, testée exhaustivement |
| Pas de lavage sans **inspection d'entrée** | Une garde, avec un message qui explique pourquoi |
| Pas de restitution d'un **véhicule impayé** | Une garde, code **402**, et une dérogation réservée à un responsable — tracée nominativement au journal |
| Le contrôle qualité peut renvoyer au lavage | La table : c'est tout l'intérêt d'un contrôle que de pouvoir dire non |

---

## Ce qui est là, et ce qui ne l'est pas

| Fait | Pas encore |
|---|---|
| `login`, `register`, `refresh`, `logout`, `me` | Les 65 autres routes |
| `vehicles`, `queue`, `stations`, changement de statut | Photos, sauvegardes, contrôle d'avant-vol |
| Encaissements, remboursements, journal | |
| Caisse : ouverture, clôture, écart, historique | |
| **Tableau de bord, alertes** | |
| **Clients : liste, fiche, création, modification** | |
| Cloisonnement multi-clients, avec son garde-fou | Les index de performance (à re-mesurer, pas à recopier) |
| Matrice des droits, portée à l'identique | |
| Les 21 tables, leurs contraintes et leurs déclencheurs | |
| **Sessions tournantes, journal d'audit** | |

L'application Angular se connecte, **reste connectée** et affiche ses
véhicules. Les écrans qui appellent des routes non encore portées
(tableau de bord, file d'attente…) restent vides : c'est le périmètre
des étapes suivantes, pas un défaut.

---

## Les décisions structurantes de cette tranche

### `TenantDb` — rendre l'oubli impossible

Une requête métier qui oublie `organization_id` montre les données
d'un client à un autre. La parade n'est pas la vigilance : `select()`
injecte le filtre lui-même et **refuse** une requête dont le marqueur
`{ORG}` est absent. Écrire une requête cloisonnée est plus court que
d'en écrire une qui ne l'est pas.

### Le rôle est relu en base à chaque requête

Le jeton ne porte que l'identifiant. Le rôle, les stations et le
statut viennent de la base, à chaque appel. C'est plus coûteux, et
c'est ce qui fait qu'un compte suspendu perd ses droits
**immédiatement** — pas dans trente minutes.

### PBKDF2, et ce qu'il coûte

bcrypt n'existe pas sur Workers. Les empreintes du PHP deviennent donc
invérifiables : chaque utilisateur devrait refaire son mot de passe.
**Ce coût est nul aujourd'hui**, aucun compte réel n'existant — et il
ne le sera plus après la mise en service.

Le format d'empreinte porte son propre nombre d'itérations, pour que
l'augmenter un jour ne déconnecte pas tout le monde.

### Les droits n'ont pas été repensés

La matrice est recopiée de `config/permissions.php`, à l'identique.
Changer une règle métier en même temps qu'on change de langage, c'est
se priver du seul repère qui dise si la réécriture est fidèle.
