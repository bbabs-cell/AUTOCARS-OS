/**
 * Modèles du catalogue et de la station
 * ------------------------------------------------------------------
 * Reflètent exactement ce que renvoie l'API (voir les méthodes
 * `present()` des contrôleurs PHP). Si le backend change de format,
 * la compilation échoue au lieu de produire un bug silencieux.
 */

export interface Station {
  id: number;
  name: string;
  /** Code court affiché sur les références de dossier (« DKP »). */
  code: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  /** Format HH:MM, ou null si non renseigné. */
  opens_at: string | null;
  closes_at: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface Service {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  /** En FCFA, toujours un entier — jamais un nombre à virgule. */
  price: number;
  duration_minutes: number;
  status: 'ACTIVE' | 'INACTIVE';
}

/** Ce qu'on envoie pour créer ou modifier une prestation. */
export interface ServicePayload {
  name: string;
  description?: string | null;
  category?: string | null;
  price: number;
  duration_minutes: number;
}

export interface TeamMember {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  status: string;
  station_id: number;
  /**
   * Toutes les stations de la personne : « Dakar Plateau, Thiès ».
   *
   * Jusqu'au lot 12, la liste de l'équipe renvoyait une ligne PAR
   * RATTACHEMENT : un administrateur présent sur deux stations
   * apparaissait deux fois. Le serveur regroupe désormais par
   * personne et agrège ses stations ici.
   */
  station_names?: string;
  station_count?: number;
  station_name: string;
  last_login_at: string | null;
}

export interface TeamMemberPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  password: string;
  role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  station_id: number;
}

/** État de l'installation guidée. */
export interface OnboardingStatus {
  completed: boolean;
  organization_name: string;
  station: Station | null;
  services_count: number;
  team_count: number;
}
