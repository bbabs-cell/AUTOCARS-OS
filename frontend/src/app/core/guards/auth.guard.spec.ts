import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { authGuard, guestGuard, landingGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';
import { AuthUser } from '../models/auth.model';

/**
 * Tests des gardes de route
 * ------------------------------------------------------------------
 * RAPPEL : ces gardes ne protègent RIEN. La sécurité est côté
 * serveur, où AuthMiddleware vérifie le jeton à chaque requête.
 *
 * Ce qu'ils font, c'est éviter les allers-retours absurdes — et c'est
 * justement là qu'on se trompe. Une redirection mal orientée crée une
 * BOUCLE : la racine renvoie vers le tableau de bord, qui renvoie
 * vers la racine, et le navigateur tourne en rond.
 *
 * C'est le genre de bogue qu'on ne voit pas en écrivant le code,
 * parce qu'on teste toujours dans le même état de connexion. Le
 * dernier test de ce fichier parcourt donc les deux états.
 */
describe('Gardes de route', () => {
  const utilisateur: AuthUser = {
    id: 1,
    organization_id: 1,
    email: 'gerant@station.sn',
    full_name: 'Mamadou Diallo',
    role: 'ADMIN',
    station_ids: [1],
    permissions: ['*'],
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

  /** Exécute un garde dans le contexte d'injection d'Angular. */
  function run(guard: typeof authGuard, url = '/'): boolean | UrlTree {
    return TestBed.runInInjectionContext(
      () => guard({} as never, { url } as never),
    ) as boolean | UrlTree;
  }

  describe("landingGuard — la page d'accueil publique", () => {
    it('laisse entrer un visiteur non connecté', () => {
      expect(run(landingGuard)).toBe(true);
    });

    it('renvoie un utilisateur connecté vers son tableau de bord', () => {
      auth.user.set(utilisateur);

      const result = run(landingGuard);

      expect(result instanceof UrlTree).toBe(true);
      expect(router.serializeUrl(result as UrlTree)).toBe('/dashboard');
    });
  });

  describe('guestGuard — les pages de connexion', () => {
    it('laisse entrer un visiteur non connecté', () => {
      expect(run(guestGuard)).toBe(true);
    });

    it('renvoie vers /dashboard et NON vers « / »', () => {
      // Renvoyer vers « / » enverrait l'utilisateur sur la page
      // d'accueil publique, que landingGuard renverrait aussitôt vers
      // /dashboard : deux redirections au lieu d'une, visibles à
      // l'écran comme un clignotement.
      auth.user.set(utilisateur);

      expect(router.serializeUrl(run(guestGuard) as UrlTree)).toBe('/dashboard');
    });
  });

  describe('authGuard — la zone interne', () => {
    it('laisse passer un utilisateur connecté', () => {
      auth.user.set(utilisateur);

      expect(run(authGuard, '/queue')).toBe(true);
    });

    it('renvoie vers la connexion en mémorisant la page demandée', () => {
      // Un employé qui ouvre un lien vers une fiche véhicule doit
      // atterrir sur cette fiche après connexion, pas sur l'accueil.
      expect(router.serializeUrl(run(authGuard, '/vehicles/42') as UrlTree))
        .toBe('/login?redirect=%2Fvehicles%2F42');
    });
  });

  it("AUCUNE BOUCLE entre la racine et le tableau de bord", () => {
    // Connecté : la racine renvoie vers /dashboard, et authGuard
    // laisse alors passer. La chaîne s'arrête.
    auth.user.set(utilisateur);
    expect(router.serializeUrl(run(landingGuard) as UrlTree)).toBe('/dashboard');
    expect(run(authGuard, '/dashboard')).toBe(true);

    // Déconnecté : la racine s'affiche, /dashboard renvoie vers
    // /login, et /login est public. La chaîne s'arrête aussi.
    auth.user.set(null);
    expect(run(landingGuard)).toBe(true);
    expect(router.serializeUrl(run(authGuard, '/dashboard') as UrlTree))
      .toBe('/login?redirect=%2Fdashboard');
    expect(run(guestGuard)).toBe(true);
  });
});
