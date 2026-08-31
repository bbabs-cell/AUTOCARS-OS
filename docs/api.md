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

## À venir

| Lot | Endpoints |
|---|---|
| 4 | `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout` |
| 5 | `/api/stations`, `/api/services` |
| 6 | `/api/customers`, `/api/vehicles` |
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
