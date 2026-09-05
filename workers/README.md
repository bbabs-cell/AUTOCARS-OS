# API AUTOCARE OS sur Cloudflare Workers

> **Étapes 1 et 2 faites.** La tranche verticale, puis le schéma
> complet. Le backend PHP reste la référence en service dans
> `../backend/` tant que la migration n'est pas terminée.

---

## Ce que cette étape devait prouver

Avant de s'engager sur seize lots de réécriture, une seule question
méritait une réponse : **ce produit tient-il sur cette pile ?**

Deux routes suffisent à la poser, à condition de les prendre
entières : `POST /api/auth/login` et `GET /api/vehicles` traversent le
jeton, la relecture du rôle en base, le contrôle de permission côté
serveur, une jointure, une recherche, et le cloisonnement entre
clients. Si ces deux-là sont justes, l'architecture tient.

**Réponse : oui, la pile tient.** 61 tests le vérifient dans le vrai
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

npm test                         # 61 tests, dans le runtime Workers
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

## Ce qui est là, et ce qui ne l'est pas

| Fait | Pas encore |
|---|---|
| `POST /api/auth/login` | Le rafraîchissement par cookie tournant (lot 21) |
| `GET /api/vehicles` | Les 86 autres routes |
| Cloisonnement multi-clients, avec son garde-fou | Photos, sauvegardes, contrôle d'avant-vol |
| Matrice des droits, portée à l'identique | Les index de performance (à re-mesurer, pas à recopier) |
| **Les 21 tables**, leurs contraintes et leurs déclencheurs | |

L'application Angular se connecte et affiche ses véhicules. Elle ne
peut pas rester connectée au-delà : `/api/auth/refresh` n'existe pas
encore, et son absence renvoie à l'écran de connexion. C'est le
périmètre de l'étape, pas un défaut.

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
