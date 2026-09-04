/**
 * Modèles des rendez-vous
 * ------------------------------------------------------------------
 * Reflètent exactement ce que renvoie `BookingController::present()`.
 * Si le backend change de format, la compilation échoue au lieu de
 * produire un écran silencieusement faux.
 */

export type BookingStatus =
  | 'SCHEDULED'
  | 'CONFIRMED'
  | 'ARRIVED'
  | 'NO_SHOW'
  | 'CANCELLED';

export interface Booking {
  id: number;

  station_id: number;
  station_name: string | null;
  service_id: number;
  service_name: string | null;

  /**
   * Le client peut ne pas avoir de fiche : au téléphone, on note un
   * nom et un numéro. `customer_id` et `vehicle_id` restent alors
   * `null` jusqu'à l'arrivée.
   */
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  vehicle_id: number | null;
  /** Déjà formatée par le serveur : « DK-1234-AA ». */
  plate_number: string | null;
  vehicle_label: string | null;

  /** « 2026-09-10 10:00:00 » — la valeur de la base. */
  scheduled_at: string;
  /** Les deux morceaux, découpés côté serveur. */
  scheduled_date: string;
  scheduled_time: string;
  duration_minutes: number;
  /** En FCFA, entier. FIGÉ à la prise du rendez-vous. */
  price: number;

  status: BookingStatus;
  status_label: string;
  is_open: boolean;
  /**
   * Les suites proposables en un clic. « ARRIVED » n'y figure jamais :
   * l'arrivée ouvre un dossier et a son propre bouton.
   */
  allowed_next: BookingStatus[];

  operation_id: number | null;
  operation_reference: string | null;

  outcome_at: string | null;
  outcome_by_name: string | null;
  outcome_reason: string | null;

  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

/** Ce qu'on envoie pour noter un rendez-vous. */
export interface BookingPayload {
  customer_name: string;
  customer_phone: string;
  service_id: number;
  station_id: number;
  /** « 2026-09-10T10:00 », la valeur d'un champ `datetime-local`. */
  scheduled_at: string;
  vehicle_id?: number | null;
  plate_number?: string | null;
  notes?: string | null;
}

/** La charge d'une heure de la journée. */
export interface BookingLoad {
  hour: number;
  bookings: number;
  minutes: number;
}

/** Tout ce qu'affiche l'écran d'une journée, en une seule réponse. */
export interface BookingDay {
  bookings: Booking[];
  counts: Record<BookingStatus, number>;
  /**
   * Les rendez-vous dépassés et jamais soldés. Ils IGNORENT les bornes
   * de dates : un rendez-vous d'avant-hier reste à traiter même quand
   * on regarde la journée de demain.
   */
  overdue: Booking[];
  load: BookingLoad[];
  period: { from: string; to: string };
}

/**
 * La réponse à une création ou une modification.
 *
 * `warnings` est la particularité de ce module : le serveur ACCEPTE et
 * PRÉVIENT, au lieu de refuser. Voir la note dans `BookingController`.
 */
export interface BookingSaved {
  booking: Booking;
  warnings: string[];
}
