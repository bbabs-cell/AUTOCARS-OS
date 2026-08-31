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
`gd` (pour les photos, Lot 7).
Vérifie-les avec `php -m`.

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

---

## 7. Les deux commandes du quotidien

```bash
# Terminal 1
cd backend && php -S localhost:8000 -t public router.php

# Terminal 2
cd frontend && npm start
```
