import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import {
  AttendanceRegister,
  CorrectionPayload,
  MyAttendance,
  TimeEntry,
} from '../models/attendance.model';

/**
 * Le pointage
 * ------------------------------------------------------------------
 * Ce service garde en mémoire l'état de MON pointage, parce que deux
 * endroits l'affichent : le bouton de l'en-tête, présent sur tous les
 * écrans, et la page du registre.
 *
 * Sans état partagé, pointer depuis la page laisserait le bouton de
 * l'en-tête afficher « Pointer mon arrivée » alors que c'est déjà
 * fait — et quelqu'un finirait par cliquer deux fois.
 */
@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  /** Mon état de pointage, partagé par tous les écrans. */
  readonly mine = signal<MyAttendance | null>(null);

  private unwrap<T>(source: Observable<ApiResponse<T>>): Observable<T> {
    return source.pipe(map((response) => response.data));
  }

  /**
   * Recharge mon état.
   *
   * Une erreur ne remonte pas : un employé sans droit de pointage —
   * cas qui n'existe pas aujourd'hui, mais qui pourrait — ne doit pas
   * voir un message rouge sur chaque écran. Le bouton disparaît, c'est
   * tout.
   */
  refreshMine(): void {
    this.unwrap(this.http.get<ApiResponse<MyAttendance>>(`${this.api}/attendance/me`)).subscribe({
      next: (state) => this.mine.set(state),
      error: () => this.mine.set(null),
    });
  }

  clockIn(stationId?: number): Observable<{ entry: TimeEntry }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ entry: TimeEntry }>>(`${this.api}/attendance/clock-in`, {
        station_id: stationId ?? null,
      }),
    ).pipe(tap(() => this.refreshMine()));
  }

  clockOut(): Observable<{ entry: TimeEntry }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ entry: TimeEntry }>>(`${this.api}/attendance/clock-out`, {}),
    ).pipe(tap(() => this.refreshMine()));
  }

  /** Le registre de l'équipe. Sans bornes, l'API renvoie le mois en cours. */
  register(filters: { from?: string; to?: string; user_id?: number } = {}): Observable<AttendanceRegister> {
    const parameters = new URLSearchParams();

    for (const [key, value] of Object.entries(filters)) {
      if (value) {
        parameters.set(key, String(value));
      }
    }

    const query = parameters.toString() ? `?${parameters}` : '';

    return this.unwrap(
      this.http.get<ApiResponse<AttendanceRegister>>(`${this.api}/attendance${query}`),
    );
  }

  correct(id: number, payload: CorrectionPayload): Observable<{ entry: TimeEntry }> {
    return this.unwrap(
      this.http.put<ApiResponse<{ entry: TimeEntry }>>(`${this.api}/attendance/${id}`, payload),
    ).pipe(tap(() => this.refreshMine()));
  }
}
