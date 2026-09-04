import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import {
  Booking,
  BookingDay,
  BookingPayload,
  BookingSaved,
  BookingStatus,
} from '../models/booking.model';

/**
 * Les rendez-vous
 * ------------------------------------------------------------------
 * Contrairement au service de pointage, celui-ci ne garde AUCUN état :
 * un seul écran affiche le carnet, et il le recharge après chaque
 * action. Un signal partagé n'aurait rien servi qu'à créer un endroit
 * de plus où l'état peut être faux.
 */
@Injectable({ providedIn: 'root' })
export class BookingService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  private unwrap<T>(source: Observable<ApiResponse<T>>): Observable<T> {
    return source.pipe(map((response) => response.data));
  }

  /** La journée entière : rendez-vous, compteurs, charge, à traiter. */
  day(from: string, to: string, stationId?: number | null): Observable<BookingDay> {
    let params = new HttpParams().set('from', from).set('to', to);

    if (stationId) {
      params = params.set('station_id', String(stationId));
    }

    return this.unwrap(this.http.get<ApiResponse<BookingDay>>(`${this.api}/bookings`, { params }));
  }

  create(payload: BookingPayload): Observable<BookingSaved> {
    return this.unwrap(
      this.http.post<ApiResponse<BookingSaved>>(`${this.api}/bookings`, payload),
    );
  }

  update(id: number, payload: Partial<BookingPayload>): Observable<BookingSaved> {
    return this.unwrap(
      this.http.put<ApiResponse<BookingSaved>>(`${this.api}/bookings/${id}`, payload),
    );
  }

  /**
   * Confirmer, annuler, déclarer une absence.
   *
   * « ARRIVED » n'est PAS acceptable ici : il ouvre un dossier, et a
   * donc sa propre méthode. Le type l'interdit à la compilation, le
   * serveur le refuserait de toute façon.
   */
  changeStatus(
    id: number,
    status: Exclude<BookingStatus, 'ARRIVED' | 'SCHEDULED'>,
    reason?: string | null,
  ): Observable<{ booking: Booking }> {
    return this.unwrap(
      this.http.put<ApiResponse<{ booking: Booking }>>(`${this.api}/bookings/${id}/status`, {
        status,
        reason: reason ?? null,
      }),
    );
  }

  /** Le client est là : le rendez-vous devient un dossier. */
  arrive(id: number, vehicleId?: number | null): Observable<{ booking: Booking }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ booking: Booking }>>(`${this.api}/bookings/${id}/arrive`, {
        vehicle_id: vehicleId ?? null,
      }),
    );
  }
}
