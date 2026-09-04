import { PaymentMethod } from './payment.model';

/**
 * Le tableau de bord
 * ------------------------------------------------------------------
 * ATTENTION AUX CHAMPS OPTIONNELS : ce ne sont pas des oublis.
 *
 * Les blocs financiers ne sont PAS envoyés à qui n'a pas le droit de
 * voir des montants. La réponse d'un employé ne contient aucun
 * chiffre d'affaires — pas un bloc masqué, un bloc absent.
 *
 * C'est pourquoi `revenue`, `revenue_series`, `payment_split`,
 * `ready_unpaid` et `cash` sont marqués `?` : le typage TypeScript
 * reflète exactement ce que le serveur envoie, et oblige chaque
 * écran à traiter le cas où ils manquent.
 */

export interface DashboardAlert {
  key: string;
  severity: 'warning' | 'danger' | 'info';
  count: number;
  label: string;
  detail: string;
  /** Où aller pour régler le problème. */
  route: string;
  amount?: number;
}

export interface RevenuePoint {
  date: string;
  /** « lun. », « mar. » — calculé côté serveur. */
  label: string;
  total: number;
}

export interface PaymentSplitRow {
  method: PaymentMethod;
  total: number;
  count: number;
}

export interface TopService {
  name: string;
  count: number;
  /** Absent pour qui n'a pas le droit de voir des montants. */
  total?: number;
}

export interface Dashboard {
  station_id: number | null;
  generated_at: string;

  today: {
    vehicles_in: number;
    in_progress: number;
    released: number;
    waiting: number;
    revenue?: number;
  };

  yesterday: {
    vehicles_in: number;
    revenue?: number;
  };

  alerts: DashboardAlert[];
  top_services: TopService[];

  /** Null tant qu'il n'y a pas assez de dossiers pour une moyenne. */
  average_turnaround_minutes: number | null;

  operations_by_status: Record<string, number>;

  /** Le serveur dit lui-même si l'utilisateur a droit aux montants. */
  can_see_money: boolean;

  revenue_series?: RevenuePoint[];
  payment_split?: PaymentSplitRow[];
  ready_unpaid?: { count: number; amount: number };

  cash?: {
    is_open: boolean;
    expected: number | null;
    outside_session: number;
  };
}
