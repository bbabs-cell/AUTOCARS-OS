import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import { OperationStatus } from '../models/operation-status.model';
import {
  Inspection,
  InspectionHistoryEntry,
  InspectionPayload,
  InspectionPhoto,
  InspectionSummary,
  Operation,
  OperationPayload,
  PhotoPosition,
  ReleaseCheckItem,
  ReleasePayload,
} from '../models/operation.model';

/**
 * Opérations, inspections et restitution
 * ------------------------------------------------------------------
 * Le service du parcours d'un véhicule.
 *
 * DEUX APPELS SORTENT DE L'ORDINAIRE, ET C'EST VOULU :
 *
 * 1. `uploadPhoto` envoie un FormData, pas du JSON. Encoder une image
 *    en base64 dans du JSON l'alourdit d'un tiers ; sur une connexion
 *    mobile, ce tiers se compte en secondes.
 *
 * 2. `photoBlobUrl` télécharge la photo puis fabrique une URL locale.
 *    On ne peut pas écrire <img src="/api/photos/42"> : le navigateur
 *    n'ajoute pas l'en-tête Authorization sur les images, la requête
 *    partirait sans jeton et reviendrait en 401. Ce détour est le
 *    prix à payer pour que les preuves ne soient pas accessibles à
 *    quiconque devine une adresse — et c'est un prix qui vaut la
 *    peine d'être payé.
 */
@Injectable({ providedIn: 'root' })
export class OperationService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  private unwrap<T>(source: Observable<ApiResponse<T>>): Observable<T> {
    return source.pipe(map((response) => response.data));
  }

  // --- Opérations ----------------------------------------------------

  /**
   * @param onlyActive n'afficher que ce qui occupe réellement la
   *                   station. C'est la vue du comptoir : un dossier
   *                   restitué la semaine dernière n'y a pas sa place.
   */
  operations(
    options: { onlyActive?: boolean; search?: string; stationId?: number; vehicleId?: number } = {},
  ): Observable<{ operations: Operation[]; counts: Record<string, number> }> {
    const parameters = new URLSearchParams();

    if (options.onlyActive) {
      parameters.set('active', '1');
    }

    if (options.search) {
      parameters.set('search', options.search);
    }

    if (options.stationId) {
      parameters.set('station_id', String(options.stationId));
    }

    if (options.vehicleId) {
      parameters.set('vehicle_id', String(options.vehicleId));
    }

    const query = parameters.toString() ? `?${parameters}` : '';

    return this.unwrap(
      this.http.get<ApiResponse<{ operations: Operation[]; counts: Record<string, number> }>>(
        `${this.api}/operations${query}`,
      ),
    );
  }

  operation(id: number): Observable<{ operation: Operation; inspections: InspectionSummary[] }> {
    return this.unwrap(
      this.http.get<ApiResponse<{ operation: Operation; inspections: InspectionSummary[] }>>(
        `${this.api}/operations/${id}`,
      ),
    );
  }

  createOperation(payload: OperationPayload): Observable<{ operation: Operation }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ operation: Operation }>>(`${this.api}/operations`, payload),
    );
  }

  /**
   * Fait avancer un dossier.
   *
   * Le serveur revérifie la transition, la présence de l'inspection
   * d'entrée et l'état du règlement. Ce que l'interface a affiché ne
   * l'engage pas : masquer un bouton n'est pas une protection.
   */
  changeStatus(id: number, status: OperationStatus): Observable<{ operation: Operation }> {
    return this.unwrap(
      this.http.put<ApiResponse<{ operation: Operation }>>(`${this.api}/operations/${id}/status`, {
        status,
      }),
    );
  }

  // --- Restitution ---------------------------------------------------

  releaseCheck(id: number): Observable<{ operation: Operation; checklist: ReleaseCheckItem[] }> {
    return this.unwrap(
      this.http.get<ApiResponse<{ operation: Operation; checklist: ReleaseCheckItem[] }>>(
        `${this.api}/operations/${id}/release-check`,
      ),
    );
  }

  release(id: number, payload: ReleasePayload): Observable<{ operation: Operation }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ operation: Operation }>>(
        `${this.api}/operations/${id}/release`,
        payload,
      ),
    );
  }

  // --- Inspections ---------------------------------------------------

  createInspection(
    operationId: number,
    payload: InspectionPayload,
  ): Observable<{ inspection: Inspection }> {
    return this.unwrap(
      this.http.post<ApiResponse<{ inspection: Inspection }>>(
        `${this.api}/operations/${operationId}/inspections`,
        payload,
      ),
    );
  }

  inspection(id: number): Observable<{ inspection: Inspection }> {
    return this.unwrap(
      this.http.get<ApiResponse<{ inspection: Inspection }>>(`${this.api}/inspections/${id}`),
    );
  }

  vehicleInspections(vehicleId: number): Observable<{ inspections: InspectionHistoryEntry[] }> {
    return this.unwrap(
      this.http.get<ApiResponse<{ inspections: InspectionHistoryEntry[] }>>(
        `${this.api}/vehicles/${vehicleId}/inspections`,
      ),
    );
  }

  /**
   * Envoie UNE photo.
   *
   * Une par une, jamais les cinq d'un coup : sur une connexion qui
   * coupe, un envoi groupé perd tout et l'employé recommence. Envoyée
   * séparément, chaque photo est acquise dès qu'elle est passée.
   *
   * On ne pose PAS d'en-tête Content-Type : le navigateur doit le
   * calculer lui-même pour y insérer la frontière du multipart. Le
   * fixer à la main casserait l'envoi.
   */
  uploadPhoto(
    inspectionId: number,
    file: Blob,
    position: PhotoPosition,
    filename = 'photo.webp',
  ): Observable<{ photo: InspectionPhoto }> {
    const form = new FormData();
    form.append('photo', file, filename);
    form.append('position', position);

    return this.unwrap(
      this.http.post<ApiResponse<{ photo: InspectionPhoto }>>(
        `${this.api}/inspections/${inspectionId}/photos`,
        form,
      ),
    );
  }

  /**
   * Récupère une photo sous forme d'URL affichable dans un <img>.
   *
   * L'appelant DOIT libérer l'URL avec URL.revokeObjectURL() quand
   * l'image disparaît de l'écran : sans cela le navigateur garde
   * l'image en mémoire pour toute la durée de la session, et une
   * consultation d'historique un peu longue finit par le ralentir.
   */
  photoBlobUrl(photoUrl: string): Observable<string> {
    // photoUrl vaut « /api/photos/42 » : on retire le préfixe /api
    // déjà présent dans environment.apiUrl pour ne pas le doubler.
    const path = photoUrl.replace(/^\/api/, '');

    return this.http
      .get(`${this.api}${path}`, { responseType: 'blob' })
      .pipe(map((blob) => URL.createObjectURL(blob)));
  }
}
