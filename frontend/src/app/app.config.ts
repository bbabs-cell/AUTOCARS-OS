import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { AuthService } from './core/services/auth.service';

/**
 * Configuration globale de l'application
 * ------------------------------------------------------------------
 * provideAppInitializer bloque l'affichage tant que la promesse n'est
 * pas résolue. On l'utilise pour tenter de restaurer la session AVANT
 * que le routeur ne décide quoi afficher.
 *
 * Sans cela, recharger une page interne renverrait systématiquement
 * vers l'écran de connexion : au moment où le garde de route
 * s'exécute, la session n'aurait pas encore été restaurée.
 *
 * Le coût est un appel réseau de quelques dizaines de millisecondes
 * au démarrage. Le bénéfice : rester connecté après un F5.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideAppInitializer(() => firstValueFrom(inject(AuthService).restoreSession())),
  ],
};
