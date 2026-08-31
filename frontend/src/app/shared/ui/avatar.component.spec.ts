import { TestBed } from '@angular/core/testing';

import { AvatarComponent } from './avatar.component';

/**
 * Le calcul des initiales est de la vraie logique, avec des cas
 * limites bien réels dans notre contexte : un client enregistré avec
 * son seul prénom, un nom composé, des espaces en trop saisis à la
 * hâte sur un téléphone.
 */
describe('AvatarComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AvatarComponent],
    }).compileComponents();
  });

  function initialsFor(name: string): string {
    const fixture = TestBed.createComponent(AvatarComponent);
    fixture.componentRef.setInput('name', name);
    fixture.detectChanges();

    return (fixture.nativeElement as HTMLElement).textContent?.trim() ?? '';
  }

  it('prend la première lettre du prénom et du nom', () => {
    expect(initialsFor('Mamadou Diallo')).toBe('MD');
  });

  it("se contente d'une lettre quand il n'y a qu'un mot", () => {
    expect(initialsFor('Cheikh')).toBe('C');
  });

  it('ne dépasse jamais deux lettres', () => {
    expect(initialsFor('Marie Thérèse Diouf Ndiaye')).toBe('MT');
  });

  it('tolère les espaces superflus', () => {
    expect(initialsFor('  fatou   ndiaye  ')).toBe('FN');
  });
});
