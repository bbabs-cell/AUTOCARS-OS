import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import { Dashboard } from '../models/dashboard.model';

/** Le premier écran de la journée. */
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  dashboard(stationId?: number): Observable<Dashboard> {
    const query = stationId ? `?station_id=${stationId}` : '';

    return this.http
      .get<ApiResponse<Dashboard>>(`${this.api}/dashboard${query}`)
      .pipe(map((response) => response.data));
  }
}
