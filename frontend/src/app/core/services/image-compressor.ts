/**
 * Compression d'une photo AVANT son envoi
 * ------------------------------------------------------------------
 * POURQUOI COMPRESSER CÔTÉ NAVIGATEUR ALORS QUE LE SERVEUR
 * RÉ-ENCODE DÉJÀ ?
 *
 * Parce que ce ne sont pas les mêmes problèmes.
 *
 *   Le serveur ré-encode pour la SÉCURITÉ : détruire ce qui pourrait
 *   être caché dans le fichier. Il le fait après réception.
 *
 *   Le navigateur compresse pour le TEMPS D'ATTENTE. Une photo de
 *   téléphone fait 4 Mo ; cinq photos, c'est 20 Mo à téléverser. Sur
 *   une connexion mobile à 300 ko/s, l'employé attend plus d'une
 *   minute devant un client. Il abandonnera la procédure — et une
 *   procédure abandonnée ne protège personne.
 *
 * Réduites ici à 1600 px, les cinq photos pèsent moins de 1 Mo au
 * total. L'attente passe de la minute à quelques secondes.
 *
 * ATTENTION : cette compression est un CONFORT, pas une protection.
 * Elle s'exécute dans le navigateur, donc n'importe qui peut la
 * contourner en appelant l'API directement. Toutes les vérifications
 * qui comptent — type réel, taille, ré-encodage — sont côté serveur,
 * dans PhotoStorage.
 */

/** 1600 px suffit largement à constater une rayure sur un écran. */
const MAX_DIMENSION = 1600;

/** WebP à 0,8 : divise le poids par cinq sans perte visible. */
const QUALITY = 0.8;

export interface CompressedPhoto {
  blob: Blob;
  width: number;
  height: number;
  /** Poids d'origine, pour informer l'utilisateur du gain. */
  originalSize: number;
}

/**
 * Réduit et ré-encode une photo choisie par l'utilisateur.
 *
 * En cas d'échec — format exotique, image illisible — on renvoie le
 * fichier d'origine plutôt qu'une erreur : mieux vaut un envoi lent
 * qu'une inspection sans photo.
 */
export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  const originalSize = file.size;

  try {
    // createImageBitmap décode l'image hors du fil principal :
    // l'interface ne se fige pas pendant le traitement d'une photo
    // de 12 mégapixels.
    const bitmap = await createImageBitmap(file);

    const longest = Math.max(bitmap.width, bitmap.height);
    const ratio = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;

    const width = Math.round(bitmap.width * ratio);
    const height = Math.round(bitmap.height * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');

    if (!context) {
      bitmap.close();

      return { blob: file, width: bitmap.width, height: bitmap.height, originalSize };
    }

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', QUALITY),
    );

    // Libère la mémoire du canvas immédiatement : sur mobile, cinq
    // canvas de 12 mégapixels laissés en place font planter l'onglet.
    canvas.width = 0;
    canvas.height = 0;

    if (!blob) {
      return { blob: file, width, height, originalSize };
    }

    return { blob, width, height, originalSize };
  } catch {
    // Format que le navigateur ne sait pas décoder : on laisse le
    // serveur trancher. Il refusera clairement si ce n'est pas une
    // image.
    return { blob: file, width: 0, height: 0, originalSize };
  }
}

/** « 3,4 Mo », « 240 ko » — pour montrer le gain à l'utilisateur. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} o`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} ko`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}
