/**
 * AUTOCARE OS — API sur Cloudflare Workers
 * ==================================================================
 * ÉTAPE 1 DE LA MIGRATION : LA TRANCHE VERTICALE
 *
 * Deux routes seulement — se connecter, lister ses véhicules — mais
 * de bout en bout : jeton, relecture du rôle en base, permission
 * vérifiée côté serveur, jointure, recherche, cloisonnement.
 *
 * Le but n'est pas de livrer un morceau d'API. C'est de répondre,
 * avant de s'engager sur seize lots, à une seule question : ce
 * produit tient-il sur cette pile ? Il vaut mieux découvrir en une
 * étape qu'une contrainte de D1 rend une règle métier impraticable,
 * plutôt qu'en seize.
 *
 * L'ancien backend PHP reste intact dans backend/ tant que la
 * migration n'est pas terminée.
 */

import { connexion, deconnexion, inscription, moi, rafraichis } from './controllers/auth';
import { liste } from './controllers/vehicles';
import { changeStatut, file } from './controllers/operations';
import { liste as listeStations } from './controllers/stations';
import { identifie } from './core/auth';
import { erreur, introuvable, nonAuthentifie } from './core/response';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const chemin = new URL(request.url).pathname.replace(/\/+$/, '') || '/';

    try {
      if (chemin === '/api/health') {
        // On interroge vraiment la base : un contrôle de santé qui ne
        // vérifie que le réveil du serveur ment le jour où c'est la
        // base qui est tombée.
        await env.DB.prepare('SELECT 1').first();
        return Response.json(
          { success: true, data: { status: 'ok' }, message: '' },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }

      if (request.method === 'POST') {
        if (chemin === '/api/auth/login')    return await connexion(request, env);
        if (chemin === '/api/auth/register') return await inscription(request, env);
        if (chemin === '/api/auth/refresh')  return await rafraichis(request, env);
        if (chemin === '/api/auth/logout')   return await deconnexion(request, env);
      }

      // --------------------------------------------------------------
      // Les routes protégées.
      //
      // On identifie la ROUTE avant d'identifier l'appelant, comme le
      // faisait le routeur PHP. L'inverse renverrait 401 sur une
      // adresse qui n'existe pas, ce qui est un mensonge : le
      // problème n'est pas le jeton, c'est l'adresse.
      // --------------------------------------------------------------
      const statut = /^\/api\/operations\/(\d+)\/status$/.exec(chemin);

      const protegee =
        (chemin === '/api/auth/me' && request.method === 'GET') ||
        (chemin === '/api/vehicles' && request.method === 'GET') ||
        (chemin === '/api/queue' && request.method === 'GET') ||
        (chemin === '/api/stations' && request.method === 'GET') ||
        (statut !== null && request.method === 'PUT');

      if (protegee) {
        const utilisateur = await identifie(request, env.DB, env.JWT_SECRET);

        if (utilisateur === null) {
          return nonAuthentifie();
        }

        if (chemin === '/api/auth/me') return moi(utilisateur);
        if (chemin === '/api/vehicles') return await liste(request, env, utilisateur);
        if (chemin === '/api/queue') return await file(request, env, utilisateur);
        if (chemin === '/api/stations') return await listeStations(request, env, utilisateur);
        if (statut !== null) return await changeStatut(request, env, utilisateur, statut[1]);
      }

      return introuvable("Cette adresse n'existe pas.");
    } catch (e) {
      // On ne renvoie JAMAIS le détail d'une exception : il décrirait
      // la structure de la base et du code à qui la provoque.
      console.error('Erreur non rattrapée :', e);
      return erreur('Une erreur interne est survenue.', {}, 500);
    }
  },
} satisfies ExportedHandler<Env>;
