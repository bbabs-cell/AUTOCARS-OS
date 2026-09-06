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

import {
  connexion,
  deconnexion,
  inscription,
  moi,
  motDePasseOublie,
  rafraichis,
  reinitialise,
} from './controllers/auth';
import {
  cree as creeVehicule,
  fiche as ficheVehicule,
  liste,
  modifie as modifieVehicule,
} from './controllers/vehicles';
import { changeStatut, file } from './controllers/operations';
import { liste as listeStations } from './controllers/stations';
import { encaisse, journal, pourDossier, rembourse } from './controllers/payments';
import { courante, ferme, historique, ouvre } from './controllers/cash';
import { tableau } from './controllers/dashboard';
import {
  cree, fiche, liste as listeClients, modifie, verifieTelephone,
} from './controllers/customers';
import {
  ajoutePhoto,
  cree as creeInspection,
  montre,
  pourVehicule,
  servePhoto,
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
import {
  activite,
  affecte,
  ajoute as ajouteMembre,
  equipe,
  modifie as modifieMembre,
} from './controllers/team';
import {
  arrivee,
  corrige,
  depart,
  moi as monPointage,
  registre,
} from './controllers/attendance';
import {
  bascule as basculeService,
  cree as creeService,
  liste as listeServices,
  modifie as modifieService,
  montre as montreService,
} from './controllers/services';
import { statistiques } from './controllers/analytics';
import {
  bascule as basculeStation,
  cree as creeStation,
  modifie as modifieStation,
  montre as montreStation,
} from './controllers/stations';
import { montre as montreEntreprise, modifie as modifieEntreprise } from './controllers/organization';
import { etat as etatInstallation, termine as termineInstallation } from './controllers/onboarding';
import {
  accueille,
  affecte as affecteDossier,
  fiche as ficheDossier,
  liste as listeOperations,
  priorite,
  restitue,
  statuts as statutsOperation,
  verificationRestitution,
} from './controllers/operations';
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
        if (chemin === '/api/auth/forgot-password') return await motDePasseOublie(request, env);
        if (chemin === '/api/auth/reset-password')  return await reinitialise(request, env);
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
      const affectation = /^\/api\/team\/(\d+)\/stations$/.exec(chemin);
      const membre = /^\/api\/team\/(\d+)$/.exec(chemin);
      const pointage = /^\/api\/attendance\/(\d+)$/.exec(chemin);
      const etatService = /^\/api\/services\/(\d+)\/status$/.exec(chemin);
      const service = /^\/api\/services\/(\d+)$/.exec(chemin);
      const dossier = /^\/api\/operations\/(\d+)$/.exec(chemin);
      const prioriteDossier = /^\/api\/operations\/(\d+)\/priority$/.exec(chemin);
      const affectationDossier = /^\/api\/operations\/(\d+)\/assign$/.exec(chemin);
      const verifRestitution = /^\/api\/operations\/(\d+)\/release-check$/.exec(chemin);
      const restitution = /^\/api\/operations\/(\d+)\/release$/.exec(chemin);
      const etatStation = /^\/api\/stations\/(\d+)\/status$/.exec(chemin);
      const station = /^\/api\/stations\/(\d+)$/.exec(chemin);
      const vehicule = /^\/api\/vehicles\/(\d+)$/.exec(chemin);
      const photosInspection = /^\/api\/inspections\/(\d+)\/photos$/.exec(chemin);
      const photo = /^\/api\/photos\/(\d+)$/.exec(chemin);

      const G = request.method === 'GET';
      const P = request.method === 'POST';

      const protegee =
        (chemin === '/api/auth/me' && G) ||
        (chemin === '/api/vehicles' && (G || P)) ||
        (vehicule !== null && (G || request.method === 'PUT')) ||
        (chemin === '/api/customers/check-phone' && G) ||
        (chemin === '/api/organization' && (G || request.method === 'PUT')) ||
        (chemin === '/api/onboarding/status' && G) ||
        (chemin === '/api/onboarding/complete' && P) ||
        (etatStation !== null && request.method === 'PUT') ||
        (station !== null && (G || request.method === 'PUT')) ||
        (chemin === '/api/queue' && G) ||
        (chemin === '/api/stations' && (G || P)) ||
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
        (photosInspection !== null && P) ||
        (photo !== null && G) ||
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
        (chemin === '/api/team' && (G || P)) ||
        (chemin === '/api/team/activity' && G) ||
        (affectation !== null && request.method === 'PUT') ||
        (membre !== null && request.method === 'PUT') ||
        (chemin === '/api/attendance' && G) ||
        (chemin === '/api/attendance/me' && G) ||
        (chemin === '/api/attendance/clock-in' && P) ||
        (chemin === '/api/attendance/clock-out' && P) ||
        (pointage !== null && request.method === 'PUT') ||
        (chemin === '/api/services' && (G || P)) ||
        (etatService !== null && request.method === 'PUT') ||
        (service !== null && (G || request.method === 'PUT')) ||
        (chemin === '/api/analytics' && G) ||
        (chemin === '/api/operations' && (G || P)) ||
        (chemin === '/api/operations/statuses' && G) ||
        (dossier !== null && G) ||
        (prioriteDossier !== null && request.method === 'PUT') ||
        (affectationDossier !== null && request.method === 'PUT') ||
        (verifRestitution !== null && G) ||
        (restitution !== null && P) ||
        (statut !== null && request.method === 'PUT') ||
        (paiements !== null && (G || P)) ||
        (remboursement !== null && P);

      if (protegee) {
        const utilisateur = await identifie(request, env.DB, env.JWT_SECRET);

        if (utilisateur === null) {
          return nonAuthentifie();
        }

        if (chemin === '/api/auth/me') return moi(utilisateur);
        if (chemin === '/api/vehicles') {
          return P ? await creeVehicule(request, env, utilisateur)
                   : await liste(request, env, utilisateur);
        }

        if (vehicule !== null) {
          return G ? await ficheVehicule(env, utilisateur, vehicule[1])
                   : await modifieVehicule(request, env, utilisateur, vehicule[1]);
        }

        // AVANT « /api/customers/{id} » : « check-phone » a la même
        // forme qu'un identifiant, et le motif numérique ne l'attrape
        // pas — mais l'ordre reste écrit pour qui lirait ce routeur.
        if (chemin === '/api/customers/check-phone') {
          return await verifieTelephone(request, env, utilisateur);
        }

        if (chemin === '/api/organization') {
          return G ? await montreEntreprise(env, utilisateur)
                   : await modifieEntreprise(request, env, utilisateur);
        }

        if (chemin === '/api/onboarding/status') return await etatInstallation(env, utilisateur);
        if (chemin === '/api/onboarding/complete') return await termineInstallation(env, utilisateur);

        // « /{id}/status » avant « /{id} », comme pour les prestations.
        if (etatStation !== null) {
          return await basculeStation(request, env, utilisateur, etatStation[1]);
        }

        if (station !== null) {
          return G ? await montreStation(env, utilisateur, station[1])
                   : await modifieStation(request, env, utilisateur, station[1]);
        }
        if (chemin === '/api/queue') return await file(request, env, utilisateur);
        if (chemin === '/api/stations') {
          return P ? await creeStation(request, env, utilisateur)
                   : await listeStations(request, env, utilisateur);
        }
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

        // « /activity » avant « /{id} » : les deux ont le même nombre
        // de segments, et le premier motif qui correspond gagne.
        if (chemin === '/api/team/activity') return await activite(request, env, utilisateur);

        if (chemin === '/api/team') {
          return P ? await ajouteMembre(request, env, utilisateur)
                   : await equipe(env, utilisateur);
        }

        if (affectation !== null) {
          return await affecte(request, env, utilisateur, affectation[1]);
        }

        if (membre !== null) return await modifieMembre(request, env, utilisateur, membre[1]);

        if (chemin === '/api/attendance/me') return await monPointage(env, utilisateur);
        if (chemin === '/api/attendance/clock-in') return await arrivee(request, env, utilisateur);
        if (chemin === '/api/attendance/clock-out') return await depart(env, utilisateur);
        if (chemin === '/api/attendance') return await registre(request, env, utilisateur);
        if (pointage !== null) return await corrige(request, env, utilisateur, pointage[1]);

        if (chemin === '/api/services') {
          return P ? await creeService(request, env, utilisateur)
                   : await listeServices(request, env, utilisateur);
        }

        // « /{id}/status » avant « /{id} » : sinon la bascule d'état
        // ne serait jamais atteinte.
        if (etatService !== null) {
          return await basculeService(env, utilisateur, etatService[1]);
        }

        if (service !== null) {
          return G ? await montreService(env, utilisateur, service[1])
                   : await modifieService(request, env, utilisateur, service[1]);
        }

        if (chemin === '/api/analytics') return await statistiques(request, env, utilisateur);

        // « /statuses » avant « /{id} » : les deux ont la même forme,
        // et un routeur qui teste l'identifiant d'abord répondrait
        // « ce dossier n'existe pas » sur une adresse qui n'en
        // désigne aucun.
        if (chemin === '/api/operations/statuses') return statutsOperation(utilisateur);

        if (chemin === '/api/operations') {
          return P ? await accueille(request, env, utilisateur)
                   : await listeOperations(request, env, utilisateur);
        }

        if (prioriteDossier !== null) {
          return await priorite(request, env, utilisateur, prioriteDossier[1]);
        }

        if (affectationDossier !== null) {
          return await affecteDossier(request, env, utilisateur, affectationDossier[1]);
        }

        if (verifRestitution !== null) {
          return await verificationRestitution(env, utilisateur, verifRestitution[1]);
        }

        if (restitution !== null) return await restitue(request, env, utilisateur, restitution[1]);
        if (dossier !== null) return await ficheDossier(env, utilisateur, dossier[1]);

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

        // AVANT « /api/inspections/{id} » : l'adresse des photos est
        // plus longue, et un routeur qui teste le plus court d'abord
        // ne l'atteindrait jamais.
        if (photosInspection !== null) {
          return await ajoutePhoto(request, env, utilisateur, photosInspection[1]);
        }

        if (photo !== null) return await servePhoto(env, utilisateur, photo[1]);
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
