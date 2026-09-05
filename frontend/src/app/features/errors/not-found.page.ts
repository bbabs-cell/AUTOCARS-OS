import { Component, inject } from '@angular/core';

import { ErrorStateComponent } from '../../shared/ui/error-state.component';
import { AuthService } from '../../core/services/auth.service';

/**
 * Page inconnue (404)
 * ------------------------------------------------------------------
 * AVANT LE LOT 18, UNE URL INCONNUE REDIRIGEAIT VERS L'ACCUEIL.
 *
 * Silencieusement. Quelqu'un qui suivait un lien avec une faute de
 * frappe se retrouvait sur le tableau de bord sans comprendre, et
 * concluait que le lien qu'on lui avait envoyé était mort — ou pire,
 * que le dossier qu'il cherchait avait disparu.
 *
 * Une redirection muette est une réponse fausse : elle affirme
 * « voilà ce que vous cherchiez » alors que la bonne réponse est
 * « cette adresse n'existe pas ».
 *
 * La destination du bouton dépend de qui regarde : un visiteur non
 * connecté n'a rien à faire sur un tableau de bord.
 */
@Component({
  selector: 'app-not-found-page',
  imports: [ErrorStateComponent],
  template: `
    <ac-error-state
      icon="signpost-split"
      title="Cette page n'existe pas"
      text="L'adresse demandée ne correspond à aucun écran du produit."
      hint="Une faute de frappe dans l'adresse, ou un lien qui pointe vers une
            ancienne version de l'application."
      code="404"
      [homeLink]="home"
      [homeLabel]="homeLabel"
    />
  `,
})
export class NotFoundPage {
  private readonly auth = inject(AuthService);

  protected readonly home = this.auth.isAuthenticated() ? '/dashboard' : '/';
  protected readonly homeLabel = this.auth.isAuthenticated()
    ? 'Revenir au tableau de bord'
    : "Revenir à l'accueil";
}
