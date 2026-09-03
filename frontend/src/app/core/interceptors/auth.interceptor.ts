import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { AuthService } from '../services/auth.service';

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
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);

  const isAuthRoute = request.url.includes('/auth/');
  const token = auth.token();

  const authorized =
    token && !isAuthRoute
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request;

  return next(authorized).pipe(
    catchError((error: HttpErrorResponse) => {
      const canRetry = error.status === 401 && !isAuthRoute && token !== null;

      if (!canRetry) {
        return throwError(() => error);
      }

      // Une seule tentative : si le renouvellement échoue aussi,
      // l'erreur remonte normalement et le garde de route renverra
      // l'utilisateur vers la page de connexion.
      return auth.refresh().pipe(
        switchMap((session) => {
          if (!session) {
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
