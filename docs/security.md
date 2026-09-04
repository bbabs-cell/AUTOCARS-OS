# Sécurité — AUTOCARE OS

La sécurité n'est pas un lot en fin de projet : c'est une contrainte
présente à chaque lot. Ce document liste les règles du projet et leur
état d'application.

---

## 1. Secrets

**Règle : aucun mot de passe, clé ou jeton dans le code source.**

Tout vit dans `backend/.env`, qui est exclu de Git dès le premier
commit. Seul `.env.example` est versionné, avec des valeurs vides.

Si un secret se retrouve un jour dans Git, le retirer ne suffit pas :
l'historique le conserve. **Il faut le considérer comme compromis et
le changer.**

✅ Appliqué au Lot 1.

---

## 2. Injection SQL

**Règle : jamais de valeur concaténée dans une requête SQL.**

```php
// INTERDIT — un utilisateur saisissant  ' OR 1=1 --  lit toute la table
$sql = "SELECT * FROM users WHERE email = '$email'";

// CORRECT — MySQL traite la valeur comme du texte, jamais comme du code
$statement = $pdo->prepare('SELECT * FROM users WHERE email = :email');
$statement->execute(['email' => $email]);
```

PDO est configuré avec `ATTR_EMULATE_PREPARES => false`, ce qui envoie
la requête et les valeurs **séparément** à MySQL. C'est ce qui rend
l'injection structurellement impossible.

✅ Configuré au Lot 1 · appliqué à partir du Lot 3.

---

## 3. Mots de passe

**Règle : jamais stockés en clair, ni chiffrés — hachés.**

```php
$hash = password_hash($plainPassword, PASSWORD_DEFAULT);
password_verify($plainPassword, $hash);
```

Le rehachage automatique est en place : quand PHP recommande un
algorithme plus solide, l'empreinte est mise à jour à la prochaine
connexion — le seul moment où le mot de passe en clair est disponible.

`password_hash()` produit un hachage lent et salé. Même avec la base
volée, un attaquant ne peut pas retrouver les mots de passe.

Ne jamais utiliser `md5()` ou `sha1()` : ils sont conçus pour être
rapides, donc faciles à casser par force brute.

🔜 Lot 4.

---

## 4. Authentification

- Jeton d'accès **JWT de courte durée** (30 min), gardé en mémoire par
  Angular.
- Jeton de rafraîchissement dans un cookie
  `httpOnly; Secure; SameSite=Strict`.

**Pourquoi pas le `localStorage` ?** Il est lisible par n'importe quel
JavaScript de la page. Une seule faille XSS et le compte est volé pour
toute la durée du jeton. Un cookie `httpOnly` est invisible au
JavaScript : même en cas de XSS, il ne peut pas être exfiltré.

✅ Appliqué au Lot 4.

---

## 5. Autorisation

**Règle : une permission cachée dans Angular n'est pas une
permission.**

Masquer un bouton améliore l'expérience utilisateur, rien de plus.
N'importe qui peut appeler l'API directement avec `curl`.

**Chaque action sensible est donc vérifiée côté serveur**, à chaque
requête :

- l'utilisateur est-il authentifié ?
- son rôle l'autorise-t-il à cette action ?
- la ressource visée appartient-elle bien à **son** organisation ?

Ce troisième point est le plus souvent oublié, et le plus grave.

**Une permission trop large est un risque ; une permission trop
étroite en est un autre.** Si l'employé doit déranger un responsable à
chaque véhicule rendu, il finira par travailler à côté du logiciel —
et l'on aura des données fausses plutôt qu'un accès restreint. Le lot 9
a donc découpé les droits sur l'argent en quatre, plutôt que de
maintenir un « l'employé ne voit pas les paiements » inapplicable :
il encaisse et voit le solde **d'un dossier**, jamais le cumul de la
journée ni la caisse.

**Trois niveaux, à ne pas confondre** (lot 10) :

1. **Le serveur refuse** — 403 sur une route interdite. C'est la
   protection.
2. **Le serveur n'envoie pas** — le tableau de bord d'un employé ne
   contient aucun montant : pas un bloc masqué, un bloc absent. C'est
   la protection appliquée à la donnée, et c'est le niveau qu'on
   oublie le plus souvent : une route correctement protégée peut
   quand même laisser filtrer, dans un coin de sa réponse, une donnée
   que l'appelant ne devrait pas voir.
3. **L'interface cache** — le menu « Caisse » n'apparaît pas pour un
   employé. C'est du confort : la liste des droits arrive dans le
   navigateur, où n'importe qui peut la modifier.

Un test relit le JSON **brut** du tableau de bord d'un employé et
échoue si le moindre champ monétaire y apparaît.

✅ Appliqué au Lot 4, affiné aux Lots 9 et 10.

---

## 6. Isolation entre entreprises

C'est le risque le plus grave d'un SaaS : qu'une entreprise voie les
données d'une autre.

Parade : aucun contrôleur n'écrit de SQL librement. Toutes les
lectures passent par une couche qui **injecte automatiquement**
`WHERE organization_id = ?`. On ne peut pas l'oublier puisqu'on n'a pas
la possibilité de l'écrire.

Des tests automatisés tenteront explicitement de lire les données
d'une autre organisation et vérifieront que l'API refuse.

✅ Appliqué au Lot 4. `TenantRepository` injecte le filtre ; 43 tests dans `tests/security_test.php` tentent l'accès interdit et vérifient qu'il échoue.

---

## 7. Upload de photos

Accepter un fichier envoyé par un utilisateur est **l'opération la
plus dangereuse d'une application web**. Tout le traitement est
concentré dans une seule classe, `backend/src/Core/PhotoStorage.php`,
pour qu'il soit relu d'un bloc plutôt qu'éparpillé.

**Six protections, appliquées dans cet ordre :**

| # | Protection | Ce qu'elle empêche |
|---|---|---|
| 1 | `is_uploaded_file()` | Lire un fichier du serveur via un chemin fabriqué |
| 2 | Taille ≤ 12 Mo | Saturer le disque |
| 3 | Type réel lu par `finfo` | `payload.php` renommé `photo.jpg` |
| 4 | Garde ≤ 50 M pixels | La « bombe de décompression » : quelques ko compressés, des Go à décoder |
| 5 | **Ré-encodage complet** | Toute charge cachée dans les métadonnées |
| 6 | Nom généré, écriture hors du web | `../../` dans le nom, `.jpg.php`, accès par URL directe |

**La protection n°5 est la plus forte.** Une image peut contenir du
code PHP dans ses métadonnées. Décoder les pixels puis les réécrire
dans un fichier neuf détruit tout ce qui n'est pas de l'image : rien
ne survit. C'est vérifié par un test qui insère une charge dans un
segment `COM` d'un JPEG, envoie l'image, retélécharge le fichier
stocké et constate que la charge a disparu.

**Autres décisions :**

- Conversion en **WebP à 2048 px** : une photo de téléphone fait 3 à
  5 Mo ; cinq par inspection, sur une connexion mobile, c'est
  plusieurs minutes d'attente — et un employé qui abandonne la
  procédure. Une procédure abandonnée ne protège personne.
- L'**orientation EXIF est appliquée avant** le ré-encodage, qui
  détruit ces métadonnées : sinon les photos prises à la verticale
  s'afficheraient couchées.
- Empreinte **SHA-256** du fichier final stockée en base. Si le
  fichier sur le disque est remplacé, l'empreinte ne correspond plus
  et la substitution devient détectable
  (`PhotoStorage::verifyIntegrity()`, comparaison en temps constant).
- Fichiers dans `backend/storage/uploads/`, **hors du dossier web**,
  avec un `.htaccess` en ceinture et bretelles. `GET /api/photos/{id}`
  vérifie l'organisation avant de servir le moindre octet ; une photo
  d'une autre entreprise répond `404`, comme si elle n'existait pas.
- Photos **jamais supprimées**, seulement archivées (`status =
  ARCHIVED`) : une preuve effaçable ne vaut rien.

**La compression côté navigateur n'est pas une protection.** Elle
existe pour le temps d'attente et s'exécute chez le client, donc se
contourne trivialement. Tout ce qui compte est revérifié côté serveur.

✅ Lot 7.

---

## 7 bis. Argent et écritures comptables

**Aucun fournisseur de paiement n'est intégré**, et il n'en sera
intégré aucun tant qu'un compte marchand réel n'existera pas. Pas de
mode bac à sable, pas de faux webhook, pas de paiement simulé qui
réussit toujours : un tel code donnerait l'illusion d'un produit
branché, et il faudrait tout défaire le jour de la vraie intégration —
après avoir peut-être laissé croire à un client que ça marchait.

Cette promesse n'est pas seulement un commentaire : **un test la
vérifie**. `tests/api_payment_test.php` relit tout `src/` et `config/`
à la recherche d'un appel HTTP sortant (`curl_init`, `fsockopen`…),
d'une URL de fournisseur, ou d'une clé d'API de paiement dans
`.env.example`. Une promesse commerciale se garde mieux par un test
que par la bonne volonté de celui qui relira le code dans six mois.

**Une écriture comptable ne se modifie pas.** Aucune route ne permet
de modifier ou de supprimer un encaissement : une erreur se corrige
par une contre-écriture qui laisse les deux lignes visibles.

**Un écart de caisse est enregistré, jamais corrigé en silence.** Un
écart corrigé n'existe plus, et l'on ne peut donc plus le chercher.
Mille francs manquants un mardi, c'est une erreur de monnaie ; mille
francs manquants tous les mardis, c'est autre chose — et on ne le voit
qu'en gardant la trace de chacun. Au-delà de 500 FCFA, une explication
est exigée à la clôture.

**Le montant attendu n'est pas affiché avant la saisie.** L'écrire
au-dessus du champ, c'est obtenir ce chiffre exact tous les soirs :
personne ne recompte contre un nombre déjà donné.

---

## 7 ter. Comptes, rôles et heures de travail

Trois règles ajoutées au lot 12, chacune parce que son absence casse
quelque chose qu'on ne peut pas réparer après coup.

### On ne se retire pas ses propres droits

Un administrateur qui se rétrograde en employé se retrouve enfermé
dehors : plus personne pour lui rendre ses droits. Refusé en `422`.

### Le dernier administrateur actif ne peut pas être retiré

Rétrograder ou désactiver le dernier compte ADMIN encore actif rend
l'entreprise **définitivement** ingérable : plus de création de
compte, plus de changement de rôle, plus de correction d'heure. Le
serveur compte les administrateurs actifs avant d'écrire et refuse en
`409`.

Ce n'est pas une vérification d'interface : elle est faite là où
l'écriture se produit, dans le même flux que la mise à jour.

### On désactive un compte, on ne le supprime pas

Un employé qui part garde son nom sur les dossiers qu'il a traités et
les encaissements qu'il a saisis. Supprimer son compte effacerait la
trace de qui a fait quoi — exactement ce qu'on cherche le jour d'un
litige.

`status = 'INACTIVE'` coupe l'accès **immédiatement**, à deux
endroits :

- la **connexion** est refusée (`403`) ;
- un **jeton déjà émis** cesse d'être accepté (`401`) dès l'appel
  suivant, parce que le middleware relit le statut du compte en base
  à chaque requête plutôt que de faire confiance au contenu du jeton.

Sans ce second point, un employé licencié le matin garderait l'accès
jusqu'à l'expiration de son jeton. Les deux cas sont couverts par un
test.

### Les heures de travail sont des données de paie

**Le logiciel ne ferme jamais un pointage tout seul.** Il ne sait pas
à quelle heure la personne est partie ; inventer une heure de sortie,
c'est fabriquer une donnée qui servira à payer quelqu'un. Les
pointages oubliés sont **signalés**, et un responsable tranche.

**Toute correction est nominative et motivée.** Le motif est
obligatoire (`422` sans lui), et la trace est écrite à deux endroits
indépendants : sur la ligne elle-même (`corrected_by_user_id`,
`corrected_at`, `correction_reason`) et dans `activity_logs`, qui
conserve l'avant **et** l'après. Une heure de paie modifiée sans
explication est exactement ce qu'un employé conteste — et ce qu'un
gérant ne peut plus justifier six mois plus tard.

**Aucune suppression** n'est possible sur `time_entries` : aucune
route, aucune méthode de dépôt.

### Ce que les employés ne reçoivent pas

| Donnée | Qui la reçoit | Comment c'est appliqué |
|---|---|---|
| Le registre de toute l'équipe | `attendance.view` — MANAGER, ADMIN | Le serveur **refuse** (`403`) |
| La correction d'une heure | `attendance.correct` — MANAGER, ADMIN | Le serveur **refuse** (`403`) |
| Le chiffre d'affaires par personne | `reports.view` | Le serveur **n'envoie pas** le champ |
| Son propre pointage | `attendance.clock` — tous | Le serveur ne renvoie **que** sa ligne |

Le troisième cas est le plus important à comprendre : `revenue` n'est
pas masqué à l'affichage, il est **retiré de la réponse**. Un employé
qui ouvre les outils de développement de son navigateur ne trouvera
pas le chiffre d'affaires de ses collègues, parce qu'il n'y est pas.

### Un registre, pas une caméra

Ni géolocalisation, ni photo, ni identifiant d'appareil, ni pointage
automatique. Géolocaliser réglerait le cas de celui qui pointe pour un
collègue, et créerait celui d'un logiciel qui suit ses employés à la
trace. Sur une station où tout le monde se voit, la seconde nuisance
est la plus grande. Ce choix se décide, il ne se découvre pas dans un
schéma.

---

## 8. En-têtes HTTP

Posés par `public/index.php` sur **toutes** les réponses :

| En-tête | Rôle |
|---|---|
| `X-Content-Type-Options: nosniff` | Empêche le navigateur de « deviner » le type d'un fichier envoyé par un utilisateur |
| `X-Frame-Options: DENY` | Empêche l'affichage en iframe (clickjacking) |
| `Referrer-Policy: no-referrer` | Ne divulgue pas les URL internes aux sites tiers |
| `X-Powered-By` **retiré** | N'annonce pas la version de PHP aux attaquants |

✅ Appliqué au Lot 1.

---

## 9. Messages d'erreur

**Règle : ne jamais renvoyer une erreur technique brute au client.**

Un message PHP contient des chemins de fichiers, des noms de classes,
parfois des identifiants de base. En production (`APP_DEBUG=false`),
l'API renvoie un message neutre et journalise le détail côté serveur.

✅ Appliqué au Lot 1 (`index.php`, bloc « filet de sécurité »).

---

## 10. Journal d'audit

Toute action sensible est enregistrée dans `audit_logs` :
connexion, création et modification de véhicule, inspection,
changement de statut, paiement, **restitution**, changement de
permissions.

Chaque entrée contient : `user_id`, `station_id`, `action`,
`entity_type`, `entity_id`, `timestamp`, `metadata`.

C'est ce qui permet de répondre à « qui a fait quoi, et quand ? » —
la question centrale en cas de litige sur un véhicule.

✅ Structure et événements d'authentification au Lot 4 · alimenté à chaque lot suivant.

---

## Récapitulatif

| Règle | État |
|---|---|
| Secrets hors de Git | ✅ Lot 1 |
| En-têtes de sécurité | ✅ Lot 1 |
| Erreurs non divulguées | ✅ Lot 1 |
| PDO sans émulation | ✅ Lot 1 |
| CORS restreint à une origine | ✅ Lot 1 |
| Hachage des mots de passe | ✅ Lot 4 |
| Autorisation côté API | ✅ Lot 4 |
| Isolation multi-tenant + tests | ✅ Lot 4 |
| Journal d'audit | ✅ Lot 4 |
| Jetons courts + rotation | ✅ Lot 4 |
| Limitation des tentatives de connexion | ✅ Lot 4 |
| Envoi d'e-mail (mot de passe oublié) | 🔜 Lot 15 |
| Upload sécurisé | ✅ Lot 7 |
| Machine à états vérifiée côté serveur | ✅ Lot 7 |
| Procédure de restitution contrôlée | ✅ Lot 7 |
| Réorganisation de la file réservée et tracée | ✅ Lot 8 |
| Données financières filtrées côté serveur | ✅ Lot 10 |
| Aucune intégration de paiement (vérifié par un test) | ✅ Lot 9 |
| Écritures comptables non modifiables | ✅ Lot 9 |
| Écart de caisse enregistré, jamais corrigé | ✅ Lot 9 |
| Compte désactivé = accès coupé immédiatement | ✅ Lot 12 |
| Dernier administrateur protégé | ✅ Lot 12 |
| Heures de travail : ni suppression, ni fermeture automatique | ✅ Lot 12 |
| Corrections nominatives et motivées | ✅ Lot 12 |
| Audit de sécurité complet | 🔜 Lot 21 |
