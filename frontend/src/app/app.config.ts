import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';

import { routes } from './app.routes';

/**
 * Configuration globale de l'application Angular
 * ------------------------------------------------------------------
 * C'est ici qu'on declare les services disponibles partout.
 *
 * provideHttpClient(withFetch())
 *   Active HttpClient, indispensable pour appeler l'API PHP.
 *   `withFetch()` utilise l'API fetch du navigateur plutot que le
 *   vieux XMLHttpRequest : plus moderne et mieux supporte.
 *
 *   Au Lot 4 nous ajouterons ici un "interceptor" qui joindra
 *   automatiquement le jeton d'authentification a chaque requete.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withFetch()),
  ],
};
