import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';

import { BookingService } from './booking.service';
import { environment } from '../../../environments/environment';

/**
 * Ce que ces tests protègent
 * ------------------------------------------------------------------
 * Le service des rendez-vous ne calcule rien : il ne fait que
 * traduire des appels. Deux détails méritent quand même d'être tenus
 * dans le temps, parce qu'ils se « simplifient » facilement et se
 * remarquent tard.
 *
 * 1. LA JOURNÉE SE LIT EN UNE SEULE REQUÊTE.
 *    L'écran a besoin des rendez-vous, des compteurs, de la charge et
 *    des dépassés. Quatre appels séparés donneraient quatre états qui
 *    ne se rafraîchissent pas ensemble — et un écran où le compteur
 *    dit « 3 » au-dessus de quatre lignes.
 *
 * 2. « ARRIVÉ » NE PASSE PAS PAR LA ROUTE DE STATUT.
 *    L'arrivée ouvre un dossier. Le type l'interdit à la compilation,
 *    et le serveur le refuse ; ce test vérifie la troisième chose, la
 *    seule qui ne se voit pas : que la méthode d'arrivée tape bien sur
 *    sa propre route.
 */
describe('BookingService', () => {
  let service: BookingService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(BookingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lit toute la journée en une seule requête', () => {
    service.day('2026-09-10', '2026-09-10', 3).subscribe();

    const request = httpMock.expectOne(
      (r) =>
        r.url === `${environment.apiUrl}/bookings` &&
        r.params.get('from') === '2026-09-10' &&
        r.params.get('to') === '2026-09-10' &&
        r.params.get('station_id') === '3',
    );

    expect(request.request.method).toBe('GET');

    request.flush({
      success: true,
      data: { bookings: [], counts: {}, overdue: [], load: [], period: {} },
    });
  });

  it("n'envoie pas de station quand aucune n'est choisie", () => {
    service.day('2026-09-10', '2026-09-10', null).subscribe();

    const request = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/bookings`);

    expect(request.request.params.has('station_id')).toBeFalse();

    request.flush({ success: true, data: {} });
  });

  it('passe le motif, même vide, sur un changement de statut', () => {
    service.changeStatus(7, 'CANCELLED').subscribe();

    const request = httpMock.expectOne(`${environment.apiUrl}/bookings/7/status`);

    expect(request.request.method).toBe('PUT');
    expect(request.request.body.status).toBe('CANCELLED');
    // Le motif est facultatif : le serveur doit recevoir `null`, pas
    // une clé absente qu'il interpréterait différemment.
    expect(request.request.body.reason).toBeNull();

    request.flush({ success: true, data: {} });
  });

  it("l'arrivée a sa propre route, parce qu'elle ouvre un dossier", () => {
    service.arrive(7, 42).subscribe();

    const request = httpMock.expectOne(`${environment.apiUrl}/bookings/7/arrive`);

    expect(request.request.method).toBe('POST');
    expect(request.request.body.vehicle_id).toBe(42);

    request.flush({ success: true, data: {} });
  });
});
