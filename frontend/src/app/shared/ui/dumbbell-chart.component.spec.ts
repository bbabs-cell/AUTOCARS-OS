import { ComponentRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DumbbellChartComponent, DumbbellRow } from './dumbbell-chart.component';

/**
 * Ce que ces tests protègent
 * ------------------------------------------------------------------
 * Le graphique en haltères montre un ÉCART. Deux règles décident s'il
 * le montre honnêtement, et toutes deux se « simplifient » facilement
 * en croyant bien faire.
 *
 * 1. L'ÉCHELLE PART DE ZÉRO. La faire commencer à la plus petite
 *    valeur ferait paraître énorme un écart de deux minutes.
 * 2. LA LIAISON COUVRE EXACTEMENT L'ÉCART, quel que soit le sens :
 *    une prestation plus rapide que prévu doit se lire aussi bien
 *    qu'une plus lente.
 */
describe('DumbbellChartComponent', () => {
  let fixture: ComponentFixture<DumbbellChartComponent>;
  let ref: ComponentRef<DumbbellChartComponent>;

  const rows: DumbbellRow[] = [
    // Plus lent que prévu.
    { label: 'Lavage standard', from: 30, to: 36, samples: 7 },
    // Plus rapide que prévu : le sens inverse doit marcher.
    { label: 'Lavage premium', from: 60, to: 55, samples: 4 },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DumbbellChartComponent] });

    fixture = TestBed.createComponent(DumbbellChartComponent);
    ref = fixture.componentRef;
    ref.setInput('rows', rows);
    ref.setInput('unit', ' min');
    fixture.detectChanges();
  });

  it("place les points sur une échelle qui part de zéro", () => {
    const scaled = (fixture.componentInstance as unknown as {
      scaled: () => Array<{ fromLeft: number; toLeft: number }>;
    }).scaled();

    // 60 est le maximum : il occupe toute la piste utile (94 %).
    expect(scaled[1].fromLeft).toBeCloseTo(94, 1);
    // 30 est la moitié de 60 : il doit tomber à la moitié, ce qui
    // n'arriverait pas si l'échelle démarrait à 30.
    expect(scaled[0].fromLeft).toBeCloseTo(47, 1);
  });

  it("fait couvrir à la liaison exactement l'écart, dans les deux sens", () => {
    const scaled = (fixture.componentInstance as unknown as {
      scaled: () => Array<{ linkLeft: number; linkWidth: number; fromLeft: number; toLeft: number }>;
    }).scaled();

    for (const row of scaled) {
      expect(row.linkLeft).toBeCloseTo(Math.min(row.fromLeft, row.toLeft), 5);
      expect(row.linkWidth).toBeCloseTo(Math.abs(row.toLeft - row.fromLeft), 5);
    }
  });

  it('donne toujours les mêmes chiffres dans un tableau', () => {
    // Une information ne doit jamais être accessible uniquement à
    // l'œil : le tableau porte les mêmes valeurs, sans survol.
    const cells: string = fixture.nativeElement.querySelector('table').textContent;

    expect(cells).toContain('Lavage standard');
    expect(cells).toContain('30 min');
    expect(cells).toContain('36 min');
    expect(cells).toContain('+6 min');
    // Le nombre de mesures est affiché : une moyenne sur quatre
    // passages ne se lit pas comme une moyenne sur quatre cents.
    expect(cells).toContain('7');
  });

  it("n'écrase pas un jeu de valeurs identiques", () => {
    // Deux valeurs égales : la liaison est nulle, mais les deux points
    // doivent rester à leur place — pas de division par zéro.
    ref.setInput('rows', [{ label: 'Égal', from: 20, to: 20 }]);
    fixture.detectChanges();

    const scaled = (fixture.componentInstance as unknown as {
      scaled: () => Array<{ linkWidth: number; fromLeft: number }>;
    }).scaled();

    expect(scaled[0].linkWidth).toBe(0);
    expect(scaled[0].fromLeft).toBeCloseTo(94, 1);
  });
});
