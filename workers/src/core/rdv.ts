/**
 * La machine à états d'un rendez-vous
 * ==================================================================
 * Portée telle quelle depuis config/booking_status.php.
 */

export type EtatRdv = 'SCHEDULED' | 'CONFIRMED' | 'ARRIVED' | 'NO_SHOW' | 'CANCELLED';

export const TRANSITIONS_RDV: Record<EtatRdv, readonly EtatRdv[]> = {
  SCHEDULED: ['CONFIRMED', 'ARRIVED', 'NO_SHOW', 'CANCELLED'],
  CONFIRMED: ['ARRIVED', 'NO_SHOW', 'CANCELLED'],
  ARRIVED: [],
  NO_SHOW: [],
  CANCELLED: [],
};

export const LIBELLES_RDV: Record<EtatRdv, string> = {
  SCHEDULED: 'Prévu',
  CONFIRMED: 'Confirmé',
  ARRIVED: 'Arrivé',
  NO_SHOW: 'Absent',
  CANCELLED: 'Annulé',
};

/** Les rendez-vous qui occupent encore le planning. */
export const OUVERTS: readonly EtatRdv[] = ['SCHEDULED', 'CONFIRMED'];

/**
 * « ARRIVÉ » NE SE POSE PAS À LA MAIN.
 *
 * L'arrivée OUVRE UN DOSSIER : c'est la route /arrive qui la déclare,
 * parce qu'elle fait deux choses à la fois. Permettre de cocher
 * « arrivé » sans créer le dossier laisserait un client dans la
 * station sans trace de son véhicule.
 */
export const PAR_ROUTE_SEULEMENT: readonly EtatRdv[] = ['ARRIVED'];

/**
 * Le délai avant de pouvoir déclarer une absence.
 *
 * Quinze minutes après l'heure prévue. Déclarer quelqu'un absent
 * pendant qu'il cherche une place de stationnement est le meilleur
 * moyen de perdre un client.
 */
export const GRACE_MINUTES = 15;

/** Un an : au-delà, c'est presque toujours une faute de saisie d'année. */
export const JOURS_MAX = 365;

export const existeRdv = (e: string): e is EtatRdv => e in TRANSITIONS_RDV;

export const permetRdv = (de: EtatRdv, vers: EtatRdv): boolean =>
  TRANSITIONS_RDV[de].includes(vers);

export const estOuvert = (e: EtatRdv): boolean => OUVERTS.includes(e);
