import { OperationStatus } from './operation-status.model';
import { VehicleType } from './crm.model';

/**
 * Modèles des opérations et des inspections
 * ------------------------------------------------------------------
 * Reflètent ce que renvoient OperationController et
 * InspectionController.
 *
 * UN CHOIX À COMPRENDRE : `allowed_transitions` vient du SERVEUR.
 * On aurait pu recopier la machine à états en TypeScript pour éviter
 * un aller-retour. Ce serait la même règle écrite à deux endroits —
 * et deux règles jumelles finissent toujours par diverger, en général
 * le jour où l'une des deux est corrigée seule.
 */

/** Un dossier : le passage d'un véhicule en station. */
export interface Operation {
  id: number;
  reference: string;

  status: OperationStatus;
  status_label: string;
  /** Les étapes réellement atteignables depuis le statut actuel. */
  allowed_transitions: OperationStatus[];
  priority: number;

  vehicle_id: number;
  plate_number: string;
  plate_display: string;
  brand: string;
  model: string;
  color: string | null;
  vehicle_type: VehicleType;

  customer_id: number;
  customer_name: string;
  customer_phone: string | null;

  service_id: number;
  service_name: string;
  duration_minutes: number;

  station_id: number;
  station_name: string;

  assigned_user_id: number | null;
  assigned_name: string | null;

  /**
   * Prix figé à l'ouverture du dossier, en FCFA.
   *
   * ATTENTION : ce n'est PAS ce que le client doit. Depuis le lot 14,
   * une récompense de fidélité peut le diminuer. Le montant à
   * encaisser est `amount_due`, et c'est lui qu'il faut utiliser
   * partout où l'on parle d'argent à recevoir.
   *
   * Les deux sont envoyés séparément à dessein : afficher le prix
   * barré et le dû est la seule façon pour le client de voir ce que
   * sa fidélité lui a rapporté.
   */
  price: number;
  /** Remise accordée, en FCFA. Zéro dans l'immense majorité des cas. */
  discount_amount: number;
  /** « Fidélité — 3 lavages (Carte fidélité) ». */
  discount_reason: string | null;
  /** `price - discount_amount`, jamais négatif. CE QUE LE CLIENT DOIT. */
  amount_due: number;
  currency_code: string;
  paid_amount: number;
  is_settled: boolean;

  /** Évite d'aller chercher les inspections pour savoir si on peut laver. */
  has_entry_inspection: boolean;

  // --- La file d'attente ---------------------------------------------
  // Ces trois champs sont calculés PAR LE SERVEUR, dont l'horloge fait
  // foi. Le poste d'une station peut être déréglé de vingt minutes, et
  // une alerte fausse coûte plus cher qu'une alerte absente : on la
  // vérifie, on perd du temps, et on finit par ne plus les regarder.
  status_changed_at: string | null;
  /** Minutes passées à l'étape actuelle. */
  minutes_in_status: number | null;
  /** Seuil au-delà duquel l'étape mérite un coup d'œil. */
  alert_after_minutes: number | null;
  is_overdue: boolean;

  notes: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  released_at: string | null;
}

export interface OperationPayload {
  vehicle_id: number;
  service_id: number;
  station_id: number;
  priority?: number;
  notes?: string | null;
}

export type FuelLevel = 'EMPTY' | 'QUARTER' | 'HALF' | 'THREE_QUARTERS' | 'FULL';

export const FUEL_LEVEL_LABELS: Record<FuelLevel, string> = {
  EMPTY: 'Réservoir vide',
  QUARTER: 'Un quart',
  HALF: 'Moitié',
  THREE_QUARTERS: 'Trois quarts',
  FULL: 'Plein',
};

export type PhotoPosition =
  | 'FRONT'
  | 'REAR'
  | 'LEFT'
  | 'RIGHT'
  | 'INTERIOR'
  | 'DAMAGE'
  | 'OTHER';

/**
 * Les cinq prises de vue demandées à l'arrivée.
 *
 * POURQUOI CINQ ET PAS DEUX ?
 * Parce qu'un litige porte presque toujours sur un côté qu'on n'a
 * pas photographié. Quatre faces plus l'intérieur couvrent ce qu'un
 * client peut contester. Au-delà, l'employé abandonne la procédure —
 * et une procédure abandonnée ne protège personne.
 */
export const REQUIRED_PHOTO_POSITIONS: readonly PhotoPosition[] = [
  'FRONT',
  'REAR',
  'LEFT',
  'RIGHT',
  'INTERIOR',
] as const;

export const PHOTO_POSITION_LABELS: Record<PhotoPosition, string> = {
  FRONT: 'Avant',
  REAR: 'Arrière',
  LEFT: 'Côté gauche',
  RIGHT: 'Côté droit',
  INTERIOR: 'Intérieur',
  DAMAGE: 'Dommage',
  OTHER: 'Autre',
};

export interface InspectionPhoto {
  id: number;
  position: PhotoPosition;
  /** Chemin de l'API, pas du disque : « /api/photos/42 ». */
  url: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  file_size: number;
  created_at: string | null;
}

export interface Inspection {
  id: number;
  operation_id: number;
  vehicle_id: number;
  type: 'ENTRY' | 'EXIT';

  fuel_level: FuelLevel | null;
  mileage: number | null;

  has_damage: boolean;
  damage_notes: string | null;
  items_left: string | null;
  observations: string | null;

  customer_present: boolean;
  signature_name: string | null;

  performed_at: string;
  photos?: InspectionPhoto[];
}

/** Résumé d'inspection tel qu'il apparaît sur un dossier. */
export interface InspectionSummary {
  id: number;
  type: 'ENTRY' | 'EXIT';
  performed_by_name: string;
  performed_at: string;
  has_damage: boolean;
}

/** Une ligne de l'historique des états constatés d'un véhicule. */
export interface InspectionHistoryEntry {
  id: number;
  type: 'ENTRY' | 'EXIT';
  operation_reference: string;
  performed_by_name: string;
  performed_at: string;
  has_damage: boolean;
  damage_notes: string | null;
  photo_count: number;
}

export interface InspectionPayload {
  type: 'ENTRY' | 'EXIT';
  fuel_level?: FuelLevel | null;
  mileage?: number | null;
  has_damage: boolean;
  damage_notes?: string | null;
  items_left?: string | null;
  observations?: string | null;
  customer_present: boolean;
  signature_name?: string | null;
}

/** Une ligne de la liste de vérification avant restitution. */
export interface ReleaseCheckItem {
  key: string;
  label: string;
  passed: boolean;
  /** Une ligne non bloquante est un avertissement, pas un refus. */
  blocking: boolean;
  detail: string;
}

export interface ReleasePayload {
  reference: string;
  plate_number: string;
  override_reason?: string | null;
}


// ====================================================================
// LA FILE D'ATTENTE
// ====================================================================

/**
 * Une colonne du tableau, telle que la construit le serveur.
 *
 * Une colonne peut regrouper plusieurs statuts — « Inspection »
 * réunit `IN_PROGRESS` et `INSPECTION`, qui veulent dire la même
 * chose pour celui qui regarde le tableau. Ce regroupement est
 * déclaré côté serveur : le frontend ne connaît pas le parcours, il
 * affiche ce qu'on lui donne.
 */
export interface QueueColumn {
  label: string;
  /** Le statut appliqué quand on dépose une carte dans la colonne. */
  drop_status: OperationStatus;
  /** Les statuts regroupés sous cette colonne. */
  statuses: OperationStatus[];
  count: number;
  /** Combien de dossiers de cette colonne traînent. */
  overdue: number;
  operations: Operation[];
}

/**
 * Les quatre chiffres du bandeau.
 * Quatre, pas huit : un bandeau qui affiche les huit statuts oblige à
 * les lire tous pour repérer celui qui pose problème.
 */
export interface QueueMetrics {
  waiting: number;
  in_progress: number;
  ready: number;
  overdue: number;
  /** La plus longue attente de la file, en minutes. */
  longest_wait_minutes: number | null;
}

export interface QueueBoard {
  columns: QueueColumn[];
  metrics: QueueMetrics;
  /** Heure du serveur : le frontend n'affiche pas celle du poste. */
  generated_at: string;
}
