/**
 * Statuts d'une opération
 * ------------------------------------------------------------------
 * Le parcours d'un véhicule dans la station, de son arrivée à sa
 * restitution. C'est la donnée la plus structurante du produit :
 * la file d'attente, le tableau de bord, la sécurité et le journal
 * d'audit reposent tous dessus.
 *
 * Ce fichier est la SOURCE UNIQUE de ces statuts côté frontend. Les
 * mêmes valeurs existeront en base au Lot 3 (colonne `status` de la
 * table `operations`). Elles doivent rester identiques : c'est
 * pourquoi on les écrit en majuscules, comme en SQL.
 *
 * Progression normale :
 *
 *   WAITING → IN_PROGRESS → INSPECTION → WASHING
 *                                          ↓
 *   COMPLETED ← READY ← QUALITY_CHECK ─────┘
 *
 * CANCELLED est atteignable depuis tout état non terminal.
 * La machine à états complète sera validée au Lot 3.
 */
export type OperationStatus =
  | 'WAITING'
  | 'IN_PROGRESS'
  | 'INSPECTION'
  | 'WASHING'
  | 'QUALITY_CHECK'
  | 'READY'
  | 'COMPLETED'
  | 'CANCELLED';

/**
 * Libellés affichés à l'utilisateur.
 * Le code reste en anglais (convention du projet), l'interface est
 * en français : c'est ce tableau qui fait le pont.
 */
export const OPERATION_STATUS_LABELS: Record<OperationStatus, string> = {
  WAITING: 'En attente',
  IN_PROGRESS: 'Prise en charge',
  INSPECTION: 'Inspection',
  WASHING: 'En lavage',
  QUALITY_CHECK: 'Contrôle',
  READY: 'Prêt',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
};

/**
 * Suffixe de la classe CSS correspondante (voir _components.scss).
 * Exemple : 'WAITING' donne la classe `ac-badge--waiting`.
 */
export const OPERATION_STATUS_MODIFIERS: Record<OperationStatus, string> = {
  WAITING: 'waiting',
  IN_PROGRESS: 'in-progress',
  INSPECTION: 'inspection',
  WASHING: 'washing',
  QUALITY_CHECK: 'quality',
  READY: 'ready',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

/** Ordre d'affichage, notamment pour les colonnes du Kanban (Lot 8). */
export const OPERATION_STATUS_ORDER: readonly OperationStatus[] = [
  'WAITING',
  'IN_PROGRESS',
  'INSPECTION',
  'WASHING',
  'QUALITY_CHECK',
  'READY',
  'COMPLETED',
  'CANCELLED',
] as const;
