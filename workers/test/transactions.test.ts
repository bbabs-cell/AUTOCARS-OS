import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { prepareBase } from './aide';

/**
 * ==================================================================
 * CE QUE batch() GARANTIT — VÉRIFIÉ, PAS SUPPOSÉ
 * ==================================================================
 * Le chiffrage de la migration signalait les 9 transactions du PHP
 * comme le point le plus délicat : D1 n'a pas de transaction
 * interactive, seulement `batch()`, qui exécute une liste
 * d'instructions préparées d'avance.
 *
 * La crainte était de devoir repenser chaque logique qui a besoin du
 * résultat d'une insertion pour la suivante — créer une organisation
 * PUIS son administrateur, par exemple.
 *
 * Ces deux tests montrent que ce n'est pas nécessaire :
 *
 *   1. `last_insert_rowid()` fonctionne À L'INTÉRIEUR d'un batch : la
 *      seconde insertion peut désigner la ligne créée par la première.
 *   2. Un batch qui échoue en cours de route ne laisse RIEN — il est
 *      bien atomique.
 *
 * Autrement dit, `batch()` couvre le cas qu'on croyait perdu. Ces
 * tests restent pour que ça se sache, et pour qu'un changement de
 * comportement de la plateforme se voie immédiatement.
 */
describe('D1 : batch() se comporte comme une transaction', () => {
  beforeEach(prepareBase);

  it('last_insert_rowid() désigne bien la ligne créée juste avant', async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO organizations (name, slug) VALUES ('Essai', 'essai-batch')"),
      env.DB.prepare(
        `INSERT INTO users (organization_id, first_name, last_name, email, password_hash)
         VALUES (last_insert_rowid(), 'A', 'B', 'batch@essai.sn', 'x')`),
    ]);

    const u = await env.DB.prepare(
      "SELECT u.organization_id, o.slug FROM users u JOIN organizations o ON o.id = u.organization_id WHERE u.email = 'batch@essai.sn'",
    ).first<{ organization_id: number; slug: string }>();
    expect(u?.slug).toBe('essai-batch');
  });

  it('un batch qui échoue au milieu ne laisse aucune trace', async () => {
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO organizations (name, slug) VALUES ('Moitie', 'moitie')"),
        env.DB.prepare("INSERT INTO users (organization_id, first_name, last_name, email, password_hash) VALUES (999999, 'A', 'B', 'x@y.sn', 'x')"),
      ]);
      throw new Error('Le batch aurait dû échouer sur la clé étrangère.');
    } catch (e) {
      expect(String(e)).toMatch(/FOREIGN KEY/i);
    }
    const o = await env.DB.prepare("SELECT COUNT(*) AS n FROM organizations WHERE slug = 'moitie'").first<{ n: number }>();
    expect(o?.n).toBe(0);
  });
});
