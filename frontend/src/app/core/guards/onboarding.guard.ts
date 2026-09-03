import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/**
 * Garde d'installation
 * ------------------------------------------------------------------
 * Conduit vers l'installation guidée tant qu'elle n'est pas terminée.
 *
 * POURQUOI ? Parce que sans prestations configurées, on ne peut pas
 * créer d'opération : le gérant arriverait sur un produit dans lequel
 * rien ne fonctionne, sans comprendre pourquoi.
 *
 * Ce n'est PAS une mesure de sécurité — l'API n'interdit rien tant que
 * l'installation n'est pas finie. C'est une aide : l'interface guide,
 * elle ne verrouille pas.
 */
export const onboardingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = auth.user();

  // Pas d'utilisateur : c'est authGuard qui s'en occupe, pas nous.
  if (!user) {
    return true;
  }

  return user.onboarding_completed === false
    ? router.createUrlTree(['/onboarding'])
    : true;
};

/**
 * L'inverse : inutile de proposer l'installation à quelqu'un qui l'a
 * déjà terminée.
 */
export const onboardingPendingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.user()?.onboarding_completed === true
    ? router.createUrlTree(['/'])
    : true;
};
