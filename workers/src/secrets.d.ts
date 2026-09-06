/**
 * Les SECRETS, déclarés à part
 * ------------------------------------------------------------------
 * `wrangler types` régénère `worker-configuration.d.ts` à partir de
 * `wrangler.toml`. Les secrets n'y figurent pas — c'est tout leur
 * intérêt — donc l'outil ne peut pas les connaître, et les ajouter à
 * la main dans le fichier généré les fait disparaître à la
 * régénération suivante. C'est arrivé une fois.
 *
 * Ils sont donc déclarés ici, dans un fichier que rien ne réécrit.
 * Tous facultatifs : le produit doit tourner sans, et c'est vérifié —
 * sans service de messagerie, les courriels partent dans les traces.
 */
declare namespace Cloudflare {
  interface Env {
    /** La clé d'API Resend, posée par `wrangler secret put`. */
    RESEND_TOKEN?: string;
    /**
     * L'adresse de l'API, uniquement pour les tests : en production
     * elle est fixe, c'est un service et non un réglage.
     */
    MAIL_ENDPOINT?: string;
  }
}

interface Env extends Cloudflare.Env {}
