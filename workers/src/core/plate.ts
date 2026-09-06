/**
 * Plaques d'immatriculation — porté depuis Core/PlateNumber.php
 *
 * Deux formes sont exposées à l'application : la forme normalisée,
 * qui sert aux comparaisons et à la recherche, et la forme lisible,
 * pour l'affichage. Le frontend n'a ainsi jamais à refaire le
 * découpage — et deux découpages divergent toujours.
 */

export function normalise(plaque: string): string {
  return plaque.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function affiche(plaque: string): string {
  const n = normalise(plaque);
  const parties = /^([A-Z]{2})(\d{4})([A-Z]{2,3})$/.exec(n);

  return parties === null ? n : `${parties[1]}-${parties[2]}-${parties[3]}`;
}

/**
 * Cette plaque est-elle exploitable ?
 *
 * ON NE VALIDE PAS UN FORMAT NATIONAL PRÉCIS. Un véhicule immatriculé
 * en Gambie, en Guinée ou au Mali peut se présenter à la station, et
 * refuser sa plaque empêcherait de le servir. On vérifie seulement
 * qu'il y a de quoi identifier quelque chose : une longueur
 * plausible, au moins une lettre et au moins un chiffre.
 */
export function plausible(plaque: string): boolean {
  const n = normalise(plaque);

  return n.length >= 5 && n.length <= 12 && /[A-Z]/.test(n) && /\d/.test(n);
}
