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
