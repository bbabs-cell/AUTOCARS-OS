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
 * Une empreinte qui ne correspond à aucun mot de passe.
 *
 * `connexion()` la vérifie quand l'adresse est inconnue, pour que le
 * temps de réponse ne trahisse pas l'inexistence du compte.
 *
 * SON NOMBRE D'ITÉRATIONS EST CELUI DES VRAIES, ET C'EST TOUT
 * L'INTÉRÊT. La version précédente en annonçait 210 000 quand les
 * vraies en faisaient 600 000 : la réponse arrivait ~60 ms plus tôt
 * pour une adresse inconnue. Le message uniforme disait « je ne vous
 * dirai pas si ce compte existe » ; le chronomètre le disait quand
 * même, et une boucle sur mille adresses aurait révélé lesquelles
 * sont clientes de la station.
 *
 * Construite à partir de `ITERATIONS`, elle ne peut plus s'en écarter
 * le jour où ce nombre change.
 */
export const EMPREINTE_FACTICE =
  `pbkdf2$${ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;

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

/**
 * LE PLAFOND DE LA PLATEFORME — 100 000 ITÉRATIONS PAR APPEL.
 * ==================================================================
 * Cloudflare refuse PBKDF2 au-delà, pour éviter qu'une requête ne
 * monopolise un cœur :
 *
 *     NotSupportedError: Pbkdf2 failed:
 *     iteration counts above 100000 are not supported
 *
 * CE PLAFOND N'EXISTE PAS DANS workerd EN LOCAL. Un appel à 600 000
 * y passe sans un mot — vérifié — et les 658 tests avec lui. La
 * production, elle, levait l'exception, que le gestionnaire global
 * transformait en « Une erreur interne est survenue ».
 *
 * Personne ne pouvait donc ni s'inscrire ni se connecter, et rien en
 * local ne pouvait le montrer.
 */
const PALIER = 100_000;

/**
 * Dérive la clé en ENCHAÎNANT des tours sous le plafond.
 *
 * Chaque tour reprend la sortie du précédent comme mot de passe, avec
 * le même sel. Le travail total reste celui du nombre d'itérations
 * demandé : un attaquant doit refaire les mêmes tours dans le même
 * ordre, il n'existe pas de raccourci qui saute le milieu de la
 * chaîne.
 *
 * POURQUOI PAS SIMPLEMENT DESCENDRE À 100 000. Parce que ce serait
 * diviser par six la protection réelle des mots de passe pour
 * contourner une limite d'implémentation. L'OWASP recommande 600 000
 * pour PBKDF2-HMAC-SHA256 ; c'est ce chiffre qui protège le client,
 * pas celui qui arrange la plateforme.
 *
 * POURQUOI PAS scrypt, DISPONIBLE VIA `node:crypto`. Il serait
 * meilleur — il coûte de la mémoire, donc résiste aux cartes
 * graphiques là où PBKDF2 ne résiste qu'au temps. Mais son
 * comportement sous Workers ne se vérifie qu'EN PRODUCTION, et c'est
 * exactement l'hypothèse qui vient de coûter une mise en service.
 * PBKDF2 sous 100 000 par appel, lui, est démontré accepté.
 *
 * COMPATIBILITÉ : en dessous de 100 000, la boucle fait un seul tour
 * et le résultat est un PBKDF2 standard, identique à ce que produit
 * n'importe quelle autre implémentation.
 */
async function derive(
  motDePasse: string,
  sel: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  let bloc: Uint8Array = new TextEncoder().encode(motDePasse);
  let restant = iterations;

  while (restant > 0) {
    const tour = Math.min(restant, PALIER);

    const cleBrute = await crypto.subtle.importKey(
      'raw',
      bloc,
      'PBKDF2',
      false,
      ['deriveBits'],
    );

    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations: tour },
      cleBrute,
      CLE_BITS,
    );

    bloc = new Uint8Array(bits);
    restant -= tour;
  }

  return bloc;
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
