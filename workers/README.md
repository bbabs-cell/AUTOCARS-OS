# API AUTOCARE OS sur Cloudflare Workers

> **Étape 1 de la migration : la tranche verticale.**
> Deux routes, mais de bout en bout. Le backend PHP reste la
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

**Réponse : oui, la pile tient.** 45 tests le vérifient dans le vrai
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

npm test                         # 45 tests, dans le runtime Workers
npm run typecheck                # les deux tsconfig
npm run dev                      # API locale sur :8787
```

> **`--legacy-peer-deps`** contourne un défaut d'`npm` 10.9.7
> (`Cannot read properties of null (reading 'edgesOut')`) sur ce graphe
> de dépendances. Ce n'est pas un vrai conflit de versions :
> `@cloudflare/vitest-pool-workers` demande `vitest ^4.1.0` et c'est
> bien la 4.1.11 qui est installée.

---

## Ce qui est là, et ce qui ne l'est pas

| Fait | Pas encore |
|---|---|
| `POST /api/auth/login` | Le rafraîchissement par cookie tournant (lot 21) |
| `GET /api/vehicles` | Les 86 autres routes |
| Cloisonnement multi-clients, avec son garde-fou | 17 des 22 tables |
| Matrice des droits, portée à l'identique | Photos, sauvegardes, contrôle d'avant-vol |
| 5 tables, contraintes `CHECK`, déclencheurs `updated_at` | Les index de performance (à re-mesurer, pas à recopier) |

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
