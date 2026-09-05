import { describe, expect, it } from 'vitest';
import {
  ACTIFS, LIBELLES, TRANSITIONS, estFinal, existe, messageRefus, permet,
  type Etat,
} from '../src/core/etats';

/**
 * La machine à états se teste EXHAUSTIVEMENT : elle est petite, et
 * c'est la logique métier du produit. Vérifier quelques cas choisis
 * laisserait passer exactement celui qu'on n'a pas imaginé.
 */
describe('la machine à états', () => {
  const tous = Object.keys(TRANSITIONS) as Etat[];

  it('les huit étapes ont un libellé', () => {
    expect(tous).toHaveLength(8);
    for (const e of tous) {
      expect(LIBELLES[e]).toBeTruthy();
    }
  });

  it('le chemin normal va bien de bout en bout', () => {
    const chemin: Etat[] = [
      'WAITING', 'IN_PROGRESS', 'INSPECTION', 'WASHING', 'QUALITY_CHECK', 'READY', 'COMPLETED',
    ];

    for (let i = 0; i < chemin.length - 1; i++) {
      expect(permet(chemin[i], chemin[i + 1])).toBe(true);
    }
  });

  it('on peut annuler à toute étape non terminale', () => {
    for (const e of tous) {
      expect(permet(e, 'CANCELLED')).toBe(!estFinal(e));
    }
  });

  it('un dossier restitué ou annulé ne bouge plus', () => {
    expect(estFinal('COMPLETED')).toBe(true);
    expect(estFinal('CANCELLED')).toBe(true);
  });

  /**
   * LE REFUS LE PLUS IMPORTANT DE LA MACHINE.
   *
   * On ne saute aucune étape. En particulier : pas de lavage sans
   * être passé par l'inspection, et pas de restitution sans être
   * passé par le contrôle qualité.
   */
  it('aucune étape ne peut être sautée', () => {
    expect(permet('WAITING', 'WASHING')).toBe(false);
    expect(permet('WAITING', 'READY')).toBe(false);
    expect(permet('IN_PROGRESS', 'WASHING')).toBe(false);
    expect(permet('WASHING', 'READY')).toBe(false);        // le contrôle qualité
    expect(permet('WASHING', 'COMPLETED')).toBe(false);
    expect(permet('QUALITY_CHECK', 'COMPLETED')).toBe(false);
  });

  it('le contrôle qualité peut renvoyer au lavage', () => {
    // C'est tout l'intérêt d'un contrôle que de pouvoir dire non.
    expect(permet('QUALITY_CHECK', 'WASHING')).toBe(true);
  });

  it('on ne revient jamais en arrière ailleurs', () => {
    expect(permet('WASHING', 'INSPECTION')).toBe(false);
    expect(permet('READY', 'WASHING')).toBe(false);
    expect(permet('IN_PROGRESS', 'WAITING')).toBe(false);
  });

  it('les étapes actives sont celles où le véhicule est en station', () => {
    expect(ACTIFS).not.toContain('COMPLETED');
    expect(ACTIFS).not.toContain('CANCELLED');
    expect(ACTIFS).toHaveLength(6);
  });

  it('un statut inventé n’existe pas', () => {
    expect(existe('LAVE_A_LA_MAIN')).toBe(false);
    expect(existe('')).toBe(false);
  });
});

describe('les messages de refus', () => {
  it('disent ce qui EST possible, pas seulement ce qui ne l’est pas', () => {
    const m = messageRefus('WAITING', 'READY');

    expect(m).toContain('En attente');
    expect(m).toContain('Prêt à restituer');
    expect(m).toContain('Étapes possibles');
    expect(m).toContain('Pris en charge');
  });

  it('expliquent qu’un dossier terminé ne bouge plus', () => {
    expect(messageRefus('COMPLETED', 'WASHING')).toContain('ne peut plus changer');
  });

  it('signalent un statut qui n’existe pas', () => {
    expect(messageRefus('WAITING', 'NIMPORTE_QUOI')).toBe("Ce statut n'existe pas.");
  });
});
