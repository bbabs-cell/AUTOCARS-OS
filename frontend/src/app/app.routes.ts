import { Routes } from '@angular/router';

import { AppShellComponent } from './shared/layout/app-shell.component';
import { AuthLayoutComponent } from './shared/layout/auth-layout.component';
import { authGuard, guestGuard } from './core/guards/auth.guard';
import { onboardingGuard, onboardingPendingGuard } from './core/guards/onboarding.guard';

/**
 * Table de routage
 * ==================================================================
 * TROIS ZONES, ET L'ORDRE COMPTE.
 * ==================================================================
 *
 *   1. la zone INTERNE, sous AppShellComponent (barre latérale + en-tête)
 *   2. l'INSTALLATION guidée, sans coque
 *   3. la zone PUBLIQUE, sous AuthLayoutComponent
 *
 * ------------------------------------------------------------------
 * POURQUOI LA ZONE INTERNE EST-ELLE DÉCLARÉE EN PREMIER ?
 *
 * Parce que deux routes portent `path: ''` : la zone interne et la
 * zone publique. Quand Angular traite l'URL « / », il retient la
 * PREMIÈRE qui correspond. Si la zone publique venait d'abord, elle
 * consommerait l'URL, ne trouverait aucun enfant correspondant
 * (ses enfants sont « login », « register »…) et afficherait son
 * gabarit avec un contenu VIDE — page blanche, sans la moindre
 * erreur dans la console.
 *
 * C'est exactement le bug rencontré en développant ce lot.
 *
 * Dans cet ordre, tout se règle naturellement :
 *   « / »       → la zone interne consomme l'URL et redirige via son
 *                 enfant vide, puis les gardes décident.
 *   « /login »  → la zone interne consomme '' mais aucun enfant ne
 *                 correspond à « login » : Angular revient en arrière
 *                 et essaie la route suivante, jusqu'à la zone
 *                 publique. Les gardes de la zone interne ne sont pas
 *                 exécutés, car elles ne s'appliquent qu'à une route
 *                 réellement retenue.
 *
 * RÈGLE À RETENIR : une route « path: '' » avec enfants doit toujours
 * posséder un enfant « path: '' », sinon elle avale l'URL racine sans
 * rien afficher.
 */
export const routes: Routes = [
  // ================================================================
  // 1. Zone interne — connexion requise
  // ================================================================
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard, onboardingGuard],
    children: [
      {
        // L'enfant vide indispensable, voir l'explication ci-dessus.
        // Deviendra le tableau de bord au lot 10. En attendant, on
        // arrive sur l'écran d'accueil des véhicules : c'est celui
        // qu'un employé ouvre en premier le matin.
        path: '',
        pathMatch: 'full',
        redirectTo: 'operations',
      },
      {
        path: 'operations',
        title: 'Accueil — AUTOCARE OS',
        loadComponent: () =>
          import('./features/operations/operations.page').then((m) => m.OperationsPage),
      },
      {
        path: 'operations/:id',
        title: 'Dossier — AUTOCARE OS',
        loadComponent: () =>
          import('./features/operations/operation-detail.page').then(
            (m) => m.OperationDetailPage,
          ),
      },
      {
        path: 'customers',
        title: 'Clients — AUTOCARE OS',
        loadComponent: () =>
          import('./features/customers/customers.page').then((m) => m.CustomersPage),
      },
      {
        path: 'customers/:id',
        title: 'Fiche client — AUTOCARE OS',
        loadComponent: () =>
          import('./features/customers/customer-detail.page').then((m) => m.CustomerDetailPage),
      },
      {
        path: 'vehicles',
        title: 'Véhicules — AUTOCARE OS',
        loadComponent: () =>
          import('./features/vehicles/vehicles.page').then((m) => m.VehiclesPage),
      },
      {
        path: 'vehicles/:id',
        title: 'Fiche véhicule — AUTOCARE OS',
        loadComponent: () =>
          import('./features/vehicles/vehicle-detail.page').then((m) => m.VehicleDetailPage),
      },
      {
        path: 'services',
        title: 'Prestations — AUTOCARE OS',
        loadComponent: () =>
          import('./features/services/services.page').then((m) => m.ServicesPage),
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

  // ================================================================
  // 2. Installation guidée
  // ================================================================
  // Sans coque applicative : tant que la station n'est pas
  // configurée, une barre latérale vers des modules inutilisables ne
  // ferait qu'égarer.
  {
    path: 'onboarding',
    title: 'Installation — AUTOCARE OS',
    canActivate: [authGuard, onboardingPendingGuard],
    loadComponent: () =>
      import('./features/onboarding/onboarding.page').then((m) => m.OnboardingPage),
  },

  // ================================================================
  // 3. Zone publique
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

  // Toute URL inconnue revient à l'accueil, qui redirigera selon
  // l'état de connexion. Une vraie page 404 arrive au lot 18.
  { path: '**', redirectTo: '' },
];
