import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import {
  OnboardingStatus,
  Service,
  ServicePayload,
  Station,
  TeamMember,
  TeamMemberPayload,
} from '../models/catalog.model';

/**
 * Configuration de la station
 * ------------------------------------------------------------------
 * Regroupe station, prestations, équipe et installation guidée.
 *
 * POURQUOI UN SEUL SERVICE POUR QUATRE RESSOURCES ?
 * Parce qu'elles ne servent qu'à un seul écran — l'installation
 * guidée — et à la page Prestations. Créer quatre fichiers de vingt
 * lignes chacun ajouterait de la navigation sans rien clarifier.
 *
 * On les séparera le jour où un module aura besoin de l'un sans les
 * autres. Découper trop tôt coûte aussi cher que pas assez.
 */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  /** On extrait `data` pour que les composants ignorent l'enveloppe. */
  private unwrap<T>(source: Observable<ApiResponse<T>>): Observable<T> {
    return source.pipe(map((response) => response.data));
  }

  // --- Installation guidée -----------------------------------------

  onboardingStatus(): Observable<OnboardingStatus> {
    return this.unwrap(this.http.get<ApiResponse<OnboardingStatus>>(`${this.api}/onboarding/status`));
  }

  completeOnboarding(): Observable<null> {
    return this.unwrap(this.http.post<ApiResponse<null>>(`${this.api}/onboarding/complete`, {}));
  }

  // --- Station -------------------------------------------------------

  stations(): Observable<Station[]> {
    return this.unwrap(this.http.get<ApiResponse<Station[]>>(`${this.api}/stations`));
  }

  updateStation(id: number, station: Partial<Station>): Observable<Station> {
    return this.unwrap(this.http.put<ApiResponse<Station>>(`${this.api}/stations/${id}`, station));
  }

  // --- Prestations ---------------------------------------------------

  services(onlyActive = false): Observable<Service[]> {
    const query = onlyActive ? '?only_active=1' : '';

    return this.unwrap(this.http.get<ApiResponse<Service[]>>(`${this.api}/services${query}`));
  }

  createService(payload: ServicePayload): Observable<Service> {
    return this.unwrap(this.http.post<ApiResponse<Service>>(`${this.api}/services`, payload));
  }

  updateService(id: number, payload: ServicePayload): Observable<Service> {
    return this.unwrap(this.http.put<ApiResponse<Service>>(`${this.api}/services/${id}`, payload));
  }

  /**
   * Active ou désactive. On ne SUPPRIME jamais une prestation :
   * elle est référencée par les opérations passées, et sa disparition
   * trouerait l'historique.
   */
  toggleServiceStatus(id: number): Observable<Service> {
    return this.unwrap(this.http.put<ApiResponse<Service>>(`${this.api}/services/${id}/status`, {}));
  }

  // --- Équipe ---------------------------------------------------------

  team(): Observable<TeamMember[]> {
    return this.unwrap(this.http.get<ApiResponse<TeamMember[]>>(`${this.api}/team`));
  }

  addTeamMember(payload: TeamMemberPayload): Observable<{ id: number }> {
    return this.unwrap(this.http.post<ApiResponse<{ id: number }>>(`${this.api}/team`, payload));
  }
}
