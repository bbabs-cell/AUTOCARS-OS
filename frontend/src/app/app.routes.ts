import { Routes } from '@angular/router';

import { AppShellComponent } from './shared/layout/app-shell.component';

/**
 * Table de routage de l'application
 * ------------------------------------------------------------------
 * Les routes sont imbriquées dans la coque applicative : toutes les
 * pages connectées héritent ainsi de la barre latérale et de
 * l'en-tête sans avoir à les inclure elles-mêmes.
 *
 * Au Lot 4, les pages publiques (connexion, inscription) seront
 * déclarées EN DEHORS de cette coque — elles n'ont ni menu ni
 * en-tête —, et un garde protégera les routes internes.
 *
 * `loadComponent` charge le code d'une page à la demande. C'est
 * important pour ce produit : les employés travaillent sur mobile
 * avec une connexion limitée, inutile de leur faire télécharger le
 * module Analytics pour afficher une page de connexion.
 */
export const routes: Routes = [
  {
    path: '',
    component: AppShellComponent,
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'styleguide',
      },
      {
        // Référence du design system (Lot 2).
        // Reste disponible pendant tout le développement : c'est le
        // contrat visuel que chaque nouvel écran doit respecter.
        path: 'styleguide',
        title: 'Design system — AUTOCARE OS',
        loadComponent: () =>
          import('./features/styleguide/styleguide.page').then((m) => m.StyleguidePage),
      },
      {
        // Diagnostic de l'installation (Lot 1).
        path: 'health',
        title: 'Diagnostic — AUTOCARE OS',
        loadComponent: () =>
          import('./features/health/health.page').then((m) => m.HealthPage),
      },
    ],
  },
  {
    // Toute URL inconnue renvoie vers l'accueil.
    // Une vraie page 404 sera créée au Lot 18 (états UX).
    path: '**',
    redirectTo: '',
  },
];
