# Faire tourner AUTOCARE OS en local

Deux commandes, deux terminaux. **L'application Angular n'a pas été
modifiée pour la migration** — c'est ce que cette procédure permet de
vérifier soi-même.

---

## 1. L'API

```bash
cd workers
npx wrangler d1 migrations apply autocare --local   # la première fois
npx wrangler d1 execute autocare --local --file=seed-local.sql --yes
npx wrangler dev --port 8787 --local
```

Le jeu de démonstration crée une entreprise, deux stations, trois
clients, trois véhicules et trois dossiers à des étapes différentes.

**Compte** : `mamadou.diallo@dialloauto.sn` · mot de passe
`Autocare2026!`

---

## 2. L'application

```bash
cd frontend
npm start
```

Sur <http://localhost:4200>.

### Pourquoi un relais, et pas une adresse absolue

`environment.development.ts` vise `/api`, comme la production — pas
`http://localhost:8787/api`. Le serveur de développement d'Angular
relaie vers le Worker (`proxy.conf.json`).

Ce n'est pas un détail de confort. Une adresse absolue rendrait le
développement **croisé** alors que la production est de **même
origine** : le navigateur ajouterait un pré-vol CORS, le cookie de
rafraîchissement changerait de règles, et le Worker devrait porter des
en-têtes qui ne servent qu'en développement — du code de production
écrit pour les besoins du développement.

> Ce fichier a visé `http://localhost:8000/api` — le serveur PHP —
> pendant toute la migration. `npm start` donnait une application qui
> se chargeait, affichait sa page de connexion, et refusait toute
> connexion sans rien dire d'utile : `ERR_CONNECTION_REFUSED` dans la
> console du navigateur, et rien du tout à l'écran.
>
> Personne ne l'avait vu parce que personne n'avait relancé
> `npm start` depuis le début de la migration. C'est exactement ce que
> le lancement réel de la pile sert à trouver.

---

## 3. Les photos

Le ré-encodage passe par la liaison Cloudflare Images, qui fonctionne
en local sans compte. Une photo de téléphone de 213 Ko en 3024 × 4032
ressort en **8,3 Ko de WebP en 1536 × 2048**.

L'implémentation locale de `wrangler dev` est **plus stricte** que
celle du harnais de test : elle refuse une image dont le décodeur émet
le moindre avertissement. Une image légèrement abîmée passe donc les
tests et est refusée ici — ce qui est le bon sens du refus, mais
explique un écart déroutant.

Sur un refus, la cause exacte part dans les traces du Worker
(`Images : ré-encodage impossible — …`) : le message rendu à l'employé
reste vague, parce qu'il n'a rien à faire du détail.

---

## 4. Les tests

```bash
cd workers
npm test          # 658 dans le runtime Workers + 22 pour les outils
npm run typecheck
```

Les tests n'ont besoin **ni** de `wrangler dev`, **ni** du jeu de
démonstration : chacun applique les migrations sur une base vide et
pose ses propres données.
