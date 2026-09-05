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
    ],
  },
  {
    label: 'Pilotage',
    items: [
    ],
  },
];

/**
 * Entrées du bas de la barre latérale, toujours séparées du reste.
 * Ce sont des outils, pas des modules métier.
 */
export const NAVIGATION_FOOTER: readonly NavigationItem[] = [];

/**
 * Entrées disponibles dès maintenant. Elles sont listées à part pour
 * que la barre latérale distingue clairement ce qui est cliquable de
 * ce qui ne l'est pas encore.
 */
export const NAVIGATION_AVAILABLE: readonly NavigationItem[] = [
  { label: 'Tableau de bord', icon: 'grid-1x2',  route: '/dashboard',  lot: 10 },
  // Juste après le tableau de bord, et pas ailleurs : les deux
  // parlent de chiffres, mais l'un dit « qu'est-ce qui demande une
  // action aujourd'hui » et l'autre « comment se porte l'affaire ».
  // Les voisiner rend la différence lisible dans le menu lui-même.
  { label: 'Statistiques',  icon: 'graph-up',  route: '/analytics',  lot: 16,
    permission: 'reports.view' },
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
  // Juste après la fidélité : les deux parlent d'un client qui
  // revient. L'une le récompense, l'autre le fait payer d'avance.
  { label: 'Abonnements',   icon: 'arrow-repeat', route: '/subscriptions', lot: 15,
    permission: 'subscriptions.view' },
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
  // Les stations sont juste après le catalogue : les deux décrivent
  // ce que l'entreprise EST, pas ce qu'elle fait aujourd'hui. Un
  // manager les voit — il change de site à longueur de journée ; un
  // employé n'a pas `stations.view` et n'a donc pas cette entrée.
  { label: 'Stations',      icon: 'geo-alt',  route: '/stations',   lot: 17,
    permission: 'stations.view' },
  // Les paramètres restent en bas, avec l'aide : ce sont des outils,
  // pas des modules métier. Réservés au propriétaire.
  { label: 'Paramètres',    icon: 'gear',     route: '/settings',   lot: 17,
    permission: 'organization.view' },
  // L'aide est ouverte à TOUS les rôles, sans permission : c'est
  // l'employé au comptoir qui rencontre le plus de refus, et lui
  // cacher les explications serait exactement à l'envers.
  { label: 'Aide',          icon: 'question-circle', route: '/help', lot: 18 },
  { label: 'Design system', icon: 'palette',  route: '/styleguide', lot: 2 },
  { label: 'Diagnostic',    icon: 'activity', route: '/health',     lot: 1 },
];
