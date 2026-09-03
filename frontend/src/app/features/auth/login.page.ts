import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

/**
 * Page de connexion
 * ------------------------------------------------------------------
 * Utilise les Reactive Forms : le formulaire est décrit en
 * TypeScript, pas dans le gabarit. On peut ainsi le tester sans
 * afficher quoi que ce soit, et les règles de validation sont
 * lisibles au même endroit.
 *
 * Les messages d'erreur du serveur sont affichés tels quels : c'est
 * lui qui décide quoi dire, notamment pour ne jamais révéler si une
 * adresse existe ou non.
 */
@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.page.html',
})
export class LoginPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected submit(): void {
    // Un formulaire invalide n'est pas envoyé, mais on marque les
    // champs comme « touchés » pour que les messages apparaissent :
    // sinon l'utilisateur clique et rien ne se passe visiblement.
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    this.auth.login(this.form.getRawValue()).subscribe({
      next: () => {
        // On revient là où l'utilisateur voulait aller avant d'être
        // renvoyé vers la connexion.
        const redirect = this.route.snapshot.queryParamMap.get('redirect') ?? '/';
        void this.router.navigateByUrl(redirect);
      },
      error: (error: HttpErrorResponse) => {
        this.isSubmitting.set(false);
        this.errorMessage.set(
          error.status === 0
            ? "Impossible de joindre le serveur. Vérifie que l'API est démarrée."
            : (error.error?.message ?? 'La connexion a échoué.'),
        );
      },
    });
  }
}
