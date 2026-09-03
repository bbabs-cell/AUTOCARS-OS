import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { CrmService } from '../../core/services/crm.service';
import {
  Customer,
  VEHICLE_TYPE_LABELS,
  Vehicle,
  VehicleType,
} from '../../core/models/crm.model';

/**
 * Les véhicules
 * ------------------------------------------------------------------
 * Même logique que les clients : la recherche prime sur la liste.
 *
 * Particularité : la plaque est cherchée sous sa forme NORMALISÉE.
 * L'employé peut taper « dk 1234 aa », « DK-1234-AA » ou « dk1234aa »,
 * il retrouve le même véhicule. Sans cela il conclurait que le
 * véhicule n'est pas enregistré, en créerait un second, et
 * l'historique se scinderait en deux — exactement ce que le produit
 * doit empêcher.
 */
@Component({
  selector: 'app-vehicles-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    RelativeDatePipe,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './vehicles.page.html',
})
export class VehiclesPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly crm = inject(CrmService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly typeLabels = VEHICLE_TYPE_LABELS;
  protected readonly types = Object.keys(VEHICLE_TYPE_LABELS) as VehicleType[];

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly vehicles = signal<Vehicle[]>([]);
  protected readonly customers = signal<Customer[]>([]);
  protected readonly searchTerm = signal('');

  protected readonly isFormOpen = signal(false);
  protected readonly editing = signal<Vehicle | null>(null);

  protected readonly hasSearch = computed(() => this.searchTerm().trim() !== '');

  private readonly searchInput = new Subject<string>();

  protected readonly form = this.formBuilder.nonNullable.group({
    plate_number: ['', [Validators.required]],
    customer_id: [0, [Validators.required, Validators.min(1)]],
    brand: ['', [Validators.required]],
    model: ['', [Validators.required]],
    color: [''],
    vehicle_type: ['CAR' as VehicleType, [Validators.required]],
    notes: [''],
  });

  constructor() {
    this.searchInput
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          this.isLoading.set(true);

          return this.crm.vehicles(term);
        }),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (vehicles) => {
          this.vehicles.set(vehicles);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.errorMessage.set('La recherche a échoué.');
        },
      });

    this.load();

    // On charge la liste des clients pour le sélecteur du formulaire.
    this.crm.customers().subscribe((customers) => this.customers.set(customers));

    // Arriver depuis une fiche client avec ?customer_id=… pré-remplit
    // le formulaire : c'est l'enchaînement naturel au comptoir,
    // « ce client, ce véhicule ».
    const preselected = this.route.snapshot.queryParamMap.get('customer_id');

    if (preselected) {
      this.openCreate(Number(preselected));
    }
  }

  protected load(): void {
    this.searchInput.next(this.searchTerm());
  }

  protected onSearch(value: string): void {
    this.searchTerm.set(value);
    this.searchInput.next(value);
  }

  // --- Formulaire ---------------------------------------------------

  protected openCreate(customerId = 0): void {
    this.editing.set(null);
    this.form.reset({ customer_id: customerId, vehicle_type: 'CAR' });
    this.fieldErrors.set({});
    this.isFormOpen.set(true);
  }

  protected openEdit(vehicle: Vehicle, event: Event): void {
    event.stopPropagation();
    event.preventDefault();

    this.editing.set(vehicle);
    this.form.setValue({
      // On présente la forme LISIBLE pour la modification : personne
      // ne relit « DK1234AA » avec plaisir.
      plate_number: vehicle.plate_display,
      customer_id: vehicle.customer_id,
      brand: vehicle.brand,
      model: vehicle.model,
      color: vehicle.color ?? '',
      vehicle_type: vehicle.vehicle_type,
      notes: vehicle.notes ?? '',
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
      ? this.crm.updateVehicle(editing.id, payload)
      : this.crm.createVehicle(payload);

    request.subscribe({
      next: (vehicle) => {
        this.isSaving.set(false);
        this.isFormOpen.set(false);

        if (!editing) {
          void this.router.navigate(['/vehicles', vehicle.id]);

          return;
        }

        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);

        if (error.status === 422 && error.error?.errors) {
          this.fieldErrors.set(error.error.errors);

          return;
        }

        this.fieldErrors.set({
          plate_number: error.error?.message ?? "L'enregistrement a échoué.",
        });
      },
    });
  }
}
