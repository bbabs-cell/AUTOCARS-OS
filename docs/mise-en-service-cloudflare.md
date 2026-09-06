# Mettre AUTOCARE OS en service sur Cloudflare

> Ce document décrit ce qu'il reste à faire **une fois**, à la main,
> avant le premier déploiement. Le code est prêt ; ce qui suit ne
> s'automatise pas, parce qu'il s'agit de comptes et de domaines.

---

## 1. Le plan payant est obligatoire

Ce n'est pas un confort. Le plan gratuit limite chaque requête à
**10 ms de temps de calcul**, et le hachage d'un mot de passe en coûte
**92 ms** à la valeur recommandée — mesuré à l'étape 1 de la
migration, pas estimé.

Sans plan payant, **personne ne peut se connecter**.

Le plan Workers Paid coûte 5 $/mois et couvre largement l'usage d'une
entreprise de trois stations. Cloudflare Images se facture à part.

---

## 2. La base D1

```bash
cd workers
npx wrangler d1 create autocare
```

La commande affiche un `database_id`. **Reportez-le dans
`wrangler.toml`** : tant qu'il vaut `a-remplacer-au-premier-deploiement`,
le contrôle avant vol refuse de laisser déployer.

```bash
npx wrangler d1 migrations apply autocare --remote
```

---

## 3. Le seau des photos

```bash
npx wrangler r2 bucket create autocare-photos
```

**Ne le rendez pas public.** Les photos d'inspection sont les preuves
d'une entreprise ; elles ne sont servies que par
`GET /api/photos/{id}`, qui vérifie d'abord à qui elles appartiennent.

Cloudflare Images n'a rien à créer : la liaison `[images]` de
`wrangler.toml` suffit, le service est facturé à l'usage.

---

## 4. Le secret de signature

```bash
npx wrangler secret put JWT_SECRET
```

Une valeur longue et tirée au hasard — 64 caractères au moins :

```bash
openssl rand -base64 48
```

**Ne la mettez jamais dans `wrangler.toml`.** Ce fichier est suivi par
Git : un secret qui y figure est un secret public, et le contrôle
avant vol s'arrête dessus.

---

## 5. Resend, l'envoi de courriel

C'est le point où l'on perd le plus de temps si on le fait dans le
mauvais ordre. **Le domaine d'abord, la clé ensuite.**

### 5.1 Vérifier le domaine

1. Sur [resend.com/domains](https://resend.com/domains), ajoutez
   `magyapro.com`.
2. Resend affiche trois enregistrements DNS : un SPF, un DKIM, et un
   DMARC recommandé.
3. Posez-les dans la zone Cloudflare de `magyapro.com` — c'est là
   qu'elle est.
4. Attendez que Resend affiche **« Verified »**.

> **Sans cette étape, Resend accepte la requête et le courriel
> n'arrive jamais.** Les messageries rejettent un expéditeur non
> authentifié. C'est la panne la plus déroutante du module, parce
> qu'elle ne ressemble pas à une panne : l'API répond 200, les traces
> sont vides, et le client attend son lien.
>
> Le code aide à la reconnaître : sur un refus 422, il écrit
> « le domaine expéditeur est-il vérifié chez Resend ? » dans les
> traces.

### 5.2 Poser la clé

```bash
npx wrangler secret put RESEND_TOKEN
```

### 5.3 Vérifier

```bash
npx wrangler tail
```

…puis demander une réinitialisation depuis l'application. Sans clé, le
message apparaît **en entier dans les traces** au lieu de partir — le
produit continue de fonctionner, et c'est ainsi qu'on suit le parcours
en développement.

### 5.4 L'adresse d'expédition

`MAIL_FROM` vaut `no-reply@magyapro.com` dans `wrangler.toml`. Elle
doit appartenir au domaine vérifié à l'étape 5.1 ; une autre serait
refusée.

---

## 6. Le contrôle avant vol

```bash
node tools/avant-vol.mjs --remote
```

Il s'arrête sur tout point **BLOQUANT**, ce qui permet de le placer
dans le script de déploiement.

Ce qu'il ne peut pas vérifier, et qu'il dit plutôt que de le taire :

- **que le domaine est vérifié chez Resend** — cela se lit sur leur
  interface, pas depuis ici ;
- **l'envoi de courriel hors ligne** — les secrets Wrangler ne sont
  pas lisibles depuis une machine de développement.

Un contrôle qui répondrait « ok » sur ces deux points donnerait une
fausse assurance, ce qui est pire que pas de contrôle.

---

## 7. Déployer

```bash
npm test                    # 658 + 22 tests
npm run typecheck
node tools/avant-vol.mjs --remote
npx wrangler deploy
```

---

## 8. Le lendemain

- Programmer la sauvegarde nocturne et sa copie hors de chez
  Cloudflare — voir
  [`sauvegarde-restauration-d1.md`](sauvegarde-restauration-d1.md).
- Faire **une restauration d'essai** sur la base locale. Le jour où
  l'on en a besoin est le pire moment pour découvrir qu'une archive
  était tronquée.
- Retirer le jeu de démonstration s'il a servi : le contrôle avant vol
  le signale avec `--remote`.
