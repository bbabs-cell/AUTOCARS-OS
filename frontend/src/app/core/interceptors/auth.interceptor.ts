import { HttpErrorResponse, HttpEventType, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, tap, throwError } from 'rxjs';

import { AuthService } from '../services/auth.service';
import { ConnectionService } from '../services/connection.service';

/**
 * Intercepteur d'authentification
 * ------------------------------------------------------------------
 * Passe sur CHAQUE requête HTTP sortante et fait deux choses :
 *
 *   1. joint le jeton d'accès à l'en-tête Authorization ;
 *   2. si l'API répond 401, tente UNE fois de renouveler la session,
 *      puis rejoue la requête.
 *
 * POURQUOI CE SECOND POINT ?
 * Le jeton d'accès expire au bout de 30 minutes. Sans cet
 * intercepteur, un employé en train de saisir une inspection serait
 * brutalement renvoyé vers l'écran de connexion — et perdrait sa
 * saisie. Ici, le renouvellement est invisible : il voit juste sa
 * requête aboutir.
 *
 * ATTENTION AU PIÈGE : si /auth/refresh répond lui-même 401, tenter
 * de le renouveler déclencherait une boucle infinie. Les routes
 * d'authentification sont donc exclues du mécanisme.
 *
 * ------------------------------------------------------------------
 * DEUX AJOUTS DU LOT 18
 *
 * 1. L'ÉTAT DU LIEN AVEC LE SERVEUR. Une requête qui n'arrive pas
 *    (`status === 0`) allume le bandeau de perte de connexion ; la
 *    première qui aboutit l'éteint. On ne compte QUE les échecs
 *    réseau : une réponse 500 prouve que le serveur répond.
 *
 * 2. LA SESSION EXPIRÉE NE LAISSE PLUS UN ÉCRAN MORT. Quand le
 *    renouvellement échoue, la session est effacée — mais jusqu'ici
 *    l'utilisateur restait sur son écran, à cliquer sur des boutons
 *    qui répondaient 401 en silence, jusqu'à ce qu'il change de page
 *    et tombe enfin sur la connexion. On l'y emmène maintenant, avec
 *    une phrase qui explique pourquoi.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const connection = inject(ConnectionService);
  const router = inject(Router);

  const isAuthRoute = request.url.includes('/auth/');
  const token = auth.token();

  const authorized =
    token && !isAuthRoute
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request;

  return next(authorized).pipe(
    // Une RÉPONSE, quelle qu'elle soit, prouve que le serveur est
    // joignable — y compris une réponse d'erreur.
    //
    // LE TEST SUR LE TYPE D'ÉVÉNEMENT N'EST PAS UNE PRÉCAUTION : il
    // corrige un défaut. `HttpClient` émet d'abord un événement
    // `Sent`, au DÉPART de la requête, bien avant la moindre réponse.
    // Sans ce filtre, chaque requête sortante déclarait le serveur
    // joignable — donc éteignait le bandeau au moment précis où une
    // nouvelle requête partait, pendant la coupure.
    tap((event) => {
      if (event.type === HttpEventType.Response) {
        connection.reportSuccess();
      }
    }),
    catchError((error: HttpErrorResponse) => {
      // `status === 0` : la requête n'a jamais atteint le serveur.
      // C'est le seul cas qui allume le bandeau — un 500 est un bug,
      // pas une coupure, et envoyer quelqu'un redémarrer son routeur
      // pour un bug ne l'aide pas.
      if (error.status === 0) {
        connection.reportFailure();
      } else {
        connection.reportSuccess();
      }

      const canRetry = error.status === 401 && !isAuthRoute && token !== null;

      if (!canRetry) {
        return throwError(() => error);
      }

      // Une seule tentative : si le renouvellement échoue aussi, la
      // session est bel et bien terminée.
      return auth.refresh().pipe(
        switchMap((session) => {
          if (!session) {
            // LA SESSION A EXPIRÉ PENDANT QU'IL TRAVAILLAIT.
            //
            // Sans cette redirection, il restait sur son écran à
            // cliquer sur des boutons qui échouaient en silence : le
            // garde de route ne s'exécute qu'à la navigation
            // suivante, et rien ne l'y poussait.
            //
            // On garde l'adresse en cours pour l'y ramener après la
            // reconnexion, et `expired` dit à l'écran de connexion
            // d'expliquer ce qui s'est passé plutôt que de laisser
            // croire à une déconnexion mystérieuse.
            void router.navigate(['/login'], {
              queryParams: { redirect: router.url, expired: 1 },
            });

            return throwError(() => error);
          }

          return next(
            request.clone({
              setHeaders: { Authorization: `Bearer ${session.access_token}` },
            }),
          );
        }),
      );
    }),
  );
};
