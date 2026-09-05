# Installation d'AUTOCARE OS

Ce document permet de partir d'un poste vierge et d'arriver à une
application qui fonctionne.

---

## 1. Prérequis

| Outil | Version minimale | Vérifier avec |
|---|---|---|
| PHP | 8.2 | `php -v` |
| Composer | 2.x | `composer -V` |
| Node.js | 20.19 ou 22.12+ | `node -v` |
| MySQL | 8.0 | `mysql --version` |

Extensions PHP requises : `pdo_mysql`, `mbstring`, `json`, `fileinfo`,
`gd` **avec le support WebP**, et `exif` (redressement des photos
prises à la verticale). Vérifie-les avec `php -m`.

Pour confirmer que GD sait écrire du WebP :

```bash
php -r "var_dump(function_exists('imagewebp'));"
```

Sans WebP, l'envoi des photos d'inspection échouera : c'est le format
dans lequel elles sont ré-enregistrées. Sous Laragon et XAMPP,
l'extension `gd` livrée d'origine le gère.

> **Windows** : XAMPP ou Laragon fournissent PHP + MySQL en une
> installation. Après l'installation, ajoute le dossier `php` à ton
> PATH pour pouvoir taper `php` dans n'importe quel terminal.

> **Note Angular** : la version 20 utilisée ici accepte Node 20.19+ ou
> 22.12+. Les versions plus récentes du CLI Angular exigent Node
> 22.22.3 minimum.

---

## 2. Récupérer le projet

```bash
git clone <url-du-depot> AUTOCARS-OS
cd AUTOCARS-OS
```

---

## 3. Backend

```bash
cd backend
composer install
```

### Configuration

```bash
cp .env.example .env      # Windows : copy .env.example .env
```

Ouvre `backend/.env` et renseigne tes accès MySQL :

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=autocare_os
DB_USER=root
DB_PASSWORD=ton_mot_de_passe
```

Génère aussi ta clé secrète (elle servira au Lot 4) :

```bash
php -r "echo bin2hex(random_bytes(32));"
```

Copie le résultat dans `JWT_SECRET=`.

> ⚠️ **Le fichier `.env` ne doit jamais être commité.** Il est déjà
> listé dans `.gitignore`. Il contient tes mots de passe : s'il se
> retrouve sur GitHub, considère-les comme compromis et change-les.

### Le courrier (lot 19)

Rien à configurer pour développer. Par défaut, les messages — lien de
mot de passe oublié, confirmation de changement — sont **écrits dans
`storage/logs/mail.log`** au lieu d'être envoyés :

```ini
MAIL_DRIVER=log
```

C'est volontairement le réglage le plus prudent : on relit le lien de
réinitialisation dans le fichier, et aucun message ne part par erreur
vers l'adresse réelle d'un client pendant un test.

En production, `MAIL_DRIVER=mail` remet le message au serveur de
courrier de la machine. Le choix d'un prestataire d'envoi est attendu
au lot 22, avec l'hébergement.

> Ce fichier contient des liens de réinitialisation, donc de quoi
> prendre la main sur un compte. Il est hors du dossier exposé au web
> et ignoré par Git — ne le recopie nulle part.

### Créer la base

```sql
CREATE DATABASE autocare_os
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

`utf8mb4` est important : c'est ce qui permet de stocker correctement
les accents français et les emojis.

### Vérifier la connexion

```bash
php tools/check_db.php
```

Cet outil te dit précisément ce qui bloque : MySQL éteint, base
absente, mot de passe faux, extension manquante…

### Lancer l'API

```bash
php -S localhost:8000 -t public router.php
```

Test rapide dans un autre terminal :

```bash
curl http://localhost:8000/api/health
```

Réponse attendue :

```json
{"success":true,"data":{"status":"ok","database":"connected"},"message":"L'API AUTOCARE OS fonctionne."}
```

---

## 3 bis. Installation avec Laragon sur Windows (environnement de référence)

C'est la configuration sur laquelle le projet est développé et testé.
Laragon installe PHP, MySQL, Composer et Node en une seule fois — bien
moins pénible que quatre installations séparées.

**Version validée : Laragon 8.7 · PHP 8.3.33 · MySQL 8.4.3.**

### 1. Installer

Télécharge **Laragon Full** sur <https://laragon.org/download/> et
installe-le dans le dossier proposé (`C:\laragon`).

### 2. Démarrer les services

Ouvre Laragon et clique sur **▷ Démarrer**. Apache et MySQL passent au
vert.

> Seul MySQL nous est indispensable : l'API utilise le serveur intégré
> de PHP, pas Apache. Mais laisser tout démarrer ne gêne pas.

### 3. Rendre `php` et `composer` visibles dans PowerShell

Dans Laragon : **Menu → Outils → Chemin → Ajouter Laragon au Path**,
puis **ferme et rouvre PowerShell** (il garde l'ancien PATH en
mémoire tant qu'il reste ouvert).

Le bouton **Terminal** de Laragon fonctionne, lui, immédiatement.

Vérifie :

```powershell
php -v
composer -V
node -v
```

### 4. Installer le projet

```powershell
cd C:\Users\<toi>\AUTOCARS-OS\backend
composer install
Copy-Item .env.example .env
mysql -u root -e "CREATE DATABASE autocare_os CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
notepad .env
```

Valeurs à mettre dans `.env` — **le mot de passe root de Laragon est
vide par défaut** :

```ini
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=autocare_os
DB_USER=root
DB_PASSWORD=
```

### 5. Vérifier et lancer

```powershell
php tools/check_db.php
php -S localhost:8000 -t public router.php
```

Dans un **second** terminal :

```powershell
cd C:\Users\<toi>\AUTOCARS-OS\frontend
npm install
npm start
```

### Différences PowerShell / Linux

| Linux, macOS | PowerShell |
|---|---|
| `cp .env.example .env` | `Copy-Item .env.example .env` |
| `nano .env` | `notepad .env` |
| `ls` | `dir` (ou `ls`, qui est un alias) |

---

## 4. Frontend

Dans un **second terminal** (le serveur PHP doit rester allumé) :

```bash
cd frontend
npm install
npm start
```

Ouvre **http://localhost:4200**.

---

> **Note** : `frontend/angular.json` contient `"cli": { "analytics": false }`.
> Sans ce réglage, Angular demande à chaque nouveau poste s'il peut envoyer
> des statistiques d'usage à Google, puis **écrit la réponse dans
> `angular.json`** — ce qui crée une modification locale et bloque le
> prochain `git pull`. Le réglage est donc figé dans le dépôt.

---

## 5. Résultat attendu

La page affiche **« Connexion établie »** avec le nom de ta base.

Cela prouve que les quatre maillons fonctionnent :

```
Angular (4200) → HttpClient → API PHP (8000) → MySQL
```

---

## 6. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « Impossible de joindre l'API » | Le serveur PHP n'est pas lancé | Relance `php -S localhost:8000 -t public router.php` depuis `backend/` |
| « base de données injoignable » | MySQL éteint ou `.env` incorrect | `php tools/check_db.php` te donne la cause exacte |
| Erreur CORS dans la console du navigateur | `APP_FRONTEND_URL` ne correspond pas à l'URL réelle d'Angular | Mets exactement `http://localhost:4200` dans `backend/.env` |
| `Class "Autocare\Core\Env" not found` | Autoloader absent | `composer install` (ou `composer dump-autoload`) dans `backend/` |
| `could not find driver` | Extension `pdo_mysql` désactivée | Décommente `extension=pdo_mysql` dans `php.ini`, puis redémarre |
| Angular refuse de démarrer | Version de Node trop ancienne | `node -v` doit être ≥ 20.19 |
| « L'enregistrement de la photo a échoué » | GD sans support WebP | `php -r "var_dump(function_exists('imagewebp'));"` doit afficher `true` ; sinon active `extension=gd` dans `php.ini` |
| Les aperçus de photos restent vides | Le dossier `backend/storage/uploads/` n'est pas inscriptible | Donne les droits d'écriture au dossier ; sur Windows c'est rarement le problème |
| Photos de démonstration absentes | Le jeu de démonstration a été chargé avant le Lot 7 | Relance `php tools/migrate.php --fresh` puis `php tools/seed.php` : les fichiers sont écrits par le seed |

---

## 7. Lancer les tests

Depuis `backend/`, avec le serveur PHP démarré dans un autre terminal :

```bash
composer test        # ou : php tests/run_all.php
```

Les tests d'API sont ignorés proprement si le serveur ne répond pas —
ils ne font pas échouer l'ensemble. Les tests de schéma et la machine
à états, eux, tournent sans serveur.

Vérifier la syntaxe de tout le code PHP, sans rien installer :

```bash
composer lint        # ou : php tools/lint.php
```

Côté frontend, depuis `frontend/` :

```bash
npm test             # ouvre un navigateur et reste en écoute
npm run test:ci      # une seule passe, sans fenêtre
```

### Chrome refuse de démarrer ? (conteneur, ou session root)

Chrome ne s'ouvre pas en tant que `root` — c'est le cas dans beaucoup
de conteneurs. Il faut alors lui passer `--no-sandbox`, ce que Karma
ne fait pas tout seul :

```bash
printf '#!/bin/sh\nexec /usr/bin/chromium --no-sandbox --headless=new "$@"\n' \
  > /tmp/chrome-nosandbox && chmod +x /tmp/chrome-nosandbox

CHROME_BIN=/tmp/chrome-nosandbox npm run test:ci
```

C'est un contournement de POSTE, pas une configuration du projet : le
bac à sable protège d'un site hostile, et il n'y en a pas ici — mais
la décision de le désactiver doit rester visible dans la commande, pas
cachée dans un fichier du dépôt.

---

## 7 bis. L'intégration continue

Depuis le lot 19, `.github/workflows/tests.yml` rejoue tout cela à
chaque poussée : les suites du serveur contre une vraie base MySQL, et
côté navigateur les tests unitaires plus la compilation de production.

**Rien à installer pour en profiter.** Le seul point d'attention est
que la configuration y est fabriquée à la volée : `.env` n'est pas
dans Git, et l'intégration continue s'en écrit un avec des valeurs qui
n'ont de sens que pour une machine jetable.

---

## 7 ter. Mesurer les performances

Le jeu de démonstration contient une quinzaine d'opérations : toutes
les requêtes y répondent en une milliseconde, **y compris celles qui
parcourent la table entière**. Mesurer dessus ne dit rien.

```bash
composer benchmark-seed          # ~13 s : 76 000 opérations, 3 ans
composer benchmark               # mesure les écrans, serveur démarré
php tools/benchmark_seed.php --purge
```

Le volume est écrit dans **une entreprise à part** (`banc-de-mesure`)
et n'altère jamais le jeu de démonstration : on peut mesurer le lundi
et faire une capture d'écran le mardi.

Chaque écran porte un budget, et la commande sort en erreur si l'un
d'eux le dépasse. Résultats détaillés et méthode :
**[docs/performance.md](performance.md)**.

---

## 7 quater. Mettre en production

Rien de ce qui précède ne convient à un vrai serveur : `php -S` est un
serveur de développement, et `APP_DEBUG=true` afficherait la structure
du code à tout internet.

La procédure complète — Nginx, HTTPS, migrations, publication
atomique, sauvegarde planifiée — est dans
**[docs/deploiement.md](deploiement.md)**.

Avant toute mise en ligne :

```bash
cd backend && composer preflight
```

---

## 8. Les deux commandes du quotidien

```bash
# Terminal 1
cd backend && php -S localhost:8000 -t public router.php

# Terminal 2
cd frontend && npm start
```
