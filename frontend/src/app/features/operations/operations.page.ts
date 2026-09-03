import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { StatusBadgeComponent } from '../../shared/ui/status-badge.component';
import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { CrmService } from '../../core/services/crm.service';
import { OperationService } from '../../core/services/operation.service';
import { Service } from '../../core/models/catalog.model';
import { Vehicle } from '../../core/models/crm.model';
import { Operation } from '../../core/models/operation.model';

/**
 * L'accueil des véhicules
 * ------------------------------------------------------------------
 * L'ÉCRAN LE PLUS UTILISÉ DU PRODUIT.
 *
 * Il répond à deux questions, dans cet ordre :
 *   « qu'est-ce qui est en cours dans ma station ? »
 *   « comment j'enregistre le véhicule qui vient d'arriver ? »
 *
 * Par défaut, on n'affiche QUE les dossiers actifs. Un dossier
 * restitué la semaine dernière n'a rien à faire sur l'écran du
 * comptoir : il encombre la vue et fait rater celui qui attend.
 * L'historique complet reste accessible d'un clic.
 */
@Component({
  selector: 'app-operations-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AmountPipe,
    RelativeDatePipe,
    EmptyStateComponent,
    PageHeaderComponent,
    StatusBadgeComponent,
  ],
  templateUrl: './operations.page.html',
})
export class OperationsPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly operationService = inject(OperationService);
  private readonly crm = inject(CrmService);
  private readonly catalog = inject(CatalogService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly operations = signal<Operation[]>([]);
  protected readonly counts = signal<Record<string, number>>({});
  protected readonly searchTerm = signal('');

  /**
   * Vue par défaut : ce qui occupe réellement la station.
   * Le basculement vers l'historique est explicite, jamais subi.
   */
  protected readonly onlyActive = signal(true);

  protected readonly isFormOpen = signal(false);
  protected readonly vehicles = signal<Vehicle[]>([]);
  protected readonly services = signal<Service[]>([]);

  protected readonly hasSearch = computed(() => this.searchTerm().trim() !== '');

  /** Le récapitulatif affiché en haut : trois chiffres, pas huit. */
  protected readonly waiting = computed(() => this.counts()['WAITING'] ?? 0);
  protected readonly inStation = computed(() =>
    ['IN_PROGRESS', 'INSPECTION', 'WASHING', 'QUALITY_CHECK'].reduce(
      (total, status) => total + (this.counts()[status] ?? 0),
      0,
    ),
  );
  protected readonly ready = computed(() => this.counts()['READY'] ?? 0);

  /**
   * La prestation choisie, pour afficher son prix avant validation.
   * Annoncer le prix AVANT d'ouvrir le dossier évite la discussion
   * la plus pénible du comptoir : celle qui a lieu à la restitution.
   */
  protected readonly selectedService = signal<Service | null>(null);

  private readonly searchInput = new Subject<string>();

  protected readonly form = this.formBuilder.nonNullable.group({
    vehicle_id: [0, [Validators.required, Validators.min(1)]],
    service_id: [0, [Validators.required, Validators.min(1)]],
    priority: [0],
    notes: [''],
  });

  constructor() {
    this.searchInput
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          this.isLoading.set(true);

          return this.operationService.operations({
            onlyActive: this.onlyActive(),
            search: term,
          });
        }),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (result) => {
          this.operations.set(result.operations);
          this.counts.set(result.counts);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.errorMessage.set('Le chargement des dossiers a échoué.');
        },
      });

    this.load();

    // Le formulaire d'accueil ne propose que les prestations ACTIVES :
    // une prestation retirée du catalogue ne doit plus être vendue.
    this.catalog.services(true).subscribe((services) => this.services.set(services));
    this.crm.vehicles().subscribe((vehicles) => this.vehicles.set(vehicles));
  }

  protected load(): void {
    this.searchInput.next(this.searchTerm());
  }

  protected onSearch(value: string): void {
    this.searchTerm.set(value);
    this.searchInput.next(value);
  }

  protected toggleScope(): void {
    this.onlyActive.update((value) => !value);
    // distinctUntilChanged filtrerait un terme identique : on force
    // le rechargement en passant par une valeur volontairement
    // différente puis la vraie.
    this.searchInput.next(this.searchTerm() + ' ');
    this.searchInput.next(this.searchTerm());
  }

  // --- Accueil d'un véhicule -----------------------------------------

  protected openForm(): void {
    this.form.reset({ vehicle_id: 0, service_id: 0, priority: 0, notes: '' });
    this.selectedService.set(null);
    this.fieldErrors.set({});
    this.isFormOpen.set(true);
  }

  protected closeForm(): void {
    this.isFormOpen.set(false);
  }

  protected onServiceChange(value: string): void {
    const service = this.services().find((item) => item.id === Number(value)) ?? null;
    this.selectedService.set(service);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();

      return;
    }

    // La station vient de la SESSION, pas d'un champ de formulaire.
    // L'employé travaille là où il est rattaché ; le serveur revérifie
    // ce rattachement de toute façon.
    const stationId = this.auth.user()?.station_ids[0] ?? 0;

    if (stationId === 0) {
      this.errorMessage.set(
        "Votre compte n'est rattaché à aucune station. Contactez votre responsable.",
      );

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const value = this.form.getRawValue();

    this.operationService
      .createOperation({
        vehicle_id: Number(value.vehicle_id),
        service_id: Number(value.service_id),
        station_id: stationId,
        priority: Number(value.priority),
        notes: value.notes || null,
      })
      .subscribe({
        next: (result) => {
          this.isSaving.set(false);
          this.isFormOpen.set(false);

          // On enchaîne directement sur le dossier : l'étape suivante
          // est l'inspection d'entrée, et la faire tout de suite est
          // ce qui protège la station.
          void this.router.navigate(['/operations', result.operation.id]);
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving.set(false);

          if (error.status === 422 && error.error?.errors) {
            this.fieldErrors.set(error.error.errors);

            return;
          }

          // 409 : un dossier est déjà ouvert sur ce véhicule. Le
          // message du serveur porte la référence du dossier existant,
          // c'est l'information utile.
          this.fieldErrors.set({
            vehicle_id: error.error?.message ?? "L'ouverture du dossier a échoué.",
          });
        },
      });
  }
}
