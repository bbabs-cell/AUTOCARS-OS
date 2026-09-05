import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';

import { authInterceptor } from './auth.interceptor';
import { ConnectionService } from '../services/connection.service';
import { AuthService } from '../services/auth.service';
import { AuthUser } from '../models/auth.model';
import { environment } from '../../../environments/environment';

/**
 * Ce que ces tests protègent
 * ------------------------------------------------------------------
 * LE PREMIER EXISTE PARCE QUE LE DÉFAUT S'EST PRODUIT.
 *
 * Le bandeau de perte de connexion s'allumait sur l'échec réseau…
 * puis s'éteignait aussitôt. `HttpClient` émet un premier événement
 * `Sent` au DÉPART de chaque requête, bien avant la moindre réponse :
 * la version initiale de l'intercepteur y voyait la preuve que le
 * serveur répondait, et éteignait le bandeau au moment précis où une
 * nouvelle requête partait — c'est-à-dire en permanence, pendant une
 * coupure.
 *
 * Les tests du service de connexion, eux, passaient : ils vérifiaient
 * le service, pas ce que l'intercepteur en fait. Seul l'essai dans un
 * vrai navigateur l'a montré, et c'est exactement ce que ce fichier
 * évite d'avoir à refaire.
 */
describe('authInterceptor', () => {
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

  let http: HttpClient;
  let httpMock: HttpTestingController;
  let connection: ConnectionService;
  let auth: AuthService;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    connection = TestBed.inject(ConnectionService);
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
  });

  afterEach(() => httpMock.verify());

  it('allume le bandeau quand la requête n’atteint pas le serveur', () => {
    http.get('/api/queue').subscribe({ error: () => undefined });

    httpMock
      .expectOne('/api/queue')
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });

    expect(connection.isOffline()).toBeTrue();
  });

  it('ne l’allume PAS sur une erreur du serveur : un 500 prouve qu’il répond', () => {
    http.get('/api/queue').subscribe({ error: () => undefined });

    httpMock
      .expectOne('/api/queue')
      .flush({}, { status: 500, statusText: 'Server Error' });

    expect(connection.isOffline()).toBeFalse();
  });

  it('l’éteint dès qu’une requête aboutit', () => {
    connection.reportFailure();

    http.get('/api/health').subscribe();
    httpMock.expectOne('/api/health').flush({ success: true });

    expect(connection.isOffline()).toBeFalse();
  });

  it('NE l’éteint PAS au simple départ d’une requête', () => {
    // LE DÉFAUT CORRIGÉ. Pendant une coupure, l'écran continue de
    // demander des données : si le départ d'une requête suffisait à
    // déclarer le serveur joignable, le bandeau disparaîtrait à
    // chaque tentative — et l'utilisateur croirait la connexion
    // revenue alors que rien ne passe.
    connection.reportFailure();

    http.get('/api/queue').subscribe({ error: () => undefined });

    // La requête est PARTIE, elle n'a pas encore répondu.
    const pending = httpMock.expectOne('/api/queue');

    expect(connection.isOffline())
      .withContext('le bandeau doit rester allumé tant que rien n’a répondu')
      .toBeTrue();

    pending.error(new ProgressEvent('error'), { status: 0 });
  });

  it('emmène vers la connexion quand la session ne peut plus être renouvelée', () => {
    const navigate = spyOn(router, 'navigate');

    auth.user.set(utilisateur);
    // `accessToken` est privé — et c'est bien ainsi : personne ne doit
    // pouvoir poser un jeton de l'extérieur. On simule donc sa
    // lecture, qui est le seul point de contact de l'intercepteur.
    spyOn(auth, 'token').and.returnValue('un-jeton-perime');

    http.get('/api/queue').subscribe({ error: () => undefined });

    httpMock.expectOne('/api/queue').flush({}, { status: 401, statusText: 'Unauthorized' });

    // Le renouvellement est tenté une fois — et échoue lui aussi.
    httpMock
      .expectOne(`${environment.apiUrl}/auth/refresh`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(navigate).toHaveBeenCalledWith(
      ['/login'],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ expired: 1 }),
      }),
    );
  });
});
