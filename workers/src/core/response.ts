/**
 * L'enveloppe de réponse — identique au PHP, au caractère près
 * ==================================================================
 * `{ success, data, message }` en cas de succès,
 * `{ success, message, errors }` en cas d'erreur.
 *
 * Ce n'est pas un détail de forme : l'application Angular existante
 * lit exactement ces clés. Le but de l'étape 1 est de prouver que le
 * frontend fonctionne SANS ÊTRE MODIFIÉ. La moindre différence ici
 * invaliderait la démonstration.
 */

const ENTETES_SECURITE = {
  'Content-Type': 'application/json; charset=utf-8',
  // Une réponse authentifiée ne doit jamais dormir dans un cache
  // partagé — le poste du comptoir est partagé par toute l'équipe.
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
} as const;

export function succes(data: unknown = null, message = '', status = 200): Response {
  return new Response(JSON.stringify({ success: true, data, message }), {
    status,
    headers: ENTETES_SECURITE,
  });
}

export function erreur(
  message: string,
  errors: Record<string, string> = {},
  status = 400,
): Response {
  return new Response(
    JSON.stringify({ success: false, message, errors }),
    { status, headers: ENTETES_SECURITE },
  );
}

export const nonAuthentifie = (m = 'Vous devez vous connecter.') => erreur(m, {}, 401);
export const interdit = (m = "Vous n'avez pas le droit de faire cela.") => erreur(m, {}, 403);
export const introuvable = (m = "Cette ressource n'existe pas.") => erreur(m, {}, 404);
