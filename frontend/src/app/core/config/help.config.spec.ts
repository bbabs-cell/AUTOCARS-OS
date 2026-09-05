import { HELP, HELP_ENTRIES } from './help.config';

/**
 * Ce que ces tests protègent
 * ------------------------------------------------------------------
 * L'aide est du CONTENU, pas du code : on n'attend pas d'un texte
 * qu'il ait des tests. Trois propriétés méritent pourtant d'être
 * tenues, parce qu'elles se cassent en silence quand quelqu'un ajoute
 * une entrée un an plus tard.
 *
 * 1. LES ANCRES SONT UNIQUES ET STABLES. `/help#restitution-impayee`
 *    est une adresse publique : un doublon enverrait le lecteur sur
 *    la mauvaise réponse, et un identifiant contenant un espace ou un
 *    accent casserait le lien.
 *
 * 2. CHAQUE ENTRÉE DIT QUOI FAIRE. Une aide qui explique pourquoi
 *    c'est refusé et s'arrête là laisse l'utilisateur exactement où
 *    il était : bloqué, mais savant.
 *
 * 3. AUCUN SEUIL CHIFFRÉ. C'est la règle qui garde cette aide
 *    honnête : les vraies règles vivent dans le serveur, et un
 *    chiffre recopié ici serait faux le jour où il changerait — sans
 *    que personne pense à venir le corriger.
 *
 * ------------------------------------------------------------------
 * UN TEST A ÉTÉ ÉCRIT PUIS RETIRÉ, ET ÇA VAUT D'ÊTRE NOTÉ
 *
 * Il vérifiait que chaque entrée est formulée du point de vue de
 * quelqu'un de bloqué, et non comme un titre de chapitre. C'est une
 * vraie règle d'écriture — mais elle porte sur du STYLE, et aucune
 * expression régulière ne la capture : « Le logiciel dit qu'un
 * dossier est déjà ouvert » est un excellent intitulé qu'aucun motif
 * raisonnable ne distingue d'un titre.
 *
 * Il restait deux issues : élargir le motif jusqu'à ce qu'il accepte
 * tout, ou retirer le test. Un test qu'on assouplit jusqu'à ce qu'il
 * passe ne prouve plus rien et coûte la confiance qu'on a dans les
 * autres. La règle reste écrite en tête de `help.config.ts`, où un
 * relecteur la lira ; elle n'est pas mécanisable, et prétendre le
 * contraire aurait été le vrai défaut.
 */
describe('Le contenu de l’aide', () => {
  it('a des ancres uniques', () => {
    const ids = HELP_ENTRIES.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a des ancres utilisables dans une URL', () => {
    for (const entry of HELP_ENTRIES) {
      expect(entry.id)
        .withContext(`ancre « ${entry.id} »`)
        .toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('a des sections aux identifiants uniques', () => {
    const ids = HELP.map((section) => section.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('répond toujours à trois choses : la question, le pourquoi, le quoi faire', () => {
    for (const entry of HELP_ENTRIES) {
      expect(entry.question.length).withContext(entry.id).toBeGreaterThan(10);
      expect(entry.answer.length).withContext(entry.id).toBeGreaterThan(40);
      expect(entry.todo.length).withContext(entry.id).toBeGreaterThan(10);
    }
  });

  it('ne recopie aucun seuil chiffré', () => {
    // Les nombres écrits en toutes lettres dans une phrase (« deux
    // dossiers ») ne posent pas ce problème : ils décrivent la règle,
    // pas son réglage. Ce sont les CHIFFRES qui dérivent.
    for (const entry of HELP_ENTRIES) {
      const text = `${entry.answer} ${entry.todo}`;

      expect(text)
        .withContext(`« ${entry.id} » contient un chiffre : il deviendra faux`)
        // « 5 000 F » est l'exception assumée : c'est un exemple de
        // montant, pas un seuil du produit.
        .not.toMatch(/\b\d+\s*(minutes?|heures?|jours?|lavages?|fois)\b/);
    }
  });
});
