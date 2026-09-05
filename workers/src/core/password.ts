/**
 * Mots de passe — PBKDF2, faute de bcrypt
 * ==================================================================
 * POURQUOI PAS bcrypt, COMME EN PHP
 *
 * `password_hash()` utilisait bcrypt. Les Workers n'exposent que la
 * Web Crypto, qui ne connaît pas bcrypt. Restaient deux voies :
 * embarquer bcrypt en WebAssembly, ou passer à PBKDF2-HMAC-SHA256,
 * qui est nativement disponible.
 *
 * PBKDF2 est retenu : c'est la seule des deux qui ne fasse pas entrer
 * un binaire de plusieurs centaines de kilo-octets dans un Worker, et
 * c'est un algorithme éprouvé et recommandé.
 *
 * ------------------------------------------------------------------
 * CE QUE CE CHOIX COÛTE, DIT FRANCHEMENT
 *
 * Les empreintes bcrypt existantes deviennent INVÉRIFIABLES. Un
 * utilisateur déjà inscrit devrait refaire son mot de passe.
 *
 * Aujourd'hui ce coût est nul : aucun compte réel n'existe, le
 * produit n'est pas en service. Il ne le sera plus après la mise en
 * service — c'est l'argument de calendrier du §4.3 du chiffrage.
 *
 * ------------------------------------------------------------------
 * LE NOMBRE D'ITÉRATIONS N'EST PAS COPIÉ D'UNE RECOMMANDATION
 *
 * Les Workers facturent le TEMPS DE CALCUL, et en limitent la durée.
 * Un chiffre repris d'un article sans le mesurer sur cette plateforme
 * donnerait soit une connexion qui dépasse la limite, soit une
 * protection plus faible qu'annoncée.
 *
 * La valeur ci-dessous a été mesurée dans le runtime Workers, et le
 * test `password.test.ts` refait la mesure à chaque exécution : il
 * échoue si une connexion coûte trop cher.
 */

/**
 * Itérations PBKDF2 — MESURÉES, pas recopiées.
 *
 * Coût relevé dans le runtime Workers (workerd local, médiane de
 * trois mesures) :
 *
 *      50 000 →  8 ms      210 000 → 32 ms
 *     100 000 → 14 ms      300 000 → 47 ms
 *     150 000 → 23 ms      600 000 → 92 ms
 *
 * ------------------------------------------------------------------
 * CE QUE CETTE MESURE A RÉVÉLÉ, ET QUI DÉPASSE LE CHOIX DU PARAMÈTRE
 *
 * Le plan GRATUIT de Cloudflare limite chaque requête à 10 ms de
 * temps de CALCUL. Même 50 000 itérations le dépassent déjà — et
 * 50 000 est en dessous de toute recommandation sérieuse.
 *
 * Autrement dit : **la connexion ne peut pas fonctionner sur le plan
 * gratuit**, quel que soit le réglage. Le plan payant (30 s de calcul)
 * l'absorbe sans difficulté.
 *
 * C'est exactement ce que l'étape 1 devait découvrir : une contrainte
 * de plateforme qu'aucune lecture de documentation n'aurait rendue
 * évidente, et qu'il valait mieux trouver maintenant qu'au lot 16.
 *
 * ------------------------------------------------------------------
 * POURQUOI 600 000
 *
 * C'est la valeur recommandée pour PBKDF2-HMAC-SHA256. Elle coûte
 * 92 ms par connexion, ce qui est sans conséquence à l'échelle d'une
 * station : même mille connexions par jour restent très loin du
 * quota de calcul inclus. Le coût étant négligeable, rien ne
 * justifiait de descendre en dessous de la recommandation.
 */
export const ITERATIONS = 600_000;

const SEL_OCTETS = 16;
const CLE_BITS = 256;

/**
 * Empreinte d'un mot de passe, au format
 * `pbkdf2$<itérations>$<sel base64>$<clé base64>`.
 *
 * Le format porte son propre nombre d'itérations : le jour où on
 * l'augmentera, les anciennes empreintes resteront vérifiables. Sans
 * cela, changer le paramètre déconnecterait tout le monde.
 */
export async function hachePassword(motDePasse: string): Promise<string> {
  const sel = crypto.getRandomValues(new Uint8Array(SEL_OCTETS));
  const cle = await derive(motDePasse, sel, ITERATIONS);

  return `pbkdf2$${ITERATIONS}$${base64(sel)}$${base64(cle)}`;
}

/**
 * Vérifie un mot de passe contre une empreinte.
 *
 * Ne lève jamais : une empreinte illisible — corrompue, ou héritée de
 * bcrypt — renvoie `false`, comme un mauvais mot de passe. Le contexte
 * d'appel est une page de connexion : distinguer les deux cas
 * renseignerait un attaquant sur l'existence du compte.
 */
export async function verifiePassword(
  motDePasse: string,
  empreinte: string,
): Promise<boolean> {
  const parties = empreinte.split('$');

  if (parties.length !== 4 || parties[0] !== 'pbkdf2') {
    return false;
  }

  const iterations = Number.parseInt(parties[1], 10);

  if (!Number.isInteger(iterations) || iterations < 1) {
    return false;
  }

  let sel: Uint8Array;
  let attendu: Uint8Array;

  try {
    sel = deBase64(parties[2]);
    attendu = deBase64(parties[3]);
  } catch {
    return false;
  }

  const obtenu = await derive(motDePasse, sel, iterations);

  return egaliteConstante(obtenu, attendu);
}

async function derive(
  motDePasse: string,
  sel: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const cleBrute = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(motDePasse),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations },
    cleBrute,
    CLE_BITS,
  );

  return new Uint8Array(bits);
}

/**
 * Comparaison à temps constant.
 *
 * Une comparaison ordinaire s'arrête au premier octet différent. Le
 * temps de réponse révèle alors combien d'octets étaient corrects, ce
 * qui permet de reconstituer l'empreinte octet par octet.
 */
function egaliteConstante(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < a.length; i++) {
    difference |= a[i] ^ b[i];
  }

  return difference === 0;
}

function base64(octets: Uint8Array): string {
  return btoa(String.fromCharCode(...octets));
}

function deBase64(texte: string): Uint8Array {
  return Uint8Array.from(atob(texte), (c) => c.charCodeAt(0));
}
