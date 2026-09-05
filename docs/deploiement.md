# Mise en production — AUTOCARE OS

> Lot 22. **L'hébergement n'a pas été arrêté au moment d'écrire ce
> document** : cette procédure suppose donc un **serveur privé virtuel
> sous Ubuntu**, avec Nginx, PHP-FPM et MySQL. Le §8 dit ce qui change
> si vous choisissez autre chose.

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

**La racine du site est `frontend/`, et l'API vit sous `/api` avec sa
propre racine `backend/public/`.** Si la racine pointait sur le
dossier du projet, `.env` serait téléchargeable. C'est l'erreur de
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
mv /var/www/autocare-web-ancien /var/www/autocare-web
```

L'ancienne version du frontend est conservée à chaque déploiement. Le
retour arrière de la **base**, lui, n'est pas automatique : voir §7.

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
