/**
 * Jetons d'accès — HMAC-SHA256 sur la Web Crypto
 * ==================================================================
 * Remplace `firebase/php-jwt`. Un JWT signé en HS256 tient en une
 * centaine de lignes : rien ne justifiait d'ajouter une dépendance.
 *
 * On ne gère QUE HS256, et on refuse tout le reste. C'est délibéré :
 * accepter l'algorithme annoncé par le jeton lui-même est la faille
 * historique des bibliothèques JWT — un attaquant annonce « none » et
 * la signature n'est plus vérifiée. Ici l'algorithme est décidé par
 * le serveur, jamais lu dans le jeton.
 */

export interface Charge {
  sub: number;
  org: number;
  iat: number;
  exp: number;
}

export async function signe(
  charge: Omit<Charge, 'iat' | 'exp'>,
  secret: string,
  dureeSecondes: number,
): Promise<string> {
  const maintenant = Math.floor(Date.now() / 1000);
  const complet: Charge = {
    ...charge,
    iat: maintenant,
    exp: maintenant + dureeSecondes,
  };

  const entete = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corps = base64url(JSON.stringify(complet));
  const signature = await hmac(`${entete}.${corps}`, secret);

  return `${entete}.${corps}.${signature}`;
}

/**
 * Vérifie un jeton et renvoie sa charge, ou `null`.
 *
 * `null` couvre tous les cas — signature fausse, jeton expiré, forme
 * illisible. L'appelant n'a pas à distinguer : dans tous les cas la
 * requête n'est pas authentifiée.
 */
export async function verifie(
  jeton: string,
  secret: string,
): Promise<Charge | null> {
  const parties = jeton.split('.');

  if (parties.length !== 3) {
    return null;
  }

  const [entete, corps, signature] = parties;
  const attendue = await hmac(`${entete}.${corps}`, secret);

  // Comparaison à temps constant : voir password.ts.
  if (!egaliteConstante(signature, attendue)) {
    return null;
  }

  let charge: Charge;

  try {
    charge = JSON.parse(deBase64url(corps)) as Charge;
  } catch {
    return null;
  }

  if (
    typeof charge.sub !== 'number' ||
    typeof charge.org !== 'number' ||
    typeof charge.exp !== 'number'
  ) {
    return null;
  }

  if (charge.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return charge;
}

async function hmac(donnees: string, secret: string): Promise<string> {
  const cle = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    cle,
    new TextEncoder().encode(donnees),
  );

  return base64urlOctets(new Uint8Array(signature));
}

function egaliteConstante(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return difference === 0;
}

function base64url(texte: string): string {
  return base64urlOctets(new TextEncoder().encode(texte));
}

function base64urlOctets(octets: Uint8Array): string {
  return btoa(String.fromCharCode(...octets))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function deBase64url(texte: string): string {
  const complet = texte.replace(/-/g, '+').replace(/_/g, '/');
  const rembourre = complet.padEnd(Math.ceil(complet.length / 4) * 4, '=');

  return new TextDecoder().decode(
    Uint8Array.from(atob(rembourre), (c) => c.charCodeAt(0)),
  );
}
