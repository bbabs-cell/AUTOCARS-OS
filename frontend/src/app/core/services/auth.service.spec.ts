import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { AuthService } from './auth.service';
import { AuthSession } from '../models/auth.model';

/**
 * Le service d'authentification porte une règle de sécurité qu'il
 * faut protéger dans le temps : le jeton d'accès ne doit JAMAIS
 * finir dans localStorage.
 *
 * C'est exactement le genre de détail qu'un futur développeur pressé
 * « corrigerait » pour éviter de reconnecter à chaque rechargement,
 * sans mesurer qu'il ouvre la porte au vol de session par XSS.
 * Ce test échouera si quelqu'un le fait.
 */
describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  const session: AuthSession = {
    access_token: 'jeton-de-test',
    expires_in: 1800,
    user: {
      id: 1,
      organization_id: 1,
      email: 'gerant@station.sn',
      full_name: 'Mamadou Diallo',
      role: 'ADMIN',
      station_ids: [1],
    },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.clear();
  });

  afterEach(() => httpMock.verify());

  it("démarre déconnecté", () => {
    expect(service.isAuthenticated()).toBeFalse();
    expect(service.user()).toBeNull();
    expect(service.token()).toBeNull();
  });

  it('enregistre la session après une connexion réussie', () => {
    service.login({ email: 'gerant@station.sn', password: 'un-mot-de-passe' }).subscribe();

    httpMock.expectOne((r) => r.url.endsWith('/auth/login')).flush({
      success: true,
      data: session,
      message: 'Connexion réussie.',
    });

    expect(service.isAuthenticated()).toBeTrue();
    expect(service.user()?.full_name).toBe('Mamadou Diallo');
    expect(service.role()).toBe('ADMIN');
    expect(service.token()).toBe('jeton-de-test');
  });

  it("n'écrit RIEN dans localStorage — le jeton reste en mémoire", () => {
    service.login({ email: 'gerant@station.sn', password: 'un-mot-de-passe' }).subscribe();

    httpMock.expectOne((r) => r.url.endsWith('/auth/login')).flush({
      success: true,
      data: session,
      message: '',
    });

    expect(Object.keys(localStorage).length)
      .withContext('le jeton ne doit jamais être stocké dans localStorage')
      .toBe(0);
  });

  it('envoie les identifiants avec withCredentials, pour recevoir le cookie', () => {
    service.login({ email: 'gerant@station.sn', password: 'x' }).subscribe();

    const request = httpMock.expectOne((r) => r.url.endsWith('/auth/login'));

    expect(request.request.withCredentials)
      .withContext('sans withCredentials, le cookie de rafraîchissement serait ignoré')
      .toBeTrue();

    request.flush({ success: true, data: session, message: '' });
  });

  it("traite l'échec du rafraîchissement comme un cas normal, pas une erreur", (done) => {
    service.refresh().subscribe((result) => {
      expect(result).toBeNull();
      expect(service.isAuthenticated()).toBeFalse();
      done();
    });

    httpMock
      .expectOne((r) => r.url.endsWith('/auth/refresh'))
      .flush({ success: false, message: 'Session absente.' }, { status: 401, statusText: 'Unauthorized' });
  });
});
