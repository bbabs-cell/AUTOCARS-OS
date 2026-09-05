import { Component, computed, inject } from '@angular/core';

import { ErrorStateComponent } from '../../shared/ui/error-state.component';
import { AuthService } from '../../core/services/auth.service';

/**
 * Accès refusé (403)
 * ==================================================================
 * CET ÉCRAN RÉPARE UN DÉFAUT CONNU DEPUIS LE LOT 4.
 * ==================================================================
 *
 * La barre latérale masque les modules qu'un rôle n'a pas le droit
 * d'ouvrir — mais taper /cash dans la barre d'adresse affichait
 * l'écran quand même, vide, puisque le serveur ne renvoyait aucune
 * donnée. Le commentaire du composant de navigation le disait déjà :
 * « l'écran resterait vide ».
 *
 * Un écran vide ne dit pas « vous n'avez pas le droit ». Il dit
 * « c'est cassé », ou « il n'y a rien aujourd'hui » — deux
 * conclusions fausses, et l'une d'elles se termine par un appel au
 * support.
 *
 * ------------------------------------------------------------------
 * CE N'EST TOUJOURS PAS UNE PROTECTION
 *
 * Le garde de route qui mène ici ne protège rien : la vraie barrière
 * est le serveur, qui refuse la requête quoi qu'il arrive. Cet écran
 * ne fait que DIRE ce qui se passe, au lieu de le laisser deviner.
 */
@Component({
  selector: 'app-forbidden-page',
  imports: [ErrorStateComponent],
  template: `
    <ac-error-state
      icon="lock"
      title="Cet écran ne vous est pas ouvert"
      [text]="explanation()"
      hint="Ce n'est pas une panne : les droits sont attribués par le propriétaire
            de l'entreprise, et le serveur les vérifie à chaque requête."
      code="403"
    />
  `,
})
export class ForbiddenPage {
  private readonly auth = inject(AuthService);

  protected readonly explanation = computed(() => {
    const role = this.auth.role();
    const labels: Record<string, string> = {
      ADMIN: 'administrateur',
      MANAGER: 'manager',
      EMPLOYEE: 'employé',
    };

    const roleLabel = role ? labels[role] : null;

    // On nomme le rôle plutôt que la permission manquante :
    // « il vous manque payments.journal » ne veut rien dire pour
    // quelqu'un qui tient un comptoir.
    return roleLabel
      ? `Votre compte est un compte ${roleLabel}, et cet écran demande des droits `
        + "qu'il n'a pas. Demandez-les au propriétaire de l'entreprise s'il vous "
        + 'en faut pour travailler.'
      : "Cet écran demande des droits que votre compte n'a pas.";
  });
}
