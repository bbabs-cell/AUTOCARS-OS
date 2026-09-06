/**
 * Stockage sécurisé des photos d'inspection
 * ==================================================================
 * LE FICHIER LE PLUS SENSIBLE DU PROJET.
 * ==================================================================
 *
 * Accepter un fichier envoyé par un utilisateur est l'une des
 * opérations les plus dangereuses d'une application web. Un fichier
 * mal traité, c'est un serveur compromis.
 *
 * SIX PROTECTIONS, APPLIQUÉES DANS CET ORDRE :
 *
 * 1. La TAILLE est vérifiée avant toute manipulation.
 *
 * 2. Le TYPE RÉEL est lu dans les premiers octets, jamais dans
 *    l'extension ni dans l'en-tête annoncé par le client. Renommer
 *    « payload.php » en « photo.jpg » ne trompe personne.
 *
 * 3. Les DIMENSIONS sont lues avant de décoder. Une image de
 *    50 000 × 50 000 pixels tient dans quelques kilo-octets
 *    compressés mais demande des gigaoctets pour être décodée :
 *    c'est la « bombe de décompression ».
 *
 * 4. L'IMAGE EST RÉ-ENCODÉE. C'est la protection la plus forte. Une
 *    image peut porter du code dans ses métadonnées ; décoder les
 *    pixels puis les réécrire dans un fichier neuf détruit tout ce
 *    qui n'est pas de l'image. Rien ne survit.
 *
 * 5. Le NOM du fichier est généré, jamais celui fourni. Celui de
 *    l'utilisateur peut contenir « ../../ » pour sortir du dossier,
 *    ou une double extension « .jpg.php ».
 *
 * 6. Le fichier est écrit dans un SEAU R2 PRIVÉ. Aucune URL publique
 *    n'y donne accès : une route authentifiée vérifie les droits
 *    avant de le servir.
 *
 * ------------------------------------------------------------------
 * CE QUE CLOUDFLARE IMAGES REMPLACE, ET CE QU'IL NE REMPLACE PAS
 *
 * Le PHP faisait le ré-encodage avec `gd`. Workers n'a pas `gd` ;
 * c'est le point 2 du §4.4 du chiffrage, tranché en faveur de
 * Cloudflare Images. La liaison `IMAGES` décode les pixels et en
 * réécrit de nouveaux : c'est exactement la même protection, rendue
 * par un service au lieu d'une bibliothèque.
 *
 * Elle ne remplace pas les points 1, 3, 5 et 6, qui restent écrits
 * ici. Et surtout pas le point 2 : `IMAGES.info()` sait dire ce
 * qu'est un fichier, mais on ne lui remet un fichier QUE s'il
 * ressemble déjà à une image. On ne fait pas décoder n'importe quoi
 * par un service parce qu'il est robuste.
 *
 * ------------------------------------------------------------------
 * POURQUOI CONVERTIR EN WEBP ?
 *
 * Une photo de téléphone fait 3 à 5 Mo. Cinq par inspection, sur une
 * connexion mobile sénégalaise, c'est plusieurs minutes d'attente —
 * et un employé qui abandonne la procédure. Le WebP divise le poids
 * par quatre à qualité visuelle équivalente, et reste amplement
 * suffisant pour constater une rayure.
 */

/** 12 Mo : une photo de téléphone moderne dépasse rarement 8 Mo. */
const OCTETS_MAX = 12 * 1024 * 1024;

/**
 * Garde-fou contre les bombes de décompression : au-delà, on refuse
 * de décoder plutôt que de saturer la mémoire.
 */
const PIXELS_MAX = 50_000_000;

/**
 * 2048 px sur le plus grand côté. Assez pour distinguer une rayure de
 * dix centimètres, quatre fois plus léger qu'une photo brute.
 */
const COTE_MAX = 2048;

const QUALITE = 82;

export interface PhotoRangee {
  chemin: string;
  empreinte: string;
  type: string;
  octets: number;
  largeur: number;
  hauteur: number;
}

/** Le refus est un message destiné à l'employé, pas une trace technique. */
export class PhotoRefusee extends Error {}

/**
 * Le type réel, lu dans les premiers octets.
 *
 * C'est le remplaçant de `finfo`. Trois signatures, et rien d'autre :
 * le SVG en particulier est absent, et volontairement — c'est un
 * document XML qui peut porter du script, et aucun ré-encodage ne
 * le rendrait inoffensif puisqu'il n'a pas de pixels à réécrire.
 */
function typeReel(octets: Uint8Array): string | null {
  if (octets.length < 12) {
    return null;
  }

  const a = (i: number) => octets[i];

  // FF D8 FF — JPEG
  if (a(0) === 0xff && a(1) === 0xd8 && a(2) === 0xff) {
    return 'image/jpeg';
  }

  // 89 'P' 'N' 'G' \r \n 1A \n — PNG
  if (a(0) === 0x89 && a(1) === 0x50 && a(2) === 0x4e && a(3) === 0x47
      && a(4) === 0x0d && a(5) === 0x0a && a(6) === 0x1a && a(7) === 0x0a) {
    return 'image/png';
  }

  // 'RIFF' …… 'WEBP' — WebP
  const mot = (i: number) => String.fromCharCode(a(i), a(i + 1), a(i + 2), a(i + 3));

  if (mot(0) === 'RIFF' && mot(8) === 'WEBP') {
    return 'image/webp';
  }

  return null;
}

/**
 * Vérifie, ré-encode et range une photo. Renvoie de quoi écrire la
 * ligne en base.
 *
 * @throws PhotoRefusee — le message part tel quel à l'employé.
 */
export async function range(env: Env, fichier: Blob): Promise<PhotoRangee> {
  // --- 1. La taille, avant tout ------------------------------------
  if (fichier.size === 0) {
    throw new PhotoRefusee('Le fichier est vide.');
  }

  if (fichier.size > OCTETS_MAX) {
    throw new PhotoRefusee(`La photo dépasse ${OCTETS_MAX / 1024 / 1024} Mo.`);
  }

  const recus = new Uint8Array(await fichier.arrayBuffer());

  // --- 2. Le type réel, lu dans le contenu -------------------------
  if (typeReel(recus) === null) {
    throw new PhotoRefusee('Seules les images JPEG, PNG et WebP sont acceptées.');
  }

  // --- 3. Les dimensions, avant de décoder -------------------------
  let details;

  try {
    details = await env.IMAGES.info(new Blob([recus]).stream());
  } catch {
    throw new PhotoRefusee("Ce fichier n'est pas une image lisible.");
  }

  // Le SVG n'a ni largeur ni hauteur en pixels : la liaison le
  // signale par une réponse d'une autre forme. Il est déjà écarté par
  // sa signature ; on ne s'appuie pas sur un seul refus.
  if (!('width' in details)) {
    throw new PhotoRefusee('Seules les images JPEG, PNG et WebP sont acceptées.');
  }

  if (details.width * details.height > PIXELS_MAX) {
    throw new PhotoRefusee('Cette image est trop grande pour être traitée.');
  }

  // --- 4. Le ré-encodage -------------------------------------------
  //
  // `scale-down` ne fait que réduire : une photo déjà petite n'est
  // pas agrandie, ce qui ajouterait du poids sans ajouter de détail.
  //
  // L'orientation EXIF est appliquée par le service avant de rendre
  // les pixels — sans cela, les photos prises en tenant le téléphone
  // de travers ressortiraient couchées, et les métadonnées qui
  // portent l'orientation sont justement ce que le ré-encodage
  // détruit.
  let resultat;

  try {
    resultat = await env.IMAGES
      .input(new Blob([recus]).stream())
      .transform({ width: COTE_MAX, height: COTE_MAX, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: QUALITE });
  } catch {
    throw new PhotoRefusee("Cette image n'a pas pu être traitée. Réessayez.");
  }

  const finaux = new Uint8Array(await new Response(resultat.image()).arrayBuffer());

  // On relit les dimensions SUR LE RÉSULTAT, et non calculées à
  // partir de l'original : c'est le fichier rangé qu'on décrit.
  const apres = await env.IMAGES.info(new Blob([finaux]).stream());
  const largeur = 'width' in apres ? apres.width : details.width;
  const hauteur = 'width' in apres ? apres.height : details.height;

  // --- 5. Un nom généré --------------------------------------------
  const hasard = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('');

  const mois = new Date().toISOString().slice(0, 7).replace('-', '/');
  const chemin = `${mois}/${hasard}.webp`;

  // --- 6. Rangé dans le seau privé ---------------------------------
  await env.PHOTOS.put(chemin, finaux, {
    httpMetadata: { contentType: 'image/webp' },
  });

  // L'EMPREINTE PORTE SUR LE FICHIER FINAL, celui qui est rangé. Si
  // quelqu'un le remplace plus tard, elle ne correspondra plus et la
  // substitution devient détectable — question décisive en cas de
  // litige sur une rayure.
  const condense = await crypto.subtle.digest('SHA-256', finaux);
  const empreinte = [...new Uint8Array(condense)]
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('');

  return {
    chemin,
    empreinte,
    type: 'image/webp',
    octets: finaux.length,
    largeur,
    hauteur,
  };
}

/**
 * Le fichier correspond-il toujours à son empreinte ?
 *
 * Répond à « cette photo a-t-elle été remplacée depuis l'inspection ? ».
 * La comparaison est à temps constant : sa durée ne renseigne pas sur
 * la valeur attendue.
 */
export async function intacte(
  env: Env,
  chemin: string,
  attendue: string,
): Promise<boolean> {
  const objet = await env.PHOTOS.get(chemin);

  if (objet === null) {
    return false;
  }

  const condense = await crypto.subtle.digest('SHA-256', await objet.arrayBuffer());
  const trouvee = [...new Uint8Array(condense)]
    .map((o) => o.toString(16).padStart(2, '0'))
    .join('');

  if (trouvee.length !== attendue.length) {
    return false;
  }

  let ecart = 0;

  for (let i = 0; i < trouvee.length; i += 1) {
    ecart |= trouvee.charCodeAt(i) ^ attendue.charCodeAt(i);
  }

  return ecart === 0;
}
