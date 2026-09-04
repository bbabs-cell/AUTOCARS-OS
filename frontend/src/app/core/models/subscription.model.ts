/**
 * Modèles des abonnements
 * ------------------------------------------------------------------
 * « 10 lavages standard pour 40 000 F, valables 6 mois. »
 *
 * Un forfait est un PRÉPAIEMENT : l'argent est encaissé le jour de la
 * vente, les lavages sont livrés ensuite. C'est le contraire exact de
 * la fidélité, où la station donne — et c'est pour cela que les deux
 * remises portent une `discount_source` différente.
 */

/** Ce que la station vend. */
export interface SubscriptionPlan {
  id: number;
  name: string;
  /** Le forfait porte sur UNE prestation précise. */
  service_id: number;
  service_name: string | null;
  /** Prix unitaire de cette prestation, au catalogue d'aujourd'hui. */
  service_price: number;
  washes: number;
  price: number;
  validity_days: number;
  status: 'ACTIVE' | 'INACTIVE';
  is_active: boolean;
  sold_count: number;

  /** `service_price × washes` — ce que ça coûterait à l'unité. */
  full_price: number;
  /** L'argument de vente, calculé par le serveur pour être partout le même. */
  saving: number;
}

/**
 * L'état d'un forfait acheté.
 *
 * ACTIVE seul est utilisable. Les trois autres sont CALCULÉS à la
 * lecture : « périmé » se lit dans une date, « épuisé » se compte
 * dans les opérations rattachées, et seule l'annulation est stockée.
 */
export type SubscriptionState = 'ACTIVE' | 'EXPIRED' | 'EXHAUSTED' | 'CANCELLED';

/** Ce qu'un client a acheté. */
export interface Subscription {
  id: number;

  customer_id: number;
  customer_name: string | null;
  customer_phone: string | null;

  plan_id: number;
  plan_name: string | null;
  service_id: number;
  service_name: string | null;
  station_id: number;
  station_name: string | null;

  washes_total: number;
  /** COMPTÉ, jamais stocké : c'est le nombre d'opérations rattachées. */
  washes_used: number;
  washes_left: number;
  /** Ce que le client a payé, figé au jour de la vente. */
  price_paid: number;

  starts_at: string;
  expires_at: string;
  days_left: number;

  state: SubscriptionState;
  state_label: string;
  is_usable: boolean;

  cancelled_at: string | null;
  cancellation_reason: string | null;

  notes: string | null;
  sold_by_name: string | null;
  created_at: string;
}

export interface SubscriptionPlanPayload {
  name: string;
  service_id: number;
  washes: number;
  price: number;
  validity_days: number;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface SubscriptionSalePayload {
  customer_id: number;
  plan_id: number;
  station_id: number;
  method: 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
  provider?: string | null;
  external_reference?: string | null;
  notes?: string | null;
}

/** Le bilan du module. */
export interface SubscriptionOverview {
  /** Ce qui a été VENDU sur la période — de l'argent réellement reçu. */
  sold: { count: number; amount: number };
  /**
   * Ce qui a été LIVRÉ sur la période.
   *
   * `value` n'est PAS de la recette : elle a été encaissée le jour de
   * la vente. C'est de la dette soldée.
   */
  delivered: { washes: number; value: number };
  /**
   * CE QUI RESTE À LIVRER — le chiffre qui n'existerait pas sans ce
   * module. Une station qui a vendu 200 lavages d'avance doit 200
   * lavages.
   */
  outstanding: { subscriptions: number; washes: number; value: number };
  /** Les forfaits qui périment dans les 30 jours : un appel à passer. */
  expiring: Subscription[];
  period: { from: string; to: string };
}
