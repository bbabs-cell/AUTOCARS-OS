import { Pipe, PipeTransform } from '@angular/core';

/**
 * Date relative
 * ------------------------------------------------------------------
 * {{ '2026-09-01 10:00:00' | acRelativeDate }}  →  « il y a 2 jours »
 *
 * POURQUOI ?
 * « Dernière visite : 2026-08-14 » oblige le lecteur à calculer.
 * « Il y a 3 semaines » se comprend immédiatement — et c'est
 * exactement l'information utile au comptoir : ce client est-il un
 * habitué ou revient-il après un an ?
 *
 * Au-delà d'un mois, on repasse à une date absolue : « il y a
 * 14 mois » est moins parlant que « août 2025 ».
 */
@Pipe({ name: 'acRelativeDate' })
export class RelativeDatePipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) {
      return 'Jamais';
    }

    // Les dates arrivent en UTC depuis l'API, au format MySQL
    // « 2026-09-01 10:00:00 ». Sans le « Z », le navigateur les
    // interpréterait comme locales et décalerait le résultat.
    const parsed = new Date(value.replace(' ', 'T') + 'Z');

    if (Number.isNaN(parsed.getTime())) {
      return '—';
    }

    const seconds = Math.floor((Date.now() - parsed.getTime()) / 1000);

    if (seconds < 60) {
      return "à l'instant";
    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {
      return `il y a ${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
      return `il y a ${hours} h`;
    }

    const days = Math.floor(hours / 24);

    if (days === 1) {
      return 'hier';
    }

    if (days < 7) {
      return `il y a ${days} jours`;
    }

    if (days < 31) {
      const weeks = Math.floor(days / 7);

      return weeks === 1 ? 'il y a 1 semaine' : `il y a ${weeks} semaines`;
    }

    // Au-delà d'un mois, la date absolue redevient plus parlante.
    return parsed.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  }
}
