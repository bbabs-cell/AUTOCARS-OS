/**
 * Matrice des droits — ENGENDRÉE depuis config/permissions.php
 * ==================================================================
 * Les droits n'ont PAS été repensés à l'occasion de la migration. Ils
 * sont recopiés à l'identique, et un test compare cette table à celle
 * du PHP. Changer une règle métier en même temps qu'on change de
 * langage, c'est se priver du seul repère qui permette de dire si la
 * réécriture est fidèle.
 *
 * Ce qui doit changer changera ensuite, délibérément, dans son propre
 * lot.
 *
 * ------------------------------------------------------------------
 * POURQUOI « ENGENDRÉE » ET NON « RECOPIÉE »
 *
 * À l'étape 1, cette table avait été recopiée à la main depuis une
 * sortie de terminal TRONQUÉE. Dix droits manquaient à l'employé —
 * dont operations.create, operations.update_status et
 * attendance.clock. Autrement dit : un employé n'aurait pas pu
 * accueillir un véhicule, faire avancer un dossier, ni pointer son
 * arrivée. Tout son travail était bloqué, et rien ne le signalait
 * tant qu'aucune route ne le vérifiait.
 *
 * Le défaut n'est apparu qu'en écrivant les opérations, à l'étape 4.
 * La table est désormais produite par un script à partir du fichier
 * PHP, et un test compare les effectifs des trois rôles.
 */

export type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

export const MATRICE: Record<Role, readonly string[]> = {
  ADMIN: [
    '*',
  ],
  MANAGER: [
    'dashboard.view',
    'vehicles.*',
    'customers.*',
    'operations.*',
    'inspections.*',
    'payments.*',
    'cash.*',
    'services.view',
    'services.update',
    'bookings.*',
    'loyalty.view',
    'loyalty.redeem',
    'subscriptions.*',
    'employees.view',
    'attendance.*',
    'reports.view',
    'stations.view',
    'onboarding.view',
  ],
  EMPLOYEE: [
    'dashboard.view',
    'vehicles.view',
    'vehicles.create',
    'vehicles.update',
    'customers.view',
    'customers.create',
    'customers.update',
    'payments.create',
    'payments.view',
    'bookings.view',
    'bookings.create',
    'bookings.update',
    'loyalty.view',
    'loyalty.redeem',
    'subscriptions.view',
    'subscriptions.sell',
    'subscriptions.use',
    'attendance.clock',
    'operations.create',
    'operations.view',
    'operations.update_status',
    'operations.release',
    'inspections.view',
    'inspections.create',
    'services.view',
  ],
};

/**
 * `role` a-t-il le droit de faire `action` ?
 *
 * Trois formes de motif, comme en PHP : `*` (tout), le droit exact, et
 * le domaine entier (`vehicles.*` couvre `vehicles.create`).
 */
export function autorise(role: string, action: string): boolean {
  const accordes = MATRICE[role as Role];

  if (accordes === undefined) {
    // Un rôle inconnu n'a AUCUN droit. Le défaut est le refus : un
    // rôle mal orthographié ne doit pas ouvrir les portes.
    return false;
  }

  return accordes.some((motif) => {
    if (motif === '*' || motif === action) {
      return true;
    }

    if (motif.endsWith('.*')) {
      return action.startsWith(motif.slice(0, -2) + '.');
    }

    return false;
  });
}

/** Tous les droits d'un rôle, sous leur forme déclarée. */
export function droitsDe(role: string): readonly string[] {
  return MATRICE[role as Role] ?? [];
}
