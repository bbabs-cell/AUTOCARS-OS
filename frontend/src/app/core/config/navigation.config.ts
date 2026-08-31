/**
 * Navigation principale
 * ------------------------------------------------------------------
 * La liste des modules du produit, dans l'ordre où ils apparaissent
 * dans la barre latérale.
 *
 * POURQUOI UN FICHIER DE CONFIGURATION PLUTÔT QUE DU HTML ?
 * Parce que la navigation va grandir lot après lot. Une liste de
 * données se modifie sans toucher au gabarit, et surtout elle
 * pourra être filtrée selon les permissions au Lot 4 : un employé ne
 * doit pas voir « Paiements ».
 *
 * POURQUOI DES GROUPES ?
 * Treize entrées à la suite forment un mur illisible. Les regrouper
 * par domaine (opérations, gestion, finances, pilotage) permet à
 * l'œil de viser une zone plutôt que de lire toute la liste. C'est
 * un écart assumé par rapport au cahier des charges, qui listait les
 * entrées à plat.
 *
 * Le champ `lot` indique quand le module sera développé. Les entrées
 * non encore disponibles restent visibles mais désactivées : cela
 * montre honnêtement la portée du produit sans mener vers une page
 * vide.
 */

export interface NavigationItem {
  /** Libellé affiché. */
  readonly label: string;

  /** Nom de l'icône Bootstrap Icons, sans le préfixe `bi-`. */
  readonly icon: string;

  /** Route Angular. `null` tant que le module n'existe pas. */
  readonly route: string | null;

  /** Numéro du lot où ce module sera développé. */
  readonly lot: number;
}

export interface NavigationGroup {
  /** Intitulé du groupe. Vide pour les entrées sans en-tête. */
  readonly label: string;
  readonly items: readonly NavigationItem[];
}

export const NAVIGATION: readonly NavigationGroup[] = [
  {
    label: '',
    items: [
      { label: 'Tableau de bord', icon: 'grid-1x2', route: null, lot: 10 },
    ],
  },
  {
    label: 'Opérations',
    items: [
      { label: "File d'attente", icon: 'kanban',        route: null, lot: 8 },
      { label: 'Véhicules',      icon: 'car-front',     route: null, lot: 6 },
      { label: 'Réservations',   icon: 'calendar-week', route: null, lot: 13 },
      { label: 'Sécurité',       icon: 'shield-check',  route: null, lot: 7 },
    ],
  },
  {
    label: 'Gestion',
    items: [
      { label: 'Clients',     icon: 'people',        route: null, lot: 6 },
      { label: 'Employés',    icon: 'person-badge',  route: null, lot: 12 },
      { label: 'Prestations', icon: 'droplet',       route: null, lot: 5 },
    ],
  },
  {
    label: 'Finances',
    items: [
      { label: 'Paiements',   icon: 'credit-card', route: null, lot: 9 },
      { label: 'Caisse',      icon: 'cash-stack',  route: null, lot: 9 },
      { label: 'Fidélité',    icon: 'award',       route: null, lot: 14 },
      { label: 'Abonnements', icon: 'arrow-repeat', route: null, lot: 15 },
    ],
  },
  {
    label: 'Pilotage',
    items: [
      { label: 'Analytics', icon: 'graph-up', route: null, lot: 16 },
      { label: 'Stations',  icon: 'geo-alt',  route: null, lot: 17 },
    ],
  },
];

/**
 * Entrées du bas de la barre latérale, toujours séparées du reste.
 * Ce sont des outils, pas des modules métier.
 */
export const NAVIGATION_FOOTER: readonly NavigationItem[] = [
  { label: 'Paramètres', icon: 'gear',            route: null, lot: 17 },
  { label: 'Aide',       icon: 'question-circle', route: null, lot: 18 },
];

/**
 * Entrées disponibles dès maintenant. Elles sont listées à part pour
 * que la barre latérale distingue clairement ce qui est cliquable de
 * ce qui ne l'est pas encore.
 */
export const NAVIGATION_AVAILABLE: readonly NavigationItem[] = [
  { label: 'Design system', icon: 'palette',      route: '/styleguide', lot: 2 },
  { label: 'Diagnostic',    icon: 'activity',     route: '/health',     lot: 1 },
];
