import { Component, input, output } from '@angular/core';

/**
 * État vide
 * ------------------------------------------------------------------
 * <ac-empty-state
 *    icon="bi-car-front"
 *    title="Aucun véhicule enregistré"
 *    text="Enregistrez votre premier véhicule pour commencer à suivre vos opérations."
 *    actionLabel="Ajouter un véhicule"
 *    (action)="ouvrirFormulaire()" />
 *
 * RÈGLE DU PROJET : un état vide ne se contente jamais d'annoncer
 * l'absence de données. Il explique pourquoi l'écran est vide et
 * propose l'action qui le remplira.
 *
 * « Aucun véhicule » laisse l'utilisateur bloqué.
 * « Aucun véhicule enregistré — [Ajouter un véhicule] » le fait
 * avancer. C'est souvent le tout premier écran que voit un nouveau
 * client : il détermine s'il continue ou s'il abandonne.
 */
@Component({
  selector: 'ac-empty-state',
  template: `
    <div class="ac-empty">
      <div class="ac-empty__icon">
        <i class="bi" [class]="icon()" aria-hidden="true"></i>
      </div>

      <p class="ac-empty__title">{{ title() }}</p>

      @if (text()) {
        <p class="ac-empty__text">{{ text() }}</p>
      }

      @if (actionLabel()) {
        <button type="button" class="btn btn-primary" (click)="action.emit()">
          {{ actionLabel() }}
        </button>
      }
    </div>
  `,
})
export class EmptyStateComponent {
  readonly icon = input<string>('bi-inbox');
  readonly title = input.required<string>();
  readonly text = input<string>('');
  readonly actionLabel = input<string>('');

  /** Émis au clic sur le bouton. Le parent décide de ce qui se passe. */
  readonly action = output<void>();
}
