# API REST — AUTOCARE OS

## Adresse de base

| Environnement | URL |
|---|---|
| Développement | `http://localhost:8000/api` |
| Production | à définir au Lot 22 |

Toutes les requêtes et réponses sont en **JSON** (`Content-Type:
application/json`).

---

## Format de réponse

L'API répond **toujours** avec l'une de ces deux structures. Aucune
exception : c'est `backend/src/Core/Response.php` qui les produit.

### Succès

```json
{
  "success": true,
  "data": { },
  "message": "Véhicule enregistré."
}
```

### Erreur

```json
{
  "success": false,
  "message": "Les données envoyées sont invalides.",
  "errors": {
    "plate_number": "La plaque est obligatoire."
  }
}
```

`errors` détaille le problème **champ par champ**, ce qui permet à
Angular d'afficher le message directement sous le bon input.

---

## Codes HTTP utilisés

| Code | Signification | Quand |
|---|---|---|
| 200 | OK | Lecture ou modification réussie |
| 201 | Created | Création réussie |
| 400 | Bad Request | Requête mal formée |
| 401 | Unauthorized | Non connecté, ou jeton expiré |
| 403 | Forbidden | Connecté, mais sans le droit nécessaire |
| 404 | Not Found | Ressource inexistante |
| 405 | Method Not Allowed | Mauvais verbe HTTP sur une route existante |
| 422 | Unprocessable Entity | Validation des champs échouée |
| 500 | Internal Server Error | Bug côté serveur |
| 503 | Service Unavailable | Base de données injoignable |

**401 ou 403 ?** 401 = « je ne sais pas qui tu es ».
403 = « je sais qui tu es, et tu n'as pas le droit ».

---

## Conventions de nommage

- Toutes les routes commencent par `/api`.
- Les ressources sont au **pluriel** : `/api/vehicles`, jamais
  `/api/vehicle`.
- **Le verbe HTTP porte l'action, pas l'URL.** On n'écrit donc jamais
  `/api/createVehicle`.

```
GET    /api/vehicles        lister
POST   /api/vehicles        créer
GET    /api/vehicles/{id}   consulter
PUT    /api/vehicles/{id}   modifier
DELETE /api/vehicles/{id}   supprimer
```

- Les champs JSON sont en `snake_case` (`plate_number`), comme les
  colonnes MySQL. Une seule convention de la base au frontend évite
  les conversions et les bugs de nommage.

---

## Endpoints disponibles

### `GET /api/health` — Diagnostic

Route **publique** (aucune authentification). Vérifie que l'API et la
base de données répondent.

Réponse `200` :

```json
{
  "success": true,
  "data": {
    "application": "AUTOCARE OS API",
    "status": "ok",
    "database": "connected",
    "timestamp": "2026-08-31T02:35:31+00:00",
    "environment": "local",
    "php_version": "8.4.19",
    "database_name": "autocare_os"
  },
  "message": "L'API AUTOCARE OS fonctionne."
}
```

> Les champs `environment`, `php_version` et `database_name`
> n'apparaissent que si `APP_DEBUG=true`. En production, annoncer sa
> version de PHP à tout internet aide les attaquants à cibler les
> failles connues.

Réponse `503` si la base ne répond pas :

```json
{
  "success": false,
  "message": "L'API répond mais la base de données est injoignable.",
  "errors": { "database": "Connexion impossible. Lance : php tools/check_db.php" }
}
```

---

## Authentification

### Comment ça marche

```
POST /api/auth/login
   │
   ├──► jeton d'accès (JWT, 30 min)   → renvoyé dans le corps JSON
   │                                     Angular le garde EN MÉMOIRE
   │
   └──► jeton de rafraîchissement (7 j) → cookie httpOnly
                                          invisible au JavaScript
```

Chaque requête protégée porte l'en-tête :

```
Authorization: Bearer <jeton d'accès>
```

Quand le jeton d'accès expire, l'API répond `401`. Le client appelle
alors `POST /api/auth/refresh` (le cookie part tout seul), obtient un
nouveau jeton et rejoue sa requête. L'utilisateur ne voit rien.

**Pourquoi deux jetons ?** Un jeton unique de longue durée resterait
exploitable une semaine s'il était volé. Un jeton unique de courte
durée obligerait à se reconnecter toutes les demi-heures. Le couple
donne la sécurité *et* le confort.

**Pourquoi le rôle n'est-il pas dans le jeton ?** Parce qu'un JWT
n'est pas modifiable une fois émis. Si le rôle y figurait, rétrograder
un employé n'aurait aucun effet avant l'expiration du jeton. Il est
donc relu en base à chaque requête : une requête de plus, une
révocation immédiate.

### Rotation

À chaque `refresh`, l'ancien jeton de rafraîchissement est révoqué et
un nouveau émis. Un jeton ne sert donc qu'une fois — s'il réapparaît,
il est refusé.

---

### `POST /api/auth/register` — Créer une entreprise

Crée en une transaction : l'organisation, sa première station, et
l'utilisateur administrateur.

```json
{
  "organization_name": "Groupe Diallo Auto",
  "first_name": "Mamadou",
  "last_name": "Diallo",
  "email": "mamadou@dialloauto.sn",
  "phone": "+221771234567",
  "password": "un-mot-de-passe-assez-long"
}
```

`201` → même charge utile que `login`.
`422` → `{"errors": {"email": "Cette adresse e-mail est déjà utilisée."}}`

---

### `POST /api/auth/login`

```json
{ "email": "mamadou@dialloauto.sn", "password": "…" }
```

Réponse `200` :

```json
{
  "success": true,
  "data": {
    "access_token": "eyJ0eXAiOiJKV1Qi…",
    "expires_in": 1800,
    "user": {
      "id": 1, "organization_id": 1,
      "email": "mamadou@dialloauto.sn",
      "full_name": "Mamadou Diallo",
      "role": "ADMIN", "station_ids": [1]
    }
  },
  "message": "Connexion réussie."
}
```

| Code | Cas |
|---|---|
| `401` | Identifiants incorrects — **message identique** que le compte existe ou non |
| `403` | Compte désactivé |
| `429` | Plus de 5 échecs en 15 minutes |

> Le message d'erreur ne dit jamais si l'adresse existe : ce serait un
> moyen commode de découvrir quels comptes sont enregistrés.

---

### `POST /api/auth/refresh`

Aucun corps. Le cookie `autocare_refresh` est envoyé automatiquement
par le navigateur. Renvoie une nouvelle session.

### `POST /api/auth/logout`

Révoque le jeton de rafraîchissement et efface le cookie.

### `GET /api/auth/me` 🔒

Profil de l'utilisateur connecté.

### `POST /api/auth/forgot-password`

```json
{ "email": "mamadou@dialloauto.sn" }
```

Répond **toujours** `200` avec le même message, que le compte existe
ou non.

> ⚠️ L'envoi d'e-mail n'est pas implémenté : aucun serveur SMTP n'est
> configuré, et on ne simule pas une intégration inexistante. Le lien
> est écrit dans le journal du serveur, et renvoyé dans la réponse
> (`debug_reset_link`) uniquement si `APP_DEBUG=true`.
> L'envoi réel arrive au **lot 15**.

### `POST /api/auth/reset-password`

```json
{ "token": "…", "password": "nouveau-mot-de-passe" }
```

Change le mot de passe et **révoque toutes les sessions ouvertes**.

---

## Routes protégées

Une route marquée 🔒 exige l'en-tête `Authorization`. Certaines
exigent en plus une permission (voir
`backend/config/permissions.php`).

| Code | Signification |
|---|---|
| `401` | Pas de jeton, jeton expiré ou invalide |
| `403` | Connecté, mais le rôle ne permet pas cette action |

Les exigences de chaque route sont déclarées dans
`backend/config/routes.php` :

```php
$router->post('/api/auth/login', [AuthController::class, 'login']);   // public
$router->get('/api/auth/me', [AuthController::class, 'me'], ['auth' => true]);
$router->get('/api/vehicles', [VehicleController::class, 'index'], [
    'auth' => true,
    'permission' => 'vehicles.view',
]);
```

Les rendre visibles à cet endroit est délibéré : une protection
oubliée saute aux yeux à la relecture.

---

## Configuration de la station

Toutes ces routes exigent une authentification (🔒) et une permission
précise, déclarée dans `backend/config/routes.php`.

### Installation guidée

| Route | Permission | Rôle |
|---|---|---|
| `GET /api/onboarding/status` | `onboarding.view` | Où en est l'installation |
| `POST /api/onboarding/complete` | `stations.update` | La marquer terminée |

`complete` renvoie `422` si aucune prestation n'existe : sans
catalogue, le gérant arriverait sur un produit où rien ne fonctionne.

### Stations

| Route | Permission |
|---|---|
| `GET /api/stations` | `stations.view` |
| `GET /api/stations/{id}` | `stations.view` |
| `PUT /api/stations/{id}` | `stations.update` |

Le `code` doit contenir 2 à 10 lettres ou chiffres, sans espace : il
apparaît dans les références remises aux clients (`DKP-2608-0042`).
Les horaires sont acceptés et renvoyés au format `HH:MM`.

### Prestations

| Route | Permission |
|---|---|
| `GET /api/services` | `services.view` |
| `GET /api/services/{id}` | `services.view` |
| `POST /api/services` | `services.create` |
| `PUT /api/services/{id}` | `services.update` |
| `PUT /api/services/{id}/status` | `services.update` |

`GET /api/services?only_active=1` ne renvoie que les prestations
proposables au comptoir.

**Il n'existe pas de route de suppression.** Une prestation est
référencée par toutes les opérations passées : la supprimer trouerait
l'historique. `PUT .../status` bascule entre `ACTIVE` et `INACTIVE`.

Le prix est un **entier en FCFA**. « 10 000 FCFA » ou « 10.5 » sont
refusés avec un `422` — mieux vaut un refus clair qu'une conversion
silencieuse en 10.

### Équipe

| Route | Permission |
|---|---|
| `GET /api/team` | `employees.view` |
| `POST /api/team` | `employees.create` |

La création d'un membre insère l'utilisateur **et** son rattachement à
une station dans une seule transaction : un compte sans rattachement
n'aurait aucun rôle, donc aucun droit — il pourrait se connecter sans
rien pouvoir faire.

---

## Clients et véhicules

### Clients

| Route | Permission |
|---|---|
| `GET /api/customers?search=` | `customers.view` |
| `GET /api/customers/check-phone?phone=` | `customers.view` |
| `GET /api/customers/{id}` | `customers.view` |
| `POST /api/customers` | `customers.create` |
| `PUT /api/customers/{id}` | `customers.update` |

**La recherche est la fonction principale**, pas la liste. Elle porte
sur le nom, le prénom et le téléphone. Le numéro peut être tapé sans
indicatif ni espaces : `776112233` retrouve `+221 77 611 22 33`.

`check-phone` sert à **avertir** d'un doublon pendant la saisie, pas à
l'interdire. Le téléphone n'est volontairement pas unique en base : un
couple partage souvent un numéro, et refuser l'enregistrement en pleine
affluence serait pire que le doublon.

`GET /api/customers/{id}` renvoie le client, ses compteurs (véhicules,
visites, total dépensé, dernière visite) et ses véhicules.

### Véhicules

| Route | Permission |
|---|---|
| `GET /api/vehicles?search=&customer_id=` | `vehicles.view` |
| `GET /api/vehicles/{id}` | `vehicles.view` |
| `POST /api/vehicles` | `vehicles.create` |
| `PUT /api/vehicles/{id}` | `vehicles.update` |

**Les plaques sont normalisées.** `dk 1234 aa`, `DK-1234-AA` et
`dk.1234.aa` sont stockées `DK1234AA` et désignent le même véhicule.
Sans cela, la base contiendrait plusieurs fiches pour une seule
voiture et l'historique — raison d'être du produit — serait éparpillé.

L'API renvoie les deux formes :

```json
{ "plate_number": "DK1234AA", "plate_display": "DK-1234-AA" }
```

Le format national **n'est pas** imposé : un véhicule immatriculé en
Gambie ou au Mali doit pouvoir être servi. On vérifie seulement que la
plaque est exploitable — 5 à 12 caractères mêlant lettres et chiffres.

`GET /api/vehicles/{id}` renvoie le véhicule, son propriétaire et son
**historique complet** : c'est l'écran qu'on ouvre en cas de litige.

---

## À venir

| Lot | Endpoints |
|---|---|
| 7 | `/api/inspections`, `/api/inspections/{id}/photos` |
| 8 | `/api/operations`, `/api/queue` |
| 9 | `/api/payments`, `/api/cash-registers` |

---

## CORS

Le navigateur bloque par défaut les appels entre deux origines
différentes — et en développement, Angular (`:4200`) et l'API
(`:8000`) en sont bien deux.

L'API autorise donc explicitement **une seule** origine, celle définie
par `APP_FRONTEND_URL` dans `backend/.env`.

On n'utilise volontairement pas `Access-Control-Allow-Origin: *` :
l'étoile autoriserait n'importe quel site à appeler l'API, et elle est
de toute façon incompatible avec les cookies d'authentification prévus
au Lot 4.
