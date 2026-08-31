import { Component, input } from '@angular/core';

/**
 * En-tête de page
 * ------------------------------------------------------------------
 * <ac-page-header title="Véhicules" subtitle="128 véhicules enregistrés">
 *   <button class="btn btn-primary">Ajouter un véhicule</button>
 * </ac-page-header>
 *
 * Présent en haut de chaque écran du produit. Le fait qu'il soit un
 * composant, et non du HTML recopié, garantit que le titre a partout
 * la même taille et que le bouton d'action est toujours au même
 * endroit — en haut à droite. Un utilisateur qui apprend un écran
 * connaît alors tous les autres.
 *
 * `<ng-content>` est l'emplacement où le parent insère ses boutons :
 * l'en-tête ne présume pas des actions disponibles.
 */
@Component({
  selector: 'ac-page-header',
  template: `
    <header class="ac-page-header">
      <div>
        <h1 class="ac-page-header__title">{{ title() }}</h1>

        @if (subtitle()) {
          <p class="ac-page-header__subtitle">{{ subtitle() }}</p>
        }
      </div>

      <div class="ac-page-header__actions">
        <ng-content />
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
}
