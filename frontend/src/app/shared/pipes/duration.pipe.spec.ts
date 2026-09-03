import { formatDuration } from './duration.pipe';

/**
 * Tests de la mise en forme des durées
 * ------------------------------------------------------------------
 * Cette fonction s'affiche sur chaque carte de la file d'attente, où
 * elle répond à la seule question qui compte : « depuis combien de
 * temps ? ». Une erreur ici ne plante rien — elle fait juste prendre
 * une mauvaise décision à quelqu'un.
 *
 * Le cas le plus important est la distinction entre `null` et `0` :
 * « durée inconnue » et « à l'instant » ne veulent pas dire la même
 * chose, et les confondre ferait croire à une donnée manquante là où
 * il y a une information exacte.
 */
describe('formatDuration', () => {
  it('affiche les minutes seules en dessous d\'une heure', () => {
    expect(formatDuration(45)).toBe('45 min');
  });

  it('bascule en heures pleines', () => {
    // « 240 min » obligerait le lecteur à faire la division lui-même.
    expect(formatDuration(240)).toBe('4 h');
  });

  it('complète les minutes à deux chiffres', () => {
    // « 1 h 5 » fait hésiter une demi-seconde, « 1 h 05 » non.
    expect(formatDuration(65)).toBe('1 h 05');
    expect(formatDuration(90)).toBe('1 h 30');
  });

  it('distingue « à l\'instant » de « durée inconnue »', () => {
    expect(formatDuration(0)).toBe('< 1 min');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
  });

  it('ne produit jamais de durée négative', () => {
    // Une horloge serveur en léger décalage ne doit pas afficher
    // « -3 min », qui ne veut rien dire pour la personne qui le lit.
    expect(formatDuration(-3)).toBe('—');
  });
});
