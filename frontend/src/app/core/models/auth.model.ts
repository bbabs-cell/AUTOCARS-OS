/**
 * Modèles d'authentification
 * ------------------------------------------------------------------
 * Décrit en TypeScript ce que renvoie l'API. Si le backend change de
 * format, la compilation échoue — au lieu de produire un bug
 * silencieux découvert en production.
 */

/** Les trois rôles du produit (voir backend/config/permissions.php). */
export type UserRole = 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

/** L'utilisateur connecté. */
export interface AuthUser {
  id: number;
  organization_id: number;
  email: string;
  full_name: string;
  role: UserRole;
  station_ids: number[];

  /**
   * L'installation guidée de l'entreprise est-elle terminée ?
   * Détermine si l'utilisateur est conduit vers l'installation ou
   * vers l'application.
   */
  onboarding_completed: boolean;
}

/**
 * Réponse de /login, /register et /refresh.
 *
 * Le jeton de rafraîchissement N'APPARAÎT PAS ici : il voyage dans un
 * cookie httpOnly que le JavaScript ne peut pas lire. C'est
 * précisément ce qui le protège d'une faille XSS.
 */
export interface AuthSession {
  access_token: string;
  /** Durée de validité du jeton d'accès, en secondes. */
  expires_in: number;
  user: AuthUser;
}

export interface RegisterPayload {
  organization_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}
