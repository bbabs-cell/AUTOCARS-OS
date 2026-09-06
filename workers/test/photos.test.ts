import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { jetonPour, prepareBase } from './aide';

const EMPLOYE = 'aliou@diallo.sn';
const RIVAL = 'fatou@concurrent.sn';

/** Un PNG 1×1 valide. */
const PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
), (c) => c.charCodeAt(0));

/** Un JPEG minuscule mais valide. */
const JPEG = Uint8Array.from(atob(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
), (c) => c.charCodeAt(0));

async function creeInspection(): Promise<number> {
  const jeton = await jetonPour(EMPLOYE);
  const res = await SELF.fetch('https://api.test/api/operations/1/inspections', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'ENTRY', has_damage: false, customer_present: false }),
  });

  const corps = (await res.json()) as { data: { inspection: { id: number } } };

  return corps.data.inspection.id;
}

async function envoie(
  email: string,
  inspectionId: number,
  octets: Uint8Array | string,
  nom = 'photo.jpg',
  champs: Record<string, string> = {},
) {
  const jeton = await jetonPour(email);
  const formulaire = new FormData();

  formulaire.append('photo', new Blob([octets]), nom);

  for (const [cle, valeur] of Object.entries(champs)) {
    formulaire.append(cle, valeur);
  }

  const res = await SELF.fetch(`https://api.test/api/inspections/${inspectionId}/photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}` },
    body: formulaire,
  });

  return {
    res,
    corps: (await res.json()) as { message: string; data: any; errors: Record<string, string> },
  };
}

// ====================================================================

describe('envoyer une photo d’inspection', () => {
  beforeEach(prepareBase);

  it('accepte une photo et renvoie ce que l’écran lit', async () => {
    const inspection = await creeInspection();
    const { res, corps } = await envoie(EMPLOYE, inspection, PNG, 'avant.png', {
      position: 'FRONT', caption: 'Pare-chocs',
    });

    expect(res.status).toBe(201);
    expect(Object.keys(corps.data.photo).sort()).toEqual([
      'caption', 'created_at', 'file_size', 'height', 'id', 'position', 'url', 'width',
    ]);
    expect(corps.data.photo.position).toBe('FRONT');
    expect(corps.data.photo.caption).toBe('Pare-chocs');
    expect(corps.data.photo.url).toBe(`/api/photos/${corps.data.photo.id}`);
  });

  /**
   * ==================================================================
   * L'IMAGE EST RÉ-ENCODÉE : RIEN DES OCTETS REÇUS NE SURVIT.
   * ==================================================================
   * C'est la protection la plus forte du module, et celle que le §4.4
   * du chiffrage mettait en jeu. Une image peut porter du code dans
   * ses métadonnées ; décoder les pixels puis les réécrire détruit
   * tout ce qui n'est pas de l'image.
   */
  it('ré-encode en WebP : les octets rangés ne sont pas ceux reçus', async () => {
    const inspection = await creeInspection();

    // Un PNG parfaitement valide, auquel on accroche une charge dans
    // un bloc de commentaire. Le fichier reste une image lisible —
    // c'est précisément ce qui rend l'attaque crédible.
    const charge = new TextEncoder().encode('<?php system($_GET["c"]); ?>');
    const pieges = new Uint8Array(PNG.length + charge.length);

    pieges.set(PNG);
    pieges.set(charge, PNG.length);

    const { res, corps } = await envoie(EMPLOYE, inspection, pieges, 'piege.png');

    expect(res.status).toBe(201);

    const ligne = await env.DB
      .prepare('SELECT file_path, mime_type FROM inspection_photos WHERE id = ?')
      .bind(corps.data.photo.id)
      .first<{ file_path: string; mime_type: string }>();

    expect(ligne?.mime_type).toBe('image/webp');

    const range = await env.PHOTOS.get(ligne!.file_path);
    const octets = new Uint8Array(await range!.arrayBuffer());
    const texte = new TextDecoder().decode(octets);

    // Le fichier rangé est un WebP neuf…
    expect(String.fromCharCode(...octets.slice(0, 4))).toBe('RIFF');
    // …et la charge a disparu avec les octets d'origine.
    expect(texte).not.toContain('<?php');
    expect(texte).not.toContain('system');
  });

  /**
   * LE TYPE EST LU DANS LES OCTETS, JAMAIS DANS L'EXTENSION.
   *
   * Renommer « payload.php » en « photo.jpg » ne trompe personne.
   */
  it('refuse un fichier qui n’est pas une image, même nommé .jpg', async () => {
    const inspection = await creeInspection();
    const { res, corps } = await envoie(
      EMPLOYE, inspection, '<?php system($_GET["c"]); ?>', 'photo.jpg',
    );

    expect(res.status).toBe(422);
    expect(corps.errors.photo).toContain('JPEG, PNG et WebP');

    const n = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM inspection_photos')
      .first<{ n: number }>();

    expect(n?.n).toBe(0);
  });

  /**
   * LE SVG EST REFUSÉ, ET CE N'EST PAS UN OUBLI.
   *
   * C'est un document XML qui peut porter du script, et aucun
   * ré-encodage ne le rendrait inoffensif : il n'a pas de pixels à
   * réécrire.
   */
  it('refuse un SVG, même bien formé', async () => {
    const inspection = await creeInspection();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

    const { res, corps } = await envoie(EMPLOYE, inspection, svg, 'photo.svg');

    expect(res.status).toBe(422);
    expect(corps.errors.photo).toContain('JPEG, PNG et WebP');
  });

  it('refuse un fichier vide', async () => {
    const inspection = await creeInspection();
    const { res, corps } = await envoie(EMPLOYE, inspection, new Uint8Array(0));

    expect(res.status).toBe(422);
    expect(corps.errors.photo).toContain('vide');
  });

  it('refuse une photo de plus de 12 Mo', async () => {
    const inspection = await creeInspection();
    const gros = new Uint8Array(13 * 1024 * 1024);

    gros.set(PNG);

    const { res, corps } = await envoie(EMPLOYE, inspection, gros, 'enorme.png');

    expect(res.status).toBe(422);
    expect(corps.errors.photo).toContain('12 Mo');
  });

  it('refuse une requête sans fichier', async () => {
    const inspection = await creeInspection();
    const jeton = await jetonPour(EMPLOYE);
    const formulaire = new FormData();

    formulaire.append('position', 'FRONT');

    const res = await SELF.fetch(`https://api.test/api/inspections/${inspection}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}` },
      body: formulaire,
    });

    expect(res.status).toBe(422);
  });

  // LE NOM DU FICHIER EST GÉNÉRÉ, jamais celui fourni : celui de
  // l'utilisateur peut contenir « ../../ » ou une double extension.
  it('ignore le nom fourni, y compris s’il tente de sortir du dossier', async () => {
    const inspection = await creeInspection();
    const { corps } = await envoie(
      EMPLOYE, inspection, JPEG, '../../../etc/passwd.jpg.php',
    );

    const ligne = await env.DB
      .prepare('SELECT file_path FROM inspection_photos WHERE id = ?')
      .bind(corps.data.photo.id)
      .first<{ file_path: string }>();

    expect(ligne?.file_path).toMatch(/^\d{4}\/\d{2}\/[0-9a-f]{32}\.webp$/);
    expect(ligne?.file_path).not.toContain('..');
    expect(ligne?.file_path).not.toContain('passwd');
  });

  it('ramène une position inconnue à « OTHER » plutôt que de refuser', async () => {
    const inspection = await creeInspection();
    const { corps } = await envoie(EMPLOYE, inspection, JPEG, 'p.jpg', {
      position: 'DESSOUS',
    });

    expect(corps.data.photo.position).toBe('OTHER');
  });

  /**
   * DOUZE AU MAXIMUM. Ce n'est pas une limite technique : au-delà
   * personne ne les regarde, et une procédure trop longue est une
   * procédure abandonnée.
   */
  it('refuse la treizième photo', async () => {
    const inspection = await creeInspection();

    for (let i = 0; i < 12; i += 1) {
      const { res } = await envoie(EMPLOYE, inspection, JPEG);

      expect(res.status).toBe(201);
    }

    const { res, corps } = await envoie(EMPLOYE, inspection, JPEG);

    expect(res.status).toBe(409);
    expect(corps.message).toContain('déjà 12 photos');
  });

  it("l'inspection d'une autre entreprise est introuvable", async () => {
    const inspection = await creeInspection();
    const { res } = await envoie(RIVAL, inspection, JPEG);

    expect(res.status).toBe(404);
  });

  it('l’envoi est tracé', async () => {
    const inspection = await creeInspection();
    await envoie(EMPLOYE, inspection, JPEG);

    const t = await env.DB
      .prepare("SELECT user_id FROM audit_logs WHERE action = 'inspection.photo_added'")
      .first<{ user_id: number }>();

    expect(t?.user_id).toBe(2);
  });
});

// ====================================================================

describe('afficher une photo', () => {
  beforeEach(prepareBase);

  async function pose(): Promise<number> {
    const inspection = await creeInspection();
    const { corps } = await envoie(EMPLOYE, inspection, JPEG, 'p.jpg', { position: 'LEFT' });

    return corps.data.photo.id;
  }

  it('sert le fichier, avec les en-têtes qui vont avec', async () => {
    const id = await pose();
    const jeton = await jetonPour(EMPLOYE);

    const res = await SELF.fetch(`https://api.test/api/photos/${id}`, {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/webp');

    // Cache PRIVÉ : ce sont les données d'une entreprise précise, elles
    // n'ont rien à faire dans un cache partagé.
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    // Le navigateur ne doit pas deviner un autre type que celui annoncé.
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const octets = new Uint8Array(await res.arrayBuffer());

    expect(String.fromCharCode(...octets.slice(0, 4))).toBe('RIFF');
  });

  /**
   * LE SEAU EST PRIVÉ : c'est cette route, et elle seule, qui donne
   * accès aux photos — après avoir vérifié à qui elles appartiennent.
   */
  it("la photo d'une autre entreprise est introuvable, pas interdite", async () => {
    const id = await pose();
    const jeton = await jetonPour(RIVAL);

    const res = await SELF.fetch(`https://api.test/api/photos/${id}`, {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    // 404 et non 403 : répondre « interdit » confirmerait que la
    // photo existe.
    expect(res.status).toBe(404);
  });

  it('sans jeton, rien', async () => {
    const id = await pose();
    const res = await SELF.fetch(`https://api.test/api/photos/${id}`);

    expect(res.status).toBe(401);
  });

  it('une photo qui n’existe pas est un 404', async () => {
    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch('https://api.test/api/photos/9999', {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    expect(res.status).toBe(404);
  });

  // LA LIGNE EXISTE MAIS LE FICHIER A DISPARU : c'est un incident
  // sérieux sur des preuves. On répond proprement plutôt que de
  // laisser une erreur remonter.
  it('un fichier disparu répond 404 sans casser', async () => {
    const id = await pose();

    const ligne = await env.DB
      .prepare('SELECT file_path FROM inspection_photos WHERE id = ?')
      .bind(id)
      .first<{ file_path: string }>();

    await env.PHOTOS.delete(ligne!.file_path);

    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch(`https://api.test/api/photos/${id}`, {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    expect(res.status).toBe(404);
  });

  it('la fiche d’inspection liste ses photos', async () => {
    const inspection = await creeInspection();
    await envoie(EMPLOYE, inspection, JPEG, 'p.jpg', { position: 'REAR' });

    const jeton = await jetonPour(EMPLOYE);
    const res = await SELF.fetch(`https://api.test/api/inspections/${inspection}`, {
      headers: { Authorization: `Bearer ${jeton}` },
    });

    const corps = (await res.json()) as { data: { inspection: { photos: any[] } } };

    expect(corps.data.inspection.photos).toHaveLength(1);
    expect(corps.data.inspection.photos[0].position).toBe('REAR');
    expect(corps.data.inspection.photos[0].url).toMatch(/^\/api\/photos\/\d+$/);
  });
});

// ====================================================================

describe("l'empreinte de la photo", () => {
  beforeEach(prepareBase);

  /**
   * ==================================================================
   * « CETTE PHOTO A-T-ELLE ÉTÉ REMPLACÉE DEPUIS L'INSPECTION ? »
   * ==================================================================
   * Question décisive en cas de litige sur une rayure. L'empreinte
   * porte sur le fichier FINAL, celui qui est rangé — pas sur celui
   * qui a été reçu.
   */
  it('correspond au fichier rangé, et le détecte s’il change', async () => {
    const { intacte } = await import('../src/core/photos');

    const inspection = await creeInspection();
    const { corps } = await envoie(EMPLOYE, inspection, JPEG);

    const ligne = await env.DB
      .prepare('SELECT file_path, file_hash FROM inspection_photos WHERE id = ?')
      .bind(corps.data.photo.id)
      .first<{ file_path: string; file_hash: string }>();

    expect(ligne?.file_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await intacte(env, ligne!.file_path, ligne!.file_hash)).toBe(true);

    // Quelqu'un remplace le fichier dans le seau.
    await env.PHOTOS.put(ligne!.file_path, 'autre chose');

    expect(await intacte(env, ligne!.file_path, ligne!.file_hash)).toBe(false);
  });

  it('un fichier disparu n’est pas « intact »', async () => {
    const { intacte } = await import('../src/core/photos');

    expect(await intacte(env, '2026/09/inexistant.webp', 'f'.repeat(64))).toBe(false);
  });
});
