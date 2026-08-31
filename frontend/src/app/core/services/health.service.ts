import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { ApiResponse } from '../models/api-response.model';
import { HealthStatus } from '../models/health.model';

/**
 * Service de diagnostic : interroge GET /api/health
 * ------------------------------------------------------------------
 * POURQUOI UN SERVICE ?
 * En Angular, un composant s'occupe de l'AFFICHAGE. Il ne doit pas
 * savoir comment on parle au serveur. Toute la communication HTTP est
 * donc regroupee dans des services.
 *
 * Avantages concrets :
 *   - si l'URL de l'API change, on modifie un seul fichier ;
 *   - plusieurs composants peuvent reutiliser le meme service ;
 *   - on peut tester le service sans afficher quoi que ce soit.
 *
 * `providedIn: 'root'` signifie qu'Angular cree une seule instance
 * partagee par toute l'application.
 */
@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly http = inject(HttpClient);

  /**
   * Verifie que l'API et la base de donnees repondent.
   *
   * On extrait ici le champ `data` de l'enveloppe { success, data,
   * message } pour que le composant n'ait pas a connaitre ce detail.
   */
  check(): Observable<HealthStatus> {
    return this.http
      .get<ApiResponse<HealthStatus>>(`${environment.apiUrl}/health`)
      .pipe(map((response) => response.data));
  }
}
