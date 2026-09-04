import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';

import { SplitBarComponent, SplitSegment } from './split-bar.component';

@Component({
  imports: [SplitBarComponent],
  template: '<ac-split-bar [segments]="segments" />',
})
class HostComponent {
  segments: SplitSegment[] = [];
}

/**
 * Tests de la barre de répartition
 * ------------------------------------------------------------------
 * LE TEST QUI COMPTE est le dernier : la couleur suit l'ENTITÉ, pas
 * son rang.
 *
 * Sans lui, on ne verrait le défaut qu'un matin où les espèces
 * passeraient devant le mobile money — et le graphique changerait de
 * couleurs sans que rien n'ait changé dans les données. Quelqu'un qui
 * a appris « le bleu, c'est les espèces » le lirait alors à l'envers
 * sans s'en apercevoir. C'est le genre de bogue qu'on ne remarque
 * jamais en développement, parce qu'on a toujours le même jeu de
 * données sous les yeux.
 */
describe('SplitBarComponent', () => {
  // Le module de test se configure UNE FOIS. Le reconfigurer à chaque
  // rendu lève « test module has already been instantiated » : c'est
  // ce qui arrive quand on veut rendre deux fois dans un même test —
  // exactement ce que fait le troisième cas ci-dessous.
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  function render(segments: SplitSegment[]): HTMLElement {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.segments = segments;
    fixture.detectChanges();

    return fixture.nativeElement as HTMLElement;
  }

  it('annonce clairement une journée sans encaissement', () => {
    const element = render([]);

    expect(element.textContent).toContain('Aucun encaissement');
    expect(element.querySelector('.ac-split')).toBeNull();
  });

  it('affiche un segment par catégorie, avec son pourcentage', () => {
    const element = render([
      { key: 'CASH', label: 'Espèces', value: 7500, slot: 0 },
      { key: 'MOBILE_MONEY', label: 'Mobile money', value: 2500, slot: 1 },
    ]);

    expect(element.querySelectorAll('.ac-split__segment').length).toBe(2);
    expect(element.textContent).toContain('75 %');
    expect(element.textContent).toContain('25 %');
  });

  it('LA COULEUR SUIT LA CATÉGORIE, PAS SON CLASSEMENT', () => {
    // Les espèces sont majoritaires : elles s'affichent en premier.
    const matin = render([
      { key: 'CASH', label: 'Espèces', value: 8000, slot: 0 },
      { key: 'MOBILE_MONEY', label: 'Mobile money', value: 2000, slot: 1 },
    ]);

    const couleurEspecesMatin = (matin.querySelector('.ac-split__segment') as HTMLElement)
      .style.backgroundColor;

    // L'après-midi, le mobile money passe devant. L'ordre d'affichage
    // change ; la couleur des espèces, elle, ne doit PAS bouger.
    const soir = render([
      { key: 'CASH', label: 'Espèces', value: 2000, slot: 0 },
      { key: 'MOBILE_MONEY', label: 'Mobile money', value: 8000, slot: 1 },
    ]);

    const segments = Array.from(soir.querySelectorAll('.ac-split__segment')) as HTMLElement[];
    const legendes = Array.from(soir.querySelectorAll('.ac-split__legend dt'));

    // Le mobile money est désormais en tête de la légende…
    expect(legendes[0].textContent).toContain('Mobile money');

    // …et les espèces, passées en second, ont gardé leur couleur.
    expect(segments[1].style.backgroundColor).toBe(couleurEspecesMatin);
  });

  it('regroupe sous « Autre » au-delà de quatre catégories', () => {
    // Une cinquième teinte serait indiscernable des autres pour un
    // daltonien : on ne la fabrique pas.
    const element = render([
      { key: 'a', label: 'A', value: 100, slot: 0 },
      { key: 'b', label: 'B', value: 100, slot: 1 },
      { key: 'c', label: 'C', value: 100, slot: 2 },
      { key: 'd', label: 'D', value: 100, slot: 3 },
      { key: 'e', label: 'E', value: 50, slot: 4 },
      { key: 'f', label: 'F', value: 50, slot: 5 },
    ]);

    expect(element.textContent).toContain('Autre');
    expect(element.querySelectorAll('.ac-split__segment').length).toBe(5);
  });
});
