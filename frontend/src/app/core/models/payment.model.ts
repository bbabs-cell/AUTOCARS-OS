/**
 * Encaissements et caisse
 * ------------------------------------------------------------------
 * AUCUN FOURNISSEUR DE PAIEMENT N'EST INTÉGRÉ, ET CES MODÈLES LE
 * DISENT.
 *
 * `provider` et `external_reference` sont du texte SAISI À LA MAIN
 * par le caissier — le nom du service et le numéro recopié depuis le
 * téléphone du client. Aucune API n'est appelée, aucun paiement n'est
 * vérifié, rien n'est simulé.
 *
 * Le jour où un compte marchand existera, une intégration remplira
 * ces mêmes champs. Rien de ce qui est écrit ici ne sera à jeter.
 */

export type PaymentMethod = 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Espèces',
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Carte bancaire',
  BANK_TRANSFER: 'Virement',
  OTHER: 'Autre',
};

/**
 * Les moyens proposés à la saisie, dans l'ordre de leur fréquence
 * réelle au Sénégal. Le premier de la liste est celui qu'on choisit
 * le plus souvent : le mettre en tête économise un geste par client.
 */
export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'CASH',
  'MOBILE_MONEY',
  'CARD',
  'BANK_TRANSFER',
  'OTHER',
] as const;

/**
 * Les moyens pour lesquels on demande un fournisseur et une
 * référence. Recopier le numéro de transaction Wave est la seule
 * trace exploitable en cas de contestation.
 */
export const METHODS_WITH_REFERENCE: readonly PaymentMethod[] = [
  'MOBILE_MONEY',
  'CARD',
  'BANK_TRANSFER',
] as const;

export interface Payment {
  id: number;
  amount: number;
  currency_code: string;
  method: PaymentMethod;
  status: PaymentStatus;

  /** Saisi à la main : « Wave », « Orange Money ». */
  provider: string | null;
  /** Numéro recopié depuis le téléphone du client. */
  external_reference: string | null;

  operation_id: number | null;
  operation_reference: string | null;
  plate_number: string | null;
  customer_name: string | null;

  station_id: number;
  station_name: string | null;

  /** Null si l'encaissement n'a été rattaché à aucune caisse ouverte. */
  cash_session_id: number | null;

  recorded_by_name: string | null;
  paid_at: string | null;
  notes: string | null;
}

export interface PaymentPayload {
  amount: number;
  method: PaymentMethod;
  provider?: string | null;
  external_reference?: string | null;
  notes?: string | null;
}

/** Le résultat d'un encaissement : où en est le dossier ? */
export interface PaymentResult {
  payment: Payment;
  paid_amount: number;
  is_settled: boolean;
  remaining: number;
  /**
   * L'encaissement en espèces n'a été rattaché à aucune caisse.
   * À signaler tout de suite : c'est au moment de la saisie qu'on
   * peut encore ouvrir le tiroir.
   */
  outside_cash_session: boolean;
}

export interface OperationPayments {
  payments: Payment[];
  due: number;
  paid_amount: number;
  remaining: number;
  is_settled: boolean;
}

export interface PaymentTotals {
  total: number;
  by_method: Partial<Record<PaymentMethod, number>>;
  count: number;
}

export interface PaymentJournal {
  payments: Payment[];
  totals: PaymentTotals;
  period: { from: string | null; to: string | null };
}

// ====================================================================
// LA CAISSE
// ====================================================================

export interface CashSession {
  id: number;
  station_id: number;
  status: 'OPEN' | 'CLOSED';

  /** La monnaie laissée dans le tiroir pour pouvoir rendre. */
  opening_float: number;

  /**
   * Ce que le logiciel attend : fond de caisse + espèces encaissées.
   * Calculé en direct tant que la caisse est ouverte, FIGÉ à la
   * clôture — une clôture est une photo, pas une vue.
   */
  expected_amount: number;

  /** Ce que le caissier a compté. Null tant que la caisse est ouverte. */
  counted_amount: number | null;

  /** counted - expected. Négatif s'il manque, positif s'il y a trop. */
  difference: number | null;

  opened_at: string | null;
  closed_at: string | null;
  opening_notes: string | null;
  closing_notes: string | null;
}

/** Le détail par moyen de paiement, tiroir ou pas. */
export type CashMovements = Partial<Record<PaymentMethod, { count: number; total: number }>>;

export interface CashState {
  session: CashSession | null;
  movements?: CashMovements;
  /** Espèces encaissées aujourd'hui hors de toute caisse ouverte. */
  cash_outside_session: number;
  station_id: number;
}

export interface CashSessionSummary extends CashSession {
  station_name: string;
  opened_by_name: string;
  closed_by_name: string | null;
}
