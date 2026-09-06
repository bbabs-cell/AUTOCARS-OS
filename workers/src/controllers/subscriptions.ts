/**
 * Les abonnements
 * ==================================================================
 * DES LAVAGES PAYÉS D'AVANCE.
 * ==================================================================
 *
 * « 10 lavages standard pour 40 000 F, valables 6 mois. »
 *
 * ------------------------------------------------------------------
 * LA QUESTION COMPTABLE, ET LA RÉPONSE
 *
 * Un client paie 40 000 F aujourd'hui pour des lavages qu'il prendra
 * sur six mois. Est-ce la recette d'aujourd'hui ?
 *
 * En comptabilité d'engagement, non : ce sont des produits constatés
 * d'avance. Ce produit ne fait PAS cette comptabilité, et c'est un
 * choix assumé :
 *
 *   · L'ARGENT EST BIEN ENTRÉ DANS LE TIROIR AUJOURD'HUI. Il doit
 *     être dans la caisse du soir, et la clôture doit tomber juste.
 *     Une caisse fausse est le pire défaut possible de ce produit.
 *   · Un gérant de station à Dakar ne tient pas une comptabilité
 *     d'engagement. Lui afficher « 4 000 F encaissés » un jour où il
 *     en a reçu 40 000 le ferait douter du logiciel, à raison.
 *
 * La vente d'un forfait est donc un ENCAISSEMENT ORDINAIRE : même
 * table, même caisse, même journal. Les lavages qui suivent ne
 * rapportent rien — ils ont déjà été payés.
 *
 * EN ÉCHANGE, ce module apporte le chiffre qui manquerait sinon :
 * CE QUI RESTE À LIVRER. Une station qui a vendu 200 lavages d'avance
 * doit 200 lavages. C'est une dette, et elle se voit.
 *
 * ------------------------------------------------------------------
 * UN LAVAGE D'ABONNÉ N'EST PAS UN CADEAU
 *
 * Un lavage couvert par un forfait ramène le dû à zéro et emprunte la
 * même colonne `discount_amount` que la fidélité — mais
 * `discount_source` les distingue, et ce n'est pas un détail :
 *
 *   FIDÉLITÉ     la station DONNE. C'est un coût.
 *   ABONNEMENT   le client a DÉJÀ PAYÉ. C'est une dette qu'on solde.
 *
 * Sans cette distinction, l'écran de fidélité annoncerait au gérant
 * qu'il offre un argent qu'il a en réalité encaissé six mois plus
 * tôt.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import type { TenantDb } from '../core/db';
import { enregistre } from '../core/audit';
import { erreur, interdit, introuvable, succes } from '../core/response';
import { attribueSiRegle } from '../core/fidelite';
import { dossierComplet, dossiersOu } from './operations';

const MOYENS = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'OTHER'];

/** Aujourd'hui, en `AAAA-MM-JJ`. */
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const dansNJours = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

function lireDate(valeur: string | null): string | null {
  return valeur !== null && /^\d{4}-\d{2}-\d{2}$/.test(valeur) ? valeur : null;
}

// ====================================================================
// LES FORFAITS PROPOSÉS
// ====================================================================

interface LignePlan {
  id: number;
  name: string;
  service_id: number;
  service_name: string | null;
  service_price: number;
  service_status: string | null;
  washes: number;
  price: number;
  validity_days: number;
  status: string;
  sold_count: number;
}

const PLAN = `
  SELECT p.id, p.name, p.service_id, p.washes, p.price, p.validity_days, p.status,
         s.name AS service_name, s.price AS service_price, s.status AS service_status,
         (SELECT COUNT(*) FROM subscriptions sub WHERE sub.plan_id = p.id) AS sold_count
    FROM subscription_plans p
    JOIN services s ON s.id = p.service_id`;

function presentePlan(p: LignePlan) {
  const complet = p.service_price * p.washes;

  return {
    id: p.id,
    name: p.name,
    service_id: p.service_id,
    service_name: p.service_name,
    service_price: p.service_price,
    washes: p.washes,
    price: p.price,
    validity_days: p.validity_days,
    status: p.status,
    is_active: p.status === 'ACTIVE',
    sold_count: p.sold_count,

    // CE QUE LE CLIENT ÉCONOMISE, calculé ici plutôt qu'à l'écran :
    // c'est l'argument de vente, et il doit être le même partout où
    // il s'affiche.
    full_price: complet,
    saving: Math.max(0, complet - p.price),
  };
}

/** GET /api/subscriptions/plans?active=1 */
export async function forfaits(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('subscriptions.view')) {
    return interdit();
  }

  const actifsSeuls = new URL(request.url).searchParams.get('active') === '1';

  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `${PLAN} WHERE p.{ORG}${actifsSeuls ? " AND p.status = 'ACTIVE'" : ''}
        ORDER BY p.status = 'ACTIVE' DESC, p.name ASC`,
    )
    .all<LignePlan>();

  return succes({ plans: lignes.results.map(presentePlan) });
}

/**
 * Lit et vérifie les champs d'un forfait.
 *
 * Renvoie soit les valeurs, soit la réponse d'erreur à retourner
 * telle quelle : un contrôleur qui doit se souvenir de tester deux
 * choses finit par en oublier une.
 */
async function litForfait(
  request: Request,
  base: TenantDb,
): Promise<{ valeurs: [string, number, number, number, number, string] } | { refus: Response }> {
  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return { refus: erreur('Le corps de la requête est illisible.') };
  }

  const nom = typeof corps.name === 'string' ? corps.name.trim() : '';

  if (nom === '' || nom.length > 120) {
    return {
      refus: erreur('Vérifiez les champs.', {
        name: nom === '' ? 'Le nom est obligatoire.' : 'Ce nom est trop long.',
      }, 422),
    };
  }

  const entier = (v: unknown, defaut: number) => {
    if (v === undefined || v === null || v === '') {
      return defaut;
    }

    const n = typeof v === 'number' ? v : Number(v);

    return Number.isFinite(n) ? Math.trunc(n) : Number.NaN;
  };

  const lavages = entier(corps.washes, 0);
  const prix = entier(corps.price, 0);
  const jours = entier(corps.validity_days, 180);
  const statut = String(corps.status ?? 'ACTIVE').toUpperCase();

  // Un forfait d'un seul lavage n'est pas un forfait, c'est un
  // lavage. Au-delà de cinquante, la station s'engage sur une durée
  // qu'elle ne maîtrise plus.
  if (!(lavages >= 2 && lavages <= 50)) {
    return {
      refus: erreur('Vérifiez les champs.', {
        washes: "Entre 2 et 50 lavages. Un seul lavage n'est pas un forfait.",
      }, 422),
    };
  }

  if (!(prix > 0)) {
    return { refus: erreur('Vérifiez les champs.', { price: 'Un forfait a un prix.' }, 422) };
  }

  // Un forfait sans fin est une dette éternelle ; au-delà de deux
  // ans, les tarifs auront changé plusieurs fois.
  if (!(jours >= 7 && jours <= 730)) {
    return {
      refus: erreur('Vérifiez les champs.', {
        validity_days: 'Entre 7 et 730 jours. Un forfait sans date de fin est une dette éternelle.',
      }, 422),
    };
  }

  if (statut !== 'ACTIVE' && statut !== 'INACTIVE') {
    return { refus: erreur('Vérifiez les champs.', { status: 'Statut inconnu.' }, 422) };
  }

  const serviceId = entier(corps.service_id, 0);

  const service = await base
    .select('SELECT id FROM services WHERE {ORG} AND id = ? LIMIT 1', serviceId)
    .first<{ id: number }>();

  if (service === null) {
    return {
      refus: erreur('Vérifiez les champs.', {
        service_id: "Cette prestation n'existe pas.",
      }, 422),
    };
  }

  return { valeurs: [nom, service.id, lavages, prix, jours, statut] };
}

/** POST /api/subscriptions/plans */
export async function creeForfait(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('subscriptions.manage')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const lu = await litForfait(request, base);

  if ('refus' in lu) {
    return lu.refus;
  }

  const r = await env.DB
    .prepare(
      `INSERT INTO subscription_plans (organization_id, name, service_id, washes, price,
                                       validity_days, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(utilisateur.organizationId, ...lu.valeurs, utilisateur.id)
    .run();

  const id = Number(r.meta.last_row_id);

  await enregistre(env.DB, {
    action: 'subscription.plan_created',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'subscription_plan',
    entityId: id,
    metadata: { name: lu.valeurs[0], washes: lu.valeurs[2], price: lu.valeurs[3] },
  });

  const plan = await base.select(`${PLAN} WHERE p.{ORG} AND p.id = ?`, id).first<LignePlan>();

  return succes({ plan: plan === null ? null : presentePlan(plan) }, 'Forfait créé.', 201);
}

/** PUT /api/subscriptions/plans/{id} */
export async function modifieForfait(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  planId: string,
): Promise<Response> {
  if (!utilisateur.peut('subscriptions.manage')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(planId, 10);

  const existant = await base
    .select(`${PLAN} WHERE p.{ORG} AND p.id = ?`, id)
    .first<LignePlan>();

  if (existant === null) {
    return introuvable("Ce forfait n'existe pas.");
  }

  const lu = await litForfait(request, base);

  if ('refus' in lu) {
    return lu.refus;
  }

  await base
    .select(
      `UPDATE subscription_plans
          SET name = ?, service_id = ?, washes = ?, price = ?, validity_days = ?, status = ?
        WHERE {ORG} AND id = ?`,
      ...lu.valeurs, id,
    )
    .run();

  await enregistre(env.DB, {
    action: 'subscription.plan_updated',
    organizationId: utilisateur.organizationId,
    userId: utilisateur.id,
    entityType: 'subscription_plan',
    entityId: id,
    // L'avant ET l'après : modifier un forfait ne change RIEN aux
    // abonnements déjà vendus, mais il faut pouvoir expliquer
    // pourquoi deux clients ont des droits différents sur le même
    // produit.
    metadata: {
      from: {
        washes: existant.washes, price: existant.price,
        validity_days: existant.validity_days, status: existant.status,
      },
      to: {
        washes: lu.valeurs[2], price: lu.valeurs[3],
        validity_days: lu.valeurs[4], status: lu.valeurs[5],
      },
    },
  });

  const plan = await base.select(`${PLAN} WHERE p.{ORG} AND p.id = ?`, id).first<LignePlan>();

  return succes(
    { plan: plan === null ? null : presentePlan(plan) },
    'Forfait modifié. Les abonnements déjà vendus ne changent pas.',
  );
}

// ====================================================================
// LES ABONNEMENTS VENDUS
// ====================================================================

interface LigneAbonnement {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  plan_id: number;
  plan_name: string | null;
  service_id: number;
  service_name: string | null;
  station_id: number;
  station_name: string | null;
  washes_total: number;
  washes_used: number;
  price_paid: number;
  starts_at: string;
  expires_at: string;
  status: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  notes: string | null;
  sold_by_name: string | null;
  created_at: string;
}

const ABONNEMENT = `
  SELECT s.id, s.customer_id, s.plan_id, s.service_id, s.station_id,
         s.washes_total, s.price_paid, s.starts_at, s.expires_at, s.status,
         s.cancelled_at, s.cancellation_reason, s.notes, s.created_at,
         c.first_name || ' ' || c.last_name AS customer_name,
         c.phone AS customer_phone,
         p.name  AS plan_name,
         srv.name AS service_name,
         st.name AS station_name,
         u.first_name || ' ' || u.last_name AS sold_by_name,
         (SELECT COUNT(*) FROM operations o
           WHERE o.subscription_id = s.id AND o.status <> 'CANCELLED') AS washes_used
    FROM subscriptions s
    JOIN customers c   ON c.id = s.customer_id
    JOIN subscription_plans p ON p.id = s.plan_id
    JOIN services srv  ON srv.id = s.service_id
    JOIN stations st   ON st.id = s.station_id
    JOIN users u       ON u.id = s.sold_by_user_id`;

/**
 * « Ni annulé, ni périmé, ni épuisé », en SQL.
 *
 * Écrit une seule fois : c'est la définition d'un forfait utilisable,
 * et elle est lue par la liste, par la sélection automatique et par
 * la vérification faite avant chaque consommation. Trois copies
 * auraient fini par diverger, et un forfait périmé serait passé
 * quelque part.
 */
const UTILISABLE = `(s.status = 'ACTIVE'
   AND s.expires_at >= date('now')
   AND (SELECT COUNT(*) FROM operations o
         WHERE o.subscription_id = s.id AND o.status <> 'CANCELLED') < s.washes_total)`;

const ETATS: Record<string, string> = {
  ACTIVE: 'Actif',
  EXPIRED: 'Périmé',
  EXHAUSTED: 'Épuisé',
  CANCELLED: 'Annulé',
};

function presente(r: LigneAbonnement) {
  const reste = Math.max(0, r.washes_total - r.washes_used);
  const perime = r.expires_at < aujourdhui();

  // ==============================================================
  // L'ÉTAT EST CALCULÉ, JAMAIS LU DANS UNE COLONNE.
  // ==============================================================
  // Seule l'annulation est stockée : c'est la seule qui soit une
  // décision. « Périmé » se lit dans une date, « épuisé » se compte.
  // Les stocker aurait supposé une tâche planifiée nocturne — et un
  // forfait qui reste actif le jour où elle échoue.
  const etat = r.status === 'CANCELLED' ? 'CANCELLED'
    : perime ? 'EXPIRED'
    : reste === 0 ? 'EXHAUSTED'
    : 'ACTIVE';

  return {
    id: r.id,
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    customer_phone: r.customer_phone,

    plan_id: r.plan_id,
    plan_name: r.plan_name,
    service_id: r.service_id,
    service_name: r.service_name,
    station_id: r.station_id,
    station_name: r.station_name,

    washes_total: r.washes_total,
    washes_used: r.washes_used,
    washes_left: reste,
    price_paid: r.price_paid,

    starts_at: r.starts_at,
    expires_at: r.expires_at,
    days_left: perime
      ? 0
      : Math.round(
          (new Date(`${r.expires_at}T00:00:00Z`).getTime()
            - new Date(`${aujourdhui()}T00:00:00Z`).getTime()) / 86_400_000,
        ),

    state: etat,
    state_label: ETATS[etat] ?? etat,
    is_usable: etat === 'ACTIVE',

    cancelled_at: r.cancelled_at,
    cancellation_reason: r.cancellation_reason,

    notes: r.notes,
    sold_by_name: r.sold_by_name,
    created_at: r.created_at,
  };
}

/** GET /api/subscriptions?customer_id=&usable=1&search= */
export async function liste(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('subscriptions.view')) {
    return interdit();
  }

  const p = new URL(request.url).searchParams;
  const conditions: string[] = [];
  const parametres: unknown[] = [];

  for (const colonne of ['customer_id', 'station_id', 'plan_id']) {
    const v = p.get(colonne);
    const n = v === null ? Number.NaN : Number.parseInt(v, 10);

    if (Number.isInteger(n) && n > 0) {
      conditions.push(`s.${colonne} = ?`);
      parametres.push(n);
    }
  }

  if (p.get('usable') === '1') {
    conditions.push(UTILISABLE);
  }

  const recherche = (p.get('search') ?? '').trim();

  if (recherche !== '') {
    conditions.push("(c.first_name || ' ' || c.last_name LIKE ? OR c.phone LIKE ?)");
    parametres.push(`%${recherche}%`, `%${recherche}%`);
  }

  const suite = conditions.length === 0 ? '' : ` AND ${conditions.join(' AND ')}`;

  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `${ABONNEMENT} WHERE s.{ORG}${suite} ORDER BY s.expires_at ASC, s.id DESC LIMIT 200`,
      ...parametres,
    )
    .all<LigneAbonnement>();

  return succes({ subscriptions: lignes.results.map(presente) });
}

/**
 * GET /api/subscriptions/overview?from=&to=
 *
 * Le bilan : ce qui a été vendu, ce qui a été livré, et surtout CE
 * QUI RESTE À LIVRER.
 */
export async function bilan(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('subscriptions.view')) {
    return interdit();
  }

  const p = new URL(request.url).searchParams;
  const jour = aujourdhui();
  const depuis = lireDate(p.get('from')) ?? `${jour.slice(0, 7)}-01`;
  const jusqua = lireDate(p.get('to')) ?? jour;
  const base = baseDe(utilisateur, env.DB);

  const vendus = await base
    .select(
      `SELECT COUNT(*) AS n, COALESCE(SUM(price_paid), 0) AS total
         FROM subscriptions
        WHERE {ORG} AND created_at >= ? AND created_at <= ?`,
      `${depuis} 00:00:00`, `${jusqua} 23:59:59`,
    )
    .first<{ n: number; total: number }>();

  const livres = await base
    .select(
      `SELECT COUNT(*) AS n FROM operations
        WHERE {ORG} AND subscription_id IS NOT NULL AND status <> 'CANCELLED'
          AND created_at >= ? AND created_at <= ?`,
      `${depuis} 00:00:00`, `${jusqua} 23:59:59`,
    )
    .first<{ n: number }>();

  // La VALEUR de ce qui a été livré, au prix des prestations. Ce
  // n'est PAS de la recette — elle a été encaissée le jour de la
  // vente — c'est de la dette soldée. Les deux chiffres côte à côte
  // disent si la station livre plus vite qu'elle ne vend.
  const valeurLivree = await base
    .select(
      `SELECT COALESCE(SUM(discount_amount), 0) AS n FROM operations
        WHERE {ORG} AND discount_amount > 0 AND discount_source = 'SUBSCRIPTION'
          AND discounted_at >= ? AND discounted_at <= ?`,
      `${depuis} 00:00:00`, `${jusqua} 23:59:59`,
    )
    .first<{ n: number }>();

  // ==============================================================
  // LA DETTE. Le chiffre qui n'existerait pas sans ce module.
  // ==============================================================
  // Une station qui a vendu 200 lavages d'avance DOIT 200 lavages.
  // L'argent est encaissé depuis longtemps ; la prestation, non.
  //
  // Les forfaits périmés n'y figurent pas : la station ne les doit
  // plus. C'est justement pour cela que la durée de validité est
  // obligatoire.
  const reste = await base
    .select(
      `SELECT COUNT(*) AS forfaits,
              COALESCE(SUM(s.washes_total - u.n), 0) AS lavages,
              -- La valeur au prix du catalogue d'AUJOURD'HUI : ce que
              -- ces lavages coûteraient s'ils étaient tous réclamés
              -- demain.
              COALESCE(SUM((s.washes_total - u.n) * srv.price), 0) AS valeur
         FROM subscriptions s
         JOIN services srv ON srv.id = s.service_id
         JOIN (SELECT sub.id,
                      (SELECT COUNT(*) FROM operations o
                        WHERE o.subscription_id = sub.id
                          AND o.status <> 'CANCELLED') AS n
                 FROM subscriptions sub) AS u ON u.id = s.id
        WHERE s.{ORG} AND s.status = 'ACTIVE'
          AND s.expires_at >= date('now')
          AND u.n < s.washes_total`,
    )
    .first<{ forfaits: number; lavages: number; valeur: number }>();

  // Ceux dont le forfait se périme bientôt : un appel, et le client
  // vient user ce qu'il a payé. C'est le seul bloc actionnable de
  // l'écran.
  const bientot = await base
    .select(
      `${ABONNEMENT} WHERE s.{ORG} AND ${UTILISABLE} AND s.expires_at <= ?
        ORDER BY s.expires_at ASC LIMIT 200`,
      dansNJours(30),
    )
    .all<LigneAbonnement>();

  return succes({
    sold: { count: vendus?.n ?? 0, amount: vendus?.total ?? 0 },
    delivered: { washes: livres?.n ?? 0, value: valeurLivree?.n ?? 0 },
    outstanding: {
      subscriptions: reste?.forfaits ?? 0,
      washes: reste?.lavages ?? 0,
      value: reste?.valeur ?? 0,
    },
    expiring: bientot.results.map(presente),
    period: { from: depuis, to: jusqua },
  });
}

/** GET /api/subscriptions/{id} */
export async function montre(
  env: Env,
  utilisateur: Utilisateur,
  abonnementId: string,
): Promise<Response> {
  if (!utilisateur.peut('subscriptions.view')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(abonnementId, 10);

  const ligne = await base
    .select(`${ABONNEMENT} WHERE s.{ORG} AND s.id = ? LIMIT 1`, id)
    .first<LigneAbonnement>();

  if (ligne === null) {
    return introuvable("Cet abonnement n'existe pas.");
  }

  return succes({
    subscription: presente(ligne),
    // Les lavages déjà pris : c'est ce que le client demande quand il
    // conteste son solde.
    operations: await dossiersOu(base, 'AND o.subscription_id = ?', id),
  });
}

/**
 * POST /api/subscriptions
 * ==================================================================
 * VENDRE UN FORFAIT.
 * ==================================================================
 * Deux écritures, une seule transaction : l'abonnement et
 * l'encaissement. L'un sans l'autre, et soit le client a payé sans
 * rien recevoir, soit la station a donné dix lavages sans
 * contrepartie dans la caisse.
 */
export async function vend(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('subscriptions.sell')) {
    return interdit();
  }

  let corps: Record<string, unknown>;

  try {
    corps = (await request.json()) as Record<string, unknown>;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const nombre = (cle: string) => {
    const v = corps[cle];
    const n = typeof v === 'number' ? v : Number(v);

    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const manquants: Record<string, string> = {};
  const clientId = nombre('customer_id');
  const forfaitId = nombre('plan_id');
  const stationId = nombre('station_id');
  const moyen = String(corps.method ?? '');

  if (clientId === null) manquants.customer_id = 'Le client est obligatoire.';
  if (forfaitId === null) manquants.plan_id = 'Le forfait est obligatoire.';
  if (stationId === null) manquants.station_id = 'La station est obligatoire.';
  if (!MOYENS.includes(moyen)) manquants.method = 'Le moyen de paiement est obligatoire.';

  if (Object.keys(manquants).length > 0) {
    return erreur('Vérifiez les champs.', manquants, 422);
  }

  if (!await utilisateur.voitStation(stationId!)) {
    return interdit("Vous n'êtes pas rattaché à cette station.");
  }

  const base = baseDe(utilisateur, env.DB);

  const client = await base
    .select('SELECT id FROM customers WHERE {ORG} AND id = ? LIMIT 1', clientId)
    .first();

  if (client === null) {
    return erreur('Vérifiez les champs.', { customer_id: "Ce client n'existe pas." }, 422);
  }

  const forfait = await base
    .select(`${PLAN} WHERE p.{ORG} AND p.id = ? LIMIT 1`, forfaitId)
    .first<LignePlan>();

  if (forfait === null) {
    return erreur('Vérifiez les champs.', { plan_id: "Ce forfait n'existe pas." }, 422);
  }

  if (forfait.status !== 'ACTIVE') {
    return erreur('Vérifiez les champs.', {
      plan_id: "Ce forfait n'est plus proposé. Choisissez-en un autre.",
    }, 422);
  }

  // La prestation couverte doit exister encore : vendre dix lavages
  // d'une prestation retirée du catalogue, c'est vendre quelque chose
  // qu'on ne sait plus faire.
  if (forfait.service_status !== 'ACTIVE') {
    return erreur('Vérifiez les champs.', {
      plan_id: "La prestation de ce forfait n'est plus proposée.",
    }, 422);
  }

  const debut = aujourdhui();
  const fin = dansNJours(Math.max(1, forfait.validity_days));

  const session = await base
    .select(
      "SELECT id FROM cash_sessions WHERE {ORG} AND station_id = ? AND status = 'OPEN' LIMIT 1",
      stationId,
    )
    .first<{ id: number }>();

  const texte = (v: unknown) =>
    typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 1000) : null;

  const ecrit = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO subscriptions (organization_id, customer_id, plan_id, station_id, service_id,
                                  washes_total, price_paid, starts_at, expires_at, status,
                                  notes, sold_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
    ).bind(
      utilisateur.organizationId, clientId, forfaitId, stationId,
      // TOUT EST RECOPIÉ : modifier le forfait le mois prochain ne
      // doit rien retirer à ce client.
      forfait.service_id, forfait.washes, forfait.price, debut, fin,
      texte(corps.notes), utilisateur.id,
    ),
    // L'ENCAISSEMENT PASSE PAR LA TABLE HABITUELLE. Il entre donc dans
    // la caisse, dans le journal et dans la recette du jour sans
    // qu'on ait rien à ajouter — et il pourra être remboursé par la
    // route existante.
    env.DB.prepare(
      `INSERT INTO payments (organization_id, station_id, cash_session_id, subscription_id,
                             customer_id, amount, method, provider, external_reference,
                             status, paid_at, recorded_by_user_id, notes)
       VALUES (?, ?, ?, last_insert_rowid(), ?, ?, ?, ?, ?, 'PAID', datetime('now'), ?, ?)`,
    ).bind(
      utilisateur.organizationId, stationId, session?.id ?? null,
      clientId, forfait.price, moyen,
      texte(corps.provider), texte(corps.external_reference),
      utilisateur.id, `Forfait « ${forfait.name} »`,
    ),
  ]);

  const abonnementId = Number(ecrit[0].meta.last_row_id);

  await enregistre(env.DB, {
    action: 'subscription.sold',
    organizationId: utilisateur.organizationId,
    stationId,
    userId: utilisateur.id,
    entityType: 'subscription',
    entityId: abonnementId,
    metadata: {
      customer_id: clientId, plan: forfait.name, washes: forfait.washes,
      amount: forfait.price, method: moyen, expires_at: fin,
    },
  });

  const avertissements: string[] = [];

  // Un encaissement en espèces hors session de caisse ne sera pas
  // dans la clôture du soir.
  if (moyen === 'CASH' && session === null) {
    avertissements.push(
      "La caisse n'est pas ouverte : cet encaissement ne sera pas dans la clôture du soir.",
    );
  }

  const ligne = await base
    .select(`${ABONNEMENT} WHERE s.{ORG} AND s.id = ? LIMIT 1`, abonnementId)
    .first<LigneAbonnement>();

  const [a, m, j] = fin.split('-');

  return succes(
    {
      subscription: ligne === null ? null : presente(ligne),
      warnings: avertissements,
    },
    `${forfait.name} vendu : ${forfait.washes} lavages jusqu'au ${j}/${m}/${a}.`,
    201,
  );
}

/**
 * POST /api/subscriptions/{id}/cancel
 *
 * ON N'INVENTE AUCUN REMBOURSEMENT AU PRORATA. Combien rendre à un
 * client qui a pris trois lavages sur dix est une décision
 * commerciale, pas un calcul : le forfait était vendu moins cher que
 * trois lavages à l'unité, et la station peut vouloir garder la
 * différence, ou pas.
 *
 * L'annulation ARRÊTE le forfait. Le remboursement éventuel passe par
 * la route de remboursement existante, sur l'encaissement d'origine —
 * là où il est tracé comme n'importe quelle sortie d'argent.
 */
export async function annule(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
  abonnementId: string,
): Promise<Response> {
  if (!utilisateur.peut('subscriptions.manage')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const id = Number.parseInt(abonnementId, 10);

  const ligne = await base
    .select(`${ABONNEMENT} WHERE s.{ORG} AND s.id = ? LIMIT 1`, id)
    .first<LigneAbonnement>();

  if (ligne === null) {
    return introuvable("Cet abonnement n'existe pas.");
  }

  if (ligne.status === 'CANCELLED') {
    return erreur('Cet abonnement est déjà annulé.', {}, 409);
  }

  let corps: { reason?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  const motif = typeof corps.reason === 'string' ? corps.reason.trim() : '';

  // LE MOTIF EST OBLIGATOIRE ICI, contrairement à l'annulation d'un
  // rendez-vous. La différence : de l'argent a été encaissé. Un
  // client qui réclame six mois plus tard doit trouver une
  // explication, pas une ligne muette.
  if (motif === '' || motif.length > 255) {
    return erreur('Vérifiez les champs.', {
      reason: motif === '' ? 'Le motif est obligatoire.' : 'Ce motif est trop long.',
    }, 422);
  }

  await base
    .select(
      `UPDATE subscriptions
          SET status = 'CANCELLED', cancelled_at = datetime('now'),
              cancelled_by_user_id = ?, cancellation_reason = ?
        WHERE {ORG} AND id = ?`,
      utilisateur.id, motif, id,
    )
    .run();

  await enregistre(env.DB, {
    action: 'subscription.cancelled',
    organizationId: utilisateur.organizationId,
    stationId: ligne.station_id,
    userId: utilisateur.id,
    entityType: 'subscription',
    entityId: id,
    metadata: {
      reason: motif, washes_used: ligne.washes_used,
      washes_total: ligne.washes_total, price_paid: ligne.price_paid,
    },
  });

  const reste = Math.max(0, ligne.washes_total - ligne.washes_used);

  const apres = await base
    .select(`${ABONNEMENT} WHERE s.{ORG} AND s.id = ? LIMIT 1`, id)
    .first<LigneAbonnement>();

  return succes(
    { subscription: apres === null ? null : presente(apres) },
    reste > 0
      ? `Abonnement annulé. Il restait ${reste} lavage(s) : un remboursement éventuel se fait `
        + 'depuis le journal des encaissements.'
      : 'Abonnement annulé.',
  );
}

// ====================================================================
// CONSOMMER UN LAVAGE
// ====================================================================

interface LigneDossier {
  id: number;
  station_id: number;
  customer_id: number;
  service_id: number;
  service_name: string;
  status: string;
  price: number;
  discount_amount: number;
  discount_source: string | null;
  subscription_id: number | null;
  reference: string;
  paid_amount: number;
}

const DOSSIER = `
  SELECT o.id, o.station_id, o.customer_id, o.service_id, o.status, o.price,
         o.discount_amount, o.discount_source, o.subscription_id, o.reference,
         srv.name AS service_name,
         (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
           WHERE p.operation_id = o.id AND p.status = 'PAID') AS paid_amount
    FROM operations o JOIN services srv ON srv.id = o.service_id
   WHERE o.{ORG} AND o.id = ? LIMIT 1`;

/**
 * POST /api/subscriptions/use
 *
 * Le client présente son forfait au comptoir. Le SERVEUR choisit
 * lequel utiliser : celui qui expire le plus tôt, dans l'intérêt du
 * client.
 */
export async function consomme(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  if (!utilisateur.peut('subscriptions.use')) {
    return interdit();
  }

  let corps: { operation_id?: unknown };

  try {
    corps = (await request.json()) as typeof corps;
  } catch {
    return erreur('Le corps de la requête est illisible.');
  }

  if (corps.operation_id === undefined || corps.operation_id === null || corps.operation_id === '') {
    return erreur('Vérifiez les champs.', { operation_id: 'Le dossier est obligatoire.' }, 422);
  }

  const base = baseDe(utilisateur, env.DB);
  const dossier = await base.select(DOSSIER, Number(corps.operation_id)).first<LigneDossier>();

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  if (!await utilisateur.voitStation(dossier.station_id)) {
    return interdit("Vous n'êtes pas rattaché à cette station.");
  }

  if (dossier.status === 'COMPLETED' || dossier.status === 'CANCELLED') {
    return erreur('Ce dossier est clos : le forfait ne peut plus y être appliqué.', {}, 409);
  }

  if (dossier.subscription_id !== null) {
    return erreur('Ce dossier est déjà couvert par un forfait.', {}, 409);
  }

  // Un dossier déjà remisé par la fidélité ne peut pas être couvert
  // en plus par un forfait : les deux ramènent le dû à zéro, et le
  // client perdrait des tampons pour rien.
  if (dossier.discount_amount > 0) {
    return erreur(
      "Une remise est déjà appliquée à ce dossier. Retirez-la avant d'utiliser un forfait.",
      {}, 409,
    );
  }

  if (dossier.paid_amount > 0) {
    return erreur(
      "Ce dossier a déjà été réglé en partie : le forfait ne peut plus s'y appliquer.",
      {}, 409,
    );
  }

  // CELUI QUI EXPIRE LE PLUS TÔT : le client ne perd pas le forfait
  // dont la date approche pendant qu'on entame le suivant.
  const abonnement = await base
    .select(
      `${ABONNEMENT} WHERE s.{ORG} AND s.customer_id = ? AND s.service_id = ? AND ${UTILISABLE}
        ORDER BY s.expires_at ASC, s.id ASC LIMIT 1`,
      dossier.customer_id, dossier.service_id,
    )
    .first<LigneAbonnement>();

  if (abonnement === null) {
    return erreur(
      `Ce client n'a pas de forfait utilisable pour « ${dossier.service_name} ».`,
      {}, 409,
    );
  }

  await base
    .select(
      `UPDATE operations
          SET subscription_id = ?, discount_amount = ?, discount_source = 'SUBSCRIPTION',
              discount_reason = ?, discount_by_user_id = ?, discounted_at = datetime('now')
        WHERE {ORG} AND id = ?`,
      abonnement.id,
      // La remise couvre TOUT le dossier : le lavage est payé depuis
      // le jour de la vente du forfait.
      dossier.price,
      `Forfait « ${abonnement.plan_name} » — lavage ${abonnement.washes_used + 1} `
      + `sur ${abonnement.washes_total}`,
      utilisateur.id, dossier.id,
    )
    .run();

  // ==============================================================
  // UN LAVAGE D'ABONNÉ RAPPORTE UN TAMPON DE FIDÉLITÉ
  // ==============================================================
  // Il a été payé — d'avance, mais payé. Le contraire punirait le
  // client le plus fidèle de la station.
  //
  // Sans cet appel, le tampon ne serait attribué que depuis le
  // contrôleur des paiements, donc jamais sur un dossier soldé sans
  // encaissement.
  let solde: number | null = null;

  try {
    const tampon = await attribueSiRegle(
      base, env.DB,
      {
        id: dossier.id,
        customer_id: dossier.customer_id,
        price: dossier.price,
        discount_amount: dossier.price,
        discount_source: 'SUBSCRIPTION',
        reference: dossier.reference,
        paid_amount: 0,
      },
      utilisateur.id, utilisateur.organizationId,
    );

    solde = tampon.awarded ? tampon.balance : null;
  } catch (e) {
    console.error("Fidélité indisponible pendant l'usage d'un forfait :", e);
  }

  await enregistre(env.DB, {
    action: 'subscription.used',
    organizationId: utilisateur.organizationId,
    stationId: dossier.station_id,
    userId: utilisateur.id,
    entityType: 'operation',
    entityId: dossier.id,
    metadata: {
      subscription_id: abonnement.id,
      reference: dossier.reference,
      // La VALEUR du lavage livré : c'est ce qui permet de mesurer la
      // dette soldée, et de vérifier des mois plus tard qu'un forfait
      // a bien été honoré.
      value: dossier.price,
      wash: abonnement.washes_used + 1,
      of: abonnement.washes_total,
    },
  });

  const apres = await base
    .select(`${ABONNEMENT} WHERE s.{ORG} AND s.id = ? LIMIT 1`, abonnement.id)
    .first<LigneAbonnement>();

  const reste = apres === null ? 0 : Math.max(0, apres.washes_total - apres.washes_used);

  return succes(
    {
      operation: await dossierComplet(base, dossier.id),
      subscription: apres === null ? null : presente(apres),
      loyalty_balance: solde,
    },
    reste > 0
      ? `Lavage décompté du forfait. Il en reste ${reste}.`
      : "Lavage décompté. C'était le dernier du forfait.",
  );
}

/**
 * POST /api/subscriptions/use/{operationId}/cancel
 *
 * Le forfait a été appliqué au mauvais dossier. Le lavage est rendu
 * au client — il suffit de détacher l'opération, puisque c'est elle
 * qui compte.
 */
export async function annuleUsage(
  env: Env,
  utilisateur: Utilisateur,
  operationId: string,
): Promise<Response> {
  if (!utilisateur.peut('subscriptions.use')) {
    return interdit();
  }

  const base = baseDe(utilisateur, env.DB);
  const dossier = await base
    .select(DOSSIER, Number.parseInt(operationId, 10))
    .first<LigneDossier>();

  if (dossier === null) {
    return introuvable("Ce dossier n'existe pas.");
  }

  if (!await utilisateur.voitStation(dossier.station_id)) {
    return interdit("Vous n'êtes pas rattaché à cette station.");
  }

  if (dossier.subscription_id === null) {
    return erreur("Aucun forfait n'est appliqué à ce dossier.", {}, 409);
  }

  // Après restitution, retirer le forfait ferait réapparaître une
  // somme à réclamer à un client déjà parti.
  if (dossier.status === 'COMPLETED') {
    return erreur(
      'Ce véhicule est déjà restitué : le forfait ne peut plus être retiré.',
      {}, 409,
    );
  }

  const abonnementId = dossier.subscription_id;

  await base
    .select(
      `UPDATE operations
          SET subscription_id = NULL, discount_amount = 0, discount_source = NULL,
              discount_reason = NULL, discount_by_user_id = ?, discounted_at = datetime('now')
        WHERE {ORG} AND id = ?`,
      utilisateur.id, dossier.id,
    )
    .run();

  await enregistre(env.DB, {
    action: 'subscription.use_cancelled',
    organizationId: utilisateur.organizationId,
    stationId: dossier.station_id,
    userId: utilisateur.id,
    entityType: 'operation',
    entityId: dossier.id,
    metadata: { subscription_id: abonnementId, reference: dossier.reference },
  });

  const apres = await base
    .select(`${ABONNEMENT} WHERE s.{ORG} AND s.id = ? LIMIT 1`, abonnementId)
    .first<LigneAbonnement>();

  return succes(
    {
      operation: await dossierComplet(base, dossier.id),
      subscription: apres === null ? null : presente(apres),
    },
    'Forfait retiré. Le lavage est rendu au client.',
  );
}
