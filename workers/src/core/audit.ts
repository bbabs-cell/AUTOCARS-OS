/**
 * Journal d'audit
 * ==================================================================
 * Ce qui s'écrit ici sert à répondre, des semaines plus tard, à la
 * question « qui a fait ça, et quand ». C'est aussi ce qui rend
 * exploitable la détection de rejeu : sans trace, on révoque une
 * session et personne ne saura jamais pourquoi.
 *
 * IL NE DOIT JAMAIS FAIRE ÉCHOUER L'ACTION QU'IL DOCUMENTE.
 *
 * Une écriture d'audit qui plante empêcherait une connexion, un
 * encaissement ou une restitution. On préfère perdre une ligne de
 * journal qu'un client à l'accueil. L'erreur part donc dans la console
 * du Worker, où elle reste visible, sans remonter à l'appelant.
 */

export interface Trace {
  action: string;
  organizationId?: number | null;
  userId?: number | null;
  entityType?: string | null;
  entityId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export async function enregistre(db: D1Database, t: Trace): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        t.organizationId ?? null,
        t.userId ?? null,
        t.action,
        t.entityType ?? null,
        t.entityId ?? null,
        t.metadata ? JSON.stringify(t.metadata) : null,
      )
      .run();
  } catch (e) {
    console.error("Journal d'audit indisponible :", t.action, e);
  }
}

/**
 * Compte les traces d'une action récente, pour les limitations de
 * fréquence (lot 21).
 *
 * ATTENTION — LE DÉFAUT LE PLUS COÛTEUX DU LOT 21 ÉTAIT ICI.
 *
 * La première version comptait les demandes de réinitialisation par
 * adresse e-mail, lue dans `metadata`. Mais l'enregistrement
 * n'écrivait AUCUNE métadonnée : le compte valait toujours zéro et la
 * limitation ne limitait rien. Elle avait l'air juste, elle était
 * inerte, et seul un essai sur l'API en marche l'a révélé.
 *
 * D'où la forme de cette fonction : elle prend le critère qu'elle
 * doit chercher, et l'appelant doit prouver — par un test — que ce
 * critère est bien écrit au moment de l'enregistrement.
 */
export async function compteRecent(
  db: D1Database,
  action: string,
  cheminJson: string,
  valeur: string,
  minutes: number,
): Promise<number> {
  const r = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM audit_logs
        WHERE action = ?
          AND json_extract(metadata, ?) = ?
          AND created_at >= datetime('now', ?)`,
    )
    .bind(action, cheminJson, valeur, `-${minutes} minutes`)
    .first<{ n: number }>();

  return r?.n ?? 0;
}
