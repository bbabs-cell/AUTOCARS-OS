# Cahier des charges — AUTOCARE OS

> **Le système d'exploitation de votre station automobile.**
> Plateforme SaaS de gestion pour stations de lavage, centres de
> detailing, centres automobiles et gestionnaires de flottes, au
> Sénégal et en Afrique de l'Ouest.

---

## 0. Objet de ce document, et un avertissement sur sa date

Ce cahier des charges décrit **ce que le produit doit faire, pour qui,
sous quelles contraintes, et ce qu'il ne fera pas**. Il sert de
référence commune entre celui qui commande, celui qui développe et
celui qui, plus tard, reprendra le code.

**Il est écrit au lot 16 sur 22, et il faut le dire honnêtement.** Un
cahier des charges se rédige normalement avant la première ligne de
code. Celui-ci arrive après seize lots, ce qui a une conséquence qu'il
serait malhonnête de masquer : les exigences ci-dessous ne sont pas
toutes des prévisions. Beaucoup sont la mise au propre de décisions
déjà prises, testées, et parfois corrigées en cours de route.

C'est un défaut, et c'est aussi un avantage :

| Ce que ça coûte | Ce que ça rapporte |
|---|---|
| Aucune exigence n'a servi de garde-fou *avant* d'être codée | Aucune exigence n'est une hypothèse : chacune a été confrontée au code |
| Le risque de décrire le logiciel au lieu du besoin | Les règles métier écrites ici sont vérifiées par 739 tests |

Pour tenir les deux bouts, chaque exigence porte un **statut** :

- **[FAIT]** — spécifié, développé, testé, visible à l'écran.
- **[PRÉVU]** — spécifié ici, pas encore développé. Ces exigences-là
  jouent le rôle normal d'un cahier des charges : elles engagent la
  suite.
- **[HORS PÉRIMÈTRE]** — explicitement refusé, avec la raison.

Les documents techniques (`architecture.md`, `database.md`,
`security.md`, `api.md`, `design-system.md`) expliquent **comment**.
Celui-ci dit **quoi** et **pourquoi**.

---

## 1. Contexte et problème à résoudre

### 1.1 La situation actuelle

Une station de lavage typique de la zone visée fonctionne avec un
mélange de :

- un cahier de rendez-vous sur le comptoir ;
- des fiches papier pour l'état des véhicules ;
- WhatsApp pour prévenir le client et coordonner l'équipe ;
- un tableur, parfois, pour la recette ;
- et beaucoup de mémoire humaine.

### 1.2 Les cinq problèmes que cela produit

| # | Problème | Conséquence concrète |
|---|---|---|
| P1 | **Aucune traçabilité de l'état du véhicule** | Le client affirme que la rayure n'y était pas. Sans constat d'entrée, la station perd toujours l'arbitrage — et paye. |
| P2 | **Files d'attente non gérées** | Personne ne sait qui est arrivé avant qui, ni depuis combien de temps une voiture attend. |
| P3 | **Erreurs et fuites de paiement** | Un véhicule part sans avoir réglé ; l'écart de caisse se découvre le soir, sans savoir d'où il vient. |
| P4 | **Informations perdues** | Le numéro du client, l'historique de son véhicule, ce qui a été fait la dernière fois. |
| P5 | **Aucune vision de l'affaire** | Le gérant ne sait pas si le mois a été meilleur que le précédent, ni quelle prestation le fait vivre. |

### 1.3 La réponse du produit

AUTOCARE OS remplace cette organisation dispersée par **une chaîne de
traçabilité continue**, du moment où le client confie son véhicule
jusqu'à sa restitution :

```
rendez-vous → accueil → inspection d'entrée avec photos → file d'attente
   → lavage → contrôle qualité → encaissement → restitution vérifiée
   → clôture de caisse → tableau de bord du lendemain matin
```

Chaque flèche de cette chaîne est une règle vérifiée par le serveur,
pas une convention que l'équipe est priée de respecter.

---

## 2. Périmètre

### 2.1 Ce que le produit couvre — [FAIT]

Gestion d'exploitation d'une ou plusieurs stations : clients,
véhicules, prestations, opérations de lavage, inspections, file
d'attente, encaissements, caisse, équipe et pointage, rendez-vous,
fidélité, abonnements, statistiques.

### 2.2 Ce que le produit ne couvre pas — [HORS PÉRIMÈTRE]

Ce tableau est aussi important que le précédent. Un périmètre qui ne
dit pas non n'est pas un périmètre.

| Exclusion | Raison |
|---|---|
| **Comptabilité générale** (bilan, TVA, liasse fiscale) | Métier d'expert-comptable. Le produit fournit des chiffres justes ; il ne les transforme pas en écritures comptables. |
| **Paie** | Le pointage produit des heures. Les convertir en bulletins engage un droit du travail qui varie d'un pays à l'autre. |
| **Gestion de stock** (produits, consommables) | Réel, mais pas dans la chaîne de traçabilité du véhicule. Candidat pour une version ultérieure. |
| **Intégration de paiement en ligne** | **Aucune intégration ne sera codée tant qu'un compte marchand réel n'existe pas.** Voir §7.4 — c'est une exigence, pas un retard. |
| **Envoi de SMS / WhatsApp / e-mail au client** | Aucun envoi sortant tant que le canal, son coût et son consentement ne sont pas décidés. Le produit n'envoie rien aujourd'hui. |
| **Application mobile native** | L'application web responsive couvre le besoin. Une application native se justifierait par le mode hors-ligne (§7.5), pas avant. |
| **Marketplace / réservation par le client final** | Le rendez-vous est pris par la station, pas par le client. Ouvrir la prise de rendez-vous au public est un autre produit. |

---

## 3. Acteurs et rôles

### 3.1 Les quatre acteurs

| Acteur | Qui c'est | Ce qu'il attend du produit |
|---|---|---|
| **Administrateur** | Le propriétaire de l'entreprise | Savoir si l'affaire va bien, sans être sur place |
| **Manager** | Le responsable d'une station | Faire tourner la journée : file, équipe, caisse |
| **Employé** | Celui qui lave les véhicules et tient le comptoir | Que le logiciel ne le ralentisse pas |
| **Client final** | Le propriétaire du véhicule | N'utilise pas le produit. Il en voit les effets : un ticket, une carte de fidélité, un véhicule rendu conforme |

Le client final **n'a pas de compte**. C'est une décision : lui en
donner un obligerait à gérer des mots de passe, des oublis et des
demandes de suppression pour un public qui vient trois fois par an.

### 3.2 La matrice des droits — [FAIT]

Source unique de vérité : `backend/config/permissions.php`.

| Domaine | ADMIN | MANAGER | EMPLOYEE |
|---|:---:|:---:|:---:|
| Tableau de bord | ✅ | ✅ | ✅ |
| Clients, véhicules | ✅ | ✅ | voir / créer / corriger |
| Opérations (créer, faire avancer) | ✅ | ✅ | ✅ |
| Réorganiser la file, affecter un dossier | ✅ | ✅ | ❌ |
| Restituer un véhicule | ✅ | ✅ | ✅ |
| Lever le blocage d'un impayé | ✅ | ✅ | ❌ |
| Encaisser | ✅ | ✅ | ✅ |
| Journal des recettes, caisse, remboursement | ✅ | ✅ | ❌ |
| Rendez-vous | ✅ | ✅ | ✅ |
| Fidélité : appliquer une récompense | ✅ | ✅ | ✅ |
| Fidélité : changer les règles du programme | ✅ | ❌ | ❌ |
| Abonnements : vendre, décompter | ✅ | ✅ | ✅ |
| Abonnements : créer un forfait, annuler | ✅ | ✅ | ❌ |
| Pointer pour soi | ✅ | ✅ | ✅ |
| Voir le registre de l'équipe, corriger une heure | ✅ | ✅ | ❌ |
| Comptes utilisateurs, rôles | ✅ | ❌ | ❌ |
| Catalogue : créer / retirer une prestation | ✅ | ❌ | ❌ |
| Catalogue : ajuster un prix | ✅ | ✅ | ❌ |
| Statistiques | ✅ | ✅ | ❌ |
| Stations, paramètres de l'entreprise | ✅ | ❌ | ❌ |

**Trois principes tiennent cette matrice :**

1. **Le moindre privilège.** Un compte employé volé ne doit pas donner
   accès au chiffre d'affaires.
2. **Mais jamais au prix du travail.** L'employé encaisse, prend les
   rendez-vous, applique les récompenses et rend les clés — parce
   qu'il est au comptoir. *Un logiciel qu'on doit contourner pour
   travailler finit par ne plus être utilisé du tout.*
3. **La séparation protège quelque chose de précis** : l'argent
   (caisse, remboursements), les personnes (rôles, heures de paie), la
   structure (stations, catalogue). Là où le métier n'a pas de
   hiérarchie — un rendez-vous est une ligne dans un cahier — le
   logiciel n'en invente pas.

---

## 4. Exigences fonctionnelles

Chaque exigence porte un identifiant `EF-xx`. Le lot indiqué est celui
où elle a été livrée (ou est prévue).

### 4.1 Compte, entreprise, installation

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-01 | Un propriétaire crée son compte et son entreprise en une seule inscription | 4 | [FAIT] |
| EF-02 | Connexion par e-mail + mot de passe, session prolongée sans re-saisie | 4 | [FAIT] |
| EF-03 | Réinitialisation de mot de passe par jeton à usage unique et durée limitée | 4 | [FAIT] |
| EF-04 | Installation guidée : la première station et le catalogue de prestations avant tout usage | 5 | [FAIT] |
| EF-05 | Le produit refuse de fonctionner tant que l'installation n'est pas terminée | 5 | [FAIT] |

### 4.2 Clients et véhicules

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-06 | Recherche d'un client au comptoir par nom ou téléphone, en quelques caractères | 6 | [FAIT] |
| EF-07 | Un client porte plusieurs véhicules | 6 | [FAIT] |
| EF-08 | Les plaques sont normalisées à l'enregistrement et affichées au format local | 6 | [FAIT] |
| EF-09 | Une plaque est unique **par entreprise**, jamais globalement | 6 | [FAIT] |
| EF-10 | Le téléphone d'un client n'est **pas** unique : deux personnes partagent un numéro de famille | 6 | [FAIT] |
| EF-11 | L'historique complet d'un véhicule est consultable : opérations, inspections, photos | 6–7 | [FAIT] |

### 4.3 Le parcours d'un véhicule — le cœur du produit

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-12 | Une opération suit une machine à états vérifiée **côté serveur** | 7 | [FAIT] |
| EF-13 | **L'inspection d'entrée est obligatoire** : aucun chemin ne mène au lavage sans elle | 7 | [FAIT] |
| EF-14 | L'inspection accepte des photos horodatées, conservées hors du dossier web | 7 | [FAIT] |
| EF-15 | **Le contrôle qualité est obligatoire**, et peut renvoyer au lavage | 7 | [FAIT] |
| EF-16 | **Un véhicule impayé ne se restitue pas** — sauf dérogation nominative d'un responsable, tracée | 7, 9 | [FAIT] |
| EF-17 | L'annulation est possible **à toute étape** : un client peut repartir à tout moment | 7 | [FAIT] |
| EF-18 | Une photo d'inspection ne se supprime pas | 7 | [FAIT] |

> **Pourquoi EF-17 est une exigence et pas une facilité.** Un logiciel
> qui refuse d'annuler oblige l'équipe à mentir sur les statuts. Des
> données fausses valent moins que pas de données du tout.

### 4.4 File d'attente

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-19 | Vue par colonnes de l'état de la station, lisible d'un coup d'œil | 8 | [FAIT] |
| EF-20 | Alerte visuelle quand un véhicule dépasse la durée annoncée | 8 | [FAIT] |
| EF-21 | Un responsable priorise un dossier et l'affecte à un employé | 8 | [FAIT] |
| EF-22 | Un employé peut signaler « client pressé » **à l'accueil** sans réorganiser la file existante | 8 | [FAIT] |

### 4.5 Argent

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-23 | Encaissement au comptoir : espèces, mobile money, carte, virement, autre | 9 | [FAIT] |
| EF-24 | **Un encaissement ne se modifie pas.** Une erreur se corrige par un remboursement, jamais par une réécriture | 9 | [FAIT] |
| EF-25 | Ouverture et clôture de caisse par vacation, avec fond de caisse déclaré | 9 | [FAIT] |
| EF-26 | L'écart entre le compté et l'attendu est **enregistré, pas corrigé** | 9 | [FAIT] |
| EF-27 | Un seul encaissement peut couvrir plusieurs dossiers ; un dossier peut recevoir plusieurs encaissements | 9 | [FAIT] |
| EF-28 | Les montants sont des **entiers** en francs CFA. Aucun flottant ne touche à l'argent | 3, 9 | [FAIT] |

### 4.6 Pilotage

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-29 | Tableau de bord : **ce qui demande une action aujourd'hui**, et rien d'autre | 10 | [FAIT] |
| EF-30 | Le tableau de bord se vide quand tout va bien | 10 | [FAIT] |
| EF-31 | Statistiques sur une période choisie : activité, recette, prestations, heures, jours | 16 | [FAIT] |
| EF-32 | L'écran distingue **encaissé** (l'argent reçu) et **livré** (la valeur rendue) sans en élire un | 16 | [FAIT] |
| EF-33 | L'identité `valeur livrée = encaissé + offert + prépayé + jamais réglé` est **affichée et vérifiée à l'écran** | 16 | [FAIT] |
| EF-34 | Comparaison durée annoncée / durée réelle par prestation | 16 | [FAIT] |
| EF-35 | Part de clients déjà venus avant la période | 16 | [FAIT] |

> **EF-32 mérite une phrase.** Les deux chiffres sont vrais et ils ne
> sont pas égaux : *encaissé* inclut des forfaits dont les lavages
> seront livrés dans six mois ; *livré* inclut des lavages payés il y
> a six mois et des lavages offerts. Choisir l'un et l'appeler « le
> chiffre d'affaires » serait un mensonge par simplification.

### 4.7 Équipe

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-36 | L'administrateur crée les comptes, attribue les rôles et les stations | 12 | [FAIT] |
| EF-37 | **On désactive un compte, on ne le supprime pas** : son travail passé reste attribué | 12 | [FAIT] |
| EF-38 | On ne peut pas se retirer ses propres droits, ni retirer le dernier administrateur actif | 12 | [FAIT] |
| EF-39 | Pointage d'arrivée et de départ, un seul pointage ouvert par personne | 12 | [FAIT] |
| EF-40 | **Aucune fermeture automatique** d'un pointage oublié : un responsable corrige, nominativement | 12 | [FAIT] |
| EF-41 | Chacun pointe **pour soi** ; corriger l'heure d'un autre est un droit distinct | 12 | [FAIT] |

> **EF-40, dit autrement : un registre, pas une caméra.** Le produit
> ne géolocalise pas, ne prend pas de photo au pointage, ne surveille
> personne. Il enregistre ce qu'une personne déclare, et trace qui
> corrige quoi.

### 4.8 Rendez-vous

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-42 | Carnet de rendez-vous par station et par jour, avec charge horaire visible | 13 | [FAIT] |
| EF-43 | **Aucun refus pour créneau plein** : le produit informe de la charge, il n'arbitre pas | 13 | [FAIT] |
| EF-44 | **Le prix promis est le prix facturé** : il est recopié sur le rendez-vous et ne se réécrit pas | 13 | [FAIT] |
| EF-45 | L'arrivée d'un client attendu crée son dossier en un geste | 13 | [FAIT] |
| EF-46 | Les trois fins (honoré, annulé, absent) sont définitives | 13 | [FAIT] |
| EF-47 | On ne déclare pas une absence avant l'heure du rendez-vous, plus un délai de grâce | 13 | [FAIT] |

### 4.9 Fidélité

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-48 | Programme à tampons : N lavages payés donnent droit à une récompense | 14 | [FAIT] |
| EF-49 | **Une récompense est une remise, jamais de la recette** : elle ne gonfle aucun chiffre d'affaires | 14 | [FAIT] |
| EF-50 | Le grand livre des points est **en ajout seul** : une annulation est une écriture inverse | 14 | [FAIT] |
| EF-51 | Un tampon ne s'obtient que sur un lavage réellement réglé | 14 | [FAIT] |
| EF-52 | La fidélité ne peut jamais bloquer un encaissement | 14 | [FAIT] |
| EF-53 | Un programme naît **inactif** : il ne s'applique qu'une fois assumé | 14 | [FAIT] |

### 4.10 Abonnements

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-54 | Vente de forfaits : N lavages d'une prestation donnée, valables jusqu'à une date | 15 | [FAIT] |
| EF-55 | **L'argent entre dans la caisse le jour où il est reçu**, pas au fil des lavages | 15 | [FAIT] |
| EF-56 | Un lavage d'abonné n'est **ni un cadeau ni une recette** : c'est une dette qu'on éteint | 15 | [FAIT] |
| EF-57 | Le solde restant dû par la station à ses abonnés est **rendu visible** | 15 | [FAIT] |
| EF-58 | Ce qu'un forfait ne couvre pas (autre prestation, forfait périmé, solde épuisé), le serveur le refuse | 15 | [FAIT] |
| EF-59 | **Aucun remboursement automatique** à l'annulation d'un forfait : c'est une décision humaine | 15 | [FAIT] |

### 4.11 Multi-stations et paramètres — [PRÉVU]

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-60 | Une entreprise gère plusieurs stations ; chaque écran d'exploitation se filtre par station | 17 | [PRÉVU] |
| EF-61 | Un utilisateur est rattaché à une ou plusieurs stations ; il ne voit que les siennes | 4, 17 | [FAIT] (base) / [PRÉVU] (écran) |
| EF-62 | Paramètres de l'entreprise : raison sociale, coordonnées, horaires, devise d'affichage | 17 | [PRÉVU] |
| EF-63 | Un administrateur voit l'ensemble de ses stations ; **jamais celles d'une autre entreprise** | 16 | [FAIT] |

### 4.12 Aide et robustesse d'usage — [PRÉVU]

| ID | Exigence | Lot | Statut |
|---|---|:---:|:---:|
| EF-64 | Pages d'erreur explicites : 404, 403, panne serveur, session expirée | 18 | [PRÉVU] |
| EF-65 | Aide contextuelle expliquant les règles qui **refusent** quelque chose (« pourquoi ne puis-je pas rendre ce véhicule ? ») | 18 | [PRÉVU] |
| EF-66 | Chaque message d'erreur de l'API dit ce qui bloque **sans révéler** l'existence de données d'une autre entreprise | 4 | [FAIT] |

---

## 5. Règles métier non négociables

Ces règles ne sont pas des préférences. Elles sont vérifiées par le
serveur, contraintes par la base quand c'est possible, et couvertes
par des tests. Les modifier, c'est changer de produit.

| # | Règle | Où elle est tenue |
|---|---|---|
| R1 | Pas d'inspection d'entrée, pas de lavage | Machine à états + garde serveur |
| R2 | Pas de contrôle qualité, pas de restitution | Machine à états |
| R3 | Pas de paiement, pas de clés — sauf dérogation tracée | Garde serveur + journal d'audit |
| R4 | Un encaissement est immuable | Base + API |
| R5 | Un écart de caisse se constate, il ne se corrige pas | Base |
| R6 | Une récompense de fidélité n'est jamais de la recette | Colonne `discount_amount`, distincte du prix |
| R7 | Un lavage d'abonné n'est jamais compté deux fois | Contrainte d'unicité |
| R8 | Le prix promis lors d'un rendez-vous est le prix facturé | Recopie à la prise du rendez-vous |
| R9 | Le journal d'audit est en ajout seul | Base |
| R10 | Une photo d'inspection ne se supprime pas | Base + `PhotoStorage` |
| R11 | Aucune donnée ne traverse la frontière d'une entreprise | Filtre `organization_id` injecté par `TenantRepository` |

### Deux principes de conception qui découlent de ces règles

> **« Un statut qui se calcule ne se stocke pas. »**
> Le nombre de lavages restants d'un forfait n'est pas une colonne :
> c'est un compte. Une colonne se désynchronise ; un compte, jamais.

> **« Une contrainte ne se pose que sur une règle vraie TOUJOURS. »**
> Trois contraintes d'unicité « évidentes » ont été délibérément
> refusées, parce qu'un cas réel les violait — par exemple un
> gestionnaire de flotte qui prend trois rendez-vous le même jour avec
> le même numéro de téléphone.

---

## 6. Exigences non fonctionnelles

### 6.1 Sécurité — la priorité, dès le premier jour

| ID | Exigence | Statut |
|---|---|:---:|
| ENF-01 | **Multi-tenant dès le jour 1** : chaque table métier porte `organization_id`, et le filtre est injecté par l'infrastructure, pas écrit à la main dans chaque requête | [FAIT] |
| ENF-02 | **Toute permission est vérifiée côté serveur.** Cacher un bouton dans Angular n'est pas une permission : n'importe qui peut appeler l'API avec `curl` | [FAIT] |
| ENF-03 | Aucun mot de passe en clair (hachage à coût adaptatif) | [FAIT] |
| ENF-04 | Aucun secret dans Git : tout en `.env`, avec un `.env.example` sans valeur | [FAIT] |
| ENF-05 | Requêtes préparées partout, sans émulation. Aucune concaténation de valeur dans du SQL | [FAIT] |
| ENF-06 | Les photos sont stockées **hors du dossier exposé au web** et servies par une route qui vérifie les droits | [FAIT] |
| ENF-07 | Journal d'audit nominatif de toute action sensible | [FAIT] |
| ENF-08 | Un message d'erreur ne révèle jamais l'existence d'une donnée d'une autre entreprise (403 et non 200 vide) | [FAIT] |
| ENF-09 | Audit de sécurité complet avant mise en production | [PRÉVU] — lot 21 |

> **ENF-08 vient d'une faille réelle, trouvée au lot 16.** Le contrôle
> d'accès aux stations répondait `200` avec une réponse vide au lieu de
> `403` quand un administrateur demandait une station d'une autre
> entreprise. Aucune donnée ne fuyait — le filtre tenait en dessous —
> mais un `200` vide contre un `403` renseigne : il permettait
> d'énumérer les identifiants des autres. Elle a été trouvée par le
> test d'un écran de statistiques, qui n'a rien à voir avec la
> sécurité. C'est l'argument pour continuer d'écrire des tests même
> quand le module semble inoffensif.

### 6.2 Le terrain visé

| ID | Exigence | Statut |
|---|---|:---:|
| ENF-10 | **Interface en français**, dans les mots qu'un employé emploierait à l'oral | [FAIT] |
| ENF-11 | **Francs CFA (XOF)**, entiers, sans décimale | [FAIT] |
| ENF-12 | Utilisable sur un téléphone de comptoir : responsive à partir de 390 px | [FAIT] |
| ENF-13 | Sobre en données : l'application doit rester utilisable sur une connexion lente | [FAIT] |
| ENF-14 | Le produit n'envoie **rien** au client final tant que le canal n'est pas décidé | [FAIT] |
| ENF-15 | **Mode hors-ligne** — une station peut perdre le réseau | [HORS PÉRIMÈTRE] pour la v1, à réévaluer sur le terrain |

### 6.3 Qualité et maintenabilité

| ID | Exigence | Statut |
|---|---|:---:|
| ENF-16 | **Le code est professionnel mais pédagogique** : chaque choix technique est justifié dans le code ou la documentation | [FAIT] |
| ENF-17 | **Ne pas sur-concevoir.** Aucune abstraction avant son deuxième cas d'usage réel | [FAIT] |
| ENF-18 | Une règle métier est écrite **une seule fois**, à un seul endroit, lue par l'API, l'écran et les tests | [FAIT] |
| ENF-19 | Toute règle serveur est couverte par un test | [FAIT] — 739 tests |
| ENF-20 | **Un lot est validé avant de passer au suivant.** Jamais d'avance automatique | [FAIT] |

### 6.4 Performance et exploitation

| ID | Exigence | Statut |
|---|---|:---:|
| ENF-21 | Les écrans de comptoir répondent en moins d'une seconde sur les volumes d'une station | [FAIT] — index posés au lot 3 et suivants |
| ENF-22 | Les filtres financiers sont appliqués **côté serveur** : l'API n'envoie pas ce que l'utilisateur n'a pas le droit de voir | [FAIT] |
| ENF-23 | Sauvegarde et restauration documentées | [PRÉVU] — lot 22 |
| ENF-24 | Journalisation d'exploitation et supervision | [PRÉVU] — lots 19–22 |

---

## 7. Contraintes techniques imposées

Ces contraintes viennent du commanditaire. Elles ne sont pas le
résultat d'un arbitrage technique.

### 7.1 La pile

| Couche | Technologie | Justification |
|---|---|---|
| Frontend | Angular 20 + Bootstrap 5 | SPA typée, responsive |
| API | **PHP 8.4, sans framework** | Le projet sert aussi d'apprentissage : chaque brique (routeur, requête, réponse, connexion) tient en une centaine de lignes lisibles plutôt que d'être masquée par la magie d'un framework |
| Base | MySQL 8 | Relationnel, PDO, requêtes préparées |
| Contrat | REST / JSON | Un seul contrat, documenté dans `api.md` |

### 7.2 Structure imposée

- **Un seul dossier exposé au web** (`backend/public/`), avec un front
  controller unique. Photos, journaux et code source sont en dehors.
- Le frontend sépare `core/` (services, gardes — une seule instance),
  `shared/` (composants réutilisables) et `features/` (un dossier par
  module métier).

### 7.3 Le design est figé — règle §37

Une fois la charte validée au lot 2, **les couleurs, la typographie,
les boutons, les cartes, les rayons, les icônes, la navigation et les
espacements ne changent plus**. Un écran ajouté au lot 16 utilise les
mêmes jetons que celui du lot 5.

**Direction : claire, premium, aérée.**

| Jeton | Valeur |
|---|---|
| Primaire | `#2563EB` |
| Fond | `#F8FAFC` |
| Surface | `#FFFFFF` |
| Texte | `#111827` |
| Texte secondaire | `#64748B` |
| Bordure | `#E2E8F0` |
| Typographie | Manrope |

**Interdits explicites :** mode sombre, fonds noirs, cyberpunk, néons,
dégradés agressifs, glassmorphisme excessif, ombres lourdes.

### 7.4 Les paiements — l'interdiction la plus importante

> **Aucune intégration de paiement ne sera simulée.**

Le produit est architecturé pour accueillir un fournisseur (les
colonnes `provider` et `external_reference` existent, vides), mais
**aucune fausse intégration n'est codée**. Les encaissements sont
saisis à la main. Le jour où un compte marchand réel existe, ces
colonnes se remplissent.

Une intégration simulée donne la double illusion que le produit sait
encaisser en ligne et que le travail est fait. Les deux sont fausses,
et la seconde coûte plus cher que la première.

### 7.5 Le mode hors-ligne, et pourquoi il n'est pas là

Une station peut perdre le réseau. C'est le risque le plus sérieux du
produit sur le terrain visé.

Il n'est pourtant **pas traité en v1**, délibérément : une file
d'écritures locales avec résolution de conflits est un projet en soi,
et personne ne sait encore *lesquels* des dix-neuf écrans doivent
fonctionner hors ligne. Le test terrain (§10) doit répondre à cette
question avant qu'une ligne soit écrite pour elle.

---

## 8. Modèle de données

**21 tables**, toutes portant `organization_id` pour les tables
métier. Détail complet et justification de chaque colonne :
`docs/database.md`.

| Domaine | Tables |
|---|---|
| Entreprise et accès | `organizations`, `users`, `stations`, `station_users`, `refresh_tokens`, `password_resets` |
| Clientèle | `customers`, `vehicles` |
| Exploitation | `services`, `operations`, `inspections`, `inspection_photos` |
| Argent | `payments`, `cash_sessions` |
| Équipe | `time_entries` |
| Rendez-vous | `bookings` |
| Fidélité | `loyalty_programs`, `loyalty_entries` |
| Abonnements | `subscription_plans`, `subscriptions` |
| Traçabilité | `audit_logs` |

**Le lot 16 n'a ajouté aucune table.** C'est le test de tout ce qui
précède : si les données avaient été mal enregistrées, aucune requête
n'aurait pu les rattraper au moment de produire des statistiques.

---

## 9. Livrables et critères d'acceptation

### 9.1 Livrables

| Livrable | État |
|---|---|
| Code source (frontend, backend, migrations) | Livré en continu, un commit par lot |
| Jeu de données de démonstration | [FAIT] |
| `docs/setup.md` — installation et dépannage | [FAIT] |
| `docs/architecture.md` — les choix et leur justification | [FAIT] |
| `docs/database.md` — le modèle de données | [FAIT] |
| `docs/api.md` — le contrat REST | [FAIT] |
| `docs/security.md` — les règles de sécurité | [FAIT] |
| `docs/design-system.md` — la charte | [FAIT] |
| Ce cahier des charges | [FAIT] |
| Procédure de déploiement et de sauvegarde | [PRÉVU] — lot 22 |
| Rapport d'audit de sécurité | [PRÉVU] — lot 21 |

### 9.2 Critères d'acceptation d'un lot

Un lot n'est proposé à la validation que si les cinq points sont vrais :

1. Toutes les règles serveur du lot sont **couvertes par des tests**,
   et la suite entière est verte — pas seulement les nouveaux tests.
2. La compilation de production passe **sans avertissement**.
3. Les écrans sont vérifiés en 1440 px **et** en 390 px.
4. La documentation concernée est à jour dans le même commit.
5. **Le lot est présenté au commanditaire, et attend sa validation.**

### 9.3 Critère d'acceptation du produit

Le parcours complet d'un véhicule — du rendez-vous à la clôture de
caisse — fonctionne sans intervention en base de données, pour une
entreprise à plusieurs stations, sans qu'aucune donnée d'une
entreprise ne soit atteignable par une autre.

**Ce critère est atteint depuis le lot 10.** Les lots suivants
étendent le produit ; ils ne le rendent pas utilisable, il l'était
déjà.

---

## 10. Planning — 22 lots

| Phase | Lots | Objet | État |
|---|---|---|---|
| **A — Fondations** | 1–3 | Projet, design system, base de données | ✅ |
| **B — Cœur du MVP** | 4–10 | Authentification, installation, clients, opérations, file, argent, tableau de bord | ✅ **MVP utilisable** |
| **C — Extension** | 11–18 | Vitrine, équipe, rendez-vous, fidélité, abonnements, statistiques, multi-stations, aide | 16/18 |
| **D — Industrialisation** | 19–22 | Qualité, audit de sécurité, performance, déploiement | À venir |

**739 tests** (697 backend, 42 frontend) tiennent l'ensemble au
lot 16.

### Le test terrain — la tâche la plus importante qui reste

Le plan prévoit, à ce point précis, **un test dans une vraie
station**. Ce n'est pas une formalité de recette : les lots 17 et 18
gagneront à être conçus sur ce qu'un gérant aura reproché au produit
plutôt que sur ce qu'on imagine aujourd'hui à distance.

Trois questions au moins n'ont pas de réponse crédible sans lui :

1. Un gérant lit-il « livré » et « encaissé » comme deux chiffres
   distincts, ou en choisit-il un et ignore l'autre ?
2. Quels écrans doivent survivre à une coupure réseau (§7.5) ?
3. Les seuils d'alerte de la file d'attente, posés « au bon sens » au
   lot 8, correspondent-ils à la réalité ? *(Les premières mesures du
   lot 16 disent déjà qu'un lavage standard annoncé à 30 minutes en
   dure 36.)*

---

## 11. Risques et points ouverts

| Risque | Impact | Traitement |
|---|---|---|
| **Coupure réseau en station** | Le comptoir s'arrête | Non traité en v1 (§7.5). Le test terrain doit dire quels écrans en ont besoin |
| **Le produit est conçu à distance du terrain** | Des écrans justes et inutiles | Test terrain avant les lots 17–18 |
| **Absence d'intégration de paiement** | Saisie manuelle des encaissements | Assumé (§7.4) : rien ne sera simulé |
| **Référencement de la page publique** | Un robot qui n'exécute pas le JavaScript voit une page vide | Décision au lot 22, avec l'hébergement. Le partage de lien sur WhatsApp — canal principal de la zone — fonctionne déjà |
| **Volume des photos** | Saturation du disque | `PhotoStorage` est l'unique point de contact avec le système de fichiers : le passage à un stockage objet ne touchera que cette classe. Décision sur des volumes réels |
| **Hébergement de production non choisi** | Bloque le lot 22 | Décision du commanditaire attendue |

---

## 12. Ce que ce cahier ne tranche pas encore

Écrit ici pour que personne ne croie que c'est un oubli :

- L'hébergement de production et le rendu côté serveur (lot 22).
- Le stockage des photos à grande échelle.
- Le fournisseur de paiement et le canal de notification client.
- La tarification du SaaS lui-même et la gestion de l'abonnement des
  entreprises clientes — le produit sait gérer les abonnements *des
  clients d'une station*, pas encore les siens.
- La composition de rôles sur mesure : les droits sont aujourd'hui
  trois rôles figés dans un fichier versionné. On passera à des tables
  **le jour où un client voudra composer ses propres rôles, pas
  avant.**
