/**
 * Les SECRETS, dans le contrat de types
 * ==================================================================
 * `wrangler types` construit l'interface `Env` à partir de deux
 * sources : `wrangler.toml`, et le fichier local `.dev.vars`.
 *
 * Or un secret n'est dans NI L'UN NI L'AUTRE en production. Il est
 * posé par `wrangler secret put`, et c'est précisément ce qu'on veut :
 * `wrangler.toml` est suivi par Git, `.dev.vars` ne l'est pas.
 *
 * Conséquence, découverte sur un clone neuf : `env.JWT_SECRET` ne
 * compilait que sur les machines qui avaient un `.dev.vars`. Sur
 * celles qui n'en avaient pas — donc sur toute machine fraîchement
 * clonée, et sur n'importe quelle intégration continue — le typage
 * échouait sur cinq lignes, dont le cœur de l'authentification.
 *
 * Le défaut n'était pas dans le code : il était dans le fait que le
 * contrat dépendait d'un fichier non versionné. Les secrets sont
 * déclarés ici, en dur, parce que leur PRÉSENCE fait partie du
 * contrat même si leur VALEUR n'y est jamais.
 *
 * Ces déclarations fusionnent avec l'interface produite par
 * `wrangler types` — TypeScript réunit les interfaces de même nom.
 */
interface SecretsAutocare {
  /**
   * Signe et vérifie les jetons de session.
   *
   * Obligatoire : sans lui, personne ne peut se connecter.
   *     npx wrangler secret put JWT_SECRET
   */
  JWT_SECRET: string;

  /**
   * Clé de l'API Resend, pour les courriels de mot de passe oublié.
   *
   * FACULTATIF, et le point d'interrogation le dit : sans elle, le
   * module de courriel bascule sur le transport « journal », le
   * message part dans les traces du Worker et le produit continue de
   * fonctionner. Le typer obligatoire forcerait à en poser une pour
   * lancer le produit, ce qui est faux.
   *     npx wrangler secret put RESEND_TOKEN
   */
  RESEND_TOKEN?: string;

  /**
   * Adresse de l'API de courriel, si l'on veut en changer sans
   * toucher au code. Non posée en temps normal : le module utilise
   * l'adresse de Resend.
   */
  MAIL_ENDPOINT?: string;
}

/**
 * DEUX interfaces à compléter, une seule liste.
 *
 * `wrangler types` en produit deux : `Env`, que le Worker reçoit, et
 * `Cloudflare.Env`, que `cloudflare:test` donne aux tests. Les deux
 * décrivent le même environnement.
 *
 * Ne compléter que la première laissait les tests échouer sur
 * « Property 'JWT_SECRET' is missing in type 'Cloudflare.Env' » —
 * l'erreur suivante, une fois la première corrigée. Les deux héritent
 * donc de la même déclaration : ajouter un secret plus tard se fait à
 * un seul endroit.
 */
interface Env extends SecretsAutocare {}

declare namespace Cloudflare {
  interface Env extends SecretsAutocare {}
}
