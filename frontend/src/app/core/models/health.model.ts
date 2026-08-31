/** Reponse de GET /api/health (voir backend HealthController). */
export interface HealthStatus {
  application: string;
  status: 'ok';
  database: 'connected';
  timestamp: string;

  /** Champs presents uniquement quand APP_DEBUG=true cote backend. */
  environment?: string;
  php_version?: string;
  database_name?: string;
}
