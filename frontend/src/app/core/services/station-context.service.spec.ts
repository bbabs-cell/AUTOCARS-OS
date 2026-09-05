import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';

import { StationContextService } from './station-context.service';
import { Station } from '../models/catalog.model';
import { environment } from '../../../environments/environment';

/**
 * Ce que ces tests protègent
 * ------------------------------------------------------------------
 * Ce service porte le choix de station de TOUS les écrans de
 * consultation. Une erreur ici ne casse pas un écran : elle en fausse
 * huit à la fois, discrètement.
 *
 * 1. UNE STATION MÉMORISÉE MAIS DEVENUE INACCESSIBLE EST OUBLIÉE.
 *    Quelqu'un a pu être retiré d'une station depuis sa dernière
 *    visite, ou changer de compte sur le même navigateur. Sans ce
 *    retour à « toutes les stations », tous ses écrans demanderaient
 *    une station interdite et répondraient 403 — un produit qui a
 *    l'air en panne sans qu'on sache pourquoi.
 *
 * 2. UNE STATION FERMÉE NE S'OFFRE PLUS AU CHOIX, sauf si c'est celle
 *    qu'on regarde déjà : un sélecteur qui affiche une valeur absente
 *    de sa propre liste est un bug visible.
 *
 * 3. « TOUTES LES STATIONS » NE SE TRANSMET PAS À L'API.
 *    Le zéro est une convention d'affichage ; l'API attend l'ABSENCE
 *    de filtre. Envoyer `station_id=0` interrogerait une station qui
 *    n'existe pas.
 */
describe('StationContextService', () => {
  let service: StationContextService;
  let httpMock: HttpTestingController;

  const station = (id: number, name: string, status: 'ACTIVE' | 'INACTIVE'): Station => ({
    id,
    name,
    code: name.slice(0, 3).toUpperCase(),
    address: null,
    city: null,
    phone: null,
    opens_at: null,
    closes_at: null,
    status,
  });

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(StationContextService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  /** Répond à l'appel de chargement des stations. */
  function respondWith(stations: Station[]): void {
    httpMock.expectOne(`${environment.apiUrl}/stations`).flush({
      success: true,
      data: stations,
    });
  }

  it('démarre sur « toutes les stations »', () => {
    expect(service.selectedId()).toBe(0);
    expect(service.label()).toBe('Toutes les stations');
    expect(service.queryId()).toBeNull();
  });

  it('mémorise la station choisie et la transmet à l\'API', () => {
    service.select(7);

    expect(service.selectedId()).toBe(7);
    expect(service.queryId()).toBe(7);
    expect(localStorage.getItem('autocare.station')).toBe('7');
  });

  it('oublie la station quand on revient à « toutes »', () => {
    service.select(7);
    service.select(0);

    expect(service.queryId()).toBeNull();
    expect(localStorage.getItem('autocare.station')).toBeNull();
  });

  it('revient à « toutes » si la station mémorisée n\'est plus accessible', () => {
    service.select(99);
    service.refresh();

    respondWith([station(1, 'Dakar', 'ACTIVE'), station(2, 'Thiès', 'ACTIVE')]);

    expect(service.selectedId()).toBe(0);
  });

  it('garde la station mémorisée quand elle est toujours accessible', () => {
    service.select(2);
    service.refresh();

    respondWith([station(1, 'Dakar', 'ACTIVE'), station(2, 'Thiès', 'ACTIVE')]);

    expect(service.selectedId()).toBe(2);
    expect(service.label()).toBe('Thiès');
  });

  it('n\'offre pas au choix une station fermée', () => {
    service.refresh();
    respondWith([station(1, 'Dakar', 'ACTIVE'), station(2, 'Thiès', 'INACTIVE')]);

    expect(service.stations().length).toBe(2);
    expect(service.selectable().map((s) => s.id)).toEqual([1]);
    expect(service.hasChoice()).toBeFalse();
  });

  it('garde au choix la station fermée qu\'on est en train de regarder', () => {
    service.select(2);
    service.refresh();
    respondWith([station(1, 'Dakar', 'ACTIVE'), station(2, 'Thiès', 'INACTIVE')]);

    expect(service.selectable().map((s) => s.id)).toEqual([1, 2]);
    expect(service.hasChoice()).toBeTrue();
  });

  it('ne charge la liste qu\'une seule fois', () => {
    service.ensureLoaded();
    respondWith([station(1, 'Dakar', 'ACTIVE')]);

    service.ensureLoaded();

    // Un second appel HTTP ferait échouer httpMock.verify() ; ici,
    // l'absence de requête en attente EST l'assertion.
    expect(service.stations().length).toBe(1);
  });

  it('reste utilisable quand la liste est refusée (403 pour un employé)', () => {
    service.refresh();

    httpMock
      .expectOne(`${environment.apiUrl}/stations`)
      .flush({ success: false }, { status: 403, statusText: 'Forbidden' });

    expect(service.stations()).toEqual([]);
    expect(service.hasChoice()).toBeFalse();
  });
});
