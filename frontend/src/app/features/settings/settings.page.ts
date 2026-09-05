import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { CatalogService } from '../../core/services/catalog.service';
import { Organization } from '../../core/models/catalog.model';

/**
 * Les paramètres de l'entreprise
 * ==================================================================
 * TROIS CHAMPS QU'ON MODIFIE, TROIS QU'ON EXPLIQUE.
 * ==================================================================
 *
 * L'écran est court, et c'est volontaire. Un écran de paramètres qui
 * grossit sans raison devient l'endroit où l'on range ce qu'on ne
 * sait pas placer ailleurs — et personne n'y trouve plus rien.
 *
 * ------------------------------------------------------------------
 * POURQUOI AFFICHER CE QU'ON NE PEUT PAS CHANGER ?
 *
 * Parce que la devise, le pays et le fuseau horaire sont des
 * informations que le gérant a le droit de connaître, et qu'il
 * cherchera. Les cacher ne les rendrait pas moins vraies : il
 * ouvrirait un ticket au support pour demander ce qui est écrit là.
 *
 * Et chacun porte sa raison, à côté de sa valeur. « Pourquoi ne
 * puis-je pas changer ma devise ? » a une réponse — les montants sont
 * des entiers de francs, et basculer en euro les diviserait par cent
 * sans rien convertir. Un champ grisé sans explication ressemble à un
 * défaut ; avec sa raison, c'est une décision.
 */
@Component({
  selector: 'app-settings-page',
  imports: [ReactiveFormsModule, PageHeaderComponent, RouterLink],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly catalog = inject(CatalogService);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly noticeMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly organization = signal<Organization | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    phone: [''],
    email: [''],
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);

    this.catalog.organization().subscribe({
      next: (organization) => {
        this.organization.set(organization);
        this.form.reset({
          name: organization.name,
          phone: organization.phone ?? '',
          email: organization.email ?? '',
        });
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set('Le chargement des paramètres a échoué.');
      },
    });
  }

  protected submit(): void {
    if (this.form.invalid || this.isSaving()) {
      this.form.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.noticeMessage.set(null);
    this.fieldErrors.set({});

    this.catalog.updateOrganization(this.form.getRawValue()).subscribe({
      next: (organization) => {
        this.organization.set(organization);
        this.isSaving.set(false);
        this.noticeMessage.set('Paramètres enregistrés.');
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.fieldErrors.set(error.error?.errors ?? {});

        if (Object.keys(error.error?.errors ?? {}).length === 0) {
          this.errorMessage.set(error.error?.message ?? "L'enregistrement a échoué.");
        }
      },
    });
  }

  /** « Franc CFA (XOF) » plutôt que « XOF » tout seul. */
  protected currencyLabel(code: string): string {
    const known: Record<string, string> = {
      XOF: 'Franc CFA (XOF)',
      XAF: 'Franc CFA BEAC (XAF)',
      GNF: 'Franc guinéen (GNF)',
    };

    return known[code] ?? code;
  }

  protected countryLabel(code: string): string {
    const known: Record<string, string> = {
      SN: 'Sénégal',
      ML: 'Mali',
      CI: "Côte d'Ivoire",
      GN: 'Guinée',
      GM: 'Gambie',
      BF: 'Burkina Faso',
    };

    return known[code] ?? code;
  }
}
