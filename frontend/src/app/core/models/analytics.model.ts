/**
 * Modèles des statistiques
 * ------------------------------------------------------------------
 * Le lot 16 n'ajoute aucune table : ces types décrivent des LECTURES
 * de ce que quinze lots ont accumulé.
 */

/** Une journée d'activité. */
export interface AnalyticsDay {
  /** ISO. Les jours vides sont présents, à zéro. */
  day: string;
  vehicles: number;
  /** Encaissé ce jour-là, en FCFA. */
  revenue: number;
}

/**
 * LA VALEUR DE CE QUI A ÉTÉ LIVRÉ, ET COMMENT ELLE A ÉTÉ COUVERTE.
 *
 *     delivered = paid + gifted + prepaid + unpaid
 *
 * Les quatre termes viennent de quatre modules différents. Si
 * l'égalité ne tombe pas juste, `reconciles` vaut `false` et l'écran
 * le dit au lieu de le cacher.
 */
export interface AnalyticsDelivered {
  operations: number;
  delivered: number;
  /** Réellement encaissé sur ces dossiers. */
  paid: number;
  /** Offert par la fidélité — un coût pour la station. */
  gifted: number;
  /** Couvert par un forfait — payé d'avance, pas offert. */
  prepaid: number;
  /** Le reste : ce qui n'a jamais été réglé. Peut être négatif. */
  unpaid: number;
  reconciles: boolean;
}

/**
 * L'ARGENT RÉELLEMENT REÇU sur la période.
 *
 * Ce n'est PAS `delivered` : il comprend les forfaits vendus, dont
 * les lavages seront livrés plus tard, et ignore les lavages offerts.
 */
export interface AnalyticsCollected {
  total: number;
  on_operations: number;
  on_subscriptions: number;
}

export interface AnalyticsService {
  service: string;
  operations: number;
  value: number;
  average: number;
}

export interface AnalyticsHour {
  hour: number;
  operations: number;
}

export interface AnalyticsWeekday {
  /** 1 = lundi. MySQL compte à partir du dimanche ; le serveur convertit. */
  weekday: number;
  label: string;
  operations: number;
}

/** Le temps annoncé au catalogue contre le temps réellement mesuré. */
export interface AnalyticsDuration {
  service: string;
  announced: number;
  actual: number;
  /** Une moyenne n'apparaît qu'au-delà de trois mesures. */
  samples: number;
  /** Dossiers écartés parce qu'ouverts plus de huit heures. */
  excluded: number;
}

export interface AnalyticsCustomers {
  total: number;
  /** Déjà venus AVANT le début de la période. */
  returning: number;
  new: number;
}

export interface Analytics {
  period: { from: string; to: string; days: number };
  daily: AnalyticsDay[];
  delivered: AnalyticsDelivered;
  collected: AnalyticsCollected;
  services: AnalyticsService[];
  hours: AnalyticsHour[];
  weekdays: AnalyticsWeekday[];
  durations: AnalyticsDuration[];
  customers: AnalyticsCustomers;
}
