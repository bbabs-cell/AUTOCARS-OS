import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { PaymentService } from '../../core/services/payment.service';
import {
  CashMovements,
  CashSession,
  CashSessionSummary,
  PAYMENT_METHOD_LABELS,
  PaymentMethod,
} from '../../core/models/payment.model';

/**
 * La caisse
 * ==================================================================
 * TOUT CET ÉCRAN EXISTE POUR UN SEUL NOMBRE : L'ÉCART.
 * ==================================================================
 *
 * Le matin, on compte le fond de caisse. Le soir, on recompte. Le
 * logiciel dit ce qu'il devrait y avoir. La différence est la seule
 * information que ce module produit, et elle vaut à elle seule tout
 * le reste.
 *
 * ------------------------------------------------------------------
 * LA DÉCISION D'INTERFACE LA PLUS IMPORTANTE :
 * ON N'AFFICHE PAS LE MONTANT ATTENDU AVANT LA SAISIE.
 *
 * Montrer « il devrait y avoir 47 500 F » au-dessus du champ, c'est
 * obtenir 47 500 F comptés tous les soirs. Personne ne recompte
 * contre un chiffre déjà écrit — et l'écart, seule raison d'être de
 * ce module, disparaît à jamais.
 *
 * Le caissier compte d'abord, saisit, et découvre ensuite. C'est
 * moins confortable, et c'est exactement le but.
 */
@Component({
  selector: 'app-cash-page',
  imports: [
    ReactiveFormsModule,
    AmountPipe,
    RelativeDatePipe,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './cash.page.html',
})
export class CashPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly payments = inject(PaymentService);

  protected readonly methodLabels = PAYMENT_METHOD_LABELS;

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly session = signal<CashSession | null>(null);
  protected readonly movements = signal<CashMovements>({});
  protected readonly cashOutside = signal(0);
  protected readonly history = signal<CashSessionSummary[]>([]);

  /** Le résultat de la dernière clôture, montré une fois fermée. */
  protected readonly lastClosed = signal<CashSession | null>(null);

  protected readonly isOpen = computed(() => this.session() !== null);

  /** Les mouvements, triés pour l'affichage. */
  protected readonly movementRows = computed(() =>
    (Object.entries(this.movements()) as [PaymentMethod, { count: number; total: number }][])
      .map(([method, value]) => ({ method, ...value }))
      .sort((a, b) => b.total - a.total),
  );

  protected readonly totalCollected = computed(() =>
    this.movementRows().reduce((sum, row) => sum + row.total, 0),
  );

  protected readonly openForm = this.formBuilder.nonNullable.group({
    opening_float: [0, [Validators.required, Validators.min(0)]],
    opening_notes: [''],
  });

  protected readonly closeForm = this.formBuilder.nonNullable.group({
    counted_amount: [null as number | null, [Validators.required]],
    closing_notes: [''],
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);

    this.payments.cashState().subscribe({
      next: (state) => {
        this.session.set(state.session);
        this.movements.set(state.movements ?? {});
        this.cashOutside.set(state.cash_outside_session);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set("L'état de la caisse n'a pas pu être chargé.");
      },
    });

    this.payments.cashHistory().subscribe({
      next: (result) => this.history.set(result.sessions),
      error: () => this.history.set([]),
    });
  }

  // --- Ouverture --------------------------------------------------------

  protected openCash(): void {
    if (this.openForm.invalid) {
      this.openForm.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const value = this.openForm.getRawValue();

    this.payments.openCash(Number(value.opening_float), value.opening_notes || null).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.lastClosed.set(null);
        this.closeForm.reset({ counted_amount: null, closing_notes: '' });
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.handleError(error, 'opening_float');
      },
    });
  }

  // --- Clôture ----------------------------------------------------------

  protected closeCash(): void {
    if (this.closeForm.invalid) {
      this.closeForm.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const value = this.closeForm.getRawValue();

    this.payments
      .closeCash(Number(value.counted_amount), value.closing_notes || null)
      .subscribe({
        next: (result) => {
          this.isSaving.set(false);
          // On garde la session fermée à l'écran : le caissier doit
          // voir son écart, pas un formulaire d'ouverture vide.
          this.lastClosed.set(result.session);
          this.openForm.reset({ opening_float: 0, opening_notes: '' });
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving.set(false);
          this.handleError(error, 'counted_amount');
        },
      });
  }

  private handleError(error: HttpErrorResponse, fallbackField: string): void {
    if (error.status === 422 && error.error?.errors) {
      this.fieldErrors.set(error.error.errors);

      return;
    }

    this.fieldErrors.set({
      [fallbackField]: error.error?.message ?? "L'opération a échoué.",
    });
  }

  /**
   * Un écart, quel que soit son sens, est une anomalie.
   *
   * UN EXCÉDENT N'EST PAS UNE BONNE NOUVELLE : il signale presque
   * toujours un encaissement non saisi — c'est-à-dire une prestation
   * rendue qui n'apparaît nulle part.
   */
  protected differenceLabel(difference: number | null): string {
    if (difference === null || difference === 0) {
      return 'Le compte est juste';
    }

    return difference < 0 ? 'Il manque' : 'Il y a en trop';
  }
}
