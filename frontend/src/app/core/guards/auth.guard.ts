import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/**
 * Garde de route — accès réservé aux utilisateurs connectés
 * ------------------------------------------------------------------
 * RAPPEL IMPORTANT : ce garde n'est PAS une mesure de sécurité.
 *
 * Il améliore l'expérience — inutile d'afficher un écran vide à
 * quelqu'un qui n'est pas connecté — mais n'importe qui peut appeler
 * l'API directement avec curl, sans passer par Angular.
 *
 * La vraie protection est côté serveur : AuthMiddleware vérifie le
 * jeton et les permissions à chaque requête. Ce garde ne fait
 * qu'éviter un aller-retour inutile.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  // On mémorise la page demandée pour y revenir après la connexion :
  // un employé qui ouvre un lien vers une fiche véhicule doit
  // atterrir sur cette fiche, pas sur le tableau de bord.
  return router.createUrlTree(['/login'], {
    queryParams: { redirect: state.url },
  });
};

/**
 * L'inverse : réservé aux visiteurs NON connectés.
 * Évite d'afficher le formulaire de connexion à quelqu'un qui a déjà
 * une session ouverte.
 *
 * On renvoie vers /dashboard et non vers « / » : depuis le lot 11,
 * la racine est la page d'accueil publique. Y renvoyer un
 * utilisateur connecté provoquerait une seconde redirection, visible
 * à l'écran comme un clignotement.
 */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isAuthenticated() ? router.createUrlTree(['/dashboard']) : true;
};

/**
 * La page d'accueil publique.
 * ------------------------------------------------------------------
 * Elle est visible par tout le monde — c'est une vitrine. Mais
 * quelqu'un qui a déjà une session ouverte n'a rien à y faire : il
 * veut son tableau de bord, pas l'argumentaire de vente.
 *
 * On ne réutilise pas `guestGuard` : il fait la même chose
 * aujourd'hui, mais les deux règles n'ont pas la même raison d'être.
 * Le jour où l'on voudra qu'un utilisateur connecté puisse relire la
 * vitrine, on modifiera celle-ci sans casser la page de connexion.
 */
export const landingGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isAuthenticated() ? router.createUrlTree(['/dashboard']) : true;
};
