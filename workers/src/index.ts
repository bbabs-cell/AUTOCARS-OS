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
import { encaisse, journal, pourDossier, rembourse } from './controllers/payments';
import { courante, ferme, historique, ouvre } from './controllers/cash';
import { tableau } from './controllers/dashboard';
import { cree, fiche, liste as listeClients, modifie } from './controllers/customers';
import {
  cree as creeInspection, montre, pourVehicule,
} from './controllers/inspections';
import {
  arrive, changeStatut as changeStatutRdv, cree as creeRdv,
  liste as listeRdv, modifie as modifieRdv, montre as montreRdv, statuts,
} from './controllers/bookings';
import {
  annule as annuleRemise,
  apercu as apercuFidelite,
  carteClient,
  reglage,
  utilise,
} from './controllers/loyalty';
import {
  annule as annuleAbonnement,
  annuleUsage,
  bilan,
  consomme,
  creeForfait,
  forfaits,
  liste as listeAbonnements,
  modifieForfait,
  montre as montreAbonnement,
  vend,
} from './controllers/subscriptions';
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
      const paiements = /^\/api\/operations\/(\d+)\/payments$/.exec(chemin);
      const remboursement = /^\/api\/payments\/(\d+)\/refund$/.exec(chemin);
      const client = /^\/api\/customers\/(\d+)$/.exec(chemin);
      const inspections = /^\/api\/operations\/(\d+)\/inspections$/.exec(chemin);
      const inspection = /^\/api\/inspections\/(\d+)$/.exec(chemin);
      const inspectionsVehicule = /^\/api\/vehicles\/(\d+)\/inspections$/.exec(chemin);
      const rdv = /^\/api\/bookings\/(\d+)$/.exec(chemin);
      const rdvStatut = /^\/api\/bookings\/(\d+)\/status$/.exec(chemin);
      const rdvArrive = /^\/api\/bookings\/(\d+)\/arrive$/.exec(chemin);
      const carte = /^\/api\/loyalty\/customers\/(\d+)$/.exec(chemin);
      const annulation = /^\/api\/loyalty\/redeem\/(\d+)\/cancel$/.exec(chemin);
      const forfait = /^\/api\/subscriptions\/plans\/(\d+)$/.exec(chemin);
      const finUsage = /^\/api\/subscriptions\/use\/(\d+)\/cancel$/.exec(chemin);
      const finAbo = /^\/api\/subscriptions\/(\d+)\/cancel$/.exec(chemin);
      const abonnement = /^\/api\/subscriptions\/(\d+)$/.exec(chemin);

      const G = request.method === 'GET';
      const P = request.method === 'POST';

      const protegee =
        (chemin === '/api/auth/me' && G) ||
        (chemin === '/api/vehicles' && G) ||
        (chemin === '/api/queue' && G) ||
        (chemin === '/api/stations' && G) ||
        (chemin === '/api/payments' && G) ||
        (chemin === '/api/cash/current' && G) ||
        (chemin === '/api/cash/sessions' && G) ||
        (chemin === '/api/cash/open' && P) ||
        (chemin === '/api/cash/close' && P) ||
        (chemin === '/api/dashboard' && G) ||
        (chemin === '/api/customers' && (G || P)) ||
        (client !== null && (G || request.method === 'PUT')) ||
        (inspections !== null && P) ||
        (inspection !== null && G) ||
        (inspectionsVehicule !== null && G) ||
        (chemin === '/api/bookings/statuses' && G) ||
        (chemin === '/api/bookings' && (G || P)) ||
        (rdv !== null && (G || request.method === 'PUT')) ||
        (rdvStatut !== null && request.method === 'PUT') ||
        (rdvArrive !== null && P) ||
        (chemin === '/api/loyalty' && G) ||
        (chemin === '/api/loyalty/program' && request.method === 'PUT') ||
        (chemin === '/api/loyalty/redeem' && P) ||
        (carte !== null && G) ||
        (annulation !== null && P) ||
        (chemin === '/api/subscriptions' && (G || P)) ||
        (chemin === '/api/subscriptions/plans' && (G || P)) ||
        (chemin === '/api/subscriptions/overview' && G) ||
        (chemin === '/api/subscriptions/use' && P) ||
        (forfait !== null && request.method === 'PUT') ||
        (finUsage !== null && P) ||
        (finAbo !== null && P) ||
        (abonnement !== null && G) ||
        (statut !== null && request.method === 'PUT') ||
        (paiements !== null && (G || P)) ||
        (remboursement !== null && P);

      if (protegee) {
        const utilisateur = await identifie(request, env.DB, env.JWT_SECRET);

        if (utilisateur === null) {
          return nonAuthentifie();
        }

        if (chemin === '/api/auth/me') return moi(utilisateur);
        if (chemin === '/api/vehicles') return await liste(request, env, utilisateur);
        if (chemin === '/api/queue') return await file(request, env, utilisateur);
        if (chemin === '/api/stations') return await listeStations(request, env, utilisateur);
        if (chemin === '/api/payments') return await journal(request, env, utilisateur);
        if (chemin === '/api/cash/current') return await courante(request, env, utilisateur);
        if (chemin === '/api/cash/sessions') return await historique(request, env, utilisateur);
        if (chemin === '/api/cash/open') return await ouvre(request, env, utilisateur);
        if (chemin === '/api/cash/close') return await ferme(request, env, utilisateur);
        if (chemin === '/api/dashboard') return await tableau(request, env, utilisateur);

        if (chemin === '/api/customers') {
          return P
            ? await cree(request, env, utilisateur)
            : await listeClients(request, env, utilisateur);
        }

        if (chemin === '/api/bookings/statuses') return statuts(utilisateur);
        if (chemin === '/api/loyalty') return await apercuFidelite(request, env, utilisateur);
        if (chemin === '/api/loyalty/program') return await reglage(request, env, utilisateur);
        if (chemin === '/api/loyalty/redeem') return await utilise(request, env, utilisateur);

        // AVANT `/api/loyalty/customers/{id}` : l'annulation est une
        // adresse plus longue, et un routeur qui teste le plus court
        // d'abord ne l'atteindrait jamais.
        if (annulation !== null) return await annuleRemise(env, utilisateur, annulation[1]);
        if (carte !== null) return await carteClient(env, utilisateur, carte[1]);

        // LES ADRESSES FIXES AVANT LES VARIABLES : « /plans » et
        // « /overview » sont aussi de la forme « /subscriptions/… », et
        // un routeur qui testerait `{id}` d'abord les avalerait.
        if (chemin === '/api/subscriptions/plans') {
          return P ? await creeForfait(request, env, utilisateur)
                   : await forfaits(request, env, utilisateur);
        }

        if (chemin === '/api/subscriptions/overview') return await bilan(request, env, utilisateur);
        if (chemin === '/api/subscriptions/use') return await consomme(request, env, utilisateur);

        if (chemin === '/api/subscriptions') {
          return P ? await vend(request, env, utilisateur)
                   : await listeAbonnements(request, env, utilisateur);
        }

        if (forfait !== null) {
          return await modifieForfait(request, env, utilisateur, forfait[1]);
        }

        if (finUsage !== null) return await annuleUsage(env, utilisateur, finUsage[1]);

        if (finAbo !== null) {
          return await annuleAbonnement(request, env, utilisateur, finAbo[1]);
        }

        if (abonnement !== null) return await montreAbonnement(env, utilisateur, abonnement[1]);

        if (chemin === '/api/bookings') {
          return P ? await creeRdv(request, env, utilisateur)
                   : await listeRdv(request, env, utilisateur);
        }

        if (rdvStatut !== null) return await changeStatutRdv(request, env, utilisateur, rdvStatut[1]);
        if (rdvArrive !== null) return await arrive(request, env, utilisateur, rdvArrive[1]);

        if (rdv !== null) {
          return G ? await montreRdv(env, utilisateur, rdv[1])
                   : await modifieRdv(request, env, utilisateur, rdv[1]);
        }

        if (inspections !== null) {
          return await creeInspection(request, env, utilisateur, inspections[1]);
        }

        if (inspection !== null) return await montre(env, utilisateur, inspection[1]);

        if (inspectionsVehicule !== null) {
          return await pourVehicule(env, utilisateur, inspectionsVehicule[1]);
        }

        if (client !== null) {
          return G
            ? await fiche(env, utilisateur, client[1])
            : await modifie(request, env, utilisateur, client[1]);
        }

        if (statut !== null) return await changeStatut(request, env, utilisateur, statut[1]);

        if (paiements !== null) {
          return P
            ? await encaisse(request, env, utilisateur, paiements[1])
            : await pourDossier(env, utilisateur, paiements[1]);
        }

        if (remboursement !== null) {
          return await rembourse(request, env, utilisateur, remboursement[1]);
        }
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
