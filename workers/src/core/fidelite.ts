/**
 * Le grand livre de la fidélité
 * ==================================================================
 * POURQUOI UN MODULE, ALORS QUE TOUT LE RESTE VIT DANS UN CONTRÔLEUR ?
 * ==================================================================
 *
 * Parce qu'une de ces règles est déclenchée depuis DEUX endroits :
 * « un lavage payé donne un tampon » se produit au moment où l'on
 * enregistre un encaissement — donc dans le contrôleur des paiements —
 * alors que la règle appartient à la fidélité.
 *
 * Les deux autres solutions étaient pires : recopier la règle dans le
 * contrôleur des paiements garantit qu'un jour les deux copies
 * diffèrent ; l'appeler depuis l'autre contrôleur rend les deux
 * illisibles séparément.
 *
 * Ce n'est donc PAS une « couche service » qu'on généraliserait au
 * reste du produit. C'est une exception née d'un besoin précis.
 *
 * ------------------------------------------------------------------
 * IL N'ÉCRIT JAMAIS DE RÉPONSE HTTP
 *
 * Il dit ce qui s'est passé, et le contrôleur décide quoi en faire.
 * C'est ce qui permet à l'attribution d'un tampon d'échouer en
 * silence pendant un encaissement : un problème de fidélité ne doit
 * jamais empêcher d'encaisser de l'argent.
 */

import type { TenantDb } from './db';

export interface Programme {
  id: number;
  name: string;
  stamps_required: number;
  reward_amount: number;
  min_operation_amount: number;
  status: string;
}

/** L'état de la carte d'un client, tel qu'on le lui montre. */
export interface Carte {
  has_program: boolean;
  balance: number;
  stamps_required: number;
  reward_amount: number;
  rewards_available: number;
  stamps_to_next: number;
}

const CHAMPS_PROGRAMME =
  'id, name, stamps_required, reward_amount, min_operation_amount, status';

/** Le programme EN VIGUEUR, ou null si l'entreprise n'en a pas. */
export async function programmeActif(base: TenantDb): Promise<Programme | null> {
  return await base
    .select(
      `SELECT ${CHAMPS_PROGRAMME} FROM loyalty_programs
        WHERE {ORG} AND status = 'ACTIVE' LIMIT 1`,
    )
    .first<Programme>();
}

/**
 * Le programme à AFFICHER : celui en vigueur, sinon le dernier
 * enregistré. Un gérant qui a désactivé son programme doit retrouver
 * ses réglages en le rouvrant, pas un formulaire vide.
 */
export async function programmeCourant(base: TenantDb): Promise<Programme | null> {
  return await base
    .select(
      `SELECT ${CHAMPS_PROGRAMME} FROM loyalty_programs
        WHERE {ORG} ORDER BY status = 'ACTIVE' DESC, id DESC LIMIT 1`,
    )
    .first<Programme>();
}

/**
 * Le solde d'un client : la somme de ses écritures.
 *
 * Le solde n'est stocké NULLE PART. C'est plus de requêtes qu'un
 * compteur — et infiniment plus sûr : un compteur devient faux au
 * premier incident (un paiement rejoué, une remise annulée), et
 * personne ne peut alors dire s'il est trop haut ou trop bas. Ici on
 * relit les lignes. Les REVERSAL étant positifs et les REDEEM
 * négatifs, une simple somme suffit.
 */
export async function solde(base: TenantDb, clientId: number): Promise<number> {
  const r = await base
    .select(
      `SELECT COALESCE(SUM(points), 0) AS n FROM loyalty_entries
        WHERE {ORG} AND customer_id = ?`,
      clientId,
    )
    .first<{ n: number }>();

  return r?.n ?? 0;
}

/** L'état de la carte d'un client : ce qu'on affiche au comptoir. */
export async function carte(
  base: TenantDb,
  clientId: number,
  programme?: Programme | null,
): Promise<Carte> {
  const p = programme === undefined ? await programmeActif(base) : programme;

  if (p === null) {
    return {
      has_program: false, balance: 0, stamps_required: 0,
      reward_amount: 0, rewards_available: 0, stamps_to_next: 0,
    };
  }

  const requis = Math.max(1, p.stamps_required);

  // Un solde négatif ne devrait pas exister — mais si une écriture
  // manque un jour, mieux vaut afficher 0 qu'un nombre négatif que
  // personne ne saura expliquer au client.
  const n = Math.max(0, await solde(base, clientId));
  const disponibles = Math.floor(n / requis);

  return {
    has_program: true,
    balance: n,
    stamps_required: requis,
    reward_amount: p.reward_amount,
    rewards_available: disponibles,
    // Ce que le client veut savoir : « il m'en reste combien ? ».
    // Zéro dès qu'une récompense complète l'attend : lui annoncer
    // « encore 8 » alors qu'il a déjà droit à un lavage serait faux.
    stamps_to_next: disponibles > 0 ? 0 : requis - (n % requis),
  };
}

export interface Attribution {
  awarded: boolean;
  reason: string;
  balance: number | null;
}

/**
 * ==================================================================
 * UN LAVAGE PAYÉ DONNE UN TAMPON
 * ==================================================================
 * Appelé après chaque encaissement. Ne fait rien — et c'est le cas
 * le plus fréquent — si l'entreprise n'a pas de programme actif, si
 * le dossier n'est pas entièrement réglé, si le montant est sous le
 * plancher, ou si un tampon a déjà été donné.
 *
 * POURQUOI AU PAIEMENT, ET NON À LA RESTITUTION ?
 * Parce qu'un lavage qui n'est pas payé n'est pas un lavage. Un
 * véhicule rendu par dérogation à un client qui n'a rien réglé ne
 * doit pas faire avancer sa carte — sinon la dérogation devient une
 * façon de gagner des tampons.
 */
export async function attribueSiRegle(
  base: TenantDb,
  db: D1Database,
  dossier: {
    id: number;
    customer_id: number;
    price: number;
    discount_amount: number;
    discount_source: string | null;
    reference: string;
    paid_amount: number;
  },
  utilisateurId: number,
  organizationId: number,
): Promise<Attribution> {
  const p = await programmeActif(base);

  if (p === null) {
    return { awarded: false, reason: 'no_program', balance: null };
  }

  if (dossier.customer_id === 0) {
    return { awarded: false, reason: 'no_customer', balance: null };
  }

  const du = Math.max(0, dossier.price - dossier.discount_amount);

  if (dossier.paid_amount < du) {
    return { awarded: false, reason: 'not_settled', balance: null };
  }

  // UN LAVAGE ENTIÈREMENT OFFERT NE RAPPORTE PAS DE TAMPON.
  // Un dossier dont le dû est tombé à zéro grâce à une RÉCOMPENSE, et
  // pour lequel le client n'a rien sorti de sa poche, ne doit pas
  // faire avancer sa carte : le programme se nourrirait lui-même, et
  // dix lavages offerts en produiraient un onzième.
  //
  // Un lavage couvert par un ABONNEMENT, lui, rapporte un tampon : il
  // a bien été payé — d'avance, mais payé. Le contraire punirait le
  // client le plus fidèle de la station.
  if (dossier.paid_amount === 0 && dossier.discount_source === 'LOYALTY') {
    return { awarded: false, reason: 'fully_rewarded', balance: null };
  }

  // Le plancher se mesure sur le PRIX de la prestation, pas sur ce
  // qui a été encaissé : sinon un lavage payé pour moitié avec une
  // récompense passerait sous le plancher, et le client serait puni
  // d'être fidèle.
  if (dossier.price < p.min_operation_amount) {
    return { awarded: false, reason: 'below_minimum', balance: null };
  }

  const deja = await base
    .select(
      "SELECT id FROM loyalty_entries WHERE {ORG} AND operation_id = ? AND type = 'EARN' LIMIT 1",
      dossier.id,
    )
    .first();

  if (deja !== null) {
    return { awarded: false, reason: 'already_awarded', balance: null };
  }

  try {
    await db
      .prepare(
        `INSERT INTO loyalty_entries (organization_id, program_id, customer_id, type, points,
                                      operation_id, reward_amount, note, created_by_user_id)
         VALUES (?, ?, ?, 'EARN', 1, ?, ?, ?, ?)`,
      )
      .bind(
        organizationId, p.id, dossier.customer_id, dossier.id,
        // Ce que valait la récompense CE JOUR-LÀ : les règles peuvent
        // changer, l'historique ne doit pas bouger.
        p.reward_amount,
        `Dossier ${dossier.reference}`, utilisateurId,
      )
      .run();
  } catch (e) {
    // La colonne calculée `earn_operation_id` est unique : deux
    // encaissements partis à la même seconde ont soldé le dossier en
    // même temps, et la base a refusé le second tampon. C'est
    // exactement ce qu'on lui demande de faire ; ce n'est pas une
    // erreur à remonter.
    if (!/UNIQUE|constraint/i.test(String(e))) {
      throw e;
    }

    return { awarded: false, reason: 'already_awarded', balance: null };
  }

  return { awarded: true, reason: 'awarded', balance: await solde(base, dossier.customer_id) };
}
