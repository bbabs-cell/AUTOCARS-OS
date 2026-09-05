/**
 * Le cookie de rafraîchissement
 * ==================================================================
 * Quatre réglages, quatre raisons. Aucun n'est décoratif.
 *
 *   HttpOnly          le JavaScript de la page ne peut pas le lire.
 *                     Une faille XSS ne donne donc pas la session.
 *
 *   SameSite=Strict   le navigateur ne l'envoie jamais depuis un
 *                     autre site. C'est la protection CSRF, obtenue
 *                     sans jeton supplémentaire.
 *
 *   Path=/api/auth    il n'est envoyé qu'aux routes qui en ont besoin.
 *                     Les 88 autres routes ne le voient jamais passer.
 *
 *   Secure            sauf en développement local, où il n'y a pas de
 *                     HTTPS et où l'imposer empêcherait de travailler.
 *
 * Le jeton d'accès, lui, ne va PAS dans un cookie : il vit en mémoire
 * dans l'application. Un cookie serait envoyé automatiquement partout,
 * ce qui est exactement ce qu'on ne veut pas d'un jeton porteur.
 */

const NOM = 'autocare_refresh';
const CHEMIN = '/api/auth';

export function pose(jeton: string, jours: number, local: boolean): string {
  const expire = new Date(Date.now() + jours * 86_400_000).toUTCString();

  return [
    `${NOM}=${jeton}`,
    `Expires=${expire}`,
    `Max-Age=${jours * 86_400}`,
    `Path=${CHEMIN}`,
    'HttpOnly',
    'SameSite=Strict',
    ...(local ? [] : ['Secure']),
  ].join('; ');
}

/** Efface le cookie. Mêmes attributs, sinon le navigateur l'ignore. */
export function efface(local: boolean): string {
  return [
    `${NOM}=`,
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
    `Path=${CHEMIN}`,
    'HttpOnly',
    'SameSite=Strict',
    ...(local ? [] : ['Secure']),
  ].join('; ');
}

export function lit(request: Request): string | null {
  const brut = request.headers.get('Cookie');

  if (brut === null) {
    return null;
  }

  for (const morceau of brut.split(';')) {
    const [nom, ...reste] = morceau.trim().split('=');

    if (nom === NOM) {
      const valeur = reste.join('=');
      return valeur === '' ? null : valeur;
    }
  }

  return null;
}
