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

  /**
   * Droit nécessaire pour voir cette entrée.
   *
   * ATTENTION : CE N'EST PAS UNE PROTECTION. Cacher un lien évite
   * seulement de proposer une porte fermée — l'API refuse de toute
   * façon, et c'est elle qui protège. On le fait pour ne pas donner
   * à un employé une entrée de menu qui lui répondrait « accès
   * refusé » : un logiciel qui propose ce qu'il interdit donne
   * l'impression d'être cassé.
   *
   * Absent = visible par tous.
   */
  readonly permission?: string;
}

export interface NavigationGroup {
  /** Intitulé du groupe. Vide pour les entrées sans en-tête. */
  readonly label: string;
  readonly items: readonly NavigationItem[];
}

export const NAVIGATION: readonly NavigationGroup[] = [
  {
    label: 'Opérations',
    items: [
    ],
  },
  {
    label: 'Finances',
    items: [
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
  { label: 'Tableau de bord', icon: 'grid-1x2',  route: '/dashboard',  lot: 10 },
  { label: "File d'attente", icon: 'kanban',      route: '/queue',      lot: 8 },
  // Juste après la file : les deux écrans répondent à la même
  // question — « qu'est-ce qui arrive ? » — l'un pour maintenant,
  // l'autre pour tout à l'heure.
  { label: 'Rendez-vous',   icon: 'calendar-week', route: '/bookings', lot: 13,
    permission: 'bookings.view' },
  // Après les clients, pas après les rendez-vous : la fidélité parle
  // de personnes qui reviennent, pas de l'organisation d'une journée.
  { label: 'Fidélité',      icon: 'award',      route: '/loyalty',  lot: 14,
    permission: 'loyalty.view' },
  { label: 'Encaissements', icon: 'credit-card', route: '/payments',   lot: 9,
    permission: 'payments.journal' },
  { label: 'Caisse',        icon: 'cash-stack',  route: '/cash',       lot: 9,
    permission: 'cash.view' },
  { label: 'Accueil',       icon: 'shield-check', route: '/operations', lot: 7 },
  { label: 'Équipe',        icon: 'person-badge', route: '/team',       lot: 12,
    permission: 'employees.view' },
  { label: 'Pointage',      icon: 'clock',        route: '/attendance', lot: 12,
    permission: 'attendance.view' },
  { label: 'Véhicules',     icon: 'car-front', route: '/vehicles',  lot: 6 },
  { label: 'Clients',       icon: 'people',    route: '/customers', lot: 6 },
  { label: 'Prestations',   icon: 'droplet',  route: '/services',   lot: 5 },
  { label: 'Design system', icon: 'palette',  route: '/styleguide', lot: 2 },
  { label: 'Diagnostic',    icon: 'activity', route: '/health',     lot: 1 },
];
