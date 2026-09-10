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

---

## Les tests sont très lents sous Windows

Symptôme : `npm test` met 15 à 20 minutes au lieu d'une minute, et une
partie des tests échoue sur `Test timed out`.

La cause n'est pas le projet. `workerd` — le moteur qui exécute les
tests — crée et détruit beaucoup de petits fichiers dans `.wrangler`.
L'antivirus de Windows analyse chacun d'eux, ce qui multiplie le coût
des entrées-sorties par un facteur de l'ordre de 25.

Les délais du harnais sont réglés à 30 secondes précisément pour que la
suite reste juste sur une machine lente (voir `vitest.config.ts`), donc
elle passe — simplement lentement.

Deux leviers, dans cet ordre.

**1. Réduire la concurrence.** Chaque travailleur Vitest refait la mise
en place complète en même temps que les autres, et ils se disputent le
disque. En réduire le nombre rend chaque test plus rapide :

```powershell
npm test -- --maxWorkers=2
```

C'est ce qui empêche un test lent de dépasser son délai. Ce n'est pas
réglé dans `vitest.config.ts` : sur une machine normale, le parallélisme
complet fait passer la suite en 69 s, et l'imposer à tous coûterait
cette vitesse pour le confort d'un poste.

**2. Écarter l'antivirus.** Excluez le dossier de travail de l'analyse
en temps réel :

> **Sécurité Windows** → **Protection contre les virus et menaces** →
> **Gérer les paramètres** → **Exclusions** → **Ajouter une exclusion**
> → **Dossier** → `AUTOCARS-OS\workers\.wrangler`

N'excluez que ce dossier : il ne contient que l'état de travail du
moteur local, régénéré à volonté. Exclure le dépôt entier reviendrait à
ne plus analyser le code que vous téléchargez.
