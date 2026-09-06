import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { envoie } from '../src/core/courriel';

/**
 * ==================================================================
 * CE QUI EST RÉELLEMENT ENVOYÉ À RESEND
 * ==================================================================
 * Ces tests interceptent `fetch` et regardent la requête partie sur
 * le réseau — l'adresse, l'en-tête d'autorisation, le corps.
 *
 * C'est le seul moyen de vérifier qu'on parle bien la langue de
 * Resend sans ouvrir de compte : sa documentation attend un TABLEAU
 * de destinataires, et une chaîne passe parfois avant d'échouer
 * ailleurs. Un test qui se contenterait de « la fonction a renvoyé
 * true » ne dirait rien de cela.
 */
describe('le transport Resend', () => {
  let requetes: { url: string; init: RequestInit }[] = [];
  let reponse: Response;

  beforeEach(() => {
    requetes = [];
    reponse = new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 });

    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      requetes.push({ url, init });

      return reponse;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const avecCle = { ...env, RESEND_TOKEN: 're_cle_de_test' } as Env;

  const message = {
    destinataire: 'aminata@exemple.sn',
    sujet: 'Réinitialisation',
    texte: 'Bonjour,\n\nVoici votre lien.',
  };

  it('parle à l’API de Resend, avec la clé en porteur', async () => {
    expect(await envoie(avecCle, message)).toBe(true);

    expect(requetes).toHaveLength(1);
    expect(requetes[0].url).toBe('https://api.resend.com/emails');
    expect(requetes[0].init.method).toBe('POST');

    const entetes = requetes[0].init.headers as Record<string, string>;

    expect(entetes.Authorization).toBe('Bearer re_cle_de_test');
    expect(entetes['Content-Type']).toBe('application/json');
  });

  /**
   * RESEND ATTEND UN TABLEAU de destinataires, même pour un seul.
   * Une chaîne passe parfois et échoue ailleurs : autant s'en tenir à
   * ce que la documentation annonce.
   */
  it('envoie le destinataire dans un tableau', async () => {
    await envoie(avecCle, message);

    const corps = JSON.parse(String(requetes[0].init.body));

    expect(corps.to).toEqual(['aminata@exemple.sn']);
    expect(corps.subject).toBe('Réinitialisation');
    expect(corps.text).toBe('Bonjour,\n\nVoici votre lien.');
    expect(corps.from).toBe('no-reply@magyapro.com');
  });

  /**
   * ==================================================================
   * SANS CLÉ, LE PRODUIT CONTINUE DE FONCTIONNER.
   * ==================================================================
   * Le message part dans les traces. Ce n'est pas une solution de
   * repli honteuse : c'est ce qui permet de suivre tout le parcours
   * « mot de passe oublié » en local, et de faire tourner ces tests
   * sans jamais toucher au réseau.
   */
  it('sans clé, rien ne part sur le réseau', async () => {
    const traces = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await envoie(env, message)).toBe(false);

    expect(requetes).toHaveLength(0);
    expect(traces).toHaveBeenCalled();
    // Le contenu exact est visible, sinon la trace ne servirait à rien.
    expect(String(traces.mock.calls[0][0])).toContain('Voici votre lien.');
  });

  /**
   * ==================================================================
   * UN ÉCHEC D'ENVOI NE REMONTE JAMAIS À L'APPELANT.
   * ==================================================================
   * La route de mot de passe oublié répond la même chose que le
   * compte existe ou non. Si un échec changeait sa réponse, ce
   * formulaire deviendrait un moyen commode de découvrir quelles
   * adresses sont enregistrées.
   */
  it('un refus de Resend renvoie false, sans lever d’exception', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    reponse = new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 });

    expect(await envoie(avecCle, message)).toBe(false);
  });

  it('une panne réseau renvoie false, sans lever d’exception', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => {
      throw new Error('connexion refusée');
    });

    expect(await envoie(avecCle, message)).toBe(false);
  });

  /**
   * LE 422 EST LA PANNE LA PLUS DÉROUTANTE : Resend accepte la clé,
   * refuse l'expéditeur, et le courriel n'arrive jamais. La trace doit
   * nommer la cause probable plutôt que de laisser chercher.
   */
  it('un 422 dit qu’il faut vérifier le domaine expéditeur', async () => {
    const traces = vi.spyOn(console, 'error').mockImplementation(() => {});

    reponse = new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 });

    await envoie(avecCle, message);

    expect(traces.mock.calls[0].join(' ')).toContain('domaine expéditeur');
  });

  /**
   * ON NE JOURNALISE PAS LE CORPS DE LA RÉPONSE TEL QUEL : il reprend
   * l'adresse du destinataire, et les traces d'un Worker sont lisibles
   * par toute personne ayant accès au compte.
   */
  it('ne recopie pas l’adresse du destinataire dans la trace d’erreur', async () => {
    const traces = vi.spyOn(console, 'error').mockImplementation(() => {});

    reponse = new Response(
      JSON.stringify({ name: 'invalid_to', message: 'aminata@exemple.sn est invalide' }),
      { status: 400 },
    );

    await envoie(avecCle, message);

    expect(traces.mock.calls[0].join(' ')).not.toContain('aminata@exemple.sn');
  });
});
