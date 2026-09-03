import { Pipe, PipeTransform } from '@angular/core';

/**
 * Affichage d'une durée en minutes
 * ------------------------------------------------------------------
 * formatDuration(45)  →  « 45 min »
 * formatDuration(60)  →  « 1 h »
 * formatDuration(90)  →  « 1 h 30 »
 * formatDuration(65)  →  « 1 h 05 »
 * formatDuration(0)   →  « < 1 min »
 *
 * « 240 min » oblige le lecteur à faire la division lui-même.
 *
 * POURQUOI UNE FONCTION *ET* UN PIPE ?
 * Le pipe sert dans les gabarits, la fonction dans le code — pour
 * composer un texte d'infobulle, par exemple. Une seule
 * implémentation, deux façons d'y accéder : c'est ce qui évite qu'un
 * écran affiche « 1 h 30 » et un autre « 90 min » pour la même durée.
 *
 * ZÉRO N'EST PAS RIEN. Une prestation sans durée connue (`null`)
 * s'affiche « — » ; un dossier arrivé il y a quelques secondes
 * s'affiche « < 1 min ». Les confondre ferait croire à une donnée
 * manquante là où il y a une information exacte.
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || minutes < 0 || Number.isNaN(minutes)) {
    return '—';
  }

  if (minutes === 0) {
    return '< 1 min';
  }

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  // Les minutes sont complétées à deux chiffres : « 1 h 05 » se lit
  // comme une heure, « 1 h 5 » fait hésiter une demi-seconde.
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

@Pipe({ name: 'acDuration' })
export class DurationPipe implements PipeTransform {
  transform(minutes: number | null | undefined): string {
    return formatDuration(minutes);
  }
}
