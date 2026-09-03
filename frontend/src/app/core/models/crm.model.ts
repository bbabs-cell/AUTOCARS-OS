/**
 * Modèles clients et véhicules
 * ------------------------------------------------------------------
 * Reflètent ce que renvoient CustomerController et VehicleController.
 */

export interface Customer {
  id: number;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: string;

  /** Compteurs calculés par l'API. */
  vehicle_count: number;
  visit_count: number;
  /** Cumul des paiements encaissés, en FCFA. */
  total_spent: number;
  last_visit_at: string | null;
  created_at: string | null;
}

export interface CustomerPayload {
  first_name: string;
  last_name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

/** Un client trouvé par la vérification de doublon de téléphone. */
export interface PhoneMatch {
  id: number;
  full_name: string;
  phone: string;
}

export type VehicleType =
  | 'CAR'
  | 'SUV'
  | 'PICKUP'
  | 'VAN'
  | 'MOTORCYCLE'
  | 'TRUCK'
  | 'OTHER';

export interface Vehicle {
  id: number;

  /** Forme normalisée, telle que stockée : « DK1234AA ». */
  plate_number: string;
  /** Forme lisible, calculée par l'API : « DK-1234-AA ». */
  plate_display: string;

  brand: string;
  model: string;
  color: string | null;
  vehicle_type: VehicleType;
  notes: string | null;

  customer_id: number;
  customer_name: string;
  customer_phone: string | null;

  operation_count: number;
  last_operation_at: string | null;
  created_at: string | null;
}

export interface VehiclePayload {
  plate_number: string;
  customer_id: number;
  brand: string;
  model: string;
  color?: string | null;
  vehicle_type: VehicleType;
  notes?: string | null;
}

/** Une ligne de l'historique d'un véhicule. */
export interface VehicleHistoryEntry {
  id: number;
  reference: string;
  status: string;
  service_name: string;
  employee_name: string | null;
  price: number;
  created_at: string;
  released_at: string | null;
}

/** Les libellés français des types de véhicule. */
export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  CAR: 'Voiture',
  SUV: '4x4 / SUV',
  PICKUP: 'Pick-up',
  VAN: 'Utilitaire',
  MOTORCYCLE: 'Moto',
  TRUCK: 'Camion',
  OTHER: 'Autre',
};
