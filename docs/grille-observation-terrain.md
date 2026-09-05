# Grille d'observation terrain — AUTOCARE OS

> **À imprimer et à emporter.** Ce document se remplit à la main, dans
> une station, pendant une vraie journée de travail.

---

## 0. Pourquoi ce document existe, et ce qu'il n'est pas

Vingt-deux lots, 903 tests automatisés, un audit de sécurité, un banc
de performance sur 76 000 dossiers. Tout cela vérifie que le produit
**fait ce qu'on lui a demandé de faire**. Rien de tout cela ne vérifie
qu'on lui a demandé la bonne chose.

C'est la seule question qui reste, et aucun test ne peut y répondre
depuis un ordinateur : **personne n'a encore utilisé ce produit pour
travailler.** Tant que c'est vrai, chaque règle métier écrite dans le
cahier des charges est une hypothèse bien testée — testée contre
elle-même.

Ce document n'est donc pas :

| Ce que ce n'est pas | Pourquoi c'est important |
|---|---|
| Une **démonstration** | Une démo prouve que le produit marche quand c'est son auteur qui clique. C'est déjà connu. |
| Une **formation** | Si les gens ont besoin qu'on leur explique l'écran, la réponse est dans l'écran, pas dans l'explication. |
| Une **collecte d'avis** | « Vous en pensez quoi ? » produit de la politesse. On observe ce qui est fait, pas ce qui est dit. |
| Un **recueil de besoins** | Le cahier des charges existe. Ici on confronte, on n'élargit pas. |

C'est une **séance d'observation** : le produit est posé dans une
station, des gens travaillent avec, et quelqu'un regarde en se taisant.

---

## 1. Les critères d'échec, écrits AVANT d'y aller

**À remplir et à signer avant le départ. Sans cela, tout test réussit.**

Un test terrain sans critère d'échec préalable se termine toujours par
« globalement ça s'est bien passé ». On fixe donc maintenant, à froid,
ce qui compterait comme un échec — et on s'y tient au débriefing même
si la journée a été agréable.

Le test est **en échec** si l'une de ces lignes est vraie à la fin de
la journée :

| # | Critère d'échec | Constaté ? |
|---|---|---|
| E1 | Un dossier au moins a été **traité entièrement sur papier** parce que le logiciel bloquait ou était trop lent | ☐ oui ☐ non |
| E2 | Un employé a dû **appeler l'observateur** pour terminer une tâche courante (hors les 3 exceptions du §3) plus de **3 fois** | ☐ oui ☐ non |
| E3 | Un refus du produit a été **contourné par un mensonge de saisie** (faux montant, faux statut, faux client) | ☐ oui ☐ non |
| E4 | Le responsable **n'a pas su dire**, en fin de journée, combien la station a encaissé | ☐ oui ☐ non |
| E5 | Une donnée d'argent affichée par le produit était **fausse** au regard de la caisse réelle | ☐ oui ☐ non |
| E6 | La station a **cessé d'utiliser le produit** en cours de journée | ☐ oui ☐ non |

E3, E5 et E6 sont **éliminatoires** : un seul suffit à arrêter le
déploiement jusqu'à correction. E1, E2 et E4 se discutent au
débriefing.

Signé avant le départ, le ____ / ____ / ________ par __________________

---

## 2. Ce qui se prépare avant d'y aller

### 2.1 La station

| À vérifier | Pourquoi |
|---|---|
| **Une journée normale**, ni le jour le plus creux ni une veille de fête | Un test un mardi mort ne prouve rien |
| **Au moins 2 personnes** qui travaillent, dont un responsable | Le produit distingue les rôles ; à une personne, la distinction ne se teste pas |
| L'accord du **patron ET des employés** | Quelqu'un qui se sait jugé ne travaille pas normalement. Il faut dire, en clair, que c'est le logiciel qui est testé, pas eux |
| Une **connexion internet** (ou l'absence de connexion, assumée) | La coupure fait partie de ce qu'on mesure. On ne la provoque pas, on la note |
| Un **écran de saisie** au comptoir : tablette, portable, ou téléphone | Noter lequel : la mise en page est jugée sur le matériel réel, pas sur le nôtre |

### 2.2 Les données

**Ne jamais commencer sur une base vide.** Une station qui doit créer
ses 40 prestations avant d'encaisser son premier client abandonne
avant midi.

À charger la veille :

- [ ] Les **prestations réelles** de la station, avec leurs **prix réels** et leurs **durées annoncées réelles** (c'est la matière du §7.3)
- [ ] Les **comptes** des gens qui travailleront, avec leur **vrai rôle**
- [ ] La **station** elle-même : nom, code, devise
- [ ] Rien d'autre. Pas de clients, pas de véhicules, pas d'historique inventé.

Les données de démonstration (`php tools/seed.php`) servent à
apprendre le produit, pas à travailler avec. `php tools/preflight.php`
refuse d'ailleurs une mise en production qui les contient encore.

### 2.3 Le matériel de l'observateur

- Ce document, **imprimé**, une copie par personne observée
- Un **chronomètre** (le téléphone suffit)
- De quoi **photographier le papier** utilisé dans la station (§6)
- Rien pour filmer les gens

### 2.4 Ce qu'on annonce à l'équipe, mot pour mot

> « On teste le logiciel, pas vous. Si quelque chose vous bloque, c'est
> une information utile — ne cherchez pas à bien faire, faites comme
> d'habitude. Si vous préférez prendre un papier, prenez le papier :
> c'est justement ce qu'on veut voir. Je ne vais pas beaucoup parler. »

---

## 3. La règle du silence, et ses trois seules exceptions

**L'observateur ne parle pas.** Chaque fois qu'il explique un écran, il
détruit la donnée qu'il était venu chercher : il ne saura plus jamais
si l'écran était compréhensible.

C'est difficile à tenir. C'est le cœur de la méthode.

Les trois exceptions, et rien d'autre :

1. **Un client réel est en train d'attendre à cause du blocage.** Le
   commerce passe avant la mesure. On aide, et on note en gros
   `AIDÉ` sur la ligne.
2. **Un risque de perte d'argent réelle** (un encaissement sur le point
   d'être perdu, une caisse fausse). Même règle.
3. **Une question de sécurité ou de données** (« est-ce que je peux
   supprimer ça ? »). On répond, parce qu'une mauvaise réponse laisse
   une trace durable.

Une aide donnée n'invalide pas la journée : elle **est** le résultat.
Trois aides sur la même étape valent un défaut à corriger, pas une
équipe à former.

Quand quelqu'un pose une question, la seule réponse autorisée hors
exceptions est : **« Qu'est-ce que vous feriez si je n'étais pas là ? »**
— puis on note ce qu'il fait.

---

## 4. Feuille 1 — La journée, dossier par dossier

Une ligne par véhicule qui entre. À remplir en continu.

| Heure | Qui | Écran ouvert en premier | Ce qui a été fait | Hésitation (s) | Papier utilisé ? | Blocage rencontré | Aidé ? |
|---|---|---|---|---|---|---|---|
| | | | | | ☐ | | ☐ |
| | | | | | ☐ | | ☐ |
| | | | | | ☐ | | ☐ |
| | | | | | ☐ | | ☐ |
| | | | | | ☐ | | ☐ |
| | | | | | ☐ | | ☐ |
| | | | | | ☐ | | ☐ |
| | | | | | ☐ | | ☐ |

**Comment remplir « hésitation »** : le nombre de secondes entre le
moment où la personne arrive sur un écran et son premier clic utile.
Au-delà de **5 secondes**, écrire aussi *où* elle regardait. Un écran
qui fait hésiter deux personnes différentes au même endroit est un
écran à refaire.

**Comment remplir « écran ouvert en premier »** : l'ordre spontané
compte plus que l'ordre prévu. Si tout le monde ouvre la file
d'attente alors que le tableau de bord est la page d'accueil, la page
d'accueil est mal choisie.

### 4.1 Les moments à chronométrer précisément

| Ce qu'on mesure | Départ du chrono | Arrêt | Mesure | Objectif tacite |
|---|---|---|---|---|
| **Accueil d'un véhicule** | le client tend ses clés | le dossier est créé dans le produit | ______ s | < 90 s |
| **Inspection d'entrée** | ouverture de l'écran | inspection enregistrée | ______ s | < 120 s |
| **Encaissement** | le client sort son argent | le paiement est enregistré | ______ s | < 45 s |
| **Restitution** | le client revient | les clés sont rendues | ______ s | < 60 s |
| **Clôture de caisse** | début | fin | ______ min | < 10 min |

Ces objectifs ne sont **pas** des exigences du cahier des charges : ce
sont des repères pour savoir si un chiffre observé est inquiétant. Les
dépasser n'est pas un échec du test ; c'est une ligne de débriefing.

---

## 5. Feuille 2 — Les 28 refus du produit

Le produit refuse 28 choses, et chaque refus est documenté dans l'aide
en ligne (`/help`). **Un refus est le seul endroit où un logiciel
révèle vraiment ce qu'il pense du métier.** C'est donc là qu'il se
trompe le plus visiblement.

Pour chaque refus déclenché pendant la journée, cocher et remplir la
colonne de droite. Les refus non déclenchés ne sont pas un problème :
on ne provoque rien.

### Comment classer un refus déclenché

| Verdict | Ce qu'on a vu | Conséquence |
|---|---|---|
| **P — protège** | La personne a compris, corrigé, et le refus a évité une erreur réelle | Ne rien changer |
| **G — gêne** | La personne a compris mais a trouvé le refus pénible ; le travail a continué | À rediscuter, pas à supprimer |
| **F — faux** | Le refus était **injustifié dans cette station** : la règle métier ne correspond pas à la réalité | **Le cahier des charges est à corriger**, pas l'équipe |
| **C — contourné** | La personne a menti au logiciel pour passer outre | **Critère d'échec E3.** Le refus est nocif : il produit des données fausses |

### 5.1 Le parcours d'un véhicule

| # | Le refus | Déclenché | Verdict | Ce que la personne a fait ensuite |
|---|---|---|---|---|
| 1 | Lavage impossible sans inspection d'entrée | ☐ | P G F C | |
| 2 | Restitution impossible sans contrôle qualité | ☐ | P G F C | |
| 3 | Restitution impossible si impayé | ☐ | P G F C | |
| 4 | Deux dossiers ouverts sur le même véhicule | ☐ | P G F C | |
| 5 | Annulation en cours de lavage | ☐ | P G F C | |

> **Le refus n° 3 est le plus important de la journée.** C'est la règle
> la plus dure du produit, et la dérogation responsable existe
> justement parce qu'on savait qu'elle serait contestée. Noter
> **combien de fois** la dérogation a été utilisée : ______ .
> Si elle est utilisée plus d'une fois par jour, la règle ne tient pas
> et il faut le dire.

### 5.2 L'argent

| # | Le refus | Déclenché | Verdict | Ce que la personne a fait ensuite |
|---|---|---|---|---|
| 6 | Correction d'un montant encaissé | ☐ | P G F C | |
| 7 | Ajustement du total de caisse impossible | ☐ | P G F C | |
| 8 | Une seule caisse ouverte à la fois | ☐ | P G F C | |
| 9 | Recette et caisse invisibles selon le rôle | ☐ | P G F C | |

> Le refus n° 7 (**l'écart de caisse ne s'efface pas**) est le second
> point sensible : il oblige à assumer un manque devant son patron.
> Si l'écart a été rendu nul par une saisie fausse, c'est **E3**.

### 5.3 Les rendez-vous

| # | Le refus | Déclenché | Verdict | Ce que la personne a fait ensuite |
|---|---|---|---|---|
| 10 | Alerte de créneau chargé | ☐ | P G F C | |
| 11 | Absence non déclarable avant le délai de grâce | ☐ | P G F C | |
| 12 | Le rendez-vous garde le prix promis | ☐ | P G F C | |
| 13 | Rendez-vous terminé non modifiable | ☐ | P G F C | |

### 5.4 La fidélité

| # | Le refus | Déclenché | Verdict | Ce que la personne a fait ensuite |
|---|---|---|---|---|
| 14 | Récompense refusée malgré les tampons | ☐ | P G F C | |
| 15 | Forfait ne couvrant pas la prestation | ☐ | P G F C | |
| 16 | Forfait annulé non remboursé | ☐ | P G F C | |

### 5.5 L'équipe

| # | Le refus | Déclenché | Verdict | Ce que la personne a fait ensuite |
|---|---|---|---|---|
| 17 | Dernier administrateur non désactivable | ☐ | P G F C | |
| 18 | Changer son propre rôle | ☐ | P G F C | |
| 19 | Supprimer un compte | ☐ | P G F C | |
| 20 | Pointage de départ oublié | ☐ | P G F C | |
| 21 | Pointer pour un collègue | ☐ | P G F C | |

> Le refus n° 21 mérite une attention particulière au Sénégal comme
> ailleurs : dans beaucoup de petites structures, pointer pour un
> collègue est un **usage établi**, pas une fraude. Si l'équipe le fait
> quand même par un autre moyen (le téléphone du collègue, un papier),
> le refus est **F** et non **P**.

### 5.6 Les stations et les limites assumées

| # | Le refus | Déclenché | Verdict | Ce que la personne a fait ensuite |
|---|---|---|---|---|
| 22 | Fermer une station | ☐ | P G F C | |
| 23 | Supprimer une station | ☐ | P G F C | |
| 24 | Changer la devise | ☐ | P G F C | |
| 25 | Retirer toutes les stations de quelqu'un | ☐ | P G F C | |
| 26 | **Aucun SMS n'est envoyé au client** | ☐ | P G F C | |
| 27 | **Aucun paiement mobile depuis le produit** | ☐ | P G F C | |
| 28 | **Rien ne se ferme ni ne se classe tout seul** | ☐ | P G F C | |

> Les trois derniers ne sont pas des refus techniques : ce sont des
> **limites assumées du périmètre v1**. Ce qu'on mesure ici n'est pas
> si le produit a raison, mais **combien de fois la limite a coûté
> quelque chose** dans une seule journée.
>
> - Nombre de fois où quelqu'un a voulu prévenir un client : ______
> - Nombre de paiements par mobile money encaissés hors du produit : ______
> - Nombre de fois où quelqu'un a attendu que le produit « fasse tout seul » : ______
>
> **Le n° 27 est le plus décisif du projet.** Le cahier des charges
> interdit de coder une intégration de paiement tant qu'un compte
> marchand réel n'existe pas — cette règle ne bouge pas. Mais si la
> majorité des encaissements de la journée se font par mobile money et
> sont saisis à la main dans le produit, alors la priorité du prochain
> chantier est décidée par cette ligne, et par elle seule.

---

## 6. Feuille 3 — Le papier qui survit

**Tout papier encore utilisé à la fin de la journée est un morceau du
métier que le produit n'a pas pris.** C'est la donnée la plus honnête
de la journée, parce que personne ne la donne volontairement.

| Le papier / le carnet | À quoi il sert | Écrit AVANT ou APRÈS la saisie ? | Le produit sait-il déjà le faire ? |
|---|---|---|---|
| | | ☐ avant ☐ après | ☐ oui ☐ non |
| | | ☐ avant ☐ après | ☐ oui ☐ non |
| | | ☐ avant ☐ après | ☐ oui ☐ non |
| | | ☐ avant ☐ après | ☐ oui ☐ non |

La colonne **avant / après** décide de tout :

- Le papier est rempli **avant** puis recopié → le produit est trop
  lent ou mal placé pour le moment de la saisie. Défaut d'ergonomie.
- Le papier est rempli **après**, en plus → le produit ne restitue pas
  quelque chose dont la personne a besoin. Défaut de fonctionnalité.
- Le papier remplace le produit → **critère d'échec E1**.

Photographier chaque papier (sans les noms de clients).

---

## 7. Feuille 4 — Les trois questions qui n'ont pas de réponse à distance

Ces trois-là sont la raison d'être du déplacement. Elles ont été
laissées ouvertes dans le code et dans le cahier des charges, faute de
pouvoir y répondre depuis un bureau.

### 7.1 « Livré » et « encaissé » sont-ils deux nombres distincts ?

Le produit sépare partout **la prestation faite** de **l'argent
rentré**. Un véhicule peut être livré et impayé ; une caisse peut
contenir de l'argent pour des prestations non terminées. Toute la
comptabilité du produit repose sur cette distinction.

**Le test :** à un moment calme de la journée, demander au responsable,
sans montrer d'écran :

> « Aujourd'hui, la station a fait combien ? »

Puis noter **la première réponse**, telle quelle, sans reformuler :

Réponse donnée : ______________________________________________

| Ce que la réponse était | Ce que ça veut dire |
|---|---|
| Un **seul** nombre | La distinction n'est pas naturelle pour lui. À vérifier : le produit lui impose-t-il de choisir, et se trompe-t-il ? |
| **Deux** nombres spontanément | La distinction est déjà dans sa tête. Le produit est aligné sur le métier |
| Un nombre + « mais il y a X qui n'a pas payé » | Le meilleur cas : la distinction existe et l'impayé est vécu comme une exception, ce qui est exactement le modèle du produit |

Ensuite seulement, ouvrir l'écran des statistiques et demander :

> « Est-ce que ce chiffre-là correspond à ce que vous venez de dire ? »

Écart constaté : ______________________________________________

**Décision que cette réponse commande** : si le responsable donne un
seul nombre et se trompe en lisant l'écran, l'écran d'analyse ne
sépare pas assez visiblement les deux notions — et c'est une
correction d'affichage, jamais une correction du modèle de données. La
distinction est juste ; sa présentation ne l'est peut-être pas.

### 7.2 Quels écrans doivent survivre à une coupure ?

Le mode hors-ligne est **[HORS PÉRIMÈTRE] v1** (§7.7 du cahier des
charges). Ce n'est pas une décision définitive : c'est une décision
prise sans données. Les voici.

**On ne provoque aucune coupure.** On note celles qui arrivent.

| Heure | Durée de la coupure | Qui était en train de faire quoi | Ce qui a été perdu | Ce que la personne a fait |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |

À la fin de la journée, cocher les écrans qui ont été touchés par au
moins une coupure :

- [ ] Accueil / création d'un dossier
- [ ] Inspection d'entrée (photos)
- [ ] File d'attente
- [ ] Encaissement
- [ ] Restitution
- [ ] Caisse
- [ ] Statistiques

**La règle de décision, fixée d'avance :** le hors-ligne ne sera
développé que pour les écrans cochés **et** dont la perte a coûté
quelque chose de réel. Un hors-ligne complet est un produit deux fois
plus cher ; un hors-ligne sur deux écrans est un chantier tenable.

### 7.3 Les durées annoncées sont-elles vraies ?

Le lot 8 a fixé les seuils d'alerte de la file d'attente « au bon sens,
faute de mesures ». Le lot 16 a mesuré, sur des données de
démonstration : *lavage standard, annoncé 30 min, réel 36 min, sur
7 mesures*. Sept mesures fabriquées ne prouvent rien. Une journée
réelle, si.

Les seuils actuellement dans le code :

| Seuil | Valeur | Où |
|---|---|---|
| Client en attente sans prise en charge | **20 min** | Alerte du tableau de bord |
| Délai de grâce avant absence déclarable | **15 min** | Rendez-vous |
| Durée par défaut d'une prestation | **30 min** | Catalogue |

**La mesure**, pour chaque véhicule de la journée :

| Prestation | Durée annoncée | Début réel | Fin réelle | Durée réelle | Écart |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |
| | | | | | |

**Ce que les écarts commandent, décidé d'avance :**

| Ce qu'on observe | Conclusion | Ce qu'on corrige |
|---|---|---|
| Quelques prestations dépassent | Variation normale | Rien |
| **Toutes** dépassent, du même ordre | **Le catalogue ment aux clients**, l'équipe n'est pas lente | Les durées annoncées, dans le catalogue de la station |
| L'alerte « 20 minutes » se déclenche sans arrêt | Le seuil est trop bas pour cette station : une alerte permanente n'est plus une alerte | Le seuil, et il devra devenir un réglage par station |
| L'alerte ne se déclenche jamais alors que des clients s'impatientent | Le seuil est trop haut, ou mesure la mauvaise chose | Le seuil, ou ce qu'il compte |

Nombre de fois où l'alerte « client attend depuis plus de 20 minutes »
s'est affichée : ______  — dont justifiées, de l'avis du responsable : ______

---

## 8. Feuille 5 — Ce qu'on regarde sans le demander

À remplir de mémoire en fin de journée, en cinq minutes, sans y
réfléchir longtemps.

| Question | Réponse |
|---|---|
| Combien de personnes ont utilisé le produit ? | |
| Y a-t-il eu un **moment de bascule** où l'équipe a cessé d'y penser et s'en est simplement servie ? À quelle heure ? | |
| Quel écran a été ouvert le plus souvent ? | |
| Quel écran n'a **jamais** été ouvert ? | |
| Quelqu'un a-t-il **montré** un écran à un client ? Lequel ? | |
| Le téléphone a-t-il servi de terminal ? Quelle taille d'écran ? | |
| Y a-t-il eu un moment où quelqu'un a **ri** ou **soupiré** devant un écran ? Lequel ? | |
| Quelqu'un a-t-il demandé une fonction qui n'existe pas ? Laquelle, mot pour mot ? | |

Un écran jamais ouvert de la journée n'est pas forcément inutile — mais
il ne mérite plus une place dans la navigation principale.

---

## 9. Débriefing — convertir l'observation en décisions

**Le jour même, avant d'oublier.** Trente minutes, pas plus. Un
débriefing qui s'étale devient une discussion d'opinion.

### 9.1 Avec l'équipe (15 min, dans la station)

Trois questions, dans cet ordre, et on écoute sans défendre le
produit :

1. « Qu'est-ce qui vous a fait perdre du temps aujourd'hui ? »
2. « Qu'est-ce que vous avez fait sur papier, et pourquoi ? »
3. « Si on vous enlevait le logiciel demain, qu'est-ce qui vous
   manquerait ? » *(la seule question dont la réponse « rien » est une
   information exploitable)*

Ne pas poser : « c'est facile à utiliser ? », « ça vous plaît ? »,
« vous en pensez quoi ? ». Ces trois-là ne produisent que de la
politesse.

### 9.2 Seul, avec les feuilles (15 min)

Chaque observation devient **une ligne** de l'un de ces quatre bacs, et
d'un seul :

| Bac | Contenu | Qui décide | Délai |
|---|---|---|---|
| **A — Bug** | Le produit ne fait pas ce qui est écrit dans le cahier des charges | Le développeur, seul | Avant tout autre travail |
| **B — Affichage** | La règle est bonne, sa présentation trompe | Le développeur, sous la charte figée du lot 2 | Prochain lot |
| **C — Règle métier fausse** | Le cahier des charges s'est trompé sur le métier | **Le commanditaire**, jamais le développeur seul | Décision écrite, puis lot |
| **D — Hors périmètre confirmé** | Le manque est réel mais reste hors v1 | Le commanditaire | Noté, daté, non fait |

**La règle qui rend le débriefing utile :** rien ne va dans le bac B
« pour faire plaisir ». Un défaut d'affichage ne se corrige pas en
changeant les couleurs, la typographie, les boutons, les cartes, les
rayons, les icônes, la navigation ou les espacements — **§37 de la
charte, jamais entamé en vingt-deux lots**. Il se corrige en changeant
ce qui est écrit, ce qui est groupé et ce qui est mis en avant.

### 9.3 Le tableau de sortie

| # | Observation (feuille, ligne) | Bac | Décision | Qui | Fait ? |
|---|---|---|---|---|---|
| 1 | | A B C D | | | ☐ |
| 2 | | A B C D | | | ☐ |
| 3 | | A B C D | | | ☐ |
| 4 | | A B C D | | | ☐ |
| 5 | | A B C D | | | ☐ |
| 6 | | A B C D | | | ☐ |
| 7 | | A B C D | | | ☐ |
| 8 | | A B C D | | | ☐ |

**Verdict de la journée** — reprendre le §1 sans le réécrire :

- Critères d'échec constatés : ______________________
- Éliminatoire déclenché (E3, E5, E6) : ☐ oui ☐ non
- Décision : ☐ on continue ☐ on corrige d'abord ☐ on revoit le périmètre

Signé le ____ / ____ / ________ par __________________

---

## 10. Ce qui se passe après

Une seule journée dans une seule station ne suffit pas à conclure. Elle
suffit à **arrêter les erreurs les plus coûteuses**, ce qui est déjà
l'essentiel.

L'ordre de ce qui suit, si la journée s'est bien passée :

1. Les bugs du **bac A**, corrigés avant tout le reste.
2. Une **seconde journée** dans une station différente — de préférence
   plus grande, ou avec plusieurs sites, parce que le filtre de station
   du lot 17 n'a encore jamais servi à quelqu'un qui en a vraiment
   deux.
3. Les décisions du **bac C**, écrites dans le cahier des charges avec
   leur date et leur motif terrain, avant d'être codées. Une règle
   métier qui change sans trace dans le cahier des charges est une
   règle qui reviendra.
4. La **relecture de sécurité par un tiers**, réclamée par l'audit du
   lot 21, avant les premières données réelles d'un client.

Ce document ne se remplit pas deux fois de la même façon : après la
première journée, ses feuilles doivent être corrigées par ce qu'on aura
appris. Une grille d'observation qui ne change jamais observe surtout
son auteur.

---

## Annexe — Comptes de démonstration

À n'utiliser que pour **apprendre** le produit avant la journée, jamais
pendant. Mot de passe commun : `Autocare2026!`

| Compte | Rôle | Stations | Ce qu'il voit |
|---|---|---|---|
| `mamadou.diallo@dialloauto.sn` | ADMIN | Dakar Plateau **et** Thiès | Tout, y compris les réglages et l'équipe |
| `awa.ndiaye@dialloauto.sn` | MANAGER | Dakar Plateau | L'exploitation, l'argent, les statistiques |
| `aliou.sow@dialloauto.sn` | EMPLOYEE | Dakar Plateau | Son travail, sans les montants globaux |
| `ousmane.ba@dialloauto.sn` | EMPLOYEE | Dakar Plateau | Idem |

Seul le compte administrateur voit deux stations : c'est le seul par
lequel le filtre de station de l'en-tête (lot 17) peut être essayé
avant la journée.

Le jour du test, ces comptes **ne doivent plus exister** sur
l'installation utilisée : `php tools/preflight.php` refuse de valider
une mise en production qui les contient encore.
