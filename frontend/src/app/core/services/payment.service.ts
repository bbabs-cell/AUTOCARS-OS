import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import {
  CashSession,
  CashSessionSummary,
  CashState,
  OperationPayments,
  PaymentJournal,
  PaymentPayload,
  PaymentResult,
} from '../models/payment.model';

/**
 * Encaissements et caisse
 * ------------------------------------------------------------------
 * Ce service n'appelle QUE l'API d'AUTOCARE OS. Il ne parle à aucune
 * passerelle de paiement, et il n'y a nulle part de code qui simule
 * un paiement réussi.
 */
@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  private unwrap<T>(source: Observable<ApiResponse<T>>): Observable<T> {
    return source.pipe(map((response) => response.data));
  }

  // --- Encaissements --------------------------------------------------

  operationPayments(operationId: number): Observable<OperationPayments> {
    return this.unwrap(
      this.http.get<ApiResponse<OperationPayments>>(
        `${this.api}/operations/${operationId}/payments`,
      ),
    );
  }

  record(operationId: number, payload: PaymentPayload): Observable<PaymentResult> {
    return this.unwrap(
      this.http.post<ApiResponse<PaymentResult>>(
        `${this.api}/operations/${operationId}/payments`,
        payload,
      ),
    );
  }

  /**
   * Rembourser, c'est-à-dire contre-passer.
   * La ligne d'origine n'est pas effacée : elle est marquée
   * remboursée, et une écriture inverse est ajoutée. Les deux restent
   * visibles — on ne gomme pas une écriture comptable.
   */
  refund(paymentId: number, reason: string): Observable<{ payment: unknown }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ payment: unknown }>>(
        `${this.api}/payments/${paymentId}/refund`,
        { reason },
      ),
    );
  }

  /** Le journal des encaissements. Sans bornes, l'API renvoie aujourd'hui. */
  journal(filters: { from?: string; to?: string; method?: string } = {}): Observable<PaymentJournal> {
    const parameters = new URLSearchParams();

    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        parameters.set(key, value);
      }
    }

    const query = parameters.toString() ? `?${parameters}` : '';

    return this.unwrap(this.http.get<ApiResponse<PaymentJournal>>(`${this.api}/payments${query}`));
  }

  // --- Caisse -----------------------------------------------------------

  cashState(): Observable<CashState> {
    return this.unwrap(this.http.get<ApiResponse<CashState>>(`${this.api}/cash/current`));
  }

  openCash(openingFloat: number, notes?: string | null): Observable<{ session: CashSession }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ session: CashSession }>>(`${this.api}/cash/open`, {
        opening_float: openingFloat,
        opening_notes: notes ?? null,
      }),
    );
  }

  closeCash(countedAmount: number, notes?: string | null): Observable<{ session: CashSession }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ session: CashSession }>>(`${this.api}/cash/close`, {
        counted_amount: countedAmount,
        closing_notes: notes ?? null,
      }),
    );
  }

  cashHistory(): Observable<{ sessions: CashSessionSummary[] }> {
    return this.unwrap(
      this.http.get<ApiResponse<{ sessions: CashSessionSummary[] }>>(`${this.api}/cash/sessions`),
    );
  }
}
