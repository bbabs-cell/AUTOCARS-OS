import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PaymentService } from '../../core/services/payment.service';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  Payment,
  PaymentMethod,
  PaymentTotals,
} from '../../core/models/payment.model';

/**
 * Le journal des encaissements
 * ------------------------------------------------------------------
 * « Combien a-t-on fait aujourd'hui, et comment les gens ont-ils
 * payé ? »
 *
 * L'écran s'ouvre sur AUJOURD'HUI, sans qu'on ait à choisir une
 * période. Un journal qui démarre sur les six derniers mois oblige à
 * filtrer avant de pouvoir lire quoi que ce soit — alors que la
 * question posée neuf fois sur dix est celle du jour même.
 *
 * ------------------------------------------------------------------
 * CE QUI N'EXISTE PAS ICI, ET N'EXISTERA PAS TANT QU'UN COMPTE
 * MARCHAND RÉEL N'AURA PAS ÉTÉ OUVERT : le moindre appel à Wave,
 * Orange Money ou une passerelle bancaire. Les colonnes « service »
 * et « référence » contiennent ce que le caissier a recopié depuis le
 * téléphone du client, rien de plus.
 */
@Component({
  selector: 'app-payments-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AmountPipe,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './payments.page.html',
})
export class PaymentsPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(PaymentService);

  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly methods = PAYMENT_METHODS;

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly payments = signal<Payment[]>([]);
  protected readonly totals = signal<PaymentTotals | null>(null);

  /** Les moyens réellement utilisés sur la période, triés par montant. */
  protected readonly breakdown = computed(() => {
    const byMethod = this.totals()?.by_method ?? {};

    return (Object.entries(byMethod) as [PaymentMethod, number][])
      .map(([method, total]) => ({ method, total }))
      .sort((a, b) => b.total - a.total);
  });

  protected readonly form = this.formBuilder.nonNullable.group({
    from: [this.today()],
    to: [this.today()],
    method: [''],
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);

    const value = this.form.getRawValue();

    this.service
      .journal({ from: value.from, to: value.to, method: value.method })
      .subscribe({
        next: (result) => {
          this.payments.set(result.payments);
          this.totals.set(result.totals);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
          this.errorMessage.set('Le chargement du journal a échoué.');
        },
      });
  }

  /** Raccourci : les sept derniers jours, bornes comprises. */
  protected lastSevenDays(): void {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 6);

    this.form.patchValue({ from: this.format(from), to: this.format(to) });
    this.load();
  }

  protected today(): string {
    return this.format(new Date());
  }

  protected setToday(): void {
    this.form.patchValue({ from: this.today(), to: this.today() });
    this.load();
  }

  /**
   * Date au format AAAA-MM-JJ, dans le fuseau LOCAL.
   *
   * `toISOString()` convertit en UTC et donnerait la veille pour
   * quelqu'un à l'est de Greenwich passé une certaine heure — un
   * journal « du jour » qui affiche hier est le genre de bogue qu'on
   * met des semaines à comprendre.
   */
  private format(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
  }
}
