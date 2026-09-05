import { TestBed } from '@angular/core/testing';

import { ConnectionService } from './connection.service';

/**
 * Ce que ces tests protègent
 * ------------------------------------------------------------------
 * 1. LE BANDEAU N'HÉSITE PAS. Une requête échouée l'allume, une
 *    requête réussie l'éteint. Pas de compteur, pas de seuil : un
 *    bandeau qui clignote est un bandeau auquel on ne croit plus.
 *
 * 2. L'HEURE DE LA COUPURE NE SE RÉÉCRIT PAS. Pendant une panne,
 *    toutes les requêtes échouent ; si chacune remettait l'horloge à
 *    zéro, « depuis 3 minutes » afficherait éternellement « à
 *    l'instant ».
 */
describe('ConnectionService', () => {
  let service: ConnectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ConnectionService);
  });

  it('démarre en supposant que le serveur répond', () => {
    expect(service.isOffline()).toBeFalse();
    expect(service.since()).toBeNull();
  });

  it('signale la coupure dès le premier échec', () => {
    service.reportFailure();

    expect(service.isOffline()).toBeTrue();
    expect(service.since()).not.toBeNull();
  });

  it("ne réécrit pas l'heure de la coupure aux échecs suivants", () => {
    service.reportFailure();
    const first = service.since();

    service.reportFailure();
    service.reportFailure();

    expect(service.since()).toBe(first);
  });

  it('efface la coupure dès la première requête qui aboutit', () => {
    service.reportFailure();
    service.reportSuccess();

    expect(service.isOffline()).toBeFalse();
    expect(service.since()).toBeNull();
  });

  it('reste silencieux quand tout va bien', () => {
    service.reportSuccess();
    service.reportSuccess();

    expect(service.isOffline()).toBeFalse();
  });
});
