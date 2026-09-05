import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { permissionGuard } from './permission.guard';
import { AuthService } from '../services/auth.service';
import { AuthUser } from '../models/auth.model';
import { NAVIGATION_AVAILABLE } from '../config/navigation.config';

/**
 * Ce que ces tests protègent
 * ------------------------------------------------------------------
 * RAPPEL : ce garde ne protège RIEN. Le serveur refuse la requête de
 * toute façon. Ce qu'il apporte est une PHRASE à la place d'un écran
 * vide — et c'est précisément ce qui peut se casser sans que personne
 * s'en aperçoive, puisque rien de sensible n'en dépend.
 *
 * 1. UNE ROUTE SANS PERMISSION DÉCLARÉE RESTE OUVERTE.
 *    Refuser par défaut transformerait chaque nouvelle route en
 *    écran interdit jusqu'à ce que quelqu'un pense à la déclarer.
 *
 * 2. LA REDIRECTION VA VERS /403, PAS VERS L'ACCUEIL.
 *    Renvoyer silencieusement au tableau de bord serait exactement le
 *    défaut que ce lot corrige : une réponse fausse à la place d'une
 *    explication.
 *
 * 3. LA BARRE LATÉRALE ET LES ROUTES LISENT LES MÊMES DROITS.
 *    Le dernier test compare les deux : une entrée de menu visible
 *    qui mènerait à un refus, ou l'inverse, est un produit qui se
 *    contredit lui-même.
 */
describe('permissionGuard', () => {
  const employe: AuthUser = {
    id: 2,
    organization_id: 1,
    email: 'awa@station.sn',
    full_name: 'Awa Ndiaye',
    role: 'EMPLOYEE',
    station_ids: [1],
    permissions: ['dashboard.view', 'operations.view', 'bookings.view'],
    onboarding_completed: true,
  };

  let auth: AuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });

    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  function run(permission?: string): boolean | UrlTree {
    return TestBed.runInInjectionContext(
      () =>
        permissionGuard(
          { data: permission === undefined ? {} : { permission } } as never,
          {} as never,
        ),
    ) as boolean | UrlTree;
  }

  it('laisse passer une route qui ne déclare aucune permission', () => {
    auth.user.set(employe);

    expect(run()).toBe(true);
  });

  it('laisse passer quand le droit est accordé', () => {
    auth.user.set(employe);

    expect(run('bookings.view')).toBe(true);
  });

  it('renvoie vers /403 quand le droit manque', () => {
    auth.user.set(employe);

    const result = run('cash.view');

    expect(result instanceof UrlTree).toBe(true);
    expect(router.serializeUrl(result as UrlTree)).toBe('/403');
  });

  it("n'envoie PAS vers l'accueil : une redirection muette est une réponse fausse", () => {
    auth.user.set(employe);

    const result = run('cash.view');

    expect(router.serializeUrl(result as UrlTree)).not.toBe('/dashboard');
  });

  it('la barre latérale et les routes appliquent les mêmes droits', () => {
    auth.user.set(employe);

    // Pour chaque entrée de menu, la visibilité du lien et le verdict
    // du garde doivent coïncider. Sinon le produit se contredit :
    // soit il propose une porte fermée, soit il cache un écran
    // accessible.
    for (const item of NAVIGATION_AVAILABLE) {
      const visible = item.permission === undefined || auth.can(item.permission);
      const allowed = run(item.permission) === true;

      expect(allowed)
        .withContext(`« ${item.label} » : menu ${visible}, route ${allowed}`)
        .toBe(visible);
    }
  });
});
