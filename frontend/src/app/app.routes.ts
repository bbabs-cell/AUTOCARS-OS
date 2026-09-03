import { Routes } from '@angular/router';

import { AppShellComponent } from './shared/layout/app-shell.component';
import { AuthLayoutComponent } from './shared/layout/auth-layout.component';
import { authGuard, guestGuard } from './core/guards/auth.guard';

/**
 * Table de routage
 * ------------------------------------------------------------------
 * DEUX ZONES BIEN SÉPARÉES :
 *
 *   1. les pages PUBLIQUES, sous AuthLayoutComponent — connexion,
 *      inscription, mot de passe oublié. Ni barre latérale ni
 *      en-tête : quelqu'un qui n'est pas connecté n'a rien à faire
 *      dans une navigation vers des modules inaccessibles.
 *
 *   2. les pages INTERNES, sous AppShellComponent, protégées par
 *      authGuard.
 *
 * RAPPEL : authGuard n'est PAS une mesure de sécurité, seulement du
 * confort. La vraie protection est côté serveur, où chaque route
 * vérifie le jeton et les permissions.
 */
export const routes: Routes = [
  // ================================================================
  // Zone publique
  // ================================================================
  {
    path: '',
    component: AuthLayoutComponent,
    canActivate: [guestGuard],
    children: [
      {
        path: 'login',
        title: 'Connexion — AUTOCARE OS',
        loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
      },
      {
        path: 'register',
        title: 'Créer une station — AUTOCARE OS',
        loadComponent: () => import('./features/auth/register.page').then((m) => m.RegisterPage),
      },
      {
        path: 'forgot-password',
        title: 'Mot de passe oublié — AUTOCARE OS',
        loadComponent: () =>
          import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage),
      },
      {
        path: 'reset-password',
        title: 'Nouveau mot de passe — AUTOCARE OS',
        loadComponent: () =>
          import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage),
      },
    ],
  },

  // ================================================================
  // Zone interne
  // ================================================================
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        // Deviendra le tableau de bord au lot 10.
        redirectTo: 'styleguide',
      },
      {
        path: 'styleguide',
        title: 'Design system — AUTOCARE OS',
        loadComponent: () =>
          import('./features/styleguide/styleguide.page').then((m) => m.StyleguidePage),
      },
      {
        path: 'health',
        title: 'Diagnostic — AUTOCARE OS',
        loadComponent: () => import('./features/health/health.page').then((m) => m.HealthPage),
      },
    ],
  },

  // Toute URL inconnue renvoie vers l'accueil, qui redirigera vers la
  // connexion si nécessaire. Une vraie page 404 arrive au lot 18.
  { path: '**', redirectTo: '' },
];
