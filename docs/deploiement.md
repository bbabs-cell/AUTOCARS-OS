# Mise en production — AUTOCARE OS

> Lot 22. **L'hébergement n'a pas été arrêté au moment d'écrire ce
> document** : cette procédure suppose donc un **serveur privé virtuel
> sous Ubuntu**, avec Nginx, PHP-FPM et MySQL. Le §8 dit ce qui change
> si vous choisissez autre chose.

---

> **Vous déployez sur Vercel ?** Vercel n'exécute ni PHP ni MySQL :
> l'application y vit, l'API doit vivre ailleurs. La procédure est
> dans [`deploiement-vercel.md`](deploiement-vercel.md) ; ce
> document-ci reste celui de l'API.

---

## 0. Pourquoi ce choix par défaut

Il fallait bien en supposer un pour écrire une procédure vérifiable.
Un VPS est retenu pour trois raisons qui tiennent au marché visé :

- **Le paiement.** Une plateforme à la Render ou Railway demande une
  carte internationale. Un VPS se loue chez un hébergeur local ou
  européen, parfois par virement.
- **Le contrôle des sauvegardes.** Les données d'une station — ses
  clients, sa caisse, ses photos de litige — doivent pouvoir être
  copiées ailleurs, par le gérant, sans dépendre d'un bouton
  propriétaire.
- **La cohérence avec le produit.** PHP sans framework et MySQL
  n'attendent rien d'exotique. Le déploiement doit rester aussi
  explicable que le code.

**Ce n'est pas une recommandation définitive.** Voir §8.

---

## 1. Ce qu'il faut sur le serveur

```bash
sudo apt update
sudo apt install nginx mysql-server php8.2-fpm php8.2-mysql \
     php8.2-mbstring php8.2-gd php8.2-curl php8.2-xml \
     certbot python3-certbot-nginx git unzip
```

Node.js 20 est nécessaire **pour compiler** l'application. Il peut
vivre sur le serveur ou sur votre poste ; dans le second cas, on
envoie le dossier compilé et on retire l'étape 4 du script de
déploiement.

---

## 2. La base

```sql
CREATE DATABASE autocare_os
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER 'autocare'@'localhost' IDENTIFIED BY 'un-mot-de-passe-long-et-aleatoire';

-- Le compte de l'application n'a QUE ce dont elle a besoin.
-- Ni DROP, ni CREATE USER, ni GRANT : un jour où une faille
-- permettrait d'exécuter du SQL arbitraire, elle ne pourrait pas
-- effacer la base.
GRANT SELECT, INSERT, UPDATE, DELETE ON autocare_os.* TO 'autocare'@'localhost';
FLUSH PRIVILEGES;
```

> **Les migrations font des `CREATE TABLE` et des `ALTER TABLE`.**
> Elles ne peuvent donc pas tourner avec ce compte-là — et c'est
> voulu. On les applique avec un compte d'administration, à la main ou
> depuis le script de déploiement, puis l'application tourne avec ses
> droits réduits. Si vous préférez la simplicité, ajoutez `CREATE,
> ALTER, INDEX, REFERENCES` : c'est un arbitrage explicite, pas un
> oubli.

---

## 3. Le fichier `.env`

```bash
cd /var/www/autocare/backend
cp .env.example .env
php -r "echo bin2hex(random_bytes(32)) . PHP_EOL;"   # pour JWT_SECRET
nano .env
chmod 600 .env
```

Les valeurs qui changent tout :

```ini
APP_ENV=production
APP_DEBUG=false
APP_FRONTEND_URL=https://app.ma-station.sn

DB_USER=autocare
DB_PASSWORD=…

JWT_SECRET=…                 # 64 caractères, JAMAIS celui du modèle
MAIL_DRIVER=mail
MAIL_FROM=no-reply@ma-station.sn

BACKUP_DIR=/var/backups/autocare
```

`chmod 600` : ce fichier contient de quoi lire toute la base et
fabriquer de faux jetons.

---

## 4. Nginx et le certificat

Le fichier **[`deploy/nginx.conf.example`](../deploy/nginx.conf.example)**
est commenté ligne à ligne. Deux points méritent d'être répétés ici.

**Deux fichiers sont à copier, pas un :**

```bash
sudo cp deploy/nginx.conf.example        /etc/nginx/sites-available/autocare
sudo cp deploy/security-headers.conf     /etc/nginx/autocare-security-headers.conf
sudo ln -s /etc/nginx/sites-available/autocare /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Le second contient les en-têtes de sécurité. Ils sont dans un fichier
séparé à cause de la règle d'héritage la plus piégeuse de Nginx : **un
`add_header` dans un `location` remplace *tous* ceux hérités du bloc
`server`**, il ne s'y ajoute pas. Trois `location` posent un
`add_header` de cache ; sans l'`include` répété dans chacun, HSTS, CSP,
X-Frame-Options, nosniff, Referrer-Policy et Permissions-Policy ne
sont servis sur **aucun** chemin. C'était le cas, et seul un `curl -I`
sur le site l'a montré.

**La racine du site est le dossier PUBLIÉ (`/var/www/autocare-web`),
jamais le dossier source du frontend.** Servir `frontend/` exposerait
`src/` et `package.json`, et il n'y aurait même pas d'`index.html` à
la racine. L'API vit sous `/api` et part directement au contrôleur
frontal `backend/public/index.php`. Si une racine pointait sur le
dossier du projet, `.env` serait téléchargeable : c'est l'erreur de
déploiement à ne pas faire, et `preflight.php` la cherche.

**HSTS ne s'active qu'une fois le certificat en place et vérifié.** Un
HSTS posé sur un site dont le HTTPS casse rend le site inaccessible à
tous ceux qui l'ont déjà visité — et on ne peut pas le retirer de leur
navigateur.

```bash
sudo certbot --nginx -d app.ma-station.sn
sudo systemctl reload nginx
```

Le renouvellement est automatique. Vérifiez-le une fois :

```bash
sudo certbot renew --dry-run
```

---

## 5. Mettre en ligne

```bash
./deploy/deploy.sh
```

### Les quatre variables que lit `deploy.sh`

Toutes ont une valeur par défaut utilisable telle quelle. Un script
qui lit une variable absente de la documentation est un piège : elles
sont donc listées ici, et un test le vérifie
(`backend/tests/deployment_test.php`).

| Variable | Défaut | À quoi elle sert |
|---|---|---|
| `AUTOCARE_ROOT` | `/var/www/autocare` | Où le dépôt est cloné |
| `AUTOCARE_BRANCH` | `main` | La branche à mettre en ligne |
| `AUTOCARE_WEB` | `/var/www/autocare-web` | Où le frontend compilé est publié. **Doit être identique au `root` de Nginx** — un test vérifie que les deux ne divergent pas |
| `AUTOCARE_SERVE_FRONTEND` | `1` | `1` : ce serveur sert aussi l'application Angular. `0` : l'application est ailleurs (Vercel) et il n'y a rien à compiler ici — Node devient inutile sur la machine. Voir [`installation-vps-ovh.md`](installation-vps-ovh.md) |
| `AUTOCARE_HOST` | *(aucun)* | Le domaine, pour l'appel de vérification final. Sans lui, l'étape 6 s'annonce « non vérifiée » au lieu de faire échouer une mise en ligne réussie |

Le script fait, dans cet ordre :

| Étape | Pourquoi cet ordre |
|---|---|
| **Sauvegarde** | Avant toute migration. Si ça se passe mal, on a l'état d'avant — pas celui d'hier soir. |
| Code et dépendances | `composer install --no-dev` : les outils de développement n'ont rien à faire en production. |
| Migrations | Avant de publier l'application, qui va réclamer les nouvelles colonnes. |
| Compilation et publication | **Atomique** : on prépare à côté, on échange les dossiers d'un geste. Copier par-dessus laisserait quelques secondes pendant lesquelles `index.html` réclame des fichiers pas encore copiés. |
| Contrôle d'avant-vol | En dernier : il vérifie l'état réel du serveur, pas l'intention. |

`set -e` en tête : la moindre erreur arrête tout. Sans lui, une
migration ratée laisserait quand même publier une application qui
appelle des colonnes inexistantes.

### Revenir en arrière

```bash
./deploy/rollback.sh
```

L'ancienne version du frontend est conservée à chaque déploiement.

**Pourquoi un script pour une seule commande.** Cette documentation
disait, avant d'avoir été essayée :

```bash
mv /var/www/autocare-web-ancien /var/www/autocare-web
```

Cette commande est fausse, et fausse **silencieusement**. Quand la
destination existe déjà — ce qui est toujours le cas ici, puisque la
version cassée est en place — `mv` ne remplace pas le dossier : il
déplace la source **à l'intérieur**. On obtient
`/var/www/autocare-web/autocare-web-ancien/`, le site reste cassé,
aucune erreur n'est affichée, et la personne qui vient de taper la
commande croit avoir réparé. Un retour arrière se tape en panique :
c'est le dernier endroit du projet où l'on peut se permettre une
commande qui échoue sans le dire.

`rollback.sh` refuse s'il n'y a rien à restaurer, vérifie qu'il
restaure bien un frontend compilé, et conserve la version fautive dans
`…-casse` — la seule pièce à conviction pour comprendre le lendemain.

Le retour arrière de la **base**, lui, n'est pas automatique : voir §7.
`rollback.sh` le rappelle à l'écran, parce qu'un frontend revenu en
arrière sur une base déjà migrée est une panne différente, pas une
réparation.

---

## 6. Le contrôle d'avant-vol

```bash
cd backend && composer preflight
```

Il vérifie vingt-sept points et **sort en erreur** si l'un des
bloquants n'est pas levé, ce qui permet de l'enchaîner dans un script.

Les trois qu'il attrape le plus souvent :

- `APP_DEBUG` resté à `true` — chaque erreur affiche alors les chemins
  de fichiers et la structure du code ;
- la clé de signature recopiée du modèle — elle est dans Git, donc
  chez tout le monde ;
- le **jeu de démonstration oublié en base** — « Groupe Diallo Auto »
  au milieu des données d'un vrai client.

Aucun des trois ne fait planter quoi que ce soit. C'est ce qui les
rend dangereux.

### Ce que le contrôle d'avant-vol ne peut pas voir

Il lit la configuration **du serveur**. Il ne voit pas ce que le
navigateur reçoit. Toute une catégorie de défauts vit dans cet écart :
une CSP écrite mais jamais servie, une feuille de style bloquée par
cette même CSP, une route d'API avalée par une règle statique.

C'est pourquoi `deploy.sh` se termine par une étape 7 qui interroge le
site en ligne et vérifie **ce qui sort** : les six en-têtes de
sécurité sont-ils dans la réponse, et la feuille de style se
charge-t-elle sans script inline. Elle ne s'exécute que si
`AUTOCARE_HOST` est défini.

La règle générale, apprise à la première mise en ligne réelle : **on
ne vérifie pas une configuration en la relisant.** Six en-têtes de
sécurité étaient écrits, commentés, revus — et servis à personne. Un
`curl -I` l'a montré en une seconde.

```bash
curl -I https://votre-domaine/
```

### Pourquoi trois en-têtes apparaissent en double

Sur les réponses de l'API, `X-Frame-Options`, `X-Content-Type-Options`
et `Referrer-Policy` sont envoyés deux fois, avec la **même valeur** :
une fois par Nginx, une fois par `public/index.php`. Ce n'est pas un
oubli. L'API doit se protéger elle-même si elle est un jour servie par
autre chose que ce Nginx — un Apache en hébergement mutualisé, par
exemple, où le `.htaccess` livré ne pose pas tout. Des valeurs
identiques ne posent aucun problème au navigateur ; une API nue en
poserait un.

---

## 7. Sauvegarde et restauration

### Sauvegarder

```bash
cd backend && composer backup
```

À planifier :

```cron
0 2 * * * cd /var/www/autocare/backend && php tools/backup.php >> /var/log/autocare-backup.log 2>&1
```

L'outil sauvegarde **la base et les photos**. Les photos comptent
autant : une inspection sans ses images ne prouve rien, et c'est
précisément ce qui sert le jour d'un litige sur une rayure.

Le mot de passe MySQL **ne passe pas par la ligne de commande** —
`mysqldump --password=…` est lisible par n'importe quel utilisateur du
serveur avec un simple `ps`. Un fichier de configuration temporaire en
0600 le porte, et il est effacé même en cas d'échec.

Chaque archive est accompagnée d'une **empreinte SHA-256**. Une
sauvegarde silencieusement tronquée — disque plein, connexion coupée —
ressemble à une bonne sauvegarde jusqu'au jour où on en a besoin.

> **Une sauvegarde qui reste sur le même serveur ne protège pas d'un
> disque perdu.** Copiez-la ailleurs : `rsync` vers une autre machine,
> ou un stockage objet. C'est la seule partie de ce lot que le code ne
> peut pas faire à votre place, parce qu'elle dépend de ce que vous
> avez.

### Restaurer

```bash
cd backend
composer restore -- --list
composer restore -- --latest --photos
```

L'outil **vérifie l'empreinte avant d'écraser quoi que ce soit** — une
archive abîmée restaurée sur des données vivantes, c'est deux pertes
au lieu d'une — et **refuse de tourner en production** sans
`--je-sais-ce-que-je-fais`.

### Le seul essai qui compte

**Une sauvegarde qu'on n'a jamais restaurée n'est pas une
sauvegarde.** `php tests/backup_test.php` fait l'essai en entier :
il sauvegarde, **détruit une donnée**, restaure, et vérifie qu'elle
est revenue. Il tourne à chaque intégration continue.

Sur le serveur, refaites l'essai **tous les trimestres**, sur une base
de test. Le jour où l'on en a réellement besoin est le pire moment
pour découvrir qu'il manquait une permission.

---

## 8. Si vous choisissez un autre hébergement

| Ce que vous prenez | Ce qui change |
|---|---|
| **Hébergement mutualisé** | Souvent pas d'accès SSH ni de tâche planifiée : la sauvegarde automatique tombe. Vérifiez `php -v` ≥ 8.2 et la présence de `gd`. La racine du domaine doit pouvoir pointer sur un sous-dossier — sinon, `.env` est exposé et c'est rédhibitoire. |
| **Plateforme (Render, Railway…)** | Le disque est souvent éphémère : **les photos d'inspection disparaissent au redéploiement**. Il faut alors un stockage objet, et `PhotoStorage` est l'unique classe à modifier. La base est gérée, ses sauvegardes aussi — vérifiez qu'on peut les télécharger. |
| **Docker** | Rien ne s'y oppose ; le produit n'a pas d'image officielle parce que personne n'en a eu besoin. Deux services (PHP-FPM, Nginx), un volume pour `storage/`. |

Dans tous les cas, `composer preflight` reste valable : il ne vérifie
pas *où* vous tournez, mais *comment*.

---

## 9. Ce qui n'est pas couvert, et qui devrait l'être

Écrit ici pour que ce ne soit pas confondu avec un oubli.

- **La supervision.** Rien ne prévient si l'API tombe à 3 h du matin.
  Un simple appel à `/api/health` toutes les cinq minutes depuis un
  service extérieur suffirait.
- **La rotation des journaux.** `storage/logs/` grossit sans limite.
  `logrotate` s'en charge en quatre lignes.
- **Le chiffrement des sauvegardes.** Elles contiennent la base en
  clair. Sur un stockage distant, elles devraient être chiffrées
  avant l'envoi.
- **La restauration à un instant donné.** Les sauvegardes sont
  quotidiennes : on peut perdre jusqu'à une journée de travail. Les
  journaux binaires de MySQL permettraient de faire mieux, au prix
  d'une exploitation plus complexe.
- **La relecture de sécurité par un tiers**, réclamée par
  [l'audit du lot 21](audit-securite.md), **avant les premières
  données réelles d'un client.**
