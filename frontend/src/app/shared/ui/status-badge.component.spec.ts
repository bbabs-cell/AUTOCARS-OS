import { TestBed } from '@angular/core/testing';

import { StatusBadgeComponent } from './status-badge.component';
import { OPERATION_STATUS_ORDER } from '../../core/models/operation-status.model';

/**
 * Le badge de statut porte une vraie règle métier : la traduction
 * d'un statut technique en libellé français et en couleur. C'est
 * exactement le genre de logique qui mérite un test — si quelqu'un
 * ajoute un statut sans son libellé, le test échoue au lieu qu'un
 * badge vide apparaisse en production.
 */
describe('StatusBadgeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StatusBadgeComponent],
    }).compileComponents();
  });

  it('affiche le libellé français du statut', () => {
    const fixture = TestBed.createComponent(StatusBadgeComponent);
    fixture.componentRef.setInput('status', 'WASHING');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent?.trim()).toBe('En lavage');
  });

  it('applique la classe CSS correspondant au statut', () => {
    const fixture = TestBed.createComponent(StatusBadgeComponent);
    fixture.componentRef.setInput('status', 'QUALITY_CHECK');
    fixture.detectChanges();

    const badge = (fixture.nativeElement as HTMLElement).querySelector('.ac-badge');
    expect(badge?.classList).toContain('ac-badge--quality');
  });

  it('gère les huit statuts sans libellé manquant', () => {
    for (const status of OPERATION_STATUS_ORDER) {
      const fixture = TestBed.createComponent(StatusBadgeComponent);
      fixture.componentRef.setInput('status', status);
      fixture.detectChanges();

      const text = (fixture.nativeElement as HTMLElement).textContent?.trim();
      expect(text).withContext(`libellé manquant pour ${status}`).toBeTruthy();
    }
  });
});
