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

## Tableau de bord

| Route | Permission |
|---|---|
| `GET /api/dashboard?station_id=` | `dashboard.view` |

**Tous les rôles peuvent ouvrir cet écran. Le contenu, lui, dépend
des droits — et les blocs interdits ne sont pas masqués, ils ne sont
pas envoyés.**

C'est la distinction qui fait toute la différence entre une
protection et une décoration : masquer un bloc dans Angular ne
protège rien, puisque l'onglet réseau du navigateur montre ce que le
serveur a répondu.

| Bloc | Condition |
|---|---|
| `today.vehicles_in`, `in_progress`, `released`, `waiting` | toujours |
| `alerts`, `top_services`, `average_turnaround_minutes` | toujours |
| `today.revenue`, `revenue_series`, `payment_split`, `ready_unpaid` | `reports.view` |
| `top_services[].total` | `reports.view` |
| `cash` | `cash.view` |

`can_see_money` dit à l'interface s'il faut prévoir trois cartes ou
quatre. Il ne protège rien : il évite un écran troué.

### Les alertes d'abord

`alerts` est le premier champ que l'interface affiche, avant tout
chiffre. Un tableau de bord qui commence par « 47 véhicules ce
mois-ci » laisse passer le véhicule prêt depuis deux heures que
personne n'a rappelé.

Chaque alerte porte un `route` : où aller pour la régler. **Une
alerte disparaît dès que le problème est résolu** — c'est ce qui
fait qu'on la regarde encore au bout d'un mois.

Les seuils viennent de `config/operation_status.php`, **la même
source que la file d'attente**. Les recalculer ici en ferait une
seconde définition, qui divergerait au premier réglage.

### Deux précisions sur les chiffres

`in_progress` compte les véhicules **en station maintenant**, même
arrivés hier — un véhicule laissé la veille occupe toujours la
station. `vehicles_in` compte ceux **accueillis aujourd'hui**, quel
que soit leur état actuel.

`average_turnaround_minutes` mesure de l'arrivée jusqu'à **« prêt »**,
pas jusqu'à la restitution : le temps que met un client à venir
rechercher sa voiture ne dépend pas de la station. La valeur est
`null` sous trois dossiers — une « moyenne » sur deux passages est
une anecdote, et un chiffre faux qu'on croit est pire qu'un chiffre
absent.

### « Aujourd'hui » est en UTC

Le serveur stocke tout en UTC, et `CURDATE()` désigne donc le jour
UTC. Pour le Sénégal, la Gambie, la Guinée et le Mali — à UTC+0 toute
l'année — c'est exact. Ce le sera moins le jour d'une station au
Cameroun : entre 23 h et minuit, la recette basculerait au lendemain.
La colonne `organizations.timezone` existe pour ce jour-là.

### Les droits sont envoyés avec le profil

`GET /api/auth/me` et les réponses de connexion portent désormais
`permissions` : la liste des motifs du rôle (`vehicles.*`, `*`…).

Le frontend s'en sert pour ne pas afficher un menu qui mènerait à un
« accès refusé ». **Elle ne protège rien** — elle arrive dans le
navigateur, où n'importe qui peut la modifier. Son intérêt est
ailleurs : la matrice reste écrite **une seule fois**, dans
`config/permissions.php`. La recopier en TypeScript aurait garanti
qu'un jour les deux divergent.

---

## Équipe et pointage

### `GET /api/team` — la liste de l'équipe

Droit requis : `employees.view` (MANAGER et ADMIN).

```json
{
  "success": true,
  "data": {
    "members": [
      {
        "id": 3,
        "full_name": "Mamadou Diallo",
        "email": "mamadou.diallo@dialloauto.sn",
        "role": "ADMIN",
        "status": "ACTIVE",
        "station_id": 1,
        "station_name": "Station Dakar Plateau",
        "station_names": "Station Dakar Plateau, Station Thiès",
        "station_count": 2,
        "last_login_at": "2026-09-04T11:02:44+00:00"
      }
    ]
  }
}
```

> **UNE LIGNE PAR PERSONNE, PAS PAR RATTACHEMENT.**
> Jusqu'au lot 12, la requête joignait `station_users` sans regrouper :
> un administrateur présent sur deux stations apparaissait **deux
> fois** dans la liste. Le serveur regroupe désormais par personne,
> agrège les stations dans `station_names`, et retient le rôle le plus
> élevé (`MIN(FIELD(role,'ADMIN','MANAGER','EMPLOYEE'))`).
>
> `FIELD()` plutôt que `MIN(role)` : l'ordre d'un `ENUM` dépend de
> l'ordre de déclaration, et une base migrée pourrait le changer sans
> prévenir. `FIELD()` écrit la hiérarchie noir sur blanc.

---

### `PUT /api/team/{id}` — changer un rôle, désactiver un compte

Droit requis : `employees.update` (**ADMIN seulement**).

```json
{ "role": "MANAGER", "status": "INACTIVE" }
```

Deux refus qui n'ont rien d'un détail :

| Cas | Code | Pourquoi |
|---|---|---|
| Se retirer soi-même ses propres droits | `422` | On se retrouverait enfermé dehors, sans personne pour rouvrir. |
| Retirer ou désactiver **le dernier administrateur actif** | `409` | Plus personne ne pourrait créer de compte, changer un rôle ni corriger une heure. L'entreprise serait bloquée sans recours. |

> **DÉSACTIVER, JAMAIS SUPPRIMER.**
> Un employé qui part garde son nom sur les dossiers qu'il a traités
> et les encaissements qu'il a saisis. Supprimer la ligne, ce serait
> effacer la trace de qui a fait quoi — et rendre le journal
> inexploitable le jour d'un litige. `status = 'INACTIVE'` coupe
> l'accès **immédiatement** : la connexion est refusée (`403`) et un
> jeton déjà émis cesse d'être accepté (`401`) au premier appel.

---

### `GET /api/team/activity?from=&to=` — l'activité de chacun

Droit requis : `employees.view`.

```json
{
  "members": [
    { "id": 6, "full_name": "Aliou Sow", "operations": 6, "revenue": 72500 }
  ]
}
```

> Le champ `revenue` **n'est pas envoyé** aux comptes sans
> `reports.view`. Il n'est pas masqué à l'affichage : il ne quitte
> jamais le serveur. Un employé qui ouvre les outils de développement
> ne trouvera pas le chiffre d'affaires de ses collègues dans la
> réponse, parce qu'il n'y est pas.

---

### `GET /api/attendance/me` — mon pointage

Droit requis : `attendance.clock` — **tous les rôles**, y compris
EMPLOYEE. Chacun ne voit que son propre pointage.

```json
{
  "is_clocked_in": true,
  "current": {
    "id": 12,
    "clock_in_at": "2026-09-04T11:04:00+00:00",
    "minutes_present": 197
  }
}
```

`minutes_present` est calculé **par le serveur**. L'horloge d'un
téléphone se règle à la main ; celle du serveur, non. C'est la seule
raison pour laquelle le frontend ne fait pas cette soustraction
lui-même.

---

### `POST /api/attendance/clock-in` — pointer son arrivée
### `POST /api/attendance/clock-out` — pointer son départ

Droit requis : `attendance.clock`. Sans corps de requête : le serveur
sait qui appelle et quelle heure il est.

| Situation | Code |
|---|---|
| Arrivée alors qu'un pointage est déjà ouvert | `409` |
| Départ sans pointage ouvert | `409` |

La règle « un seul pointage ouvert par personne » n'est pas seulement
vérifiée en PHP : elle est **inscrite dans le schéma** par une colonne
générée sous contrainte d'unicité (voir `docs/database.md`). Deux
appels partis en même temps depuis deux téléphones ne peuvent pas
créer deux lignes.

---

### `GET /api/attendance?from=&to=&user_id=&station_id=` — le registre

Droit requis : `attendance.view` (MANAGER et ADMIN). Un employé reçoit
`403` : les heures de ses collègues ne le regardent pas.

```json
{
  "stale":   [ { "id": 9, "user_name": "Ousmane Ba", "hours_open": 81 } ],
  "present": [ { "id": 12, "user_name": "Aliou Sow", "minutes_present": 197 } ],
  "totals":  [ { "user_id": 6, "user_name": "Aliou Sow", "days": 2, "minutes": 1020 } ],
  "entries": [ … ],
  "period":  { "from": "2026-09-01", "to": "2026-09-04" }
}
```

Quatre blocs, dans l'ordre du travail à faire :

1. **`stale`** — les pointages jamais fermés. Tant qu'ils traînent,
   les totaux du mois sont faux.
2. **`present`** — qui est là maintenant.
3. **`totals`** — le chiffre qui sert à payer.
4. **`entries`** — le détail, ligne par ligne.

> **LE LOGICIEL NE FERME RIEN TOUT SEUL.**
> Quelqu'un pointe le matin, part le soir sans pointer, et le compteur
> tourne toute la nuit. La tentation est de fermer automatiquement à
> 18 h, ou après huit heures. Ce serait **fabriquer une donnée de
> paie** : le logiciel ne sait pas à quelle heure la personne est
> partie. Il signale, un responsable tranche avec ce qu'il sait, et la
> correction porte son nom.
>
> Un pointage signalé (`stale`) n'apparaît **ni** dans `present` — un
> « présent depuis 81 h » ferait douter de tout le panneau — **ni**
> dans `totals` : une durée inconnue ne s'estime pas quand elle sert à
> payer. Une ligne est soit une présence, soit une anomalie, jamais
> les deux.

`days` avant `minutes` : la paie d'une station de lavage se fait le
plus souvent à la journée travaillée. « 14 jours » est le chiffre
qu'on cherche ; « 112 h 30 » est celui qu'un logiciel européen
mettrait en avant.

---

### `PUT /api/attendance/{id}` — corriger un pointage

Droit requis : `attendance.correct` (MANAGER et ADMIN).

```json
{
  "clock_in_at":  "2026-09-01 08:00",
  "clock_out_at": "2026-09-01 17:30",
  "reason": "Départ non pointé — confirmé par le chef d'équipe"
}
```

Le motif est **obligatoire**. Une heure de paie modifiée sans
explication, c'est exactement ce qu'un employé conteste — et ce qu'un
gérant ne peut plus justifier six mois plus tard.

Quatre refus, tous en `422` :

| Cas | Pourquoi |
|---|---|
| Motif absent | Voir ci-dessus. |
| Départ antérieur à l'arrivée | Une journée ne se termine pas avant de commencer. |
| Journée de plus de 16 heures | Au-delà, c'est une faute de frappe, pas une journée de travail. |
| Pointage dans le futur | On ne pointe pas demain. |

La réponse renvoie la ligne corrigée **avec les noms**, pas seulement
les identifiants : `corrected_by_name`, `user_name`, `station_name`.

> `find()` fait un `SELECT *` sur la seule table `time_entries` : il en
> revient des identifiants. La ligne renvoyée après une correction
> affichait donc « corrigé par — », alors que le registre affichait
> bien le nom : deux écrans, deux vérités pour la même donnée. D'où
> `findDetailed()`, qui reprend **exactement** les jointures de
> `listDetailed()`.

La correction laisse trois traces, et elles sont indépendantes :

1. `corrected_by_user_id`, `corrected_at`, `correction_reason` **sur
   la ligne elle-même** — visibles dans le registre, sans avoir à
   ouvrir un journal.
2. Une entrée dans `activity_logs` qui conserve **l'avant et
   l'après** (`from` / `to`).
3. La ligne d'origine n'est jamais supprimée : elle est modifiée, et
   la modification se voit.

---

## Rendez-vous

Le carnet qui remplace le cahier posé à côté du téléphone. Le client
appelle, quelqu'un note.

**Aucun SMS, aucun rappel automatique, aucune réservation par le
client lui-même.** Un envoi de SMS suppose un compte opérateur et un
budget ; le coder « en simulation » donnerait l'illusion d'un produit
branché. Même règle qu'au lot 9 sur les paiements, et le même genre de
test la vérifie : `tests/api_booking_test.php` relit tout `src/` à la
recherche d'un appel HTTP sortant ou d'un nom de fournisseur de SMS.

Ce que le produit fait à la place : la liste de ceux qu'il reste à
rappeler. Le téléphone, c'est l'employé qui le compose.

---

### Les cinq états

| État | Sens |
|---|---|
| `SCHEDULED` | Noté, rien de plus. |
| `CONFIRMED` | Quelqu'un a rappelé, le client a dit oui. |
| `ARRIVED` | Le véhicule est là, un dossier est ouvert. |
| `NO_SHOW` | L'heure est passée, personne n'est venu. |
| `CANCELLED` | Annulé, par le client ou par la station. |

Les trois derniers sont **définitifs**. Un rendez-vous manqué qu'on
rouvrirait ferait disparaître le fait qu'il a été manqué ; si le client
reprend un créneau, c'est un **nouveau** rendez-vous, et les deux
lignes racontent alors ce qui s'est réellement passé.

`CONFIRMED` n'est pas un luxe : rappeler la veille est la seule mesure
qui réduit vraiment les absences, et encore faut-il savoir qui reste à
rappeler.

Le parcours est déclaré une seule fois, dans
`config/booking_status.php`, et lu par le contrôleur, le frontend et
les tests.

---

### `GET /api/bookings/statuses` — le parcours

Droit requis : `bookings.view`.

Renvoie les cinq états avec leurs libellés et leurs suites possibles,
plus `no_show_grace_minutes` et `max_days_ahead`.

`allowed_next` **ne contient jamais `ARRIVED`** : voir plus bas.

---

### `GET /api/bookings?from=&to=&station_id=&status=&open=1&search=`

Droit requis : `bookings.view`. **Toute la journée en une seule
requête** — quatre appels séparés donneraient quatre états qui ne se
rafraîchissent pas ensemble, et un compteur qui dit « 3 » au-dessus de
quatre lignes.

```json
{
  "bookings": [ … ],
  "counts":   { "SCHEDULED": 2, "CONFIRMED": 1, "ARRIVED": 1, "NO_SHOW": 0, "CANCELLED": 0 },
  "overdue":  [ … ],
  "load":     [ { "hour": 8, "bookings": 1, "minutes": 30 } ],
  "period":   { "from": "2026-09-04", "to": "2026-09-04" }
}
```

`counts` porte **tous** les statuts, à zéro s'il le faut : un écran
dont les compteurs apparaissent et disparaissent selon les données
saute sous les yeux à chaque rechargement.

**`overdue` ignore volontairement les bornes de dates.** Un rendez-vous
d'avant-hier jamais soldé reste à traiter, même quand on regarde la
journée de demain.

**`load` n'est renvoyée que pour une station et une seule journée.**
Additionner les créneaux de deux stations donnerait un chiffre qui ne
correspond à aucune réalité.

---

### `POST /api/bookings` — noter un rendez-vous

Droit requis : `bookings.create`.

```json
{
  "customer_name": "Moussa Diop",
  "customer_phone": "+221775998877",
  "service_id": 1,
  "station_id": 1,
  "scheduled_at": "2026-09-10 10:00",
  "plate_number": "DK-1234-AA",
  "vehicle_id": null,
  "notes": "Premier passage."
}
```

**Un nom et un numéro suffisent.** Ni fiche client, ni véhicule :
au téléphone, on note ce qu'on entend. Exiger une fiche complète
pendant que quelqu'un attend au bout du fil, c'est obtenir une fiche à
moitié fausse — ou un rendez-vous noté sur un papier, ce qu'on cherche
justement à remplacer.

Le rattachement à une fiche existante est facultatif ; quand
`vehicle_id` est fourni, le **client est déduit du véhicule** et jamais
lu dans la requête — un formulaire modifié ne peut donc pas rattacher
un rendez-vous au client de quelqu'un d'autre.

Refusé en `422` :

| Cas | Pourquoi |
|---|---|
| Dans le passé | Une faute de frappe, pas un projet. |
| Au-delà d'un an | Tarifs et horaires auront changé : le prix figé ne tiendrait plus. |
| Sans téléphone | On ne pourrait ni rappeler, ni retrouver le rendez-vous quand le client appelle. |
| Prestation retirée du catalogue | Promettre ce qu'on ne fait plus organise une déception. |

---

### Le serveur prévient, il ne refuse pas

La réponse porte un tableau `warnings` :

```json
{
  "booking": { … },
  "warnings": ["3 véhicules déjà attendus sur ce créneau."]
}
```

> **AUCUN REFUS POUR CAUSE DE CRÉNEAU PLEIN.**
> Le réflexe serait de donner une capacité à la station (« 3 postes »)
> et de refuser la quatrième réservation à 10 h. Trois raisons de ne
> pas le faire :
>
> - Un « poste » n'est pas une unité stable. Trois laveurs sur un
>   lavage simple, c'est six voitures à l'heure ; sur un detailing,
>   c'est une.
> - Un gérant sait des choses que la base ignore : un renfort le
>   samedi, un client fidèle qu'on fera passer, une voiture qu'on garde
>   sur le parking.
> - Un refus jugé injuste ne fait pas renoncer, il fait **contourner** :
>   on note « 10 h 05 », ou on reprend le cahier — et les données du
>   logiciel deviennent fausses.
>
> On montre la charge, celui qui connaît sa station décide. Même
> principe qu'au lot 12 pour les pointages oubliés : le logiciel
> signale, l'humain tranche.

Le second avertissement porte sur les horaires : un rendez-vous en
dehors des heures d'ouverture est le plus souvent une faute de frappe
(14 h saisi 04 h), parfois un choix assumé pour un habitué.

**Le comptage compare des intervalles, pas des heures de début.** Deux
rendez-vous à 10 h et 10 h 30 se chevauchent si le premier dure une
heure ; compter « combien à 10 h 30 » répondrait « un » alors que deux
voitures seront là.

---

### `PUT /api/bookings/{id}` — déplacer, corriger

Droit requis : `bookings.update`. Refusé en `409` sur un rendez-vous
terminé : déplacer l'heure d'un client déjà venu réécrirait ce qui
s'est passé.

Changer la prestation **refixe le prix**. Ce n'est pas contradictoire
avec la règle ci-dessous : ce qui est figé, c'est le prix de **ce qui a
été promis**. Un client qui passe du lavage simple au complet accepte
le tarif du complet — celui d'aujourd'hui, puisque c'est aujourd'hui
qu'on le lui annonce.

La trace garde l'**avant et l'après**, comme pour la correction d'un
pointage : un déplacement d'heure se conteste.

---

### `PUT /api/bookings/{id}/status` — confirmer, annuler, absenter

Droit requis : `bookings.update`.

```json
{ "status": "CANCELLED", "reason": "Le client a eu un imprévu." }
```

> **LE MOTIF EST FACULTATIF, ET C'EST VOLONTAIRE.**
> Au lot 12, corriger un pointage l'exige : la modification change ce
> qu'on doit à quelqu'un. Ici, rien de tel — un client annule, cela
> arrive. Exiger une justification partout apprend à taper « x » pour
> passer l'écran, et le champ ne vaut alors plus rien là où il compte
> vraiment.

**On ne déclare pas une absence avant l'heure** (`422`). Marquer
« absent » à 9 h un rendez-vous prévu à 10 h n'est pas une
information : c'est une erreur de saisie, ou un employé qui solde sa
journée d'avance. Un délai de grâce de 15 minutes évite l'autre
extrême — un client à 10 h 05 n'est pas absent.

`ARRIVED` est refusé sur cette route (`422`) : voir ci-dessous.

---

### `POST /api/bookings/{id}/arrive` — le client est là

Droit requis : `operations.create` — la route **ouvre un dossier**,
elle exige donc le droit d'en créer un.

```json
{ "vehicle_id": 12 }
```

`vehicle_id` est facultatif quand le rendez-vous en porte déjà un.

> **POURQUOI UNE ROUTE À PART.**
> `ARRIVED` n'est pas qu'un changement de statut : il ouvre une
> opération. Le laisser passer par la route générique autoriserait une
> réservation marquée « arrivée » sans dossier derrière — un véhicule
> officiellement pris en charge que personne ne verrait dans la file.
>
> **Règle générale : un statut qui a un effet de bord n'est jamais
> atteignable par la route générique.**

Les deux écritures sont dans **une seule transaction**. Ouvrir le
dossier sans solder le rendez-vous laisserait le client dans la liste
des gens à rappeler alors que sa voiture est en train d'être lavée ;
solder le rendez-vous sans ouvrir le dossier ferait disparaître un
véhicule présent sur le parking.

---

### Le prix promis est le prix facturé

> **LA RÈGLE MÉTIER LA PLUS IMPORTANTE DE CE LOT.**
>
> Un client réserve trois semaines à l'avance à 5 000 F. Le tarif passe
> à 6 000 F entre-temps. Il paie **5 000 F** : c'est ce qu'on lui a dit
> au téléphone. Facturer plus cher que ce qui a été annoncé est la
> meilleure façon de perdre le client et sa recommandation.
>
> Le prix est donc recopié sur la réservation à sa création, et c'est
> **lui** — pas le tarif du jour — que l'opération reprend à l'arrivée.
> Un test le vérifie en augmentant le tarif entre les deux.

Pour la même raison, l'arrivée ne vérifie **pas** que la prestation est
toujours au catalogue : retirer une prestation n'annule pas les
rendez-vous déjà pris. On refuse d'en **prendre** de nouveaux, on
**honore** ceux qui existent.

Le prix honoré figure dans le journal d'audit (`price_honoured`) :
c'est ce qui permet, des mois plus tard, d'expliquer pourquoi ce
dossier a été facturé moins cher que le tarif affiché ce jour-là.

---

### Le carnet est ouvert à tout le comptoir

C'est le **seul module du produit** où les trois rôles ont exactement
les mêmes droits. Il faut le dire, parce que ça ressemble à un oubli.

Ailleurs, la séparation protège quelque chose de précis : l'argent (la
caisse, les remboursements), les personnes (les rôles, les heures de
paie), la structure (les stations, le catalogue). Un rendez-vous n'est
rien de tout cela : c'est une ligne dans un cahier — et c'est l'employé
qui décroche le téléphone. Si noter, déplacer ou annuler exigeait un
responsable, il faudrait le déranger à chaque appel.

**Inventer une hiérarchie là où le métier n'en a pas produit un
logiciel qu'on contourne.**

---

## À venir

| Lot | Endpoints |
|---|---|
| 16 | `/api/analytics` |

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
