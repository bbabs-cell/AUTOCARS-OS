/**
 * Les statistiques
 * ==================================================================
 * LE SEUL MODULE QUI N'AJOUTE RIEN AU MÉTIER.
 * ==================================================================
 *
 * Aucune table, aucune colonne, aucune migration. Les autres lots ont
 * enregistré honnêtement ce qui se passait dans une station ;
 * celui-ci se contente de leur poser des questions.
 *
 * C'est aussi la meilleure preuve que le modèle tient. Un schéma qui
 * aurait pris des raccourcis — un compteur ici, un statut stocké là —
 * obligerait à ajouter des tables pour analyser ce qu'il a lui-même
 * rendu incalculable.
 *
 * ------------------------------------------------------------------
 * AUCUN NOUVEAU DROIT
 *
 * `reports.view` existe déjà et veut dire exactement cela : voir les
 * chiffres de l'entreprise. Créer `analytics.view` à côté aurait
 * donné deux droits pour une même notion, et un jour quelqu'un en
 * aurait accordé un sans l'autre.
 *
 * ------------------------------------------------------------------
 * DEUX PÉRIMÈTRES QU'IL NE FAUT JAMAIS CONFONDRE
 *
 *   L'ENCAISSÉ   l'argent reçu pendant la période. Il comprend les
 *                forfaits vendus, dont les lavages seront livrés plus
 *                tard.
 *   LE LIVRÉ     la valeur des prestations rendues pendant la
 *                période. Elle comprend des lavages payés il y a six
 *                mois, et des lavages offerts.
 *
 * Les deux sont vrais, ils ne sont pas égaux, et un écran qui les
 * mélangerait produirait des chiffres que personne ne pourrait
 * expliquer.
 *
 * ------------------------------------------------------------------
 * LA PÉRIODE EST BORNÉE À UN AN
 *
 * Pas par prudence technique — les requêtes tiennent bien plus — mais
 * parce qu'une moyenne sur trois ans mélange des tarifs, des équipes
 * et des prestations qui n'ont plus rien à voir. Un chiffre qu'on ne
 * peut pas interpréter vaut moins que pas de chiffre.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { erreur, interdit, succes } from '../core/response';

/** Au-delà, les chiffres mélangent des époques différentes. */
const JOURS_MAX = 366;

const JOUR = 86_400_000;

function lireDate(valeur: string | null): string | null {
  return valeur !== null && /^\d{4}-\d{2}-\d{2}$/.test(valeur) ? valeur : null;
}

/**
 * GET /api/analytics?from=&to=&station_id=
 *
 * TOUT L'ÉCRAN EN UNE SEULE REQUÊTE.
 *
 * Sept appels séparés donneraient sept états qui ne se rafraîchissent
 * pas ensemble : on verrait une décomposition calculée sur mars à
 * côté d'un graphique d'avril, et personne ne comprendrait pourquoi
 * les totaux ne tombent pas. Une seule réponse, une seule période,
 * des chiffres qui se recoupent.
 */
export async function statistiques(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('reports.view')) {
    return interdit();
  }

  const p = new URL(request.url).searchParams;
  const aujourdhui = new Date().toISOString().slice(0, 10);

  let jusqua = lireDate(p.get('to')) ?? aujourdhui;
  // Trente jours par défaut : assez pour voir une tendance, assez
  // court pour que les tarifs et l'équipe n'aient pas changé.
  let depuis = lireDate(p.get('from'))
    ?? new Date(Date.parse(`${jusqua}T00:00:00Z`) - 29 * JOUR).toISOString().slice(0, 10);

  // Des bornes inversées sont une faute de saisie, pas une demande :
  // on les remet à l'endroit plutôt que de renvoyer un écran vide que
  // l'utilisateur croira être la réalité.
  if (depuis > jusqua) {
    [depuis, jusqua] = [jusqua, depuis];
  }

  const jours = Math.round(
    (Date.parse(`${jusqua}T00:00:00Z`) - Date.parse(`${depuis}T00:00:00Z`)) / JOUR,
  ) + 1;

  if (jours > JOURS_MAX) {
    return erreur('Vérifiez les champs.', {
      from: `Au-delà de ${JOURS_MAX} jours, les chiffres mélangent des tarifs et des `
        + "équipes qui n'ont plus rien à voir.",
    }, 422);
  }

  const brute = p.get('station_id');
  const station = brute === null || brute === '' ? null : Number.parseInt(brute, 10);

  if (station !== null && (!Number.isInteger(station) || !await utilisateur.voitStation(station))) {
    return interdit("Vous n'êtes pas rattaché à cette station.");
  }

  const base = baseDe(utilisateur, env.DB);
  const debut = `${depuis} 00:00:00`;
  const fin = `${jusqua} 23:59:59`;

  /** Le filtre de station, préfixé par l'alias de la requête. */
  const surStation = (alias: string) =>
    station === null ? '' : ` AND ${alias}.station_id = ${station}`;

  // ==================================================================
  // JOUR PAR JOUR
  // ==================================================================
  // LES DEUX SÉRIES SONT RENVOYÉES ENSEMBLE MAIS S'AFFICHENT
  // SÉPARÉMENT. Un graphique à deux axes verticaux — véhicules à
  // gauche, francs à droite — invente une corrélation que la donnée ne
  // contient pas : l'alignement des deux échelles est arbitraire, et
  // le lecteur y voit un rapport qui n'existe pas.
  //
  // Les véhicules se comptent à leur ARRIVÉE, l'argent à son
  // ENCAISSEMENT. Ce ne sont pas les mêmes dates.
  const vehicules = await base
    .select(
      `SELECT date(o.created_at) AS jour, COUNT(*) AS n
         FROM operations o
        WHERE o.{ORG} AND o.status <> 'CANCELLED'
          AND o.created_at >= ? AND o.created_at <= ?${surStation('o')}
        GROUP BY date(o.created_at)`,
      debut, fin,
    )
    .all<{ jour: string; n: number }>();

  const recettes = await base
    .select(
      `SELECT date(p.paid_at) AS jour, COALESCE(SUM(p.amount), 0) AS total
         FROM payments p
        WHERE p.{ORG} AND p.status = 'PAID'
          AND p.paid_at >= ? AND p.paid_at <= ?${surStation('p')}
        GROUP BY date(p.paid_at)`,
      debut, fin,
    )
    .all<{ jour: string; total: number }>();

  // ON REMPLIT LES JOURS VIDES. Un graphique qui saute les dimanches
  // fermés écrase l'axe du temps : deux colonnes voisines paraissent
  // consécutives alors qu'une semaine les sépare. Un zéro affiché est
  // une information ; un jour absent est un mensonge de forme.
  const daily: { day: string; vehicles: number; revenue: number }[] = [];

  for (let t = Date.parse(`${depuis}T00:00:00Z`); t <= Date.parse(`${jusqua}T00:00:00Z`); t += JOUR) {
    const jour = new Date(t).toISOString().slice(0, 10);

    daily.push({
      day: jour,
      vehicles: vehicules.results.find((r) => r.jour === jour)?.n ?? 0,
      revenue: recettes.results.find((r) => r.jour === jour)?.total ?? 0,
    });
  }

  // ==================================================================
  // LA VALEUR DE CE QUI A ÉTÉ LIVRÉ, ET COMMENT ELLE A ÉTÉ COUVERTE
  // ==================================================================
  // Le panneau qui vérifie que le produit ne se contredit pas :
  //
  //   valeur livrée = encaissé + offert + prépayé + impayé
  //
  // Les quatre termes viennent de quatre modules différents — les
  // paiements, la fidélité, les abonnements, et le prix figé du
  // dossier. Si l'identité ne tombe pas juste, c'est qu'un de ces
  // modules ment, et l'écran le dit au lieu de le cacher.
  //
  // `unpaid` est un RESTE, pas une mesure : il se déduit des trois
  // autres. C'est volontaire — une cinquième requête qui compterait
  // les impayés séparément pourrait diverger, et on aurait deux
  // chiffres sans savoir lequel croire.
  const livre = await base
    .select(
      `SELECT COUNT(*) AS dossiers,
              COALESCE(SUM(o.price), 0) AS valeur,
              COALESCE(SUM(CASE WHEN o.discount_source = 'LOYALTY'
                                THEN o.discount_amount ELSE 0 END), 0) AS offert,
              COALESCE(SUM(CASE WHEN o.discount_source = 'SUBSCRIPTION'
                                THEN o.discount_amount ELSE 0 END), 0) AS prepaye,
              COALESCE(SUM(
                  (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                    WHERE p.operation_id = o.id AND p.status = 'PAID')
              ), 0) AS encaisse
         FROM operations o
        WHERE o.{ORG} AND o.status = 'COMPLETED'
          AND o.released_at >= ? AND o.released_at <= ?${surStation('o')}`,
      debut, fin,
    )
    .first<{ dossiers: number; valeur: number; offert: number; prepaye: number; encaisse: number }>();

  const valeur = livre?.valeur ?? 0;
  const encaisse = livre?.encaisse ?? 0;
  const offert = livre?.offert ?? 0;
  const prepaye = livre?.prepaye ?? 0;

  // Peut être NÉGATIF si un dossier a été trop encaissé — ce que l'API
  // refuse, mais qu'un remboursement mal saisi pourrait produire. On
  // ne le masque pas : un reste négatif est précisément ce qu'il faut
  // voir.
  const impaye = valeur - encaisse - offert - prepaye;

  // L'argent RÉELLEMENT REÇU. Ce n'est PAS la valeur livrée : il
  // comprend les forfaits vendus dont les lavages viendront plus tard.
  const recu = await base
    .select(
      `SELECT COALESCE(SUM(p.amount), 0) AS total,
              COALESCE(SUM(CASE WHEN p.operation_id IS NOT NULL
                                THEN p.amount ELSE 0 END), 0) AS sur_dossiers,
              COALESCE(SUM(CASE WHEN p.subscription_id IS NOT NULL
                                THEN p.amount ELSE 0 END), 0) AS sur_forfaits
         FROM payments p
        WHERE p.{ORG} AND p.status = 'PAID'
          AND p.paid_at >= ? AND p.paid_at <= ?${surStation('p')}`,
      debut, fin,
    )
    .first<{ total: number; sur_dossiers: number; sur_forfaits: number }>();

  // ==================================================================
  // CE QUI SE VEND
  // ==================================================================
  // VOLUME ET VALEUR ENSEMBLE, PARCE QUE SÉPARÉS ILS MENTENT. Soixante
  // lavages à 5 000 F et deux « intégral » à 35 000 F, ce n'est pas la
  // même conversation : le premier remplit la station, le second
  // remplit la caisse.
  const prestations = await base
    .select(
      `SELECT s.name AS prestation, COUNT(*) AS n, COALESCE(SUM(o.price), 0) AS valeur
         FROM operations o JOIN services s ON s.id = o.service_id
        WHERE o.{ORG} AND o.status <> 'CANCELLED'
          AND o.created_at >= ? AND o.created_at <= ?${surStation('o')}
        GROUP BY o.service_id, s.name
        ORDER BY valeur DESC`,
      debut, fin,
    )
    .all<{ prestation: string; n: number; valeur: number }>();

  // ==================================================================
  // À QUELLE HEURE LES VÉHICULES ARRIVENT
  // ==================================================================
  // LE CHIFFRE QUI SERT À DÉCIDER DES HORAIRES D'ÉQUIPE. Un gérant qui
  // voit que la moitié de sa journée se joue entre 8 h et 11 h
  // n'organise pas ses relèves comme celui dont l'activité est plate.
  //
  // Les 24 heures sont toujours renvoyées, y compris à zéro : un axe
  // du temps troué se lit de travers.
  const heures = await base
    .select(
      `SELECT CAST(strftime('%H', o.created_at) AS INTEGER) AS h, COUNT(*) AS n
         FROM operations o
        WHERE o.{ORG} AND o.status <> 'CANCELLED'
          AND o.created_at >= ? AND o.created_at <= ?${surStation('o')}
        GROUP BY h`,
      debut, fin,
    )
    .all<{ h: number; n: number }>();

  // ==================================================================
  // QUELS JOURS DE LA SEMAINE
  // ==================================================================
  // `strftime('%w')` renvoie 0 pour DIMANCHE et 6 pour samedi. Une
  // semaine française commence le lundi. On convertit ICI, une fois,
  // plutôt que de laisser chaque écran s'en débrouiller — c'est
  // exactement le genre de décalage qu'on ne remarque qu'en
  // production, quand le gérant dit « mais le samedi n'est pas mon
  // plus gros jour ».
  const semaine = await base
    .select(
      `SELECT CAST(strftime('%w', o.created_at) AS INTEGER) AS d, COUNT(*) AS n
         FROM operations o
        WHERE o.{ORG} AND o.status <> 'CANCELLED'
          AND o.created_at >= ? AND o.created_at <= ?${surStation('o')}
        GROUP BY d`,
      debut, fin,
    )
    .all<{ d: number; n: number }>();

  // Lundi (%w = 1) à dimanche (%w = 0).
  const LIBELLES: [number, string][] = [
    [1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'],
    [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche'],
  ];

  // ==================================================================
  // LE TEMPS ANNONCÉ CONTRE LE TEMPS RÉEL
  // ==================================================================
  // Les seuils d'alerte de la file d'attente étaient explicitement
  // « des points de départ, pas des vérités : elles viennent du bon
  // sens, pas de mesures, aucune station ne tourne encore avec le
  // produit ». Cet écran est l'endroit où les mesures arrivent.
  //
  // Si toutes les prestations dépassent systématiquement leur durée
  // annoncée, ce n'est pas l'équipe qui est lente : c'est le catalogue
  // qui ment aux clients — et c'est là qu'on s'en aperçoit.
  //
  // ON EXCLUT LES DOSSIERS DE PLUS DE HUIT HEURES. Un véhicule laissé
  // pour la nuit n'est pas un lavage long ; le compter tirerait la
  // moyenne au point de la rendre inutile. On dit combien ont été
  // écartés plutôt que de le taire.
  const MINUTES = "(julianday(o.completed_at) - julianday(o.started_at)) * 1440";

  const durees = await base
    .select(
      `SELECT s.name AS prestation, s.duration_minutes AS annonce,
              COUNT(*) AS total,
              SUM(CASE WHEN ${MINUTES} <= 480 THEN 1 ELSE 0 END) AS retenus,
              COALESCE(AVG(CASE WHEN ${MINUTES} <= 480 THEN ${MINUTES} END), 0) AS reel
         FROM operations o JOIN services s ON s.id = o.service_id
        WHERE o.{ORG} AND o.started_at IS NOT NULL AND o.completed_at IS NOT NULL
          AND o.completed_at > o.started_at
          AND o.created_at >= ? AND o.created_at <= ?${surStation('o')}
        GROUP BY o.service_id, s.name, s.duration_minutes
        ORDER BY s.name ASC`,
      debut, fin,
    )
    .all<{ prestation: string; annonce: number; total: number; retenus: number; reel: number }>();

  // ==================================================================
  // LES CLIENTS QUI REVIENNENT
  // ==================================================================
  // UN CLIENT « QUI REVIENT » EST UN CLIENT DÉJÀ VENU AVANT LE DÉBUT
  // DE LA PÉRIODE — pas quelqu'un venu deux fois cette semaine. La
  // nuance décide du sens du chiffre : la première mesure la fidélité,
  // la seconde mesure surtout la longueur de la période qu'on regarde.
  //
  // Deux ensembles calculés SÉPARÉMENT, chacun par un seul parcours.
  // La première version du PHP posait la question « ce client
  // était-il déjà venu ? » dans une sous-requête corrélée, réexécutée
  // pour chaque ligne de la période : 38 000 fois sur un an, alors
  // qu'il n'y a que quelques milliers de clients distincts. Aucun
  // index ne rattrape cela — le plan était bon, c'est la question qui
  // était mal posée.
  const clients = await base
    .select(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN avant.customer_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS revenus
         FROM (SELECT DISTINCT o.customer_id
                 FROM operations o
                WHERE o.{ORG} AND o.status <> 'CANCELLED'
                  AND o.created_at >= ? AND o.created_at <= ?${surStation('o')}) periode
    LEFT JOIN (SELECT DISTINCT a.customer_id
                 FROM operations a
                WHERE a.{ORG} AND a.status <> 'CANCELLED'
                  AND a.created_at < ?) avant ON avant.customer_id = periode.customer_id`,
      debut, fin, debut,
    )
    .first<{ total: number; revenus: number }>();

  const total = clients?.total ?? 0;
  const revenus = clients?.revenus ?? 0;

  return succes({
    period: { from: depuis, to: jusqua, days: jours },
    daily,

    delivered: {
      operations: livre?.dossiers ?? 0,
      delivered: valeur,
      paid: encaisse,
      gifted: offert,
      prepaid: prepaye,
      unpaid: impaye,
      reconciles: valeur === encaisse + offert + prepaye + impaye,
    },

    collected: {
      total: recu?.total ?? 0,
      on_operations: recu?.sur_dossiers ?? 0,
      on_subscriptions: recu?.sur_forfaits ?? 0,
    },

    services: prestations.results.map((r) => ({
      service: r.prestation,
      operations: r.n,
      value: r.valeur,
      average: r.n > 0 ? Math.floor(r.valeur / r.n) : 0,
    })),

    hours: Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      operations: heures.results.find((r) => r.h === h)?.n ?? 0,
    })),

    weekdays: LIBELLES.map(([sqlite, label], i) => ({
      weekday: i + 1,
      label,
      operations: semaine.results.find((r) => r.d === sqlite)?.n ?? 0,
    })),

    // Une moyenne sur un seul passage est une anecdote, pas une
    // mesure. Même règle qu'au tableau de bord, où le délai moyen
    // n'apparaît qu'au-delà de trois dossiers.
    durations: durees.results
      .filter((r) => r.retenus >= 3)
      .map((r) => ({
        service: r.prestation,
        announced: r.annonce,
        actual: Math.round(r.reel),
        samples: r.retenus,
        excluded: r.total - r.retenus,
      })),

    customers: { total, returning: revenus, new: Math.max(0, total - revenus) },
  });
}
