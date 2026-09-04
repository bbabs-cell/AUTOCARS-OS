/**
 * Le contenu de la page d'accueil publique
 * ==================================================================
 * TOUT LE TEXTE DE LA VITRINE EST ICI, ET NULLE PART AILLEURS.
 *
 * POURQUOI UN FICHIER DE CONFIGURATION PLUTÔT QUE DU HTML ?
 * Parce que c'est le texte qui bougera le plus souvent, et que c'est
 * la personne qui vend le produit qui le corrigera — pas celle qui
 * écrit le code. Chercher une phrase au milieu de balises pour la
 * reformuler est le meilleur moyen de casser une mise en page en
 * voulant changer un mot.
 *
 * Le gabarit met en forme, ce fichier dit quoi.
 *
 * ------------------------------------------------------------------
 * TYPOGRAPHIE FRANÇAISE : L'ESPACE AVANT « ? ! : ; »
 *
 * En français, ces signes sont précédés d'une espace — contrairement
 * à l'anglais. Mais une espace ORDINAIRE autorise le navigateur à
 * couper la ligne juste avant le signe, et l'on se retrouve avec un
 * « ? » seul en début de ligne suivante. C'est arrivé sur la première
 * version de cette page.
 *
 * On écrit donc une espace INSÉCABLE (\u00a0) devant chacun de ces
 * signes, ainsi qu'à l'intérieur des guillemets « … ». Elle est
 * invisible dans le rendu, et le signe reste collé à son mot.
 */

export interface Argument {
  /** Nom d'icône Bootstrap Icons, sans le préfixe `bi-`. */
  readonly icon: string;
  readonly title: string;
  readonly text: string;
}

export interface Step {
  readonly number: string;
  readonly title: string;
  readonly text: string;
}

// ==================================================================
// LE PROBLÈME — AVANT DE PARLER DE LA SOLUTION
// ==================================================================
// Une page qui commence par « notre plateforme innovante » ne
// convainc personne. Celle-ci commence par trois phrases qu'un
// gérant de station a déjà prononcées lui-même : il se reconnaît
// avant qu'on lui vende quoi que ce soit.
//
// Ce sont des situations concrètes, pas des « défis du secteur ».

export const PROBLEMS: readonly Argument[] = [
  {
    icon: 'exclamation-diamond',
    title: '«\u00a0Cette rayure y était avant\u00a0?\u00a0»',
    text: `Le client dit non, votre laveur dit oui, et personne ne peut
      prouver quoi que ce soit. Vous payez, ou vous perdez le client.`,
  },
  {
    icon: 'question-circle',
    title: '«\u00a0Où en est ma voiture\u00a0?\u00a0»',
    text: `Il faut sortir voir. Pendant ce temps, le téléphone sonne et
      trois autres clients attendent au comptoir.`,
  },
  {
    icon: 'cash-stack',
    title: 'La caisse ne tombe pas juste',
    text: `Il manque quelques milliers de francs. Depuis quand\u00a0? Sur
      quelle journée\u00a0? Le cahier ne le dira pas.`,
  },
];

// ==================================================================
// CE QUE FAIT LE PRODUIT
// ==================================================================
// Chaque entrée correspond à un module RÉELLEMENT LIVRÉ. Aucune
// promesse sur ce qui n'existe pas encore : un client qui découvre à
// l'usage qu'une fonctionnalité annoncée n'est pas là ne revient pas.

export const FEATURES: readonly Argument[] = [
  {
    icon: 'camera',
    title: 'Inspection photo à l\'arrivée',
    text: `Quatre faces, l'intérieur, les dommages constatés, le nom du
      client qui valide. Les photos ne s'effacent jamais.`,
  },
  {
    icon: 'kanban',
    title: 'File d\'attente en temps réel',
    text: `Chaque véhicule à son étape, avec le temps qu'il y passe.
      Un lavage qui traîne se voit avant que le client ne s'en plaigne.`,
  },
  {
    icon: 'key',
    title: 'Restitution vérifiée',
    text: `Référence, plaque et règlement contrôlés avant de rendre les
      clés. Deux Toyota blanches le même matin, ça arrive.`,
  },
  {
    icon: 'credit-card',
    title: 'Encaissements et caisse',
    text: `Espèces, Wave, Orange Money, carte. Fond de caisse le matin,
      écart constaté le soir — et gardé en mémoire.`,
  },
  {
    icon: 'clock-history',
    title: 'Historique par véhicule',
    text: `Tout ce qu'on a fait sur cette voiture, quand, et par qui.
      La réponse à un litige tient en dix secondes.`,
  },
  {
    icon: 'grid-1x2',
    title: 'Tableau de bord',
    text: `Ce qui demande une action en premier, les chiffres du jour
      ensuite. Pas l'inverse.`,
  },
];

// ==================================================================
// LE PARCOURS, EN TROIS TEMPS
// ==================================================================

export const STEPS: readonly Step[] = [
  {
    number: '1',
    title: 'Le véhicule arrive',
    text: `Vous notez la plaque, choisissez la prestation et prenez les
      photos. Deux minutes au comptoir, et l'état d'arrivée est acté.`,
  },
  {
    number: '2',
    title: 'Le travail avance',
    text: `Chaque étape se marque d'un geste. L'équipe voit la même file
      que vous, depuis n'importe quel téléphone.`,
  },
  {
    number: '3',
    title: 'Le client repart',
    text: `Le logiciel vérifie la référence, la plaque et le paiement
      avant la remise des clés. Ce qui est rendu est réglé.`,
  },
];

// ==================================================================
// CONÇU POUR ICI
// ==================================================================
// C'est ce qui distingue le produit d'un logiciel importé : il est
// pensé pour des stations sénégalaises, pas adapté après coup.

export const LOCAL_FIT: readonly string[] = [
  'Montants en francs CFA, sans centimes',
  'Espèces et mobile money traités comme des moyens normaux',
  'Plaques de toute la sous-région acceptées, pas seulement sénégalaises',
  'Photos réduites avant envoi\u00a0: quelques secondes, pas plusieurs minutes',
  'Interface en français, pensée pour un téléphone',
];

// ==================================================================
// LES TARIFS
// ==================================================================
// ⚠️ AUCUN PRIX N'EST INVENTÉ ICI.
//
// Fixer un tarif est une décision commerciale : elle dépend de ce que
// coûte l'hébergement, de ce que les stations acceptent de payer, et
// de la stratégie de lancement. Personne ne peut la prendre à la
// place du propriétaire du produit — et un prix affiché « pour
// l'exemple » finit toujours par être vu par un vrai client.
//
// TANT QUE CE TABLEAU EST VIDE, la section affiche une invitation à
// prendre contact. Remplissez-le et elle affiche vos offres, sans
// autre modification.

export interface Plan {
  readonly name: string;
  /** En francs CFA, par mois. Entier. */
  readonly price: number;
  readonly period: string;
  readonly description: string;
  readonly features: readonly string[];
  /** Une seule offre peut être mise en avant. */
  readonly highlighted?: boolean;
}

export const PLANS: readonly Plan[] = [];

/** Où l'on vous joint tant que les tarifs ne sont pas publiés. */
export const CONTACT = {
  email: 'contact@autocare-os.sn',
  phone: '+221 33 800 00 00',
} as const;
