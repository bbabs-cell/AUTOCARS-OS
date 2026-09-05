import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/**
 * Garde de route — le droit d'ouvrir cet écran
 * ==================================================================
 * IL NE PROTÈGE RIEN. IL EXPLIQUE.
 * ==================================================================
 *
 * Comme `authGuard`, ce garde n'est PAS une mesure de sécurité : la
 * vraie barrière est le serveur, qui vérifie la permission à chaque
 * requête et ne renvoie aucune donnée sans elle. N'importe qui peut
 * appeler l'API avec curl sans passer par Angular.
 *
 * Ce qu'il apporte est une PHRASE. Avant le lot 18, un employé qui
 * tapait /cash dans la barre d'adresse obtenait l'écran de caisse,
 * vide — parce que le serveur refusait ses requêtes en silence. Un
 * écran vide ne dit pas « vous n'avez pas le droit » : il dit
 * « c'est cassé », ou « il n'y a rien aujourd'hui ».
 *
 * ------------------------------------------------------------------
 * LA PERMISSION EST DÉCLARÉE DANS LA ROUTE, PAS ICI
 *
 * `data: { permission: 'cash.view' }` — la même chaîne que la table
 * des routes du serveur et que la barre latérale. Trois endroits
 * lisent la même valeur ; aucun ne la réinvente.
 *
 * Usage :
 *   { path: 'cash', canActivate: [permissionGuard],
 *     data: { permission: 'cash.view' }, … }
 */
export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const permission = route.data['permission'] as string | undefined;

  // Une route sans permission déclarée est ouverte à tout utilisateur
  // connecté. On ne refuse pas par défaut : ce garde ne décide de
  // rien, il relaie une déclaration.
  if (permission === undefined) {
    return true;
  }

  return auth.can(permission) ? true : router.createUrlTree(['/403']);
};
