import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import { Analytics } from '../models/analytics.model';

/**
 * Les statistiques
 * ------------------------------------------------------------------
 * UNE SEULE MÉTHODE, VOLONTAIREMENT.
 *
 * Sept appels séparés donneraient sept états qui ne se rafraîchissent
 * pas ensemble : on verrait une décomposition calculée sur mars à
 * côté d'un graphique d'avril, et personne ne comprendrait pourquoi
 * les totaux ne tombent pas. Une seule réponse, une seule période.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  load(from: string, to: string, stationId?: number | null): Observable<Analytics> {
    let params = new HttpParams().set('from', from).set('to', to);

    if (stationId) {
      params = params.set('station_id', String(stationId));
    }

    return this.http
      .get<ApiResponse<Analytics>>(`${this.api}/analytics`, { params })
      .pipe(map((response) => response.data));
  }
}
