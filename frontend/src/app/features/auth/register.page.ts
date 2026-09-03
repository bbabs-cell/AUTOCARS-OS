import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

/**
 * Page d'inscription
 * ------------------------------------------------------------------
 * Crée l'entreprise et son premier compte administrateur.
 *
 * Le formulaire est volontairement COURT : nom de la station, nom de
 * la personne, e-mail, mot de passe. Tout le reste (adresse,
 * horaires, prestations, équipe) est demandé pendant l'installation
 * guidée, une fois le compte créé.
 *
 * Un formulaire d'inscription de quinze champs fait fuir. Ce qui
 * compte ici, c'est que la personne entre dans le produit.
 */
@Component({
  selector: 'app-register-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.page.html',
})
export class RegisterPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /** Erreurs renvoyées par l'API, champ par champ. */
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly form = this.formBuilder.nonNullable.group({
    organization_name: ['', [Validators.required, Validators.maxLength(150)]],
    first_name: ['', [Validators.required, Validators.maxLength(80)]],
    last_name: ['', [Validators.required, Validators.maxLength(80)]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    // Même règle que le serveur : la longueur protège mieux que la
    // complexité. Voir Validator::password() côté backend.
    password: ['', [Validators.required, Validators.minLength(10)]],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);
    this.fieldErrors.set({});

    this.auth.register(this.form.getRawValue()).subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: (error: HttpErrorResponse) => {
        this.isSubmitting.set(false);

        // 422 : la validation du serveur a refusé un ou plusieurs
        // champs. On les affiche sous les champs concernés plutôt
        // qu'en bloc, pour que l'utilisateur sache quoi corriger.
        if (error.status === 422 && error.error?.errors) {
          this.fieldErrors.set(error.error.errors);

          return;
        }

        this.errorMessage.set(
          error.status === 0
            ? "Impossible de joindre le serveur. Vérifie que l'API est démarrée."
            : (error.error?.message ?? "La création du compte a échoué."),
        );
      },
    });
  }
}
