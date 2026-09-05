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
