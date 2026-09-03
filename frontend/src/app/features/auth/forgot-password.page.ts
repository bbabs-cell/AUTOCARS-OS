import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

/**
 * Mot de passe oublié
 * ------------------------------------------------------------------
 * L'API répond TOUJOURS la même chose, que le compte existe ou non.
 * Sinon ce formulaire deviendrait un moyen commode de découvrir
 * quelles adresses sont enregistrées — première étape d'une attaque
 * ciblée.
 *
 * L'envoi d'e-mail n'est pas encore branché (lot 15). En
 * développement, l'API renvoie le lien directement pour permettre de
 * tester le parcours de bout en bout.
 */
@Component({
  selector: 'app-forgot-password-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.page.html',
})
export class ForgotPasswordPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);

  protected readonly isSubmitting = signal(false);
  protected readonly isSent = signal(false);
  protected readonly debugLink = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      return;
    }

    this.isSubmitting.set(true);

    this.auth.forgotPassword(this.form.getRawValue().email).subscribe({
      next: (response) => {
        this.isSubmitting.set(false);
        this.isSent.set(true);
        this.debugLink.set(response.data?.debug_reset_link ?? null);
      },
      // Même en cas d'erreur réseau on affiche le message de succès :
      // ne rien laisser deviner sur l'existence du compte.
      error: () => {
        this.isSubmitting.set(false);
        this.isSent.set(true);
      },
    });
  }
}
