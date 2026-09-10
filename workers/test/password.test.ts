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
/** Le coût d'un PBKDF2 de `n` itérations sur CETTE machine, en ms. */
async function coutDe(n: number): Promise<number> {
  const cle = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode('Autocare2026!'), 'PBKDF2', false, ['deriveBits'],
  );
  const sel = crypto.getRandomValues(new Uint8Array(16));

  const debut = performance.now();
  await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: sel, iterations: n }, cle, 256,
  );

  return performance.now() - debut;
}

describe('coût de la connexion', () => {
  it('une vérification reste proportionnée à ses itérations', async () => {
    // Chauffe : la toute première dérivation paie l'initialisation du
    // moteur, et la compter fausserait l'étalon.
    await coutDe(1_000);

    const ETALON = 60_000;
    const etalon = await coutDe(ETALON);

    const empreinte = await hachePassword('Autocare2026!');
    const debut = performance.now();
    await verifiePassword('Autocare2026!', empreinte);
    const duree = performance.now() - debut;

    // ---------------------------------------------------------------
    // 1. LE CODE HONORE-T-IL LE NOMBRE QU'IL ANNONCE ?
    //
    // PBKDF2 coûte linéairement en itérations : la vérification doit
    // donc coûter ITERATIONS / ETALON fois l'étalon — 10 aujourd'hui.
    //
    // La borne BASSE est la plus intéressante des deux. Si la
    // constante affichait 600 000 pendant que le code en exécute
    // 10 000, tout le reste du fichier passerait : les empreintes se
    // vérifieraient, les mauvais mots de passe seraient refusés, et la
    // protection annoncée serait fausse d'un facteur 60. Seul le
    // chronomètre le voit.
    //
    // Le facteur 3 de part et d'autre absorbe le bruit de mesure sans
    // laisser passer un écart d'un ordre de grandeur.
    const attendu = ITERATIONS / ETALON;
    expect(duree / etalon).toBeGreaterThan(attendu / 3);
    expect(duree / etalon).toBeLessThan(attendu * 3);

    // ---------------------------------------------------------------
    // 2. LE PLANCHER DE SOLIDITÉ
    //
    // Une valeur effondrée à quelques milliers d'itérations passerait
    // inaperçue autrement : elle resterait proportionnée à elle-même.
    expect(ITERATIONS).toBeGreaterThanOrEqual(210_000);

    // ---------------------------------------------------------------
    // 3. LE PLAFOND DE COÛT
    //
    // C'est ce que gardait l'ancienne borne en millisecondes, mais
    // exprimé sur la seule grandeur qui ne dépende pas de la machine.
    // Mesuré dans workerd : 600 000 itérations coûtent 92 ms, donc
    // 1 000 000 en coûteraient ~155. Le plan payant offre 30 s de
    // calcul par requête, mais une connexion n'a pas à en consommer un
    // dixième — au-delà, c'est l'expérience de l'employé au comptoir
    // qui se dégrade, à chaque prise de poste.
    expect(ITERATIONS).toBeLessThanOrEqual(1_000_000);
  }, 60_000);
});
