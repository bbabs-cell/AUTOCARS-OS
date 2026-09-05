# Installation sur un VPS OVH — magyapro.com

> Procédure complète, dans l'ordre, à suivre une seule fois.
> Chaque bloc se copie tel quel. Les seules valeurs à remplacer sont
> signalées par `⟨…⟩`.

---

## 0. Ce que vous obtiendrez

| Adresse | Ce qui y vit | Où |
|---|---|---|
| `https://app.magyapro.com` | L'application (Angular) | Vercel |
| `https://api.magyapro.com` | L'API, la base, les photos, les sauvegardes | Votre VPS OVH |

`magyapro.com` lui-même n'est pas touché : si quelque chose y est déjà
en ligne, rien ne bouge.

**Le navigateur ne parle qu'à `app.magyapro.com`.** Vercel relaie
`/api/*` vers le VPS sans que le navigateur le sache. C'est ce qui
évite le CORS et garde le cookie d'authentification en `SameSite=Strict`.

### Ce qu'il faut avoir sous la main

- Un VPS OVH, **Ubuntu 24.04**, 2 Go de RAM minimum (le plus petit
  suffit largement pour une station ; la mesure du lot 20 tient
  76 000 dossiers).
- L'accès à la zone DNS de `magyapro.com`.
- Un compte Vercel relié à votre dépôt GitHub.

**Comptez une heure.** Les étapes 1 à 3 peuvent se faire pendant que le
DNS se propage.

---

## 1. Les deux enregistrements DNS

Dans l'espace client OVH, *Domaines → magyapro.com → Zone DNS* :

| Sous-domaine | Type | Cible |
|---|---|---|
| `api` | `A` | ⟨l'IPv4 de votre VPS⟩ |
| `app` | `CNAME` | `cname.vercel-dns.com.` |

Faites-les **maintenant** : la propagation prend de quelques minutes à
quelques heures, et le certificat HTTPS de l'étape 8 ne peut pas être
délivré avant.

Vérifiez depuis votre machine :

```bash
dig +short api.magyapro.com
dig +short app.magyapro.com
```

---

## 2. Premier accès, et fermer la porte derrière soi

OVH vous envoie un accès `root` par e-mail. On ne travaille pas en
`root`, et on n'y accède pas par mot de passe.

```bash
ssh root@api.magyapro.com

adduser autocare
usermod -aG sudo autocare
rsync --archive --chown=autocare:autocare ~/.ssh /home/autocare
```

Testez la connexion du nouveau compte **dans un second terminal, sans
fermer le premier** — c'est la précaution qui évite de rester dehors :

```bash
ssh autocare@api.magyapro.com
```

Une fois que ça marche, désactivez la connexion par mot de passe et le
compte `root` :

```bash
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/'          /etc/ssh/sshd_config
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

---

## 3. Le pare-feu

Trois portes ouvertes, pas une de plus. **MySQL n'est jamais exposé** :
l'API et la base sont sur la même machine et se parlent en local.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

---

## 4. Les logiciels

Ubuntu 24.04 livre PHP 8.3, ce qui satisfait le `>=8.2` du projet. Pas
de dépôt tiers à ajouter.

```bash
sudo apt update && sudo apt upgrade -y

sudo apt install -y nginx mysql-server git unzip curl \
  php8.3-fpm php8.3-mysql php8.3-mbstring php8.3-gd php8.3-curl php8.3-xml

# Composer
curl -sS https://getcomposer.org/installer | php
sudo mv composer.phar /usr/local/bin/composer
```

**`php8.3-gd` n'est pas optionnel.** Les photos d'inspection sont
ré-encodées en WebP côté serveur ; sans cette extension, tout
fonctionne jusqu'à la première photo. C'est déclaré dans
`composer.json`, donc l'installation des dépendances échouera bruyamment
si elle manque — ce qui vaut mieux qu'une panne en pleine station.

**Node.js n'est pas nécessaire sur ce serveur.** C'est Vercel qui
compile l'application.

Notez le chemin de la socket PHP, il servira à l'étape 8 :

```bash
ls /run/php/
```

---

## 5. La base de données

```bash
sudo mysql_secure_installation
```

Puis on crée la base et **un utilisateur dédié**. Jamais `root` : si un
jour l'API est compromise, les dégâts s'arrêtent à cette base.

Le mot de passe est **généré sur le serveur** et n'apparaît nulle part
ailleurs — ni dans un message, ni dans Git.

```bash
MDP_BASE=$(openssl rand -base64 24)
echo "Mot de passe de la base (notez-le dans votre gestionnaire) : $MDP_BASE"

sudo mysql <<SQL
CREATE DATABASE autocare_os CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'autocare'@'localhost' IDENTIFIED BY '${MDP_BASE}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON autocare_os.* TO 'autocare'@'localhost';
FLUSH PRIVILEGES;
SQL
```

> Les droits `CREATE`, `ALTER`, `INDEX` et `DROP` sont nécessaires aux
> migrations. `DROP` porte uniquement sur `autocare_os` : cet
> utilisateur ne peut toucher à aucune autre base.

---

## 6. Le code

```bash
sudo mkdir -p /var/www
sudo chown autocare:autocare /var/www
git clone https://github.com/bbabs-cell/AUTOCARS-OS.git /var/www/autocare
cd /var/www/autocare/backend

composer install --no-dev --optimize-autoloader
```

Si cette commande refuse de s'exécuter en réclamant `ext-gd`, c'est le
garde-fou de l'étape 4 qui fonctionne : `sudo apt install php8.3-gd`.

---

## 7. Le fichier `.env`

**Aucun secret de ce fichier ne doit exister ailleurs que sur ce
serveur.** Ils sont générés ici, ils y restent.

```bash
cd /var/www/autocare/backend
cp .env.example .env

# La clé de signature des jetons : 64 caractères, tirés au hasard.
CLE=$(php -r 'echo bin2hex(random_bytes(32));')

sed -i "s|^APP_ENV=.*|APP_ENV=production|"                              .env
sed -i "s|^APP_DEBUG=.*|APP_DEBUG=false|"                               .env
sed -i "s|^APP_FRONTEND_URL=.*|APP_FRONTEND_URL=https://app.magyapro.com|" .env
sed -i "s|^DB_USER=.*|DB_USER=autocare|"                                .env
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${MDP_BASE}|"                     .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${CLE}|"                            .env

# Personne d'autre que le propriétaire ne doit pouvoir le lire.
chmod 600 .env
```

> `APP_FRONTEND_URL` contient l'adresse **Vercel**, pas celle de l'API.
> C'est l'origine que le navigateur affiche, et c'est elle que le
> contrôle CORS compare.

Vérifiez qu'aucun secret n'a fui dans l'historique du shell :

```bash
history -c
```

---

## 8. Les migrations

```bash
cd /var/www/autocare/backend
php tools/migrate.php
```

**Ne lancez jamais `php tools/seed.php` sur ce serveur.** Il installe le
jeu de démonstration — « Groupe Diallo Auto », des clients et des
montants fictifs — au milieu de vos données réelles. Le contrôle
d'avant-vol le refuse d'ailleurs explicitement.

---

## 9. Nginx et le certificat

```bash
sudo cp /var/www/autocare/deploy/nginx-api.conf.example \
        /etc/nginx/sites-available/autocare-api
sudo cp /var/www/autocare/deploy/security-headers.conf \
        /etc/nginx/autocare-security-headers.conf
sudo ln -s /etc/nginx/sites-available/autocare-api /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
```

**Vérifiez la ligne `fastcgi_pass`** dans le fichier copié : elle doit
correspondre à ce que `ls /run/php/` a montré à l'étape 4.

```bash
sudo nano /etc/nginx/sites-available/autocare-api   # ligne fastcgi_pass
sudo nginx -t
```

Le certificat. Il ne peut être délivré que si le DNS de l'étape 1 est
propagé.

```bash
sudo mkdir -p /var/www/certbot
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.magyapro.com
sudo systemctl reload nginx

# Le renouvellement est automatique. Vérifiez-le une fois :
sudo certbot renew --dry-run
```

Les dossiers d'écriture appartiennent au serveur web :

```bash
sudo chown -R www-data:www-data /var/www/autocare/backend/storage
```

---

## 10. Vérifier l'API avant d'aller sur Vercel

**Ne passez pas à l'étape suivante tant que ceci ne répond pas.** Si
l'application Vercel est mise en ligne avant, vous chercherez l'erreur
du mauvais côté.

```bash
# Doit répondre 200 avec un corps JSON
curl -i https://api.magyapro.com/api/health

# Doit répondre 404, sans rien révéler
curl -o /dev/null -w '%{http_code}\n' https://api.magyapro.com/

# Les six en-têtes de sécurité doivent être là
curl -sI https://api.magyapro.com/api/health | grep -iE \
  'strict-transport|content-security|x-frame|x-content-type|referrer|permissions'
```

---

## 11. Vercel

`vercel.json` contient déjà `https://api.magyapro.com` : il n'y a rien
à modifier.

1. **vercel.com → Add New Project**, importez le dépôt.
2. **Ne touchez à aucun réglage de compilation** : tout est dans
   `vercel.json`.
3. **Deploy**.
4. **Settings → Domains** → ajoutez `app.magyapro.com`.

Détail complet et solutions de repli : [`deploiement-vercel.md`](deploiement-vercel.md).

---

## 12. Le premier compte

Ouvrez `https://app.magyapro.com` et **créez votre compte depuis la page
d'inscription**. Le premier compte crée l'organisation et devient
administrateur.

> **Un point à décider, pas un défaut.** La page d'inscription est
> ouverte : n'importe qui trouvant l'adresse peut créer *sa propre*
> organisation sur votre serveur. C'est le fonctionnement normal d'un
> SaaS multi-clients, et l'isolation entre organisations est vérifiée
> par les tests. Mais si `magyapro.com` ne doit héberger **que votre
> entreprise**, dites-le : fermer l'inscription après la création du
> premier compte est un petit changement, et il vaut mieux le faire
> avant la mise en service qu'après.

---

## 12 bis. Les mots de passe oubliés — à lire avant le test terrain

`MAIL_DRIVER=log` : **le produit n'envoie aucun courrier.** Les liens de
réinitialisation sont écrits dans un fichier, pas envoyés. C'est
délibéré — rien n'a jamais été simulé dans ce projet — mais cela a une
conséquence très concrète le jour du test.

**Ce qui se passe si un employé oublie son mot de passe :**

1. Il demande une réinitialisation depuis la page de connexion.
2. Le lien part dans `backend/storage/logs/mail.log`, sur le serveur.
3. Il ne reçoit rien. Aucun écran ne permet à un administrateur de lui
   redonner un accès : la création d'un compte fixe un mot de passe,
   sa modification non.
4. La seule récupération passe par SSH :

```bash
sudo tail -n 40 /var/www/autocare/backend/storage/logs/mail.log
```

**Pour une journée en station, c'est un vrai risque.** Un employé
bloqué à 8 h du matin ne peut pas attendre que quelqu'un se connecte
en SSH. Deux façons de s'en prémunir :

| Solution | Ce qu'elle coûte |
|---|---|
| **Créer les comptes vous-même la veille**, noter les mots de passe, et les distribuer sur papier | Rien à développer. Suffit pour une première journée d'observation |
| **Ajouter un écran de réinitialisation par l'administrateur** | Un petit développement, et une décision de sécurité à prendre : un administrateur qui peut changer le mot de passe d'un employé peut aussi se faire passer pour lui. Cela se trace dans le journal d'audit, mais il faut le vouloir |

Pensez aussi à changer `MAIL_FROM` dans `.env` : il vaut
`no-reply@autocare-os.local` par défaut, une adresse qui n'existe pas.

---

## 13. Les sauvegardes automatiques

Une sauvegarde qui dépend de quelqu'un qui y pense n'est pas une
sauvegarde.

```bash
crontab -e
```

Ajoutez :

```cron
# Sauvegarde de la base, tous les jours à 2 h du matin.
0 2 * * * cd /var/www/autocare/backend && /usr/bin/php tools/backup.php >> storage/logs/backup.log 2>&1
```

**Puis testez une restauration une fois**, avant d'en avoir besoin :
la procédure est au §7 de [`deploiement.md`](deploiement.md). Une
sauvegarde jamais restaurée n'est pas une sauvegarde — c'est le sens
des 18 tests de `backup_test.php`.

Pensez aussi à emporter les archives **hors du VPS** (un disque perdu
emporte la base et ses sauvegardes en même temps).

---

## 14. Le contrôle d'avant-vol

```bash
cd /var/www/autocare/backend && php tools/preflight.php
```

Vingt-huit points. Il **sort en erreur** si l'un des bloquants tient
encore. Tant qu'il n'est pas vert, ne mettez pas de données réelles.

---

## 15. Les mises à jour, ensuite

Sur le VPS, pour l'API :

```bash
cd /var/www/autocare
AUTOCARE_SERVE_FRONTEND=0 AUTOCARE_HOST=api.magyapro.com ./deploy/deploy.sh
```

`AUTOCARE_SERVE_FRONTEND=0` indique qu'il n'y a pas d'application à
compiler ici. L'application, elle, se met à jour toute seule à chaque
`git push` — c'est Vercel qui s'en charge.

Le script sauvegarde **avant** de migrer, et se termine en vérifiant ce
que le serveur renvoie réellement.

---

## 16. Récapitulatif des vérifications

| # | Commande | Attendu |
|---|---|---|
| 1 | `dig +short api.magyapro.com` | l'IP du VPS |
| 2 | `sudo ufw status` | 22, 80, 443 — rien d'autre |
| 3 | `curl -i https://api.magyapro.com/api/health` | 200 |
| 4 | `curl -o /dev/null -w '%{http_code}' https://api.magyapro.com/` | 404 |
| 5 | `curl -sI https://app.magyapro.com/` | les 6 en-têtes |
| 6 | `curl -i https://app.magyapro.com/api/health` | 200 — **le relais fonctionne** |
| 7 | `php tools/preflight.php` | 0 bloquant |
| 8 | Se connecter, laisser 30 min, revenir | toujours connecté |

La ligne 6 est la seule qui prouve que les deux moitiés se parlent.
La ligne 8 est la seule qui prouve que le cookie de rafraîchissement
traverse le relais — et elle demande d'attendre vraiment.
