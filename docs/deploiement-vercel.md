# Mise en ligne sur Vercel

> Ce document complète [`deploiement.md`](deploiement.md), qui décrit
> la mise en ligne sur un serveur unique. Ici, l'application est
> coupée en deux parce que Vercel impose de la couper en deux.

---

## 1. Ce que Vercel fait, et ce qu'il ne fait pas

**Vercel n'exécute ni PHP ni MySQL.** Ce n'est pas une limite de
configuration à contourner : la plateforme sert des fichiers statiques
et des fonctions JavaScript. Le backend d'AUTOCARE OS est écrit en PHP
et parle à MySQL ; il ne peut pas y vivre.

| | Vercel | Ce qu'il faut ailleurs |
|---|---|---|
| Application Angular (fichiers compilés) | ✅ c'est son métier | — |
| API PHP | ❌ | un hébergeur PHP 8.2+ |
| Base MySQL | ❌ | le même hébergeur, ou un MySQL managé |
| Photos d'inspection | ❌ disque éphémère | le même hébergeur |
| Sauvegardes automatiques | ❌ pas de tâche planifiée | le même hébergeur |

**Il faut donc deux hébergements.** Et puisqu'il en faut un pour PHP et
MySQL de toute façon, il faut savoir que **cet hébergeur-là pourrait
aussi servir l'application Angular** — c'est exactement ce que décrit
`deploiement.md`, et cette configuration a été essayée et validée. Le
choix de Vercel ajoute une plateforme, un tableau de bord et une carte
bancaire internationale ; il apporte en échange un réseau de diffusion
mondial et des mises en ligne automatiques à chaque `git push`.

Ce document suppose que le choix est fait. Il ne le rediscute pas.

---

## 2. L'architecture retenue

Vous avez indiqué qu'un sous-domaine vous suffit. On part donc de
votre domaine existant, appelé ici `mon-entreprise.sn` :

```
                 le navigateur ne parle QU'À app.mon-entreprise.sn
                                    │
        app.mon-entreprise.sn ──────┤
        (Vercel : Angular)          │
                                    │  réécriture /api/*
                                    ▼
        api.mon-entreprise.sn ── API PHP + MySQL + photos
        (votre hébergeur)
```

**Le point important : le navigateur ne voit qu'une seule origine.**
Vercel relaie `/api/*` vers votre API sans que le navigateur le sache.
C'est une réécriture (`rewrites` dans `vercel.json`), pas une
redirection.

Ce n'est pas un détail d'esthétique. C'est ce qui préserve les quatre
propriétés validées sous Nginx :

| Propriété | Pourquoi elle tient |
|---|---|
| **Aucun CORS** | Même origine du point de vue du navigateur : pas de requête préliminaire `OPTIONS` avant chaque écriture. Sur une connexion mobile, c'est un aller-retour économisé à chaque fois |
| **Cookie de rafraîchissement** | Il reste `SameSite=Strict` sur `path=/api/auth`, le réglage le plus sûr possible, sans aucune concession |
| **CSP `connect-src 'self'`** | Pas besoin d'autoriser un second domaine dans la politique de contenu |
| **Un seul build** | `environment.ts` contient `apiUrl: '/api'` : le même build fonctionne sur n'importe quel domaine, sans recompiler |

**Ceci a été essayé**, pas seulement raisonné : la topologie exacte
(un serveur statique relayant `/api` vers une API sur une autre
origine) a été montée en local et la connexion, le cookie de
rafraîchissement, un appel authentifié, une photo d'inspection et un
lien profond y fonctionnent tous.

---

## 3. Ce qu'il faut préparer

### 3.1 L'API, en premier

**Mettez l'API en ligne avant Vercel.** Sans elle, le site Vercel
s'affiche mais aucune donnée n'arrive, et vous chercherez l'erreur du
mauvais côté.

Suivez [`deploiement.md`](deploiement.md) pour `api.mon-entreprise.sn`,
avec une seule différence dans `backend/.env` :

```ini
APP_ENV=production
APP_DEBUG=false

# L'adresse du site Vercel, PAS celle de l'API.
# C'est l'origine que le navigateur affiche.
APP_FRONTEND_URL=https://app.mon-entreprise.sn
```

Vérifiez que l'API répond avant d'aller plus loin :

```bash
curl -i https://api.mon-entreprise.sn/api/health
```

### 3.2 Les deux enregistrements DNS

| Nom | Type | Valeur |
|---|---|---|
| `api` | `A` | l'adresse IP de votre hébergeur PHP |
| `app` | `CNAME` | `cname.vercel-dns.com` (Vercel vous donnera la valeur exacte) |

---

## 4. La seule ligne à modifier

Ouvrez [`vercel.json`](../vercel.json) à la racine du dépôt et
remplacez le domaine de la réécriture :

```json
{
  "source": "/api/:chemin*",
  "destination": "https://api.CHANGEZ-MOI.example/api/:chemin*"
}
```

par le vôtre :

```json
{
  "source": "/api/:chemin*",
  "destination": "https://api.mon-entreprise.sn/api/:chemin*"
}
```

**Le domaine factice est volontaire.** Si vous oubliez cette étape, les
appels échouent immédiatement et visiblement, sur un domaine qui
n'existe pas. Une valeur par défaut plausible aurait produit une panne
silencieuse et difficile à comprendre.

`vercel.json` ne permet pas de variable d'environnement dans une
destination de réécriture : c'est bien un fichier à modifier, une
fois, et à commiter.

---

## 5. Mettre en ligne

1. Sur **vercel.com**, *Add New Project*, puis importez le dépôt
   GitHub.
2. **Ne touchez à aucun réglage de compilation.** Tout est dans
   `vercel.json` : la commande, le dossier de sortie, les réécritures
   et les en-têtes. C'est délibéré — un réglage caché dans un tableau
   de bord est un réglage que personne ne retrouve six mois plus tard.
3. *Deploy*.
4. *Settings → Domains* : ajoutez `app.mon-entreprise.sn`.

Chaque `git push` sur la branche principale remet le site à jour.

---

## 6. Vérifier ce qui sort, pas ce qu'on a écrit

C'est la leçon de la première mise en ligne réelle : six en-têtes de
sécurité étaient écrits, commentés et relus — et servis à personne.

```bash
# Les six en-têtes doivent apparaître
curl -I https://app.mon-entreprise.sn/

# L'API doit répondre À TRAVERS le relais, pas seulement en direct
curl -i https://app.mon-entreprise.sn/api/health

# Un lien profond doit renvoyer l'application, pas une erreur 404
curl -o /dev/null -w '%{http_code}\n' https://app.mon-entreprise.sn/queue
```

Puis, dans un navigateur : connectez-vous, laissez la page ouverte
**plus de trente minutes**, et vérifiez que vous n'êtes pas déconnecté.
C'est le seul moyen de vérifier que le cookie de rafraîchissement
traverse bien le relais. Il traverse en local ; sur Vercel, il faut le
constater une fois.

---

## 7. Ce qui reste à surveiller, honnêtement

| Point | Pourquoi | Que faire si ça arrive |
|---|---|---|
| **Envoi de photos volumineuses** | Le navigateur compresse chaque photo en WebP 1600 px (environ 200 Ko), donc le cas normal est très en dessous de toute limite. Mais si la compression échoue — format exotique — le fichier d'origine part tel quel, jusqu'à 12 Mo, à travers le relais Vercel | Si un envoi de photo échoue en 413, pointez le frontend directement sur l'API : mettez `apiUrl: 'https://api.mon-entreprise.sn/api'` dans `environment.ts`. Le CORS est déjà géré côté API (`APP_FRONTEND_URL`), au prix d'une requête préliminaire par écriture |
| **Latence du relais** | Chaque appel passe par le réseau Vercel avant d'atteindre votre API | Mesurable dès la première journée. Si c'est sensible, hébergez l'API en Europe de l'Ouest plutôt qu'ailleurs |
| **Les sauvegardes** | Elles tournent sur l'hébergeur de l'API, pas sur Vercel | Rien de particulier : `deploiement.md` §7 s'applique inchangé |
| **`deploy/deploy.sh`** | Il publie le frontend ET l'API. Sur Vercel, c'est Vercel qui publie le frontend | Le script reste valable pour l'API seule ; les étapes 4 et 7 ne s'appliquent plus |

---

## 8. Si vous changez d'avis

Rien n'est irréversible et rien n'est à recompiler. `apiUrl` vaut
`/api`, une adresse relative : le même build fonctionne servi par
Vercel avec un relais, ou servi par Nginx à côté de l'API. Passer de
l'un à l'autre, c'est changer de serveur, pas de logiciel.
