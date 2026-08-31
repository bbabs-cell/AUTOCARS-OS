import { Routes } from '@angular/router';

/**
 * Table de routage de l'application
 * ------------------------------------------------------------------
 * Chaque route associe une URL a un composant.
 *
 * `loadComponent` charge le composant a la demande ("lazy loading") :
 * le code d'une page n'est telecharge que lorsque l'utilisateur s'y
 * rend. C'est important pour AUTOCARE OS, dont les utilisateurs
 * travaillent souvent sur mobile avec une connexion limitee : inutile
 * de leur faire telecharger le module Analytics pour afficher une
 * page de connexion.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'health',
  },
  {
    // Page temporaire de verification de l'installation (Lot 1).
    // Sera remplacee par le tableau de bord au Lot 10.
    path: 'health',
    title: 'Verification — AUTOCARE OS',
    loadComponent: () =>
      import('./features/health/health.page').then((m) => m.HealthPage),
  },
  {
    // Toute URL inconnue renvoie vers l'accueil.
    // Une vraie page 404 sera creee au Lot 18 (etats UX).
    path: '**',
    redirectTo: '',
  },
];
