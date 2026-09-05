import { describe, expect, it } from 'vitest';
import { ITERATIONS, hachePassword, verifiePassword } from '../src/core/password';

describe('empreintes de mot de passe', () => {
  it('un mot de passe se vérifie contre sa propre empreinte', async () => {
    const e = await hachePassword('Autocare2026!');
    expect(await verifiePassword('Autocare2026!', e)).toBe(true);
  });

  it('un mot de passe différent est refusé', async () => {
    const e = await hachePassword('Autocare2026!');
    expect(await verifiePassword('autocare2026!', e)).toBe(false);
    expect(await verifiePassword('', e)).toBe(false);
  });

  it('deux empreintes du même mot de passe diffèrent (sel aléatoire)', async () => {
    const [a, b] = await Promise.all([hachePassword('MemeMot!'), hachePassword('MemeMot!')]);
    expect(a).not.toBe(b);
  });

  it('le format porte son nombre d’itérations', async () => {
    const e = await hachePassword('X');
    expect(e.startsWith(`pbkdf2$${ITERATIONS}$`)).toBe(true);
    expect(e.split('$')).toHaveLength(4);
  });

  /**
   * Le format porte ses itérations POUR QUE les anciennes empreintes
   * restent vérifiables le jour où on augmentera le paramètre. Sans
   * cela, changer ITERATIONS déconnecterait tout le monde d'un coup.
   */
  it('une empreinte à un autre nombre d’itérations reste vérifiable', async () => {
    const e = await hachePassword('Autocare2026!');
    const ancienne = e.replace(`$${ITERATIONS}$`, '$1000$');

    // Elle ne correspond plus (le calcul diffère), mais elle est LUE
    // sans erreur — c'est ce qui rend une migration progressive
    // possible.
    expect(await verifiePassword('Autocare2026!', ancienne)).toBe(false);
    expect(await verifiePassword('Autocare2026!', e)).toBe(true);
  });

  /**
   * LES EMPREINTES bcrypt DU BACKEND PHP.
   *
   * Elles ne peuvent pas être vérifiées ici, et c'est le coût annoncé
   * au §4.3 du chiffrage. Ce qui compte, c'est que la fonction ne
   * PLANTE pas dessus : elle répond « non », comme pour un mauvais mot
   * de passe.
   */
  it('une empreinte bcrypt du PHP renvoie faux, sans lever d’erreur', async () => {
    const bcrypt = '$2y$12$aEImq6DKh7gSNNVHemCTwu/VGeug3lFGn5yFrwSajaR2gyNJ03/d.';
    expect(await verifiePassword('Autocare2026!', bcrypt)).toBe(false);
  });

  it('une empreinte corrompue renvoie faux, sans lever d’erreur', async () => {
    for (const mauvaise of ['', 'nimporte quoi', 'pbkdf2$abc$xx$yy', 'pbkdf2$1000$!!!$!!!', 'pbkdf2$-5$AA==$AA==']) {
      expect(await verifiePassword('Autocare2026!', mauvaise)).toBe(false);
    }
  });
});

/**
 * LA MESURE FAIT PARTIE DES TESTS.
 *
 * Le nombre d'itérations est un compromis entre solidité et temps de
 * calcul, et les Workers facturent — et limitent — ce temps. Une
 * valeur laissée sans garde-fou finit toujours par dériver : soit
 * quelqu'un la baisse « pour accélérer » sans mesurer, soit une
 * montée de version change le coût sans prévenir.
 *
 * Ce test échoue dans les deux cas.
 */
describe('coût de la connexion', () => {
  it('une vérification reste dans un budget tenable', async () => {
    const empreinte = await hachePassword('Autocare2026!');

    const debut = performance.now();
    await verifiePassword('Autocare2026!', empreinte);
    const duree = performance.now() - debut;

    // Large, volontairement : la machine qui exécute les tests n'est
    // pas celle de production. Ce test ne prétend pas mesurer la
    // production — il attrape un dérapage d'un ordre de grandeur.
    expect(duree).toBeLessThan(400);

    // Et il attrape aussi le sens inverse : une valeur effondrée à
    // quelques milliers d'itérations passerait inaperçue autrement.
    expect(ITERATIONS).toBeGreaterThanOrEqual(210_000);
  }, 30_000);
});
