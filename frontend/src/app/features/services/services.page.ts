import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { Service } from '../../core/models/catalog.model';

/**
 * Gestion des prestations
 * ------------------------------------------------------------------
 * Premier écran de gestion complet du produit. Il sert de modèle aux
 * suivants (véhicules, clients, employés) : liste, création,
 * modification, activation — et les trois états UX obligatoires.
 *
 * LE FORMULAIRE EST DANS UNE MODALE, pas sur une page séparée. Un
 * gérant qui ajuste trois tarifs à la suite ne doit pas faire six
 * allers-retours entre deux écrans.
 */
@Component({
  selector: 'app-services-page',
  imports: [
    ReactiveFormsModule,
    AmountPipe,
    DurationPipe,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './services.page.html',
})
export class ServicesPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly catalog = inject(CatalogService);
  private readonly auth = inject(AuthService);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly services = signal<Service[]>([]);

  /** Prestation en cours de modification, ou null si création. */
  protected readonly editing = signal<Service | null>(null);
  protected readonly isFormOpen = signal(false);

  /**
   * Seuls l'administrateur et le manager modifient le catalogue.
   * L'API le vérifie de son côté — ceci ne fait qu'éviter d'afficher
   * des boutons qui renverraient une erreur 403.
   */
  protected readonly canEdit = computed(() => {
    const role = this.auth.role();

    return role === 'ADMIN' || role === 'MANAGER';
  });

  protected readonly canCreate = computed(() => this.auth.role() === 'ADMIN');

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    description: [''],
    category: [''],
    price: [0, [Validators.required, Validators.min(0)]],
    duration_minutes: [30, [Validators.required, Validators.min(1)]],
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.catalog.services().subscribe({
      next: (services) => {
        this.services.set(services);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          error.status === 0
            ? "Impossible de joindre le serveur."
            : (error.error?.message ?? 'Le chargement a échoué.'),
        );
      },
    });
  }

  // --- Formulaire ---------------------------------------------------

  protected openCreate(): void {
    this.editing.set(null);
    this.form.reset({ price: 0, duration_minutes: 30 });
    this.fieldErrors.set({});
    this.isFormOpen.set(true);
  }

  protected openEdit(service: Service): void {
    this.editing.set(service);
    this.form.setValue({
      name: service.name,
      description: service.description ?? '',
      category: service.category ?? '',
      price: service.price,
      duration_minutes: service.duration_minutes,
    });
    this.fieldErrors.set({});
    this.isFormOpen.set(true);
  }

  protected closeForm(): void {
    this.isFormOpen.set(false);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const payload = this.form.getRawValue();
    const editing = this.editing();

    const request = editing
      ? this.catalog.updateService(editing.id, payload)
      : this.catalog.createService(payload);

    request.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.isFormOpen.set(false);
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);

        if (error.status === 422 && error.error?.errors) {
          this.fieldErrors.set(error.error.errors);

          return;
        }

        this.fieldErrors.set({ name: error.error?.message ?? "L'enregistrement a échoué." });
      },
    });
  }

  /**
   * Active ou désactive. Une prestation n'est jamais supprimée : les
   * opérations passées y font référence, et sa disparition trouerait
   * l'historique.
   */
  protected toggleStatus(service: Service): void {
    this.catalog.toggleServiceStatus(service.id).subscribe({
      next: () => this.load(),
      error: () => this.errorMessage.set("Le changement de statut a échoué."),
    });
  }
}
