import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import { Operation } from '../models/operation.model';
import {
  LoyaltyCard,
  LoyaltyEntry,
  LoyaltyOverview,
  LoyaltyProgram,
  LoyaltyProgramPayload,
} from '../models/loyalty.model';

/** Ce que renvoie l'application ou le retrait d'une récompense. */
export interface LoyaltyRedemption {
  operation: Operation;
  card: LoyaltyCard;
  /**
   * Le serveur accepte et prévient, comme pour les rendez-vous
   * (lot 13) : « la récompense vaut 5 000 F mais le dossier n'en
   * coûte que 3 000 : le reste est perdu ».
   */
  warnings: string[];
}

@Injectable({ providedIn: 'root' })
export class LoyaltyService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  private unwrap<T>(source: Observable<ApiResponse<T>>): Observable<T> {
    return source.pipe(map((response) => response.data));
  }

  overview(from: string, to: string): Observable<LoyaltyOverview> {
    const params = new HttpParams().set('from', from).set('to', to);

    return this.unwrap(
      this.http.get<ApiResponse<LoyaltyOverview>>(`${this.api}/loyalty`, { params }),
    );
  }

  updateProgram(payload: LoyaltyProgramPayload): Observable<{ program: LoyaltyProgram }> {
    return this.unwrap(
      this.http.put<ApiResponse<{ program: LoyaltyProgram }>>(
        `${this.api}/loyalty/program`,
        payload,
      ),
    );
  }

  /** La carte d'un client, et l'historique de ses écritures. */
  card(customerId: number): Observable<{ card: LoyaltyCard; history: LoyaltyEntry[] }> {
    return this.unwrap(
      this.http.get<ApiResponse<{ card: LoyaltyCard; history: LoyaltyEntry[] }>>(
        `${this.api}/loyalty/customers/${customerId}`,
      ),
    );
  }

  /** Appliquer une récompense à un dossier. */
  redeem(operationId: number): Observable<LoyaltyRedemption> {
    return this.unwrap(
      this.http.post<ApiResponse<LoyaltyRedemption>>(`${this.api}/loyalty/redeem`, {
        operation_id: operationId,
      }),
    );
  }

  /**
   * Retirer une remise appliquée par erreur.
   *
   * Le serveur ne SUPPRIME rien : il écrit une écriture inverse. Le
   * geste reste donc lisible dans l'historique du client.
   */
  cancelRedeem(operationId: number): Observable<LoyaltyRedemption> {
    return this.unwrap(
      this.http.post<ApiResponse<LoyaltyRedemption>>(
        `${this.api}/loyalty/redeem/${operationId}/cancel`,
        {},
      ),
    );
  }
}
