/**
 * Modèles de la fidélité
 * ------------------------------------------------------------------
 * Reflètent ce que renvoie `LoyaltyController`. Une carte à tampons :
 * « après N lavages, X FCFA offerts ».
 */

export interface LoyaltyProgram {
  id: number;
  name: string;
  /** Combien de lavages pour une récompense. Entre 3 et 50. */
  stamps_required: number;
  /** Ce que vaut la récompense, en FCFA. */
  reward_amount: number;
  /** En dessous de ce montant, la prestation ne donne pas de tampon. */
  min_operation_amount: number;
  status: 'ACTIVE' | 'INACTIVE';
  is_active: boolean;
}

/** L'état de la carte d'un client, tel qu'on le lui montre. */
export interface LoyaltyCard {
  has_program: boolean;
  balance: number;
  stamps_required: number;
  reward_amount: number;
  /** Combien de récompenses complètes il peut utiliser tout de suite. */
  rewards_available: number;
  /** Ce que le client veut savoir : « il m'en reste combien ? » */
  stamps_to_next: number;
}

/**
 * Une écriture du grand livre.
 *
 * Il n'y a JAMAIS de modification ni de suppression : une utilisation
 * annulée apparaît sous forme de deux lignes, le REDEEM et le
 * REVERSAL qui le compense.
 */
export interface LoyaltyEntry {
  id: number;
  type: 'EARN' | 'REDEEM' | 'REVERSAL';
  label: string;
  /** Signé : +1, −10, +10. Le solde est la somme. */
  points: number;
  operation_id: number | null;
  operation_reference: string | null;
  note: string | null;
  created_by_name: string | null;
  created_at: string;
}

/** Le bilan du programme sur une période. */
export interface LoyaltySummary {
  earned: number;
  redeemed: number;
  reversed: number;
  /**
   * CE QUE LE PROGRAMME A RÉELLEMENT COÛTÉ, en FCFA.
   *
   * Lu sur les remises effectivement appliquées et non sur la valeur
   * annoncée des récompenses : une récompense de 5 000 F appliquée à
   * un dossier de 3 000 F ne coûte que 3 000 F.
   *
   * Ce chiffre n'existerait pas si une récompense était enregistrée
   * comme un faux encaissement — c'est la raison d'être du choix
   * « remise plutôt que paiement ».
   */
  cost: number;
}

/** Un client qui a au moins une récompense à prendre. */
export interface LoyaltyReadyCustomer {
  customer_id: number;
  customer_name: string;
  phone: string;
  balance: number;
}

export interface LoyaltyOverview {
  program: LoyaltyProgram | null;
  summary: LoyaltySummary;
  ready: LoyaltyReadyCustomer[];
  period: { from: string; to: string };
}

export interface LoyaltyProgramPayload {
  name: string;
  stamps_required: number;
  reward_amount: number;
  min_operation_amount: number;
  status: 'ACTIVE' | 'INACTIVE';
}
