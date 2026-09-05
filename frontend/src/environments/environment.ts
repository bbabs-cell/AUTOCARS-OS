/**
 * Configuration de PRODUCTION
 * ------------------------------------------------------------------
 * Angular remplace automatiquement ce fichier par
 * environment.development.ts quand tu lances `npm start`.
 * Voir angular.json -> configurations.development.fileReplacements
 *
 * Ne mets JAMAIS de secret ici : tout le contenu de ce fichier finit
 * dans le JavaScript telecharge par le navigateur, donc visible par
 * n'importe qui. Les secrets restent cote serveur, dans backend/.env
 */
export const environment = {
  production: true,

  /**
   * L'API est servie SUR LE MEME DOMAINE que l'application, sous /api.
   *
   * POURQUOI UNE ADRESSE RELATIVE, ET PAS « https://api.mon-domaine.sn »
   *
   * 1. C'est ce que fait deja la configuration Nginx livree
   *    (deploy/nginx.conf.example) : `location /api` pointe sur le
   *    dossier public/ du backend. Une adresse absolue vers un autre
   *    domaine contredirait le serveur et l'application appellerait
   *    un hote qui n'existe pas — c'est exactement le defaut qui a ete
   *    trouve en tentant la premiere mise en ligne.
   *
   * 2. Meme origine = pas de CORS, donc pas de requete preliminaire
   *    OPTIONS avant chaque appel. Sur une connexion mobile en
   *    Afrique de l'Ouest, c'est un aller-retour economise a chaque
   *    fois.
   *
   * 3. Le cookie de rafraichissement est en SameSite=Strict sur le
   *    chemin /api/auth. Sur la meme origine, ce reglage est le plus
   *    sur possible sans aucune concession.
   *
   * 4. Le meme build fonctionne sur n'importe quel domaine. Il n'y a
   *    plus de fichier a modifier avant de compiler : c'est le serveur
   *    qui decide de son adresse, pas le JavaScript.
   *
   * Si un jour l'API doit vivre sur un autre domaine, c'est ici qu'on
   * met l'adresse absolue — et il faut alors renseigner
   * APP_FRONTEND_URL dans backend/.env, sans quoi le navigateur
   * refusera les reponses.
   */
  apiUrl: '/api',
};
