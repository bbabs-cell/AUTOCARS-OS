import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import { Operation } from '../models/operation.model';
import {
  Subscription,
  SubscriptionOverview,
  SubscriptionPlan,
  SubscriptionPlanPayload,
  SubscriptionSalePayload,
} from '../models/subscription.model';

/** Ce que renvoie la consommation ou le retrait d'un lavage. */
export interface SubscriptionUse {
  operation: Operation;
  subscription: Subscription;
  /** Un lavage d'abonné rapporte un tampon : il a été payé d'avance. */
  loyalty_balance?: number | null;
}

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  private unwrap<T>(source: Observable<ApiResponse<T>>): Observable<T> {
    return source.pipe(map((response) => response.data));
  }

  // --- Les forfaits proposés ------------------------------------------

  plans(activeOnly = false): Observable<{ plans: SubscriptionPlan[] }> {
    const params = activeOnly ? new HttpParams().set('active', '1') : new HttpParams();

    return this.unwrap(
      this.http.get<ApiResponse<{ plans: SubscriptionPlan[] }>>(
        `${this.api}/subscriptions/plans`,
        { params },
      ),
    );
  }

  createPlan(payload: SubscriptionPlanPayload): Observable<{ plan: SubscriptionPlan }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ plan: SubscriptionPlan }>>(
        `${this.api}/subscriptions/plans`,
        payload,
      ),
    );
  }

  updatePlan(
    id: number,
    payload: SubscriptionPlanPayload,
  ): Observable<{ plan: SubscriptionPlan }> {
    return this.unwrap(
      this.http.put<ApiResponse<{ plan: SubscriptionPlan }>>(
        `${this.api}/subscriptions/plans/${id}`,
        payload,
      ),
    );
  }

  // --- Les abonnements vendus -----------------------------------------

  overview(from: string, to: string): Observable<SubscriptionOverview> {
    const params = new HttpParams().set('from', from).set('to', to);

    return this.unwrap(
      this.http.get<ApiResponse<SubscriptionOverview>>(`${this.api}/subscriptions/overview`, {
        params,
      }),
    );
  }

  list(filters: {
    customer_id?: number;
    usable?: boolean;
    search?: string;
  } = {}): Observable<{ subscriptions: Subscription[] }> {
    let params = new HttpParams();

    if (filters.customer_id) {
      params = params.set('customer_id', String(filters.customer_id));
    }

    if (filters.usable) {
      params = params.set('usable', '1');
    }

    if (filters.search) {
      params = params.set('search', filters.search);
    }

    return this.unwrap(
      this.http.get<ApiResponse<{ subscriptions: Subscription[] }>>(
        `${this.api}/subscriptions`,
        { params },
      ),
    );
  }

  /**
   * Vendre un forfait.
   *
   * L'encaissement part avec, dans la même transaction : c'est le
   * même geste au comptoir, et l'un sans l'autre laisserait soit un
   * client sans forfait, soit une station sans argent.
   */
  sell(
    payload: SubscriptionSalePayload,
  ): Observable<{ subscription: Subscription; warnings: string[] }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ subscription: Subscription; warnings: string[] }>>(
        `${this.api}/subscriptions`,
        payload,
      ),
    );
  }

  cancel(id: number, reason: string): Observable<{ subscription: Subscription }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ subscription: Subscription }>>(
        `${this.api}/subscriptions/${id}/cancel`,
        { reason },
      ),
    );
  }

  // --- Consommer un lavage --------------------------------------------

  /**
   * Décompter un lavage. Le SERVEUR choisit le forfait : celui qui
   * expire le plus tôt, dans l'intérêt du client.
   */
  use(operationId: number): Observable<SubscriptionUse> {
    return this.unwrap(
      this.http.post<ApiResponse<SubscriptionUse>>(`${this.api}/subscriptions/use`, {
        operation_id: operationId,
      }),
    );
  }

  cancelUse(operationId: number): Observable<SubscriptionUse> {
    return this.unwrap(
      this.http.post<ApiResponse<SubscriptionUse>>(
        `${this.api}/subscriptions/use/${operationId}/cancel`,
        {},
      ),
    );
  }
}
