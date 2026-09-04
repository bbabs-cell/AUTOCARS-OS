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

## Opérations

Une **opération** est le passage d'un véhicule en station : un
véhicule, un client, une prestation, une date. Tout le produit tourne
autour d'elle.

| Route | Permission |
|---|---|
| `GET /api/operations/statuses` | `operations.view` |
| `GET /api/operations?active=1&search=&station_id=` | `operations.view` |
| `GET /api/operations/{id}` | `operations.view` |
| `POST /api/operations` | `operations.create` |
| `PUT /api/operations/{id}/status` | `operations.update_status` |
| `GET /api/operations/{id}/release-check` | `operations.view` |
| `POST /api/operations/{id}/release` | `operations.release` |

### La machine à états

Une opération ne change pas de statut librement. Le parcours est
déclaré dans `backend/config/operation_status.php`, à un seul endroit,
et appliqué par le serveur :

```
WAITING → IN_PROGRESS → INSPECTION → WASHING → QUALITY_CHECK → READY → COMPLETED
                                       ↑             │
                                       └─────────────┘   (contrôle refusé)
```

`CANCELLED` est atteignable depuis tout statut non terminal.
`COMPLETED` et `CANCELLED` sont finaux.

**Trois règles ne peuvent pas être contournées**, même en appelant
l'API directement :

1. **L'inspection d'entrée est obligatoire.** Il n'existe aucune
   transition `IN_PROGRESS → WASHING`, et `INSPECTION → WASHING` exige
   qu'une inspection soit réellement enregistrée. Sans état constaté à
   l'arrivée, la station perd systématiquement l'arbitrage d'un litige.
2. **Le contrôle qualité est obligatoire**, et peut renvoyer au
   lavage. Un contrôle qui ne peut que valider n'est pas un contrôle.
3. **La restitution exige un règlement**, ou une dérogation d'un
   responsable — tracée nominativement dans le journal d'audit.

`GET /api/operations/statuses` expose cette machine au frontend pour
qu'il n'affiche que les boutons utilisables. C'est un **confort
d'affichage** : le serveur revérifie chaque transition.

### Ouverture d'un dossier

```json
POST /api/operations
{ "vehicle_id": 12, "service_id": 3, "station_id": 1, "priority": 0 }
```

- Le **client n'est pas lu dans la requête** : il est déduit du
  véhicule. Un formulaire modifié ne peut donc pas rattacher un
  dossier au client de quelqu'un d'autre.
- Le **prix est figé** à l'ouverture, recopié du catalogue. Un
  changement de tarif le mois suivant ne réécrit pas le passé.
- Un **second dossier ouvert sur le même véhicule** est refusé (`409`) :
  deux dossiers, c'est deux inspections contradictoires.
- La référence est générée au format `CODE-AAMM-NNNN`
  (`DKP-2609-0042`) : code de station, année et mois, compteur mensuel.
  On n'expose pas l'identifiant de la base, qui révélerait le volume
  d'activité.

### Restitution

`POST /api/operations/{id}/release` est une route **à part**, avec sa
propre procédure. Un simple changement de statut vers `COMPLETED` est
refusé (`403`) : ce serait contourner les contrôles du comptoir.

```json
{ "reference": "DKP-2609-0042", "plate_number": "DK-1234-AA",
  "override_reason": "Client habituel, règlement en fin de mois." }
```

Quatre vérifications, dans cet ordre :

1. le dossier est `READY` — sinon `409` ;
2. la référence présentée correspond — sinon `422` ;
3. la plaque saisie correspond au véhicule — sinon `422` ;
4. la prestation est réglée — sinon `402 Payment Required`, sauf
   `override_reason` fourni **par un porteur de**
   `operations.override_payment` (`403` sinon).

Ressaisir la plaque peut sembler redondant puisqu'elle est à l'écran.
C'est le seul contrôle qui porte sur le **monde réel** et non sur la
base : il oblige à regarder la voiture avant de remettre les clés.

---

## Inspections et photos

| Route | Permission |
|---|---|
| `POST /api/operations/{id}/inspections` | `inspections.create` |
| `GET /api/inspections/{id}` | `inspections.view` |
| `POST /api/inspections/{id}/photos` | `inspections.create` |
| `GET /api/vehicles/{id}/inspections` | `inspections.view` |
| `GET /api/photos/{id}` | `inspections.view` |

**Une inspection ne se modifie pas.** Il n'y a ni `PUT` ni `DELETE` :
un constat réécrivable après coup ne prouve rien, et c'est précisément
au moment du litige que quelqu'un voudrait le corriger. Une erreur de
saisie se rattrape par une observation dans l'inspection de sortie.

Deux inspections au maximum par dossier (`ENTRY`, `EXIT`), garanties
par une contrainte d'unicité. Une inspection d'entrée enregistrée fait
automatiquement passer le dossier à `INSPECTION`.

Deux validations métier valent d'être connues :

- cocher « dommage constaté » **sans le décrire** est refusé : « il y
  avait une rayure » ne dit ni où, ni laquelle ;
- déclarer le client présent **sans son nom** est refusé : c'est ce nom
  qui transforme un constat interne en constat contradictoire.

### Envoi d'une photo

`POST /api/inspections/{id}/photos` est la **seule route qui ne reçoit
pas du JSON** : elle attend un envoi `multipart/form-data` avec les
champs `photo` (le fichier) et `position` (`FRONT`, `REAR`, `LEFT`,
`RIGHT`, `INTERIOR`, `DAMAGE`, `OTHER`).

Encoder une image en base64 dans du JSON l'alourdirait d'un tiers —
sur une connexion mobile, ce tiers se compte en secondes d'attente.

Les photos s'envoient **une par une**. Sur une connexion qui coupe, un
envoi groupé perd tout ; envoyée séparément, chaque photo est acquise
dès qu'elle est passée.

Le traitement serveur est décrit dans `docs/security.md` §7.

### Lecture d'une photo

`GET /api/photos/{id}` est la **seule route qui renvoie un fichier**
et non du JSON. Elle existe parce que les fichiers sont stockés hors
du dossier web : sans elle, aucune URL n'y mènerait.

⚠️ Elle exige l'en-tête `Authorization` comme toutes les autres. Un
navigateur **n'envoie pas cet en-tête sur une balise `<img>`** : le
frontend télécharge donc le fichier puis fabrique une URL locale
(`URL.createObjectURL`). C'est le prix à payer pour que les preuves ne
soient pas accessibles à quiconque devine une adresse.

---

## File d'attente

| Route | Permission |
|---|---|
| `GET /api/queue?station_id=` | `operations.view` |
| `PUT /api/operations/{id}/priority` | `operations.prioritize` |
| `PUT /api/operations/{id}/assign` | `operations.assign` |

**Il n'y a pas de table `queue`, et ce n'est pas un oubli.** La file
est une *lecture* des opérations actives, groupées et triées. Une
table séparée dupliquerait l'état, et deux copies d'un même état
finissent toujours par diverger — on aurait alors un véhicule « en
lavage » dans la file et « restitué » dans son dossier, sans moyen de
savoir lequel a raison.

### Les colonnes

Elles sont déclarées dans `backend/config/operation_status.php`, à
côté du parcours qu'elles montrent, et arrivent constituées :

```json
{ "label": "Inspection", "drop_status": "INSPECTION",
  "statuses": ["IN_PROGRESS", "INSPECTION"],
  "count": 2, "overdue": 0, "operations": [ … ] }
```

**Cinq colonnes pour six statuts actifs** : `IN_PROGRESS` ne dure que
quelques secondes en pratique — l'employé prend le véhicule en charge
et enchaîne sur l'inspection. Lui donner sa propre colonne
reviendrait à réserver un sixième de l'écran à une case vide.

⚠️ Ce regroupement est un choix d'**affichage**. Les deux statuts
restent distincts en base et dans la machine à états : c'est ce qui
permet d'exiger l'inspection avant le lavage. *On regroupe ce qu'on
montre, jamais ce qu'on enregistre.*

`drop_status` est le statut appliqué quand une carte est déposée dans
la colonne — le frontend n'a donc jamais besoin de connaître le
parcours.

### Le temps, pas l'état

Chaque opération porte trois champs qui font tout l'intérêt de
l'écran :

| Champ | Sens |
|---|---|
| `minutes_in_status` | Temps passé à l'étape actuelle |
| `alert_after_minutes` | Seuil au-delà duquel l'étape mérite un coup d'œil |
| `is_overdue` | Le seuil est dépassé |

« 6 véhicules en lavage » n'appelle aucune décision. « Cette voiture
est en lavage depuis 1 h 06 pour une prestation vendue 45 minutes » en
appelle une immédiatement.

Les seuils sont dans `config/operation_status.php`, section `alerts`.
Celui du lavage vaut `null` : il reprend alors **la durée annoncée de
la prestation**. Dépasser de moitié un lavage vendu 30 minutes n'a pas
le même sens que dépasser de moitié un detailing vendu 3 heures, et un
seuil fixe serait absurde pour l'un ou pour l'autre. Sans durée
connue, aucune alerte n'est levée : une alerte fausse coûte plus cher
qu'une alerte absente, parce qu'on la vérifie.

Ces trois champs sont calculés **par le serveur**, dont l'horloge fait
foi. Le poste d'une station peut être déréglé de vingt minutes.

### L'ordre

Priorité décroissante d'abord, puis ancienneté **dans l'étape
courante** — et non date d'arrivée. Un véhicule renvoyé au lavage
après un contrôle raté remonterait sinon en tête de colonne alors
qu'il vient d'y entrer, et masquerait celui qui attend vraiment.

### Deux actions réservées aux responsables

`priority` (0 à 3, borné) et `assign` exigent des permissions que
l'employé n'a pas. **Ce n'est pas une méfiance, c'est une distinction
de geste** : à l'accueil, l'employé *enregistre* ce que le client lui
dit — « je suis pressé » fait partie de la prise de commande, et le
champ `priority` reste donc accessible sur `POST /api/operations`.
Ici, on *réorganise* une file où des gens attendent déjà, et l'on fait
reculer quelqu'un qui était devant.

Un employé n'a pas besoin de `assign` pour prendre un véhicule en
charge : passer le dossier à `IN_PROGRESS` l'inscrit dessus
automatiquement. Cette route sert à désigner **quelqu'un d'autre**,
c'est-à-dire à répartir le travail de l'équipe.

Les deux actions sont tracées dans le journal d'audit — « pourquoi ma
voiture est passée après celle-là ? » se discute après coup.

`assigned_user_id: null` remet le dossier dans la file commune.

---

## Encaissements

> ### ⚠️ Aucun fournisseur de paiement n'est intégré
>
> Ces routes n'appellent ni Wave, ni Orange Money, ni aucune
> passerelle. Il n'existe **pas** de mode bac à sable, pas de faux
> webhook, pas de paiement simulé qui réussit toujours.
>
> Elles enregistrent ce que le caissier **déclare** avoir reçu —
> exactement ce que fait un cahier, en additionnant tout seul.
>
> `provider` et `external_reference` sont du texte saisi à la main :
> le nom du service, et le numéro recopié depuis le téléphone du
> client. Le jour où un compte marchand existera, l'intégration
> remplira ces mêmes colonnes.
>
> Cette promesse est **vérifiée par un test** (`api_payment_test.php`,
> section 0) qui relit le code source à la recherche d'un appel HTTP
> sortant ou d'une URL de fournisseur.

| Route | Permission |
|---|---|
| `POST /api/operations/{id}/payments` | `payments.create` |
| `GET /api/operations/{id}/payments` | `payments.view` |
| `GET /api/payments?from=&to=&method=` | `payments.journal` |
| `POST /api/payments/{id}/refund` | `payments.refund` |

### Quatre permissions, pas une

C'est la distinction la plus importante du module :

| Permission | Qui | Pourquoi |
|---|---|---|
| `payments.create` | Employé | Il est au comptoir quand le client règle |
| `payments.view` | Employé | Il doit savoir ce qui reste dû sur le dossier qu'il rend |
| `payments.journal` | Responsable | La recette de la journée est un cumul |
| `payments.refund` | Responsable | Rendre de l'argent n'est pas une décision de comptoir |

C'est une **précision** par rapport au lot 4, qui posait « l'employé
ne voit pas les paiements » sans distinguer l'encaissement du chiffre
d'affaires. Un logiciel qu'on doit contourner pour travailler finit
par ne plus être utilisé du tout.

### Enregistrer un encaissement

```json
POST /api/operations/12/payments
{ "amount": 5000, "method": "CASH" }
```

- `amount` est un **entier de francs**. Le franc CFA n'a pas de
  centimes, et accepter « 5000,50 » créerait des arrondis dans une
  caisse qui doit tomber juste.
- Un **trop-perçu est refusé** (`422`). C'est presque toujours une
  faute de frappe — 50 000 au lieu de 5 000 — et une fois enregistrée
  elle fausse la caisse du soir sans que personne ne comprenne.
- Les **règlements partiels** sont acceptés : acompte puis solde,
  éventuellement par des moyens différents.

La réponse porte `outside_cash_session: true` si l'encaissement en
espèces n'a été rattaché à aucune caisse ouverte. Le signaler **au
moment de la saisie** est le seul moment où l'on peut encore ouvrir le
tiroir ; le découvrir le soir ne sert plus à rien.

### On n'efface pas, on contre-passe

Il n'existe **ni `PUT` ni `DELETE`** sur un encaissement. Une erreur
se corrige par un remboursement :

```json
POST /api/payments/42/refund
{ "reason": "Prestation annulée, client remboursé en espèces." }
```

Deux écritures, une seule transaction : l'originale passe à
`REFUNDED`, une contre-écriture est ajoutée. Les deux restent
visibles. C'est la règle de base de toute comptabilité, et c'est
surtout la seule qui résiste au soir où la caisse ne tombe pas juste.

Le dossier redevient non réglé, ce qui **rebloque sa restitution** :
la boucle avec le lot 7 est cohérente.

---

## Caisse

| Route | Permission |
|---|---|
| `GET /api/cash/current?station_id=` | `cash.view` |
| `GET /api/cash/sessions?station_id=` | `cash.view` |
| `POST /api/cash/open` | `cash.open` |
| `POST /api/cash/close` | `cash.close` |

**Tout ce module existe pour un seul nombre : l'écart.** Le matin on
compte le fond de caisse, le soir on recompte, le logiciel dit ce
qu'il devrait y avoir. Un logiciel de caisse qui affiche toujours zéro
d'écart ne prouve rien : il dit seulement que personne ne compte.

### Une session est une vacation, le tiroir ne contient que les espèces

`cash_session_id` est posé sur **tous** les encaissements de la
session, quel que soit leur moyen — « ce matin nous avons fait
45 000 F, dont 18 000 en espèces » est la phrase que le caissier doit
pouvoir lire. Ne rattacher que les espèces le priverait de tout le
reste.

Le tri se fait au calcul : `expected_amount` ne retient que
`method = 'CASH'`. Un paiement Wave n'est pas dans le tiroir, et l'y
ajouter rendrait la clôture fausse tous les soirs.

### Une seule caisse ouverte par station, garantie par la base

Une colonne calculée (`open_station_id`, qui vaut `station_id` tant
que la session est ouverte et `NULL` ensuite) porte une contrainte
`UNIQUE`. L'API vérifie déjà avant d'ouvrir, mais deux caissiers qui
cliquent à la même seconde passeraient tous les deux la vérification
avant que l'un des deux n'écrive. Seule la base peut trancher — elle
répond alors `409`.

### La clôture

```json
POST /api/cash/close
{ "counted_amount": 47300, "closing_notes": "Erreur de rendu ce matin." }
```

- Un **écart supérieur à 500 FCFA exige une explication** (`422`
  sinon). Le seuil est bas volontairement : au-dessous, on est dans
  l'erreur de monnaie ordinaire et exiger une phrase ferait écrire
  « RAS » tous les soirs.
- `difference` est **signé** : négatif s'il manque, positif s'il y a
  trop. Un excédent est aussi une anomalie qu'un manque — il signale
  souvent un encaissement non saisi.
- Les montants sont **figés** dans la ligne, jamais recalculés. Une
  correction ultérieure sur un paiement changerait sinon
  rétroactivement un écart déjà constaté. *Une clôture est une photo,
  pas une vue.*

`cash_outside_session` compte les espèces encaissées aujourd'hui hors
de toute session : ces montants ne sont dans aucune clôture, et le
tiroir contiendra un argent que le logiciel n'attend pas.

---

## À venir

| Lot | Endpoints |
|---|---|
| 10 | `/api/dashboard` |

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
