# Design system — AUTOCARE OS

> **Page de référence vivante : [http://localhost:4200/styleguide](http://localhost:4200/styleguide)**
> Elle est écrite avec les vrais composants, jamais avec des images :
> elle ne peut donc pas se désynchroniser du code.

---

## La règle

**Une fois ce design system validé, les couleurs, la typographie, les
rayons et les espacements ne changent plus.** Tout nouvel écran
réutilise les composants existants.

S'il manque quelque chose : on l'ajoute **au design system d'abord**,
on le montre sur `/styleguide`, puis on l'utilise. Jamais l'inverse.

C'est la seule façon de garder une interface cohérente sur 20 modules
construits en plusieurs mois.

---

## Où vivent les styles

| Fichier | Rôle |
|---|---|
| `src/styles/_tokens.scss` | **Source unique de vérité.** Couleurs, typographie, espacements, rayons, ombres — sous forme de variables CSS. |
| `src/styles/_bootstrap-config.scss` | Personnalisation de Bootstrap **avant** compilation. |
| `src/styles/_base.scss` | Typographie globale, liens, focus, accessibilité. |
| `src/styles/_components.scss` | Nos classes `ac-*`. |
| `src/styles.scss` | Assemble le tout, dans un ordre qui compte. |

**Règle absolue :** aucun écran n'écrit `color: #2563EB` ou
`padding: 17px`. On utilise `var(--ac-primary)` et `var(--ac-space-4)`.

### Pourquoi des variables CSS et non des variables Sass ?

Parce qu'elles restent lisibles dans l'inspecteur du navigateur : on
peut voir et modifier `--ac-primary` en direct dans les DevTools, ce
qui est impossible avec une variable Sass compilée.

Exception : `_bootstrap-config.scss` utilise des variables Sass, car
Sass ne sait pas lire une variable CSS au moment de la compilation.
C'est le seul endroit du projet où une couleur est écrite en double.

---

## Couleurs

| Rôle | Variable | Valeur |
|---|---|---|
| Principale | `--ac-primary` | `#2563EB` |
| Accent | `--ac-accent` | `#06B6D4` |
| Succès | `--ac-success` | `#10B981` |
| Avertissement | `--ac-warning` | `#F59E0B` |
| Erreur | `--ac-danger` | `#EF4444` |
| Fond de page | `--ac-background` | `#F8FAFC` |
| Surface | `--ac-surface` | `#FFFFFF` |
| Bordure | `--ac-border` | `#E2E8F0` |
| Texte | `--ac-text` | `#111827` |
| Texte secondaire | `--ac-text-secondary` | `#475569` |

**Le bleu identifie l'action.** Il ne doit jamais envahir l'écran :
sur une page type, moins de 10 % de la surface est bleue.

### Deux verts, deux rouges — et pourquoi

`--ac-success` (`#10B981`) sert aux **pastilles, icônes et bordures**.
Les boutons pleins utilisent `#047857`, plus foncé.

Raison : Bootstrap met du texte **blanc** sur ces couleurs. Le
contraste du blanc sur `#10B981` est de **2,54** — très en dessous du
seuil d'accessibilité de 4,5. Le libellé « Terminer » serait
difficile à lire en plein soleil, situation quotidienne de nos
utilisateurs. Avec `#047857`, le contraste monte à **5,48**.

Même logique pour le rouge : `#EF4444` pour les accents, `#DC2626`
pour les boutons pleins (contraste 4,83).

### Contrastes vérifiés

Tous les couples texte/fond du produit ont été mesurés selon la norme
WCAG AA (seuil 4,5 pour un texte normal) :

| Élément | Contraste |
|---|---|
| Texte principal sur fond de page | 16,96 |
| Texte secondaire sur fond de page | 7,24 |
| Texte discret sur fond de page | 4,55 |
| Bouton bleu, texte blanc | 5,17 |
| Bouton vert, texte blanc | 5,48 |
| Badges de statut (les 8) | de 4,84 à 9,45 |

`--ac-icon-muted` (`#94A3B8`, contraste 2,45) est réservé aux
éléments **décoratifs** : icône de recherche, chevrons. Jamais pour
du texte.

---

## Statuts d'opération

Huit statuts, définis dans
`src/app/core/models/operation-status.model.ts`.

| Statut | Libellé | Couleur |
|---|---|---|
| `WAITING` | En attente | gris |
| `IN_PROGRESS` | Prise en charge | bleu |
| `INSPECTION` | Inspection | violet |
| `WASHING` | En lavage | cyan |
| `QUALITY_CHECK` | Contrôle | orange |
| `READY` | Prêt | vert |
| `COMPLETED` | Terminé | gris |
| `CANCELLED` | Annulé | rouge |

La progression suit une logique de température : gris (rien ne se
passe) → bleus (en cours) → orange (contrôle) → vert (prêt).

**La pastille colorée du badge n'est pas décorative.** Elle permet de
distinguer les statuts en cas de daltonisme, où deux couleurs peuvent
paraître identiques : la forme et la position aident là où la couleur
seule échoue.

```html
<ac-status-badge status="WASHING" />
```

---

## Typographie

**Manrope**, hébergée avec l'application (paquet `@fontsource/manrope`)
plutôt que chargée depuis Google Fonts. Deux raisons : l'interface
s'affiche correctement sans connexion, et aucune donnée de nos
utilisateurs n'est envoyée à un tiers.

| Niveau | Taille | Graisse |
|---|---|---|
| H1 | 32 px | 700 |
| H2 | 24 px | 700 |
| H3 | 20 px | 600 |
| H4 | 18 px | 600 |
| Corps | 15 px | 400 |
| Libellé | 13 px | 600 |
| Légende | 12 px | 400 |

Cinq niveaux seulement : une hiérarchie que l'on peut réciter de
mémoire est une hiérarchie qui sera respectée.

Les montants et les colonnes de chiffres utilisent `.ac-numeric`
(chiffres à largeur fixe). Sans cela, « 1 111 » est plus étroit que
« 9 999 » et les colonnes de prix paraissent bancales.

---

## Espacements

Échelle basée sur **4 px** : `--ac-space-1` (4px) à `--ac-space-16`
(64px). On n'utilise que ces valeurs — un `padding: 17px` choisi au
hasard casse le rythme de toute la page.

Valeurs les plus utilisées : `--ac-space-4` (16px) entre éléments,
`--ac-space-6` (24px) pour le padding des cartes.

---

## Composants disponibles

### Composants Angular

| Sélecteur | Rôle |
|---|---|
| `<ac-status-badge>` | Badge de statut d'opération |
| `<ac-avatar>` | Avatar avec initiales de repli |
| `<ac-stat-card>` | Indicateur chiffré (KPI) |
| `<ac-empty-state>` | État vide, avec action proposée |
| `<ac-page-header>` | En-tête de page, titre + actions |
| `<ac-app-shell>` | Coque : barre latérale + en-tête |

### Classes CSS

`.ac-card` · `.ac-badge` · `.ac-table` · `.ac-plate` · `.ac-alert` ·
`.ac-tabs` · `.ac-breadcrumb` · `.ac-pagination` · `.ac-modal` ·
`.ac-toast` · `.ac-skeleton` · `.ac-empty` · `.ac-detail-list` ·
`.ac-btn-field` · `.ac-btn-icon` · `.ac-code`

---

## Deux règles propres à ce produit

### 1. Boutons terrain — 52 px

Les employés utilisent l'application **debout, souvent les mains
mouillées, parfois avec des gants**, sur un téléphone tenu d'une seule
main.

Les actions fréquentes (« Commencer le lavage », « Terminer »,
« Prendre une photo », « Restituer ») utilisent `.ac-btn-field` :
52 px de haut, bien au-delà des 44 px recommandés par Apple et Google.

Ce n'est pas du confort, c'est ce qui évite les erreurs de
manipulation sur le véhicule d'un client.

### 2. Les états font partie de l'écran

**Un écran qui ne gère que le cas où tout va bien n'est pas un écran
fini.** Chaque page prévoit :

- **chargement** → `.ac-skeleton` (montre la forme de ce qui arrive,
  l'attente paraît plus courte et l'écran ne « saute » pas) ;
- **aucune donnée** → `<ac-empty-state>` avec l'action qui remplira
  l'écran. « Aucun véhicule » laisse l'utilisateur bloqué ;
  « Aucun véhicule enregistré — [Ajouter un véhicule] » le fait
  avancer ;
- **erreur** → `.ac-alert--danger` avec un message actionnable, jamais
  un code technique brut.

---

## Bootstrap : ce qu'on utilise, ce qu'on remplace

**On utilise** sa grille (`row`, `col-*`), ses utilitaires
(`d-flex`, `gap-*`, `mb-*`), ses formulaires et ses boutons — tous
repersonnalisés.

**On ne charge pas son JavaScript.** Les menus déroulants, modales et
tiroirs sont écrits en Angular (un `signal` + une classe CSS).

Raison : Bootstrap manipule le DOM directement, ce qui entre en
conflit avec la façon dont Angular gère l'affichage. Une quinzaine de
lignes d'Angular évitent toute une catégorie de bugs, réduisent le
poids envoyé au navigateur, et le comportement reste maîtrisé de bout
en bout.

---

## Responsive

| Palier | Largeur | Comportement |
|---|---|---|
| Mobile | < 768 px | Barre latérale en tiroir, tableaux qui défilent, modales collées en bas |
| Tablette | 768 – 991 px | Idem, contenu plus large |
| Desktop | ≥ 992 px | Barre latérale fixe visible |

Vérifié sans débordement horizontal à 390 px, 1024 px et 1440 px.

Les tableaux défilent **dans leur conteneur** (`.ac-table-wrapper`),
jamais la page entière — ce qui donnerait l'impression d'une mise en
page cassée.

---

## Accessibilité

- L'indicateur de focus n'est **jamais** supprimé. `:focus-visible`
  ne l'affiche qu'en navigation clavier.
- Tous les contrastes sont mesurés (voir tableau plus haut).
- La couleur n'est jamais le seul porteur d'information : les statuts
  ont une pastille en plus de leur teinte.
- `prefers-reduced-motion` est respecté : les animations sont
  désactivées pour les personnes qui l'ont demandé dans leur système.
  Ce n'est pas une option, c'est une règle.

---

## Poids

Build de production : **627 kB brut, 121 kB compressés** pour le
chargement initial, dont 36 kB de CSS.

`bootstrap-icons` déclare 2 078 classes d'icônes alors que le produit
en utilise environ 47. Réduire ce fichier à un sous-ensemble
économiserait environ 90 kB bruts — **à traiter au Lot 22**
(préparation à la production), pas maintenant : la complexité ajoutée
au build ne se justifie pas tant que le produit n'est pas fini.


---

## Couleurs de graphique (ajoutées au lot 10)

**Ce n'est pas une modification du design system, c'est un ajout.**
Aucune couleur existante n'a changé. On complète une palette qui
manquait : jusqu'au lot 10, rien ne servait à distinguer plusieurs
séries dans un même graphique.

| Jeton | Valeur | Origine |
|---|---|---|
| `--ac-chart-1` | `#1d4ed8` | bleu — déjà présent (`--ac-primary-600`) |
| `--ac-chart-2` | `#0891b2` | cyan — déjà présent (`--ac-accent-600`) |
| `--ac-chart-3` | `#7c3aed` | violet — **nouveau** |
| `--ac-chart-4` | `#be185d` | rose — **nouveau** |
| `--ac-chart-other` | `--ac-gray-400` | le « reste », sans identité propre |
| `--ac-chart-track` | `--ac-gray-100` | fond de piste d'une barre |

### Pourquoi pas les couleurs de sens ?

Vert, orange et rouge veulent déjà dire quelque chose dans ce
produit : réussi, à surveiller, en échec. Les employer pour
« Espèces » et « Carte bancaire » ferait lire une alerte là où il n'y
a qu'une catégorie.

### Comment elles ont été choisies

Par un calcul, pas à l'œil. Les quatre teintes sont :

- dans la **même bande de clarté** — aucune ne domine les autres ;
- assez **saturées** pour ne pas virer au gris ;
- **séparables par un daltonien** : écart perceptuel ≥ 12 sur les
  trois formes de daltonisme (protanopie, deutéranopie, tritanopie),
  pour un seuil recommandé de 8 ;
- de **contraste ≥ 3:1** sur fond blanc.

Une cinquième teinte n'est pas fabriquée : elle serait indiscernable
des quatre autres pour un daltonien. Au-delà, tout est regroupé sous
« Autre », en gris — un gris qui dit justement « pas d'identité
propre ».

### La règle qui compte : la couleur suit l'entité

**L'ordre est fixe.** Les espèces reçoivent toujours
`--ac-chart-1`, le mobile money toujours `--ac-chart-2`, que l'un
dépasse l'autre ou non.

Colorer par rang — la plus grosse part en bleu, la deuxième en cyan —
ferait changer les couleurs d'un matin à l'autre sans qu'aucune
donnée n'ait changé de nature. Quelqu'un qui a appris « le bleu,
c'est les espèces » lirait alors le graphique à l'envers sans s'en
apercevoir.

C'est le rôle du champ `slot` sur chaque segment, et c'est ce que
vérifie `split-bar.component.spec.ts`.

### Ce qu'on ne fait pas dans un graphique

| À éviter | Pourquoi |
|---|---|
| Deux axes verticaux | L'alignement des deux échelles est arbitraire : le graphique invente une corrélation qui n'est pas dans les données |
| Un dégradé sur des catégories sans ordre | La longueur dit déjà la valeur ; la couleur répéterait la même information |
| Un camembert pour comparer des parts proches | L'œil compare mal des angles, bien des longueurs |
| Un nombre au-dessus de chaque point | Sept nombres alignés deviennent du bruit qu'on ne lit plus — on étiquette la valeur extrême, l'axe et le survol font le reste |
| Une bibliothèque de graphiques pour sept rectangles | 200 ko sur une connexion mobile, et ses couleurs à combattre |


---

## La page d'accueil publique (lot 11)

C'est le seul écran du produit qui ne s'adresse pas à un utilisateur
connecté. Elle reprend malgré tout **les jetons du design system** —
mêmes couleurs, mêmes espacements, même typographie. Une vitrine qui
ne ressemble pas au produit qu'elle vend crée une déception à la
première connexion.

### Ses styles sont locaux, et c'est une exception assumée

Ils vivent dans `features/landing/landing.page.scss` (préfixe
`ac-lp-`), pas dans `_components.scss`.

`_components.scss` contient les briques **réutilisées** par les vingt
écrans de l'application : elle est téléchargée par chaque employé, à
chaque connexion. Y mettre une accroche de page d'accueil
l'alourdirait pour un écran qu'il ne verra jamais.

Conséquence : le budget `anyComponentStyle` d'Angular est passé de
4 kB à 8 kB (erreur à 16 kB). Le garde-fou continue de détecter une
croissance anormale ; il n'est plus déclenché par une page dont les
styles sont légitimement uniques.

### L'ordre des sections est l'argumentaire

1. **Le problème**, avant tout le reste — trois phrases qu'un gérant
   a déjà prononcées. Une page qui commence par « notre plateforme
   innovante » ne convainc personne.
2. **Ce que fait le produit**, et uniquement ce qui est livré.
3. **Comment ça se passe**, en trois temps.
4. **Pourquoi ici** — ce qui distingue le produit d'un logiciel
   importé.
5. **Combien ça coûte.**

### Ce qui n'y figure pas, volontairement

- **Aucun chiffre inventé.** Pas de « 200 stations nous font
  confiance » quand il y en a zéro, pas de témoignage fabriqué. Un
  chiffre faux se repère, et il coûte plus en crédibilité qu'il ne
  rapporte en conversion.
- **Aucun tarif inventé.** Fixer un prix est une décision
  commerciale. Tant que `PLANS` est vide dans
  `core/config/marketing.config.ts`, la section affiche une invitation
  à prendre contact ; remplissez le tableau et elle affiche les offres,
  sans autre modification.

---

## Le pointage est dans l'en-tête (lot 12)

Le bouton « Pointer mon arrivée » est dans la barre du haut, présent
sur tous les écrans — pas dans la page `/attendance`.

Un employé ouvre l'application pour pointer, et rien d'autre.
L'obliger à trouver un écran dédié ajoute deux gestes à quelque chose
qui doit en demander un seul ; et un pointage qui demande un effort
finit par être fait « plus tard », c'est-à-dire jamais. Le registre,
lui, est une page : on l'ouvre une fois par mois, le jour de la paie.

Le bouton affiche l'état plutôt qu'une action abstraite :

| État | Libellé |
|---|---|
| Pas encore arrivé | « Pointer mon arrivée » |
| Présent | « Pointer mon départ · depuis 3 h 17 » |

La durée vient du **serveur**, jamais du calcul `maintenant −
heure d'arrivée` fait dans le navigateur : l'horloge d'un téléphone se
règle à la main, celle du serveur non.

Sur mobile, le libellé disparaît et l'icône reste : la barre du haut
n'a la place que d'un geste, et c'est celui-là.

Il n'apparaît que si l'utilisateur a le droit `attendance.clock`. Ce
masquage est un **confort**, pas une protection : le serveur refuse de
toute façon.

---

## L'ordre d'un écran suit le travail à faire

Le registre de pointage est l'exemple le plus net du principe déjà
appliqué au tableau de bord (lot 10) : **ce qui demande une action
passe devant ce qui informe.**

1. **Les pointages jamais fermés** — tant qu'ils traînent, les totaux
   du mois sont faux. Bloc d'alerte, en tête.
2. **Qui est présent maintenant.**
3. **Les totaux** — le chiffre qui sert à payer.
4. **Le détail**, ligne par ligne.

Un écran qui commence par un tableau de trente lignes oblige à
chercher ce qui ne va pas. Un écran qui commence par « deux pointages
à corriger » dit quoi faire en une seconde.

**Les jours avant les heures.** La paie d'une station de lavage se
fait le plus souvent à la journée travaillée : « 14 jours » est le
chiffre qu'on cherche, « 112 h 30 » celui qu'un logiciel européen
mettrait en avant.

---

## Les dates : ISO dans les échanges, français à l'écran

Les dates circulent en `2026-09-04` — le seul format qu'une base de
données et une API lisent sans ambiguïté.

Elles ne s'**affichent** jamais ainsi dans une phrase. « Du 2026-09-01
au 2026-09-04 » est du format technique laissé à la vue de
l'utilisateur ; on écrit « Du 1 septembre au 4 septembre 2026 »,
via `toLocaleDateString('fr-FR', …)`.

L'exception est le tableau : dans une colonne « Jour » qu'on parcourt
du regard, l'ISO s'aligne et se compare mieux qu'un mois écrit en
toutes lettres.

---

## Le carnet de rendez-vous (lot 13)

### Une journée à la fois, pas un calendrier

La tentation était de dessiner une grille hebdomadaire avec des blocs
colorés. C'est joli sur une capture d'écran, et inutilisable sur le
téléphone de quelqu'un qui a une clé de voiture dans l'autre main.

Une station de lavage travaille à la journée : « qui vient
aujourd'hui », « qui vient demain ». Une liste répond à cette question
en une lecture et tient sur un écran de 390 pixels. Deux boutons —
*Aujourd'hui*, *Demain* — couvrent neuf usages sur dix. La semaine
viendra si un gérant la réclame, pas avant.

### L'ordre de l'écran, encore une fois

Le troisième écran construit sur le même principe, après le tableau de
bord (lot 10) et le registre de pointage (lot 12) : **ce qui demande
une action passe devant ce qui informe.**

1. **À traiter** — l'heure est passée, personne n'a rien noté.
2. **La journée** et **la charge**.
3. **Le détail**, heure par heure.
4. **À rappeler** — la liste d'appels du soir.

### La charge : des barres, et pas de maximum

Des barres et non un camembert : l'œil compare mal des angles, bien des
longueurs.

Une seule couleur (`--ac-chart-1`) : toutes ces barres mesurent **la
même chose** à des heures différentes. Les colorer différemment
inventerait une distinction qui n'existe pas — c'est la règle du lot 10,
la couleur suit l'entité, jamais son rang.

**L'échelle part d'un plancher de quatre.** Rapporter chaque barre à
l'heure la plus chargée donne un résultat absurde les jours calmes :
trois heures à un rendez-vous chacune produisent trois barres
*pleines*, et l'écran annonce une saturation là où il n'y a presque
personne. Le premier essai faisait exactement cela.

Et aucune barre n'a de maximum, parce que le logiciel ne connaît pas la
capacité réelle d'une station. Il montre ce qui est déjà promis ; c'est
le gérant qui sait combien de véhicules il peut prendre.

### Un seul bouton porte un libellé

Dans la ligne d'un rendez-vous : **« Le client est là »** en toutes
lettres, et trois icônes pour confirmer, modifier, annuler.

C'est le geste qu'on fait avec quelqu'un debout devant le comptoir : il
doit se lire sans réfléchir. Quatre libellés côte à côte passaient sur
trois lignes, déformaient la hauteur des lignes voisines, et faisaient
perdre de vue le seul qui compte.

Les boutons d'une cellule ne passent jamais à la ligne : c'est le
tableau qui défile horizontalement dans sa carte, comme partout
ailleurs dans le produit.

### Le serveur prévient, l'écran le montre après coup

Les avertissements (`warnings`) s'affichent dans le bandeau vert de
confirmation, **après** l'enregistrement — pas comme une alerte
bloquante avant.

Le rendez-vous est pris ; la personne au comptoir apprend simplement ce
qu'elle vient de faire (« 3 véhicules déjà attendus sur ce créneau »).
Un avertissement qui bloque devient un obstacle qu'on apprend à
cliquer sans lire.

### Les couleurs de statut

Reprises des variantes de badge existantes, sans en créer aucune
(règle §37) :

| Statut | Badge |
|---|---|
| Prévu | `ac-badge--info` |
| Confirmé | `ac-badge--success` |
| Arrivé | `ac-badge--completed` |
| Absent | `ac-badge--danger` |
| Annulé | `ac-badge--cancelled` |

Une ligne soldée recule d'un plan (`ac-table__row--muted`) sans jamais
disparaître : c'est l'historique de la journée.

---

## La fidélité (lot 14)

### La carte se dessine comme le carton qu'elle remplace

Des cases, et des tampons dedans. Un client qui la voit comprend son
solde sans qu'on le lui explique — c'est tout l'intérêt d'une carte à
tampons par rapport à un programme à points.

Une case vide est un **pointillé**, pas un cercle grisé : elle se lit
comme « à remplir », et non comme un élément désactivé.

On n'en dessine jamais plus d'une carte complète. Un client à
23 tampons sur un programme à 10 a deux récompenses en poche et
3 tampons entamés : aligner 23 cases ne dirait rien de plus et
déborderait de l'écran.

### Le prix barré est le point du module

Sur un dossier remisé, le montant s'affiche `10 000` rayé, puis
`5 000`. Un client qui voit les deux comprend en une seconde ce que sa
carte lui a rapporté.

Afficher directement 5 000 F lui donnerait une remise dont il ne
saurait rien — **et une fidélité invisible ne fidélise personne.**

### La récompense se propose là où elle se décide

Le bouton « Utiliser » est sur le **dossier**, à côté du bouton
« Encaisser » — pas sur l'écran `/loyalty`.

Personne n'ira ouvrir un écran séparé pour vérifier une carte pendant
qu'un client attend ses clés. Si la récompense ne se propose pas au
moment où le dossier se règle, elle ne se propose jamais.

L'écran `/loyalty` sert à autre chose : rappeler ceux qui ont gagné
quelque chose, mesurer ce que le programme coûte, régler les règles.

### Un seul grand chiffre pour le coût

C'est le nombre qu'un gérant vient chercher : « ce programme, il me
coûte combien ? ». Le noyer parmi trois compteurs de même taille
l'obligerait à le retrouver à chaque visite.

Il est peint en **couleur de texte**, ni en rouge ni en vert : un coût
de fidélité n'est ni une bonne ni une mauvaise nouvelle en soi. Le
colorer porterait un jugement que le logiciel n'a pas à porter.

### Une classe partagée remonte au troisième usage

`.ac-count-row` était locale au carnet de rendez-vous (lot 13), avec
une note disant qu'elle remonterait au troisième écran. La fidélité et
la fiche client en ont fait les deuxième et troisième : elle est
passée dans `_components.scss`.

La règle appliquée, pas seulement écrite : descendre une classe est
facile, retrouver pourquoi `_components.scss` pèse 40 ko ne l'est pas.

---

## Les abonnements (lot 15)

### Trois chiffres à la même taille, et un seul encadré

VENDU, LIVRÉ, RESTE À LIVRER. Les mettre à la même taille est ce qui
permet de les comparer d'un regard : une station qui vend beaucoup
plus qu'elle ne livre accumule une dette qu'il faudra honorer, avec
des employés à payer ce jour-là.

**Seul le troisième est signalé, et par une bordure, pas par une
couleur de texte.** Une dette de forfaits n'est ni une bonne ni une
mauvaise nouvelle : c'est le signe qu'on a bien vendu, et le rappel
qu'il faudra livrer. La peindre en rouge porterait un jugement que le
logiciel n'a pas à porter ; ne rien faire du tout la ferait passer
pour une recette à venir.

La bordure attire l'œil sans qualifier.

### Le forfait passe avant la récompense

Sur un dossier, quand le client a **et** un forfait utilisable **et**
une récompense de fidélité, c'est le forfait qui est proposé.

Il a déjà été payé : le lui faire régler pendant qu'on lui offre un
cadeau serait absurde, et lui ferait perdre des tampons pour rien.

### Une barre, pas un pourcentage

« 3 sur 10 » se lit déjà juste à côté. La barre sert à repérer d'un
coup d'œil, dans une liste de vingt lignes, les forfaits presque au
bout — pas à répéter un chiffre.

### Le libellé dit d'où vient la remise

Sur un dossier remisé, l'étiquette est « Forfait » ou « Remise » selon
la source, et le bouton de retrait appelle une route différente. Les
deux ramènent le dû à zéro et ne veulent pas dire la même chose ;
l'écran doit le dire aussi.

---

## Les statistiques (lot 16)

Le premier écran entièrement fait de graphiques. Les règles posées au
lot 10 s'y appliquent toutes, et trois s'y ajoutent.

### Jamais deux axes verticaux

Des véhicules et des francs ne partagent aucune échelle. Les tracer
ensemble avec un axe à gauche et un à droite **inventerait une
corrélation que la donnée ne contient pas** : l'alignement des deux
échelles serait arbitraire, et le lecteur y verrait un rapport qui
n'existe pas.

Deux graphiques côte à côte disent la même chose sans mentir. C'est
l'erreur de graphique la plus fréquente, et la plus difficile à
défaire une fois publiée.

### Une seule couleur quand il n'y a qu'une série

Le classement des prestations est une seule mesure — la valeur.
Colorer chaque barre différemment ferait croire à des catégories
indépendantes ; colorer plus foncé quand c'est plus haut répéterait ce
que la longueur dit déjà, et **gaspillerait le seul canal encore
libre**.

Les quatre couleurs de la palette ne servent qu'à la barre de
décomposition, où elles portent quatre notions réellement
différentes — et chaque part garde son emplacement quelle que soit sa
taille (règle du lot 10 : la couleur suit l'entité, jamais son rang).

### L'haltère : la forme d'un « avant → après »

Pour comparer le temps annoncé et le temps mesuré, deux barres
groupées obligeraient l'œil à comparer deux longueurs partant du même
bord. L'haltère montre **l'écart directement**, comme un segment qu'on
mesure du regard — et c'est l'écart qui est la question.

Une seule teinte, deux intensités : ce ne sont pas deux catégories,
c'est la même grandeur à deux moments. Et **aucune couleur d'alerte** :
un dépassement peut vouloir dire que l'équipe soigne son travail comme
que le catalogue est trop optimiste. Le graphique montre l'écart, il
ne le juge pas.

### Le nombre est parfois le graphique

« 0 % des clients étaient déjà venus » n'a pas besoin d'un camembert à
deux parts. Trois panneaux de cet écran sont de simples grands
chiffres suivis de leur phrase — c'est la forme juste quand la donnée
est **une** valeur.

### Un composant réutilisé ment sans prévenir

Le graphique en colonnes est né au lot 10 pour la recette, et son
formatage monétaire était écrit en dur. Le jour où cet écran s'en est
servi pour compter des véhicules, il a affiché *« meilleure journée :
4 à 5 FCFA »* pour cinq voitures.

Ce n'est pas la réutilisation qui était fautive : c'est **l'hypothèse
cachée** qu'elle a révélée. Le composant prend désormais son unité en
paramètre, et le libellé de son extremum aussi — « meilleure journée »
n'a pas de sens sur un axe des heures.

---

## Le multi-stations (lot 17)

### Le choix se fait une fois, en haut, et vaut partout

Avant ce lot, chaque écran qui savait filtrer par station portait son
propre menu déroulant : un dans les statistiques, un dans les
rendez-vous, et **rien du tout** dans la file d'attente ou le tableau
de bord. Un gérant de deux stations répétait donc le même choix sur
chaque page, et devait se souvenir de ce qu'il regardait.

Le choix vit désormais dans l'en-tête, à l'endroit qui affichait déjà
le nom de la station. Il est mémorisé, et il vaut pour le tableau de
bord, la file, le carnet et les statistiques à la fois.

### Un filtre de consultation n'est pas un choix de saisie

C'est la distinction qui décide de tout, et elle mérite d'être écrite
parce que les deux se ressemblent à l'écran : ce sont deux menus
déroulants avec les mêmes noms dedans.

| | Question | Où il vit |
|---|---|---|
| **Filtrer** | « montre-moi les rendez-vous de Thiès » | L'en-tête, une fois pour toutes |
| **Saisir** | « ce véhicule est accueilli à Thiès » | Le formulaire concerné, à côté du client et de la prestation |

Les confondre produirait la pire catégorie de bug : un dossier
enregistré sur la mauvaise station parce que quelqu'un avait changé un
menu en haut de l'écran une heure plus tôt.

Conséquence visible : les formulaires de **prise de rendez-vous** et de
**vente de forfait** gardent leur champ « Station ». Il est
pré-rempli sur celle qu'on regarde — un pré-remplissage, pas une
contrainte — et il ne propose que les stations **ouvertes**.

### Un sélecteur ne s'affiche que s'il y a un choix

Sur une entreprise à station unique — la majorité — l'en-tête affiche
le nom, comme avant, sans menu. Offrir un choix qui n'en est pas un
ajoute un clic pour rien.

Une station **fermée** disparaît du menu, sauf si c'est celle qu'on
regarde déjà : un sélecteur qui affiche une valeur absente de sa
propre liste est un bug visible.

### Un refus se voit venir

Sur l'écran des stations, la colonne « sur place » annonce combien de
véhicules ont un dossier ouvert, et le bouton de fermeture se
désactive de lui-même quand il y en a — ou quand c'est la dernière
station ouverte. Le titre du bouton dit laquelle des deux raisons
s'applique.

**Un bouton grisé sans explication est une impasse** : l'utilisateur
conclut à une panne et cherche ailleurs. Un refus qu'on voit venir,
lui, ne ressemble pas à un défaut.

### Afficher ce qu'on ne peut pas changer, avec sa raison

Les réglages régionaux — devise, pays, fuseau, identifiant — sont
affichés en **lignes de texte**, pas en champs désactivés. Un `input`
grisé invite à cliquer puis ne réagit pas ; une ligne de texte dit la
même chose sans rien promettre.

Chacune porte sa raison à côté de sa valeur. « Pourquoi ne puis-je pas
changer ma devise ? » a une réponse, et elle est écrite là où la
question se pose.

### Ce qu'un ajout dans l'en-tête a coûté

Ajouter le sélecteur a fait **déborder la barre sur téléphone** :
l'avatar sortait de l'écran à 390 pixels. Il a fallu arbitrer, et
l'arbitrage a désigné le champ de **recherche**, masqué sur mobile.

Il est désactivé depuis le lot 2 et l'est toujours. Un champ mort qui
pousse un bouton vivant hors de l'écran est le pire des deux mondes.
Il reviendra le jour où il cherchera vraiment quelque chose — et il
faudra alors lui trouver sa place, probablement en plein écran comme
le font les applications mobiles.

### Un détail de CSS qui efface une intention

La ligne du choix courant, dans le menu, ne s'affichait pas : sa règle
`--active` avait été écrite **avant** `.ac-topbar__menu-item`, qui
pose `background: none`. À spécificité égale, c'est la dernière règle
qui gagne — le fond était donc silencieusement effacé, et le menu
s'ouvrait sans jamais montrer où l'on se trouvait.

Aucune erreur, aucun avertissement : seulement une intention qui ne
s'applique pas. C'est ce que la capture d'écran de fin de lot sert à
attraper, et que la compilation ne verra jamais.

---

## L'aide et les écrans d'erreur (lot 18)

### L'aide est organisée par refus, pas par menu

Une aide classique décrit les écrans : « la page Rendez-vous vous
permet de… ». Personne ne la lit, parce que personne n'ouvre l'aide
pour apprendre à quoi sert un écran qu'il a sous les yeux.

**On ouvre l'aide quand le logiciel a dit non.** « Pourquoi je ne peux
pas rendre ce véhicule ? » — et à ce moment-là, une table des matières
par module ne sert à rien.

Chaque entrée est donc formulée comme la question qu'on se pose devant
le refus, et répond dans cet ordre :

1. ce que le logiciel refuse,
2. **pourquoi** — la raison métier, jamais « c'est comme ça »,
3. **quoi faire** maintenant.

### Tout est déplié

Le réflexe serait un accordéon : vingt-huit questions repliées, une
seule ouverte à la fois. C'est joli, et il faut cliquer vingt-huit
fois pour savoir si la réponse cherchée est là.

Tout est visible d'emblée, et la recherche filtre. Le navigateur peut
chercher dans la page, et l'impression donne le manuel complet.

### L'aide ne recopie aucun seuil

C'est la règle qui la garde honnête. Les vraies règles vivent dans le
serveur — c'est lui qui refuse — et le fichier de contenu en est
forcément une **seconde copie**, écrite en français. Une seconde copie
finit toujours par diverger.

On limite les dégâts en n'écrivant que ce qui ne bouge pas : le sens
de la règle, jamais sa valeur. *« On ne déclare pas une absence avant
l'heure du rendez-vous »* restera vrai si le délai de grâce passe de
quinze à trente minutes ; *« quinze minutes après l'heure »* serait
faux le jour du changement, et personne ne penserait à venir le
corriger.

Un test vérifie qu'aucune réponse ne contient de durée chiffrée.

### Les ancres sont publiques

`/help#restitution-impayee` mène directement à la bonne réponse, et
celle-ci est surlignée. C'est ce qui permet à un écran d'erreur d'y
renvoyer plutôt que de déposer le lecteur en haut d'une longue page.
Les identifiants ne se renomment donc pas à la légère.

---

### Un écran d'erreur dit trois choses, dans cet ordre

1. **Ce qui s'est passé**, en français et sans jargon.
2. **Pourquoi**, quand on le sait. *« Erreur 403 »* n'apprend rien à
   personne ; *« cet écran demande des droits que votre compte n'a
   pas »* se comprend et se résout.
3. **Une sortie.** Un écran d'erreur sans lien est un cul-de-sac :
   l'utilisateur ferme l'onglet, et c'est la dernière fois qu'il ouvre
   le produit ce jour-là.

Le code HTTP est affiché **en petit, sous le message**. Il ne sert pas
à l'utilisateur : il sert à la personne qu'il appellera. En gros
chiffre au milieu de l'écran, il donnerait au code plus d'importance
qu'à l'explication.

**Ni illustration, ni humour.** Pas de robot cassé, pas de « oups ! ».
Quelqu'un qui tombe là a un client devant lui et une voiture à rendre.

La pastille de l'icône est **neutre, pas rouge** : une page inconnue
ou un écran réservé n'est pas une panne, et une couleur d'alarme
ferait croire à un incident.

### Une redirection muette est une réponse fausse

Jusqu'au lot 18, `path: '**'` renvoyait toute adresse inconnue vers
l'accueil, sans un mot. Quelqu'un qui suivait un lien contenant une
faute de frappe atterrissait sur le tableau de bord et en concluait
que le dossier qu'il cherchait avait disparu.

Rediriger en silence, c'est affirmer « voilà ce que vous cherchiez »
quand la vérité est « cette adresse n'existe pas ».

### Un écran vide ne dit pas « vous n'avez pas le droit »

La barre latérale masque depuis le lot 4 les modules qu'un rôle ne
peut pas ouvrir. Mais taper `/cash` dans la barre d'adresse affichait
l'écran quand même — vide, puisque le serveur refusait ses requêtes.
Le commentaire du composant de navigation le disait déjà : *« l'écran
resterait vide »*.

Un écran vide se lit « c'est cassé », ou « il n'y a rien
aujourd'hui ». Deux conclusions fausses, et l'une se termine par un
appel au support. Un garde de route mène désormais vers un écran qui
**nomme le rôle** plutôt que la permission manquante : *« il vous
manque `payments.journal` »* ne veut rien dire pour quelqu'un qui
tient un comptoir.

### La panne serveur est un bandeau, pas une page

C'est la décision la plus discutée du lot, et elle va contre
l'attente : le cahier des charges annonçait une **page** d'erreur.

Une page **détruit l'écran en cours**. Quelqu'un en train de saisir
une inspection, un client devant lui, perdrait sa saisie parce qu'un
rafraîchissement automatique de la file d'attente a échoué en
arrière-plan. Sur le terrain visé, une coupure de trente secondes est
ordinaire : le remède serait pire que le mal.

Le bandeau s'affiche **sous l'en-tête, au-dessus du contenu** — il
pousse la page vers le bas plutôt que de flotter dessus, un bandeau
flottant cacherait la première ligne d'un tableau, c'est-à-dire
souvent la plus urgente. Teinte d'avertissement et non de danger : la
donnée n'est pas perdue, elle attend.

Il dit aussi ce qui est vrai **et** ce qui ne l'est pas : *« ce qui est
affiché reste à l'écran, mais rien n'est enregistré »*. Laisser croire
l'un ou l'autre serait pire que le silence.

### « Votre session a expiré » n'est pas la même chose qu'une déconnexion

Quand le renouvellement de session échouait, la session était effacée
mais l'utilisateur restait sur son écran, à cliquer sur des boutons
qui répondaient 401 en silence — le garde de route ne s'exécute qu'à
la navigation suivante, et rien ne l'y poussait.

Il est maintenant conduit à l'écran de connexion, avec une phrase qui
explique pourquoi et la promesse de le ramener où il était. Sans elle,
l'écran est identique à celui d'une déconnexion volontaire, et la
conclusion est *« le logiciel m'a jeté dehors sans raison »*.

---

## Typographie française : l'espace avant `? ! : ;`

En français, ces signes sont précédés d'une espace — contrairement à
l'anglais. Mais une espace **ordinaire** autorise le navigateur à
couper la ligne juste avant le signe : on se retrouve avec un « ? »
seul en début de ligne suivante.

C'est arrivé sur la première version de la page d'accueil.

**Règle :** écrire une espace **insécable** devant ces signes, et à
l'intérieur des guillemets `« … »`.

| Contexte | Comment |
|---|---|
| Dans un fichier `.ts` | `'Depuis quand\u00a0?'` |
| Dans un gabarit HTML | `Parlons-en&nbsp;: la suite` |
