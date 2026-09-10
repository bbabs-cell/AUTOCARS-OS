/**
 * Configuration de DÉVELOPPEMENT
 * ------------------------------------------------------------------
 * Utilisée automatiquement par `npm start`.
 *
 * L'API TOURNE EN PARALLÈLE, DANS LE WORKER :
 *
 *     cd workers && npx wrangler dev --port 8787 --local
 *
 * ------------------------------------------------------------------
 * POURQUOI « /api » ET NON « http://localhost:8787/api »
 *
 * Ce fichier visait `http://localhost:8000/api` — le serveur PHP. Le
 * port a changé avec la migration, mais ce n'est pas le port qu'il
 * fallait corriger : c'est la FORME de l'adresse.
 *
 * Une adresse absolue rend le développement CROISÉ alors que la
 * production est de même origine. On testerait donc autre chose que
 * ce qu'on déploie : le navigateur ajouterait un pré-vol CORS, le
 * cookie de rafraîchissement changerait de règles, et le Worker
 * devrait porter des en-têtes qui ne servent qu'en développement —
 * du code de production écrit pour les besoins du développement.
 *
 * Le serveur de développement d'Angular relaie donc `/api` vers le
 * Worker (voir `proxy.conf.json`), et les deux environnements se
 * ressemblent.
 */
export const environment = {
  production: false,

  apiUrl: '/api',
};
