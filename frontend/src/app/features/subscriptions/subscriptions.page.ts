import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { CrmService } from '../../core/services/crm.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { Service, Station } from '../../core/models/catalog.model';
import { Customer } from '../../core/models/crm.model';
import {
  Subscription,
  SubscriptionOverview,
  SubscriptionPlan,
} from '../../core/models/subscription.model';

/**
 * Les abonnements
 * ==================================================================
 * DES LAVAGES PAYÉS D'AVANCE.
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * L'ÉCRAN RÉPOND À TROIS QUESTIONS, DANS CET ORDRE
 *
 *   1. QUELS FORFAITS ARRIVENT À ÉCHÉANCE ? Ces clients ont payé des
 *      lavages qu'ils vont perdre. Un appel, et ils viennent les
 *      prendre — c'est le seul bloc actionnable de la page, donc il
 *      passe devant.
 *   2. QU'EST-CE QUE JE DOIS ENCORE ? La dette : des lavages
 *      encaissés il y a des mois et pas encore livrés.
 *   3. QU'EST-CE QUE JE VENDS, et à qui.
 *
 * ------------------------------------------------------------------
 * TROIS CHIFFRES QUI NE DISENT PAS LA MÊME CHOSE
 *
 *   VENDU      de l'argent réellement reçu ce mois-ci. Il est dans la
 *              recette et dans la caisse.
 *   LIVRÉ      des lavages faits ce mois-ci au titre d'un forfait.
 *              Ils ne rapportent RIEN : ils ont déjà été payés.
 *   RESTE      ce que la station doit encore. C'est une dette.
 *
 * Les afficher côte à côte est tout l'intérêt de l'écran : une
 * station qui vend beaucoup plus qu'elle ne livre accumule une dette
 * qu'elle devra honorer un jour, avec des employés qu'il faudra
 * payer ce jour-là.
 *
 * ------------------------------------------------------------------
 * CET ÉCRAN NE SERT PAS À CONSOMMER UN LAVAGE
 *
 * Comme pour la fidélité (lot 14), le décompte se fait sur le
 * DOSSIER, au comptoir. Personne n'ira ouvrir un écran séparé pendant
 * qu'un client attend ses clés.
 */
@Component({
  selector: 'app-subscriptions-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AmountPipe,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './subscriptions.page.html',
  styleUrl: './subscriptions.page.scss',
})
export class SubscriptionsPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly subscriptions = inject(SubscriptionService);
  private readonly catalog = inject(CatalogService);
  private readonly crm = inject(CrmService);
  private readonly auth = inject(AuthService);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly noticeMessage = signal<string | null>(null);
  protected readonly warnings = signal<string[]>([]);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly data = signal<SubscriptionOverview | null>(null);
  protected readonly plans = signal<SubscriptionPlan[]>([]);
  protected readonly sold = signal<Subscription[]>([]);
  protected readonly services = signal<Service[]>([]);
  protected readonly stations = signal<Station[]>([]);
  protected readonly customers = signal<Customer[]>([]);

  protected readonly editingPlan = signal<SubscriptionPlan | null>(null);
  protected readonly isPlanFormOpen = signal(false);
  protected readonly isSaleFormOpen = signal(false);
  protected readonly cancelling = signal<Subscription | null>(null);

  protected readonly expiring = computed(() => this.data()?.expiring ?? []);
  protected readonly outstanding = computed(() => this.data()?.outstanding ?? null);

  protected readonly canManage = computed(() => this.auth.can('subscriptions.manage'));
  protected readonly canSell = computed(() => this.auth.can('subscriptions.sell'));

  protected readonly filterForm = this.formBuilder.nonNullable.group({
    from: [this.firstOfMonth()],
    to: [this.today()],
  });

  protected readonly planForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    service_id: [0, [Validators.required]],
    washes: [10, [Validators.required, Validators.min(2), Validators.max(50)]],
    price: [0, [Validators.required, Validators.min(1)]],
    validity_days: [180, [Validators.required, Validators.min(7), Validators.max(730)]],
    status: ['ACTIVE' as 'ACTIVE' | 'INACTIVE'],
  });

  protected readonly saleForm = this.formBuilder.nonNullable.group({
    customer_id: [0, [Validators.required]],
    plan_id: [0, [Validators.required]],
    station_id: [0, [Validators.required]],
    method: ['CASH' as 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'OTHER'],
    notes: [''],
  });

  protected readonly cancelForm = this.formBuilder.nonNullable.group({
    // OBLIGATOIRE, contrairement à l'annulation d'un rendez-vous : ici
    // de l'argent a été encaissé, et un client qui réclame six mois
    // plus tard doit trouver une explication.
    reason: ['', [Validators.required]],
  });

  /** Ce que le client économise sur le forfait choisi. */
  protected readonly selectedPlan = computed(() => {
    const id = Number(this.saleForm.getRawValue().plan_id);

    return this.plans().find((plan) => plan.id === id) ?? null;
  });

  constructor() {
    this.load();

    this.catalog.services().subscribe({
      next: (services) => this.services.set(services.filter((s) => s.status === 'ACTIVE')),
      error: () => this.services.set([]),
    });

    this.catalog.stations().subscribe({
      next: (stations) => {
        this.stations.set(stations);

        if (stations[0]) {
          this.saleForm.patchValue({ station_id: stations[0].id });
        }
      },
      error: () => this.stations.set([]),
    });

    this.crm.customers().subscribe({
      next: (customers) => this.customers.set(customers),
      error: () => this.customers.set([]),
    });
  }

  protected load(): void {
    this.isLoading.set(true);

    const { from, to } = this.filterForm.getRawValue();

    this.subscriptions.overview(from, to).subscribe({
      next: (data) => {
        this.data.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set('Le chargement des abonnements a échoué.');
      },
    });

    this.subscriptions.plans().subscribe({
      next: (result) => this.plans.set(result.plans),
      error: () => this.plans.set([]),
    });

    this.subscriptions.list().subscribe({
      next: (result) => this.sold.set(result.subscriptions),
      error: () => this.sold.set([]),
    });
  }

  // --- Les forfaits proposés --------------------------------------------

  protected openPlanForm(plan: SubscriptionPlan | null): void {
    this.editingPlan.set(plan);
    this.isPlanFormOpen.set(true);
    this.fieldErrors.set({});

    this.planForm.reset({
      name: plan?.name ?? '',
      service_id: plan?.service_id ?? (this.services()[0]?.id ?? 0),
      washes: plan?.washes ?? 10,
      price: plan?.price ?? 0,
      validity_days: plan?.validity_days ?? 180,
      status: plan?.status ?? 'ACTIVE',
    });
  }

  protected closePlanForm(): void {
    this.isPlanFormOpen.set(false);
    this.editingPlan.set(null);
  }

  protected submitPlan(): void {
    if (this.planForm.invalid) {
      this.planForm.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const value = this.planForm.getRawValue();
    const existing = this.editingPlan();

    const payload = {
      name: value.name.trim(),
      service_id: Number(value.service_id),
      washes: Number(value.washes),
      price: Number(value.price),
      validity_days: Number(value.validity_days),
      status: value.status,
    };

    const request = existing
      ? this.subscriptions.updatePlan(existing.id, payload)
      : this.subscriptions.createPlan(payload);

    request.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.closePlanForm();
        this.noticeMessage.set(
          existing
            ? 'Forfait modifié. Les abonnements déjà vendus ne changent pas.'
            : 'Forfait créé.',
        );
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.fieldErrors.set(error.error?.errors ?? {});
        this.errorMessage.set(error.error?.message ?? "L'enregistrement a échoué.");
      },
    });
  }

  // --- Vendre -----------------------------------------------------------

  protected openSaleForm(): void {
    this.isSaleFormOpen.set(true);
    this.fieldErrors.set({});
    this.warnings.set([]);

    this.saleForm.patchValue({
      customer_id: 0,
      plan_id: this.plans().find((plan) => plan.is_active)?.id ?? 0,
      method: 'CASH',
      notes: '',
    });
  }

  protected closeSaleForm(): void {
    this.isSaleFormOpen.set(false);
  }

  protected submitSale(): void {
    if (this.saleForm.invalid) {
      this.saleForm.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const value = this.saleForm.getRawValue();

    this.subscriptions
      .sell({
        customer_id: Number(value.customer_id),
        plan_id: Number(value.plan_id),
        station_id: Number(value.station_id),
        method: value.method,
        notes: value.notes.trim() || null,
      })
      .subscribe({
        next: (result) => {
          this.isSaving.set(false);
          this.closeSaleForm();
          this.warnings.set(result.warnings ?? []);
          this.noticeMessage.set(
            `${result.subscription.plan_name} vendu à ${result.subscription.customer_name}.`,
          );
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving.set(false);
          this.fieldErrors.set(error.error?.errors ?? {});
          this.errorMessage.set(error.error?.message ?? 'La vente a échoué.');
        },
      });
  }

  // --- Annuler ----------------------------------------------------------

  protected openCancel(subscription: Subscription): void {
    this.cancelling.set(subscription);
    this.cancelForm.reset({ reason: '' });
    this.fieldErrors.set({});
  }

  protected closeCancel(): void {
    this.cancelling.set(null);
  }

  protected submitCancel(): void {
    const subscription = this.cancelling();

    if (subscription === null || this.cancelForm.invalid) {
      this.cancelForm.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);

    this.subscriptions
      .cancel(subscription.id, this.cancelForm.getRawValue().reason.trim())
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.closeCancel();
          this.noticeMessage.set(
            'Abonnement annulé. Un remboursement éventuel se fait depuis le journal des encaissements.',
          );
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving.set(false);
          this.fieldErrors.set(error.error?.errors ?? {});
          this.errorMessage.set(error.error?.message ?? "L'annulation a échoué.");
        },
      });
  }

  // --- Affichage --------------------------------------------------------

  /**
   * La couleur de l'état.
   *
   * Elle suit l'ÉTAT, jamais la position dans la liste : « périmé »
   * est rouge partout dans le produit.
   */
  protected badgeFor(state: Subscription['state']): string {
    const classes: Record<Subscription['state'], string> = {
      ACTIVE: 'ac-badge--success',
      EXPIRED: 'ac-badge--danger',
      EXHAUSTED: 'ac-badge--neutral',
      CANCELLED: 'ac-badge--cancelled',
    };

    return classes[state];
  }

  /** La part consommée d'un forfait, pour la barre de progression. */
  protected progress(subscription: Subscription): string {
    const total = Math.max(1, subscription.washes_total);

    return `${Math.round((subscription.washes_used / total) * 100)}%`;
  }

  protected dismissNotice(): void {
    this.noticeMessage.set(null);
    this.warnings.set([]);
  }

  protected dismissError(): void {
    this.errorMessage.set(null);
  }

  private today(): string {
    return this.format(new Date());
  }

  private firstOfMonth(): string {
    const now = new Date();

    return this.format(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  private format(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
  }
}
