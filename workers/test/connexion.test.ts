import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOT_DE_PASSE, prepareBase } from './aide';

const connecte = (email: string, password: string) =>
  SELF.fetch('https://api.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

describe('connexion', () => {
  beforeEach(prepareBase);

  it('un compte valide reçoit un jeton et son profil', async () => {
    const res = await connecte('mamadou@diallo.sn', MOT_DE_PASSE);
    expect(res.status).toBe(200);

    const { data } = (await res.json()) as {
      data: {
        access_token: string;
        expires_in: number;
        user: { role: string; station_ids: number[]; permissions: string[]; full_name: string };
      };
    };

    expect(data.access_token.split('.')).toHaveLength(3);
    expect(data.expires_in).toBe(1800);
    expect(data.user.role).toBe('ADMIN');
    expect(data.user.full_name).toBe('Mamadou Diallo');
    // L'administrateur travaille sur les deux stations.
    expect(data.user.station_ids.sort()).toEqual([1, 2]);
    expect(data.user.permissions).toEqual(['*']);
  });

  it("le profil d'un employé ne porte que ses droits", async () => {
    const res = await connecte('aliou@diallo.sn', MOT_DE_PASSE);
    const { data } = (await res.json()) as { data: { user: { permissions: string[] } } };

    expect(data.user.permissions).toContain('vehicles.view');
    // Un employé ne voit ni les recettes ni l'équipe.
    expect(data.user.permissions).not.toContain('reports.view');
    expect(data.user.permissions).not.toContain('employees.view');
    expect(data.user.permissions).not.toContain('*');
  });

  it('un mauvais mot de passe est refusé', async () => {
    const res = await connecte('mamadou@diallo.sn', 'PasLeBon2026!');
    expect(res.status).toBe(401);
  });

  /**
   * LE MESSAGE NE DOIT PAS DIRE SI LE COMPTE EXISTE.
   *
   * Un message différent pour « compte inconnu » et « mot de passe
   * faux » permet à n'importe qui d'énumérer les adresses inscrites
   * chez un client. Les trois cas ci-dessous doivent être
   * indistinguables de l'extérieur.
   */
  it('compte inconnu, mot de passe faux et compte désactivé répondent la même chose', async () => {
    const reponses = await Promise.all([
      connecte('personne@nulle-part.sn', MOT_DE_PASSE),
      connecte('mamadou@diallo.sn', 'PasLeBon2026!'),
      connecte('ancien@diallo.sn', MOT_DE_PASSE),
    ]);

    const corps = await Promise.all(
      reponses.map((r) => r.json() as Promise<{ message: string }>),
    );

    expect(reponses.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(new Set(corps.map((c) => c.message)).size).toBe(1);
  });

  it('un compte désactivé ne peut pas se connecter', async () => {
    const res = await connecte('ancien@diallo.sn', MOT_DE_PASSE);
    expect(res.status).toBe(401);
  });

  /**
   * L'état INVITED existe dans le schéma MySQL et manquait à l'étape 1 :
   * un compte créé mais dont la personne n'a pas encore choisi son mot
   * de passe. Il ne doit pas pouvoir se connecter — et le fait que le
   * contrôle porte sur « différent d'ACTIVE » le couvre sans rien
   * ajouter.
   */
  it('un compte seulement invité ne peut pas se connecter', async () => {
    const res = await connecte('invite@diallo.sn', MOT_DE_PASSE);
    expect(res.status).toBe(401);
  });

  it('les champs vides sont signalés champ par champ', async () => {
    const res = await connecte('', '');
    expect(res.status).toBe(422);

    const corps = (await res.json()) as { errors: Record<string, string> };
    expect(Object.keys(corps.errors).sort()).toEqual(['email', 'password']);
  });

  it("l'empreinte du mot de passe ne sort jamais de l'API", async () => {
    const res = await connecte('mamadou@diallo.sn', MOT_DE_PASSE);
    const brut = await res.text();

    expect(brut).not.toMatch(/pbkdf2|password_hash/);
  });
});
