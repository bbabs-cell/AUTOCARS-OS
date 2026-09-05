/**
 * La machine à états d'une opération
 * ==================================================================
 * Portée telle quelle depuis config/operation_status.php. Aucune
 * règle n'a été revue à l'occasion du changement de langage : ce
 * fichier est la référence de ce que le produit accepte, et le
 * modifier en même temps qu'on le traduit reviendrait à ne plus
 * savoir si la réécriture est fidèle.
 *
 * ------------------------------------------------------------------
 * POURQUOI UNE TABLE, ET NON DES `if` DANS LES CONTRÔLEURS
 *
 * Les règles de passage d'une étape à l'autre sont LA logique métier
 * du produit. Éparpillées en conditions dans les contrôleurs, elles
 * divergent : on ajoute un cas ici, on oublie là, et un véhicule
 * finit par être restituable sans avoir été lavé.
 *
 * Écrites une fois, en table, elles se lisent d'un coup d'œil et se
 * testent exhaustivement.
 */

export type Etat =
  | 'WAITING' | 'IN_PROGRESS' | 'INSPECTION' | 'WASHING'
  | 'QUALITY_CHECK' | 'READY' | 'COMPLETED' | 'CANCELLED';

/** Ce qui est possible depuis chaque étape. Le reste est refusé. */
export const TRANSITIONS: Record<Etat, readonly Etat[]> = {
  WAITING:       ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS:   ['INSPECTION', 'CANCELLED'],
  INSPECTION:    ['WASHING', 'CANCELLED'],
  WASHING:       ['QUALITY_CHECK', 'CANCELLED'],
  // Le contrôle peut renvoyer au lavage : c'est tout l'intérêt d'un
  // contrôle qualité que de pouvoir dire non.
  QUALITY_CHECK: ['READY', 'WASHING', 'CANCELLED'],
  READY:         ['COMPLETED', 'CANCELLED'],
  COMPLETED:     [],
  CANCELLED:     [],
};

export const LIBELLES: Record<Etat, string> = {
  WAITING:       'En attente',
  IN_PROGRESS:   'Pris en charge',
  INSPECTION:    'Inspection en cours',
  WASHING:       'Lavage en cours',
  QUALITY_CHECK: 'Contrôle qualité',
  READY:         'Prêt à restituer',
  COMPLETED:     'Restitué',
  CANCELLED:     'Annulé',
};

/**
 * Les deux gardes : des conditions que la table ne peut pas exprimer,
 * parce qu'elles dépendent d'autres données que l'étape en cours.
 *
 *   entry_inspection_recorded — on ne lave pas un véhicule dont on
 *     n'a pas constaté l'état à l'arrivée. Sans cette inspection,
 *     toute rayure découverte après coup est indéfendable.
 *
 *   payment_settled — on ne rend pas les clés d'un véhicule impayé.
 *     C'est le refus le plus dur du produit, et celui qui sera le
 *     plus contesté sur le terrain.
 */
export const GARDES: Record<string, string> = {
  'INSPECTION:WASHING': 'entry_inspection_recorded',
  'READY:COMPLETED': 'payment_settled',
};

/** L'horodatage à poser en entrant dans certaines étapes. */
export const HORODATAGES: Partial<Record<Etat, string>> = {
  IN_PROGRESS: 'started_at',
  READY: 'completed_at',
  COMPLETED: 'released_at',
};

/** Les étapes où le véhicule est encore dans la station. */
export const ACTIFS: readonly Etat[] = [
  'WAITING', 'IN_PROGRESS', 'INSPECTION', 'WASHING', 'QUALITY_CHECK', 'READY',
];

/** Les colonnes de la file d'attente, telles que l'écran les affiche. */
export const COLONNES = [
  { label: 'En attente', drop: 'WAITING',       statuses: ['WAITING'] },
  { label: 'Inspection', drop: 'INSPECTION',    statuses: ['IN_PROGRESS', 'INSPECTION'] },
  { label: 'Lavage',     drop: 'WASHING',       statuses: ['WASHING'] },
  { label: 'Contrôle',   drop: 'QUALITY_CHECK', statuses: ['QUALITY_CHECK'] },
  { label: 'Prêts',      drop: 'READY',         statuses: ['READY'] },
] as const;

/**
 * Minutes au-delà desquelles une étape mérite une alerte.
 *
 * `null` pour le lavage : le seuil y est la durée annoncée de la
 * prestation, qui varie d'un service à l'autre.
 *
 * CES CHIFFRES VIENNENT DU BON SENS, PAS DE MESURES. C'est écrit
 * depuis le lot 8 et ça reste vrai : aucune station ne tourne encore
 * avec le produit. Le test terrain doit les confirmer ou les corriger.
 */
export const ALERTES: Record<string, number | null> = {
  WAITING: 20,
  IN_PROGRESS: 15,
  INSPECTION: 15,
  WASHING: null,
  QUALITY_CHECK: 10,
  READY: 45,
};

export const existe = (e: string): e is Etat => e in TRANSITIONS;

export const permet = (de: Etat, vers: Etat): boolean =>
  TRANSITIONS[de].includes(vers);

export const estFinal = (e: Etat): boolean => TRANSITIONS[e].length === 0;

/**
 * Le message qu'on montre quand un passage est refusé.
 *
 * Il dit ce qui EST possible, pas seulement ce qui ne l'est pas : un
 * refus qui n'indique pas la sortie oblige à deviner, et c'est là
 * qu'on prend l'habitude de contourner le logiciel.
 */
export function messageRefus(de: Etat, vers: string): string {
  if (!existe(vers)) {
    return "Ce statut n'existe pas.";
  }

  if (estFinal(de)) {
    return `Cette opération est ${LIBELLES[de].toLowerCase()} : son statut ne peut plus changer.`;
  }

  const possibles = TRANSITIONS[de].map((e) => LIBELLES[e]).join(', ');

  return `Une opération « ${LIBELLES[de]} » ne peut pas passer à « ${LIBELLES[vers]} ». `
    + `Étapes possibles : ${possibles}.`;
}
