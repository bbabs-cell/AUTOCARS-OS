import { Pipe, PipeTransform } from '@angular/core';

/**
 * Affichage d'une durée en minutes
 * ------------------------------------------------------------------
 * {{ 45  | acDuration }}  →  « 45 min »
 * {{ 60  | acDuration }}  →  « 1 h »
 * {{ 240 | acDuration }}  →  « 4 h »
 * {{ 90  | acDuration }}  →  « 1 h 30 »
 *
 * « 240 min » oblige le lecteur à faire la division lui-même.
 */
@Pipe({ name: 'acDuration' })
export class DurationPipe implements PipeTransform {
  transform(minutes: number | null | undefined): string {
    if (!minutes || minutes <= 0) {
      return '—';
    }

    if (minutes < 60) {
      return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;

    return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
  }
}
