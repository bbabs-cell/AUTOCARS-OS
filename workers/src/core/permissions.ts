/**
 * Matrice des droits — portée telle quelle depuis config/permissions.php
 * ==================================================================
 * Les droits n'ont PAS été repensés à l'occasion de la migration. Ils
 * sont recopiés à l'identique, et un test compare cette table à celle
 * du PHP. Changer une règle métier en même temps qu'on change de
 * langage, c'est se priver du seul repère qui permette de dire si la
 * réécriture est fidèle.
 *
 * Ce qui doit changer changera ensuite, délibérément, dans son propre
 * lot.
 */

export type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE';

export const MATRICE: Record<Role, readonly string[]> = {
  ADMIN: ['*'],
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
