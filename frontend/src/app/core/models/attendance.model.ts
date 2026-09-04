/**
 * Le pointage
 * ------------------------------------------------------------------
 * UN REGISTRE, PAS UNE CAMÉRA. Ni géolocalisation, ni photo, ni
 * pointage automatique : quelqu'un déclare son arrivée, un
 * responsable peut corriger, et la correction se voit.
 */

export interface TimeEntry {
  id: number;
  user_id: number;
  user_name: string | null;
  station_id: number;
  station_name: string | null;

  clock_in_at: string | null;
  clock_out_at: string | null;
  is_open: boolean;

  /** Figée à la fermeture, jamais recalculée. */
  duration_minutes: number | null;

  /** Pour un pointage encore ouvert, calculé par le serveur. */
  minutes_present: number | null;
  /** Depuis combien d'heures un pointage oublié reste ouvert. */
  hours_open: number | null;

  /**
   * Une correction ne se cache pas : sans cela, un employé payé sur
   * des heures qu'il n'a pas reconnues n'aurait aucun moyen de s'en
   * apercevoir.
   */
  is_corrected: boolean;
  corrected_by_name: string | null;
  corrected_at: string | null;
  correction_reason: string | null;

  notes: string | null;
}

/** Mon propre pointage — ce que voit un employé. */
export interface MyAttendance {
  is_clocked_in: boolean;
  current: TimeEntry | null;
  recent: TimeEntry[];
}

export interface AttendanceTotal {
  user_id: number;
  user_name: string;
  /** Jours travaillés : ce qui sert à payer dans une station. */
  days: number;
  minutes: number;
  entries: number;
}

/** Le registre de l'équipe — réservé aux responsables. */
export interface AttendanceRegister {
  entries: TimeEntry[];
  totals: AttendanceTotal[];
  /** Les pointages oubliés : l'anomalie à traiter en premier. */
  stale: TimeEntry[];
  present: TimeEntry[];
  period: { from: string | null; to: string | null };
}

export interface CorrectionPayload {
  clock_in_at: string;
  clock_out_at?: string | null;
  reason: string;
}
