import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

/**
 * Choix d'un nouveau mot de passe
 * ------------------------------------------------------------------
 * Le jeton arrive dans l'URL : /reset-password?token=…
 *
 * Une fois le mot de passe changé, le serveur ferme TOUTES les
 * sessions ouvertes de ce compte. Si quelqu'un s'y était introduit,
 * il perd l'accès à l'instant même.
 */
@Component({
  selector: 'app-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.page.html',
})
export class ResetPasswordPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly token = this.route.snapshot.queryParamMap.get('token') ?? '';

  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly isDone = signal(false);

  protected readonly form = this.formBuilder.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(10)]],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.auth.resetPassword(this.token, this.form.getRawValue().password).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.isDone.set(true);

        // Petite pause pour que l'utilisateur lise la confirmation
        // avant d'être renvoyé vers la connexion.
        setTimeout(() => void this.router.navigate(['/login']), 2500);
      },
      error: (error: HttpErrorResponse) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(
          error.error?.message ?? 'Ce lien est invalide ou a expiré.',
        );
      },
    });
  }
}
