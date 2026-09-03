import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { AvatarComponent } from '../../shared/ui/avatar.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { CrmService } from '../../core/services/crm.service';
import { Customer, PhoneMatch } from '../../core/models/crm.model';

/**
 * Les clients de la station
 * ------------------------------------------------------------------
 * LA RECHERCHE EST LA FONCTION PRINCIPALE, pas la liste.
 *
 * Au comptoir, un client se présente et l'employé doit le retrouver
 * avant qu'il n'ait fini de sortir ses clés. S'il n'y arrive pas, il
 * ressaisit tout — et crée un doublon qui éparpille l'historique.
 *
 * D'où le champ de recherche mis en avant, et le « debounce » de
 * 300 ms : on attend une courte pause dans la frappe avant
 * d'interroger le serveur. Sans lui, taper « Diallo » enverrait six
 * requêtes dont cinq inutiles — coûteux sur une connexion mobile
 * irrégulière.
 */
@Component({
  selector: 'app-customers-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AmountPipe,
    RelativeDatePipe,
    AvatarComponent,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './customers.page.html',
})
export class CustomersPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly crm = inject(CrmService);
  private readonly router = inject(Router);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly customers = signal<Customer[]>([]);
  protected readonly searchTerm = signal('');

  protected readonly isFormOpen = signal(false);
  protected readonly editing = signal<Customer | null>(null);

  /** Clients partageant le numéro en cours de saisie. */
  protected readonly phoneMatches = signal<PhoneMatch[]>([]);

  protected readonly hasSearch = computed(() => this.searchTerm().trim() !== '');

  private readonly searchInput = new Subject<string>();
  private readonly phoneInput = new Subject<string>();

  protected readonly form = this.formBuilder.nonNullable.group({
    first_name: ['', [Validators.required, Validators.maxLength(80)]],
    last_name: ['', [Validators.required, Validators.maxLength(80)]],
    phone: ['', [Validators.required]],
    email: [''],
    address: [''],
    notes: [''],
  });

  constructor() {
    // Recherche : on attend une pause de 300 ms et on ignore les
    // frappes qui ne changent rien (une flèche, par exemple).
    this.searchInput
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term) => {
          this.isLoading.set(true);

          return this.crm.customers(term);
        }),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (customers) => {
          this.customers.set(customers);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.errorMessage.set('La recherche a échoué.');
        },
      });

    // Vérification du doublon pendant la saisie du numéro.
    this.phoneInput
      .pipe(
        debounceTime(400),
        distinctUntilChanged(),
        switchMap((phone) => this.crm.checkPhone(phone)),
        takeUntilDestroyed(),
      )
      .subscribe({
        next: (matches) => this.phoneMatches.set(matches),
        error: () => this.phoneMatches.set([]),
      });

    this.load();
  }

  protected load(): void {
    this.searchInput.next(this.searchTerm());
  }

  protected onSearch(value: string): void {
    this.searchTerm.set(value);
    this.searchInput.next(value);
  }

  protected onPhoneChange(value: string): void {
    // On n'interroge le serveur qu'à partir de 8 chiffres : en
    // dessous, la réponse serait trop large pour signifier quelque
    // chose.
    const digits = value.replace(/\D/g, '');

    if (digits.length < 8) {
      this.phoneMatches.set([]);

      return;
    }

    this.phoneInput.next(value);
  }

  // --- Formulaire ---------------------------------------------------

  protected openCreate(): void {
    this.editing.set(null);
    this.form.reset();
    this.phoneMatches.set([]);
    this.fieldErrors.set({});
    this.isFormOpen.set(true);
  }

  protected openEdit(customer: Customer, event: Event): void {
    // La ligne entière est un lien vers la fiche : on empêche la
    // navigation quand on clique le bouton « modifier ».
    event.stopPropagation();
    event.preventDefault();

    this.editing.set(customer);
    this.form.setValue({
      first_name: customer.first_name,
      last_name: customer.last_name,
      phone: customer.phone,
      email: customer.email ?? '',
      address: customer.address ?? '',
      notes: customer.notes ?? '',
    });
    this.phoneMatches.set([]);
    this.fieldErrors.set({});
    this.isFormOpen.set(true);
  }

  protected closeForm(): void {
    this.isFormOpen.set(false);
  }

  protected useExisting(match: PhoneMatch): void {
    this.closeForm();
    void this.router.navigate(['/customers', match.id]);
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
      ? this.crm.updateCustomer(editing.id, payload)
      : this.crm.createCustomer(payload);

    request.subscribe({
      next: (customer) => {
        this.isSaving.set(false);
        this.isFormOpen.set(false);

        // Après création, on ouvre directement la fiche : au comptoir,
        // la suite logique est d'enregistrer son véhicule.
        if (!editing) {
          void this.router.navigate(['/customers', customer.id]);

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

        this.fieldErrors.set({ last_name: error.error?.message ?? "L'enregistrement a échoué." });
      },
    });
  }
}
