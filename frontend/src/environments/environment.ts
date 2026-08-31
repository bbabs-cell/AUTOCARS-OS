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

  /** Adresse de l'API en production. A ajuster au moment du deploiement. */
  apiUrl: 'https://api.autocare-os.com/api',
};
