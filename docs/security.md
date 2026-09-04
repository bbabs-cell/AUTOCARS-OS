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

## 7 quater. Rendez-vous

### Aucune messagerie, aucun envoi sortant

Même promesse qu'au lot 9 sur les paiements, et pour la même raison :
un rappel par SMS suppose un compte opérateur, un budget et un numéro
d'expéditeur déclaré. Un envoi « simulé » en attendant donnerait
l'illusion d'un produit branché — et il faudrait tout défaire le jour
venu, après avoir peut-être laissé croire à un gérant que ses clients
étaient prévenus.

`tests/api_booking_test.php` relit tout `src/` et `config/` à la
recherche d'un appel HTTP sortant ou d'un nom de fournisseur de SMS
(Twilio, Infobip, Africa's Talking…), et `.env.example` à la recherche
d'une clé de messagerie. Une promesse se garde mieux par un test que
par la bonne volonté de celui qui relira le code dans six mois.

### Un statut à effet de bord n'est jamais atteignable directement

`ARRIVED` ouvre une opération. Le poser par la route générique de
changement de statut créerait une réservation « arrivée » sans dossier
derrière : un véhicule officiellement pris en charge que personne ne
verrait dans la file, donc jamais inspecté et jamais facturé.

Il a sa propre route, `POST /api/bookings/{id}/arrive`, qui exige le
droit `operations.create` — celui d'ouvrir un dossier — et fait les
deux écritures **dans une seule transaction**.

**Règle générale : un statut qui a un effet de bord n'est jamais
atteignable par la route générique.**

### Les trois fins sont définitives

`ARRIVED`, `NO_SHOW` et `CANCELLED` sont des états finaux, vérifiés
côté serveur (`409`). Un rendez-vous manqué qu'on rouvrirait ferait
disparaître le fait qu'il a été manqué — et cet historique servira un
jour à décider si on garde un créneau à quelqu'un.

Un rendez-vous terminé ne se **modifie** pas non plus : déplacer
l'heure d'un client déjà venu réécrirait ce qui s'est passé.

### On ne déclare pas une absence avant l'heure

Marquer « absent » à 9 h un rendez-vous prévu à 10 h n'est pas une
information : c'est une erreur de saisie, ou quelqu'un qui solde sa
journée d'avance. Refusé en `422` jusqu'à 15 minutes après l'heure —
un client à 10 h 05 n'est pas absent.

Et comme au lot 12, **le logiciel ne solde rien tout seul** : les
rendez-vous dépassés sont signalés en tête d'écran, quelqu'un au
comptoir tranche.

### Le prix promis ne se réécrit pas

Le prix est figé à la réservation et repris tel quel par l'opération à
l'arrivée. Ce n'est pas seulement commercial : c'est ce qui empêche
qu'un changement de tarif réécrive rétroactivement ce qu'on a annoncé à
des clients. Le prix honoré est inscrit dans le journal d'audit
(`price_honoured`).

### Pourquoi ce module n'a PAS de séparation de rôles

C'est le seul du produit où ADMIN, MANAGER et EMPLOYEE ont les mêmes
droits (`bookings.view`, `bookings.create`, `bookings.update`).

Ce n'est pas un oubli. Ailleurs, la séparation protège quelque chose de
précis : l'argent, les personnes, la structure. Un rendez-vous n'est
rien de tout cela, et c'est l'employé qui décroche le téléphone. Une
hiérarchie inventée ici obligerait à déranger un responsable à chaque
appel — c'est-à-dire à reprendre le cahier.

**Le principe du moindre privilège protège ce qui a de la valeur ; il
ne consiste pas à restreindre par réflexe.** Toutes les actions restent
tracées nominativement.

L'isolation entre entreprises, elle, s'applique comme partout : un
carnet n'est jamais lisible, modifiable ni annulable depuis une autre
organisation, et cinq tests le vérifient.

---

## 7 quinquies. Fidélité

### Une récompense ne devient jamais de la recette

C'est la règle de sécurité comptable du lot. Un faux encaissement
« fidélité » aurait fait annoncer au gérant une recette que son tiroir
ne contient pas — et aurait rendu le coût du programme invisible.

Une récompense diminue `operations.discount_amount`. La recette ne
compte que de l'argent réellement reçu, la caisse du soir reste juste,
et un test compare la recette avant et après une remise pour vérifier
qu'elle **n'a pas bougé d'un franc**.

### Le grand livre est en ajout seul

Aucune route ne modifie ni ne supprime une écriture de
`loyalty_entries`. Une utilisation annulée est compensée par une
écriture inverse (`REVERSAL`) qui porte le nom de son auteur.

Effacer aurait fait disparaître le geste — et avec lui la trace d'une
manipulation possible : appliquer une remise, l'annuler, la
réappliquer sur un autre dossier. Les deux gestes restent lisibles
dans l'historique du client.

### Les doublons sont interdits par la base, pas seulement par le code

Trois contraintes d'unicité sur colonnes calculées :

| Règle | Ce qu'elle empêche |
|---|---|
| Un seul programme actif par entreprise | Deux règles concurrentes, dont le montant appliqué dépendrait de l'ordre des lignes |
| Un seul tampon par dossier | Un encaissement rejoué, ou un paiement en deux fois, qui créditerait deux tampons |
| Une seule annulation par utilisation | Deux appuis sur « Annuler » qui rendraient deux fois les tampons |

Le contrôleur vérifie avant d'écrire ; la base ne peut pas se tromper.
Et une violation de contrainte n'est pas remontée comme une erreur à
l'utilisateur : elle signifie simplement que la règle a joué.

### Un tampon ne s'obtient pas par une dérogation

L'attribution se fait au **paiement**, pas à la restitution. Un
véhicule rendu par dérogation à un client qui n'a rien réglé ne fait
pas avancer sa carte — sinon la dérogation de paiement (lot 7)
deviendrait une façon de fabriquer des tampons.

### La fidélité ne peut pas bloquer un encaissement

`LoyaltyLedger::awardIfSettled()` n'écrit jamais de réponse HTTP et ne
peut pas interrompre le paiement en cours. Un problème de carte de
fidélité n'a aucune raison d'empêcher de prendre l'argent d'un client.

### Un employé peut appliquer une récompense, pas changer les règles

Appliquer une récompense réduit une facture, ce qui ressemble à une
décision d'argent. Ce n'en est pas une : **la règle ne demande aucun
jugement.** Le client a ses tampons ou il ne les a pas, et le serveur
vérifie le solde avant d'écrire. Il n'y a rien à arbitrer.

Le principe du moindre privilège protège ce qui a de la valeur ; il ne
consiste pas à restreindre par réflexe un geste déterminé. Faire venir
un responsable pour appuyer sur ce bouton apprendrait au comptoir à
remettre la carte à plus tard.

**Changer les règles** (`loyalty.manage`) reste à l'administrateur : un
client qui collecte des tampons a une promesse en cours.

Toutes les actions sont tracées nominativement
(`loyalty.redeemed`, `loyalty.redeem_cancelled`,
`loyalty.program_updated` — cette dernière avec l'avant et l'après).

### Un programme naît inactif

La migration crée les tables sur toutes les installations. Un
programme actif par défaut se mettrait à distribuer de l'argent sans
que personne ne l'ait décidé.

---

## 7 sexies. Abonnements

### L'argent encaissé entre dans la caisse le jour où il est reçu

C'est le point non négociable de ce lot. La vente d'un forfait est un
encaissement ordinaire : même table, même session de caisse, même
journal. Une comptabilité d'engagement afficherait 0 F le jour de la
vente et fausserait la clôture du soir — **une caisse fausse est le
pire défaut possible de ce produit.**

Un test compare la recette avant et après la vente et vérifie que les
40 000 F y sont.

### Un lavage d'abonné n'est jamais compté deux fois

Il a été payé à la vente du forfait. Le jour du lavage, le dossier est
ramené à zéro par une remise — aucun encaissement n'est créé. Un test
vérifie que la recette ne bouge pas au moment du lavage.

### Un lavage d'abonné n'est pas un cadeau

`discount_source` distingue une remise de fidélité (un coût) d'un
lavage prépayé (une dette soldée). Sans elle, le bilan de la fidélité
compterait un argent déjà encaissé. Un test le vérifie, et la
migration 021 rattrape les remises antérieures.

### Ce qu'un forfait ne couvre pas, le serveur le refuse

- une **autre prestation** que celle du forfait (`409`) ;
- un dossier **déjà couvert**, **déjà remisé** ou **déjà payé, même en
  partie** (`409`) ;
- un dossier **restitué ou annulé** (`409`) ;
- un forfait **périmé, épuisé ou annulé** (`409`).

Les trois derniers états sont **calculés à la lecture**, jamais lus
dans une colonne : un forfait ne peut donc pas rester utilisable parce
qu'une tâche planifiée a échoué. Un test antidate la péremption en
base sans toucher au statut et vérifie que le forfait cesse de servir.

### Le choix du forfait n'appartient pas à l'appelant

L'API ne prend pas d'identifiant de forfait : le serveur choisit
**celui qui expire le plus tôt**. C'est le seul ordre qui soit dans
l'intérêt du client — l'inverse ferait périmer un forfait pendant
qu'on entame le suivant, et la station gagnerait de l'argent sur une
distraction.

### Aucun remboursement inventé

Annuler un abonnement **arrête** le forfait ; cela ne rend pas
d'argent. Combien rendre à un client qui a pris trois lavages sur dix
est une décision commerciale, pas un calcul. Le remboursement éventuel
passe par la route existante, où il est tracé comme n'importe quelle
sortie d'argent.

Le **motif d'annulation est obligatoire** — contrairement au lot 13
pour un rendez-vous. La différence est qu'ici de l'argent a été
encaissé.

### Un employé vend et décompte, il ne règle rien

Vendre un forfait, c'est encaisser : l'employé le fait déjà toute la
journée. Décompter un lavage ne demande aucun jugement — le serveur
vérifie la prestation, la péremption et le solde.

Régler les conditions d'un forfait engage l'entreprise, et annuler un
abonnement payé ouvre la question d'un remboursement : ces deux-là
restent au responsable (`subscriptions.manage`).

Toutes les actions sont tracées nominativement, et la trace d'une
consommation garde la **valeur** du lavage livré — c'est ce qui permet
de vérifier des mois plus tard qu'un forfait a bien été honoré.

---

## 7 septies. Statistiques, et une faille refermée

### Aucun nouveau droit

`reports.view` existe depuis le lot 4 et veut dire exactement cela :
voir les chiffres de l'entreprise. Un employé reçoit `403`.

Créer `analytics.view` à côté aurait donné **deux droits pour une même
notion** — et le jour où quelqu'un en accorde un sans l'autre, la
règle devient impossible à raisonner. On n'invente pas une permission
quand il en existe une juste.

### La faille que ce lot a refermée

`AuthContext::canAccessStation()` renvoyait **`true` pour tout
administrateur**, sans regarder à quelle entreprise appartenait la
station. L'administrateur de l'entreprise B qui passait l'identifiant
d'une station de l'entreprise A franchissait donc ce contrôle.

**Aucune donnée ne fuyait pour autant.** Toutes les requêtes portent
`organization_id`, et le filtre d'isolation renvoyait zéro ligne.
C'est exactement le rôle d'une défense en profondeur : la première
barrière avait cédé, la seconde a tenu.

Le défaut restait réel : l'API répondait « 200, rien à voir ici » là
où elle devait répondre « cette station n'est pas la vôtre ». Un
utilisateur pouvait sonder l'existence d'identifiants de stations
d'autres entreprises par la seule différence entre un 200 vide et un
403.

**La règle vérifie désormais que la station appartient bien à
l'entreprise de l'appelant.** Le coût est d'une requête, faite au plus
une fois par requête HTTP, et seulement quand un administrateur filtre
effectivement par station.

> **Comment le défaut a été trouvé.** Par le test d'un écran qui n'a
> rien à voir avec la sécurité : les statistiques sont le premier
> module à filtrer par station **sans jamais écrire**, et donc le
> premier à rendre visible qu'un contrôle d'accès laissait passer.
>
> Le test de sécurité a été renforcé en conséquence : il travaillait
> sur des identifiants inventés, il travaille maintenant sur deux
> entreprises réelles, et vérifie **les deux sens** — un
> administrateur atteint les stations sœurs de son entreprise, et
> aucune autre.

### Ce que l'écran ne cache pas

Quand l'identité `livré = encaissé + offert + prépayé + impayé` ne
tombe pas juste, l'écran affiche un bandeau disant que **c'est un
défaut du logiciel**, pas une erreur de saisie. Un produit qui masque
ses incohérences apprend à ses utilisateurs à ne pas croire ses
chiffres.

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
| Aucune intégration de messagerie (vérifié par un test) | ✅ Lot 13 |
| Statut à effet de bord hors de la route générique | ✅ Lot 13 |
| Rendez-vous terminé : ni rouvert, ni modifié | ✅ Lot 13 |
| Prix promis non réécrit par un changement de tarif | ✅ Lot 13 |
| Récompense = remise, jamais de la recette (vérifié par un test) | ✅ Lot 14 |
| Grand livre de fidélité en ajout seul | ✅ Lot 14 |
| Doublons de tampons interdits par la base | ✅ Lot 14 |
| Programme de fidélité inactif par défaut | ✅ Lot 14 |
| Vente de forfait dans la caisse du jour (vérifié par un test) | ✅ Lot 15 |
| Lavage d'abonné jamais compté deux fois | ✅ Lot 15 |
| Remise de fidélité et lavage prépayé distingués | ✅ Lot 15 |
| Forfait périmé / épuisé calculé, jamais stocké | ✅ Lot 15 |
| Aucun remboursement au prorata inventé | ✅ Lot 15 |
| Accès station vérifié par organisation, admins compris | ✅ Lot 16 |
| Statistiques réservées à `reports.view` | ✅ Lot 16 |
| Incohérence comptable affichée, jamais masquée | ✅ Lot 16 |
| Audit de sécurité complet | 🔜 Lot 21 |
