/**
 * GET /api/vehicles
 * ==================================================================
 * Le second bout de la tranche verticale. Il a été choisi parce qu'il
 * traverse TOUT ce qui compte : le jeton, la relecture du rôle en
 * base, le contrôle de permission côté serveur, une jointure, une
 * recherche, et le cloisonnement multi-clients.
 *
 * Si cette route est juste, l'architecture tient.
 */

import { baseDe, type Utilisateur } from '../core/auth';
import { affiche, normalise } from '../core/plate';
import { interdit, succes } from '../core/response';

interface LigneVehicule {
  id: number;
  plate_number: string;
  brand: string;
  model: string;
  color: string | null;
  vehicle_type: string;
  notes: string | null;
  customer_id: number;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone: string | null;
}

export async function liste(
  request: Request,
  env: Env,
  utilisateur: Utilisateur,
): Promise<Response> {
  // LE DROIT SE VÉRIFIE ICI, SUR LE SERVEUR.
  //
  // L'application Angular cache déjà les entrées de menu interdites,
  // mais cacher un bouton n'est pas une sécurité : n'importe qui peut
  // appeler l'API directement. C'était une exigence du cahier des
  // charges, elle est reprise telle quelle.
  if (!utilisateur.peut('vehicles.view')) {
    return interdit();
  }

  const url = new URL(request.url);
  const recherche = (url.searchParams.get('search') ?? '').trim();
  const clientBrut = url.searchParams.get('customer_id');
  const clientId =
    clientBrut !== null && clientBrut !== '' ? Number.parseInt(clientBrut, 10) : null;

  const conditions: string[] = [];
  const parametres: unknown[] = [];

  if (recherche !== '') {
    // La plaque est comparée sous sa forme normalisée : « dk 1234 ab »
    // et « DK-1234-AB » doivent trouver le même véhicule.
    const motif = `%${recherche}%`;
    conditions.push(
      `(v.plate_number LIKE ? OR v.brand LIKE ? OR v.model LIKE ?
        OR c.first_name LIKE ? OR c.last_name LIKE ? OR c.phone LIKE ?)`,
    );
    parametres.push(`%${normalise(recherche)}%`, motif, motif, motif, motif, motif);
  }

  if (clientId !== null && Number.isInteger(clientId)) {
    conditions.push('v.customer_id = ?');
    parametres.push(clientId);
  }

  const extra = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';

  // `{ORG}` est remplacé par le filtre d'organisation, et le paramètre
  // correspondant est lié avant les nôtres. Sans ce marqueur, select()
  // refuse la requête.
  const lignes = await baseDe(utilisateur, env.DB)
    .select(
      `SELECT v.id, v.plate_number, v.brand, v.model, v.color, v.vehicle_type,
              v.notes, v.customer_id,
              c.first_name AS customer_first_name,
              c.last_name  AS customer_last_name,
              c.phone      AS customer_phone
         FROM vehicles v
         JOIN customers c ON c.id = v.customer_id
        WHERE v.{ORG}${extra}
        ORDER BY v.created_at DESC
        LIMIT 200`,
      ...parametres,
    )
    .all<LigneVehicule>();

  return succes(lignes.results.map(presente));
}

/** La forme exacte que l'application Angular lit déjà. */
function presente(v: LigneVehicule) {
  return {
    id: v.id,
    plate_number: v.plate_number,
    plate_display: affiche(v.plate_number),
    brand: v.brand,
    model: v.model,
    color: v.color,
    vehicle_type: v.vehicle_type,
    notes: v.notes,
    customer_id: v.customer_id,
    customer_name: `${v.customer_first_name} ${v.customer_last_name}`.trim(),
    customer_phone: v.customer_phone,
  };
}
