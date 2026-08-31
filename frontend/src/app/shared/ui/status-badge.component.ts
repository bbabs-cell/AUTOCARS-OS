import { Component, computed, input } from '@angular/core';

import {
  OPERATION_STATUS_LABELS,
  OPERATION_STATUS_MODIFIERS,
  OperationStatus,
} from '../../core/models/operation-status.model';

/**
 * Badge de statut d'opération
 * ------------------------------------------------------------------
 * <ac-status-badge status="WASHING" />
 *
 * POURQUOI UN COMPOSANT PLUTÔT QU'UNE SIMPLE CLASSE CSS ?
 * Parce qu'il y a une décision à prendre : traduire le statut en
 * libellé français et en classe CSS. Si chaque écran refaisait cette
 * traduction, on finirait avec « En lavage » ici et « Lavage en
 * cours » là. Le composant garantit un vocabulaire unique dans tout
 * le produit.
 *
 * `input()` est la façon moderne de déclarer une entrée en Angular.
 * `input.required` signifie qu'oublier l'attribut `status` provoque
 * une erreur à la compilation, pas un badge vide en production.
 */
@Component({
  selector: 'ac-status-badge',
  template: `
    <span class="ac-badge" [class]="cssClass()">
      <span class="ac-badge__dot" aria-hidden="true"></span>
      {{ label() }}
    </span>
  `,
})
export class StatusBadgeComponent {
  readonly status = input.required<OperationStatus>();

  /**
   * `computed()` recalcule automatiquement la valeur quand `status`
   * change, et uniquement dans ce cas. C'est plus efficace qu'un
   * appel de méthode dans le template, qui serait réévalué à chaque
   * cycle de détection de changement.
   */
  protected readonly label = computed(() => OPERATION_STATUS_LABELS[this.status()]);

  protected readonly cssClass = computed(
    () => `ac-badge--${OPERATION_STATUS_MODIFIERS[this.status()]}`,
  );
}
