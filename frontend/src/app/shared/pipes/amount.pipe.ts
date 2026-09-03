import { Pipe, PipeTransform } from '@angular/core';

/**
 * Affichage d'un montant
 * ------------------------------------------------------------------
 * {{ 10000 | acAmount }}  →  « 10 000 FCFA »
 *
 * POURQUOI UN PIPE PLUTÔT QU'UN FORMATAGE DANS CHAQUE COMPOSANT ?
 * Parce que les montants apparaissent dans presque tous les écrans du
 * produit. Sans point commun, on obtiendrait « 10000 F » ici,
 * « 10 000 FCFA » là, et « 10.000 » ailleurs.
 *
 * L'espace de séparation est une ESPACE INSÉCABLE ( ) : elle
 * empêche « 10 000 » d'être coupé en fin de ligne, ce qui donnerait
 * l'illusion de deux nombres.
 */
@Pipe({ name: 'acAmount' })
export class AmountPipe implements PipeTransform {
  transform(amount: number | null | undefined, currency = 'FCFA'): string {
    if (amount === null || amount === undefined || Number.isNaN(amount)) {
      return '—';
    }

    // fr-FR groupe par milliers avec une espace, ce qui correspond à
    // l'usage au Sénégal.
    const formatted = new Intl.NumberFormat('fr-FR').format(amount);

    return `${formatted} ${currency}`;
  }
}
