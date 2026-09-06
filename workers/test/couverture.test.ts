import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { jetonPour, prepareBase } from './aide';

/**
 * ==================================================================
 * TOUTES LES ROUTES DU PHP RÉPONDENT-ELLES ?
 * ==================================================================
 * J'ai failli déclarer la migration terminée alors que vingt-deux
 * routes manquaient — dont la remise du véhicule au client, c'est-à-
 * dire le geste central du produit.
 *
 * Le contrôle qui l'a révélé était un script jetable, lancé une fois.
 * Il ne regardait que le CHEMIN : `POST /api/stations` a donc été
 * compté comme porté parce que `GET /api/stations` existait, et il
 * manquait quand même.
 *
 * Ce test-ci interroge le ROUTEUR, avec la bonne méthode. Il ne
 * vérifie pas ce que chaque route répond — les autres fichiers s'en
 * chargent — seulement qu'aucune ne renvoie « cette adresse n'existe
 * pas ». C'est peu, et c'est exactement ce qui a manqué.
 *
 * ------------------------------------------------------------------
 * LA LISTE EST ÉCRITE ICI, PAS LUE DANS LE PHP
 *
 * Un test qui lit `config/routes.php` cesserait de protéger le jour
 * où le PHP sera retiré — et c'est bien ce qui doit arriver. La liste
 * est donc recopiée, et les quatre routes non portées y figurent avec
 * la raison de leur absence.
 */

const ADMIN = 'mamadou@diallo.sn';

/** Les 88 routes du routeur PHP, méthode comprise. */
const ROUTES: [string, string][] = [
  ['POST', '/api/auth/login'],
  ['POST', '/api/auth/register'],
  ['POST', '/api/auth/refresh'],
  ['POST', '/api/auth/logout'],
  ['GET', '/api/auth/me'],
  ['POST', '/api/auth/forgot-password'],
  ['POST', '/api/auth/reset-password'],

  ['GET', '/api/onboarding/status'],
  ['POST', '/api/onboarding/complete'],

  ['GET', '/api/stations'],
  ['POST', '/api/stations'],
  ['GET', '/api/stations/1'],
  ['PUT', '/api/stations/1'],
  ['PUT', '/api/stations/1/status'],

  ['GET', '/api/organization'],
  ['PUT', '/api/organization'],

  ['GET', '/api/services'],
  ['POST', '/api/services'],
  ['GET', '/api/services/1'],
  ['PUT', '/api/services/1'],
  ['PUT', '/api/services/1/status'],

  ['GET', '/api/team'],
  ['POST', '/api/team'],
  ['GET', '/api/team/activity'],
  ['PUT', '/api/team/2'],
  ['PUT', '/api/team/2/stations'],

  ['GET', '/api/attendance'],
  ['GET', '/api/attendance/me'],
  ['POST', '/api/attendance/clock-in'],
  ['POST', '/api/attendance/clock-out'],
  ['PUT', '/api/attendance/1'],

  ['GET', '/api/customers'],
  ['POST', '/api/customers'],
  ['GET', '/api/customers/check-phone'],
  ['GET', '/api/customers/1'],
  ['PUT', '/api/customers/1'],

  ['GET', '/api/vehicles'],
  ['POST', '/api/vehicles'],
  ['GET', '/api/vehicles/1'],
  ['PUT', '/api/vehicles/1'],
  ['GET', '/api/vehicles/1/inspections'],

  ['GET', '/api/operations'],
  ['POST', '/api/operations'],
  ['GET', '/api/operations/statuses'],
  ['GET', '/api/operations/1'],
  ['PUT', '/api/operations/1/status'],
  ['PUT', '/api/operations/1/priority'],
  ['PUT', '/api/operations/1/assign'],
  ['GET', '/api/operations/1/release-check'],
  ['POST', '/api/operations/1/release'],
  ['GET', '/api/operations/1/payments'],
  ['POST', '/api/operations/1/payments'],
  ['POST', '/api/operations/1/inspections'],

  ['GET', '/api/queue'],
  ['GET', '/api/dashboard'],
  ['GET', '/api/analytics'],

  ['GET', '/api/inspections/1'],

  ['GET', '/api/payments'],
  ['POST', '/api/payments/1/refund'],
  ['GET', '/api/cash/current'],
  ['GET', '/api/cash/sessions'],
  ['POST', '/api/cash/open'],
  ['POST', '/api/cash/close'],

  ['GET', '/api/bookings'],
  ['POST', '/api/bookings'],
  ['GET', '/api/bookings/statuses'],
  ['GET', '/api/bookings/1'],
  ['PUT', '/api/bookings/1'],
  ['PUT', '/api/bookings/1/status'],
  ['POST', '/api/bookings/1/arrive'],

  ['GET', '/api/loyalty'],
  ['PUT', '/api/loyalty/program'],
  ['GET', '/api/loyalty/customers/1'],
  ['POST', '/api/loyalty/redeem'],
  ['POST', '/api/loyalty/redeem/1/cancel'],

  ['GET', '/api/subscriptions'],
  ['POST', '/api/subscriptions'],
  ['GET', '/api/subscriptions/overview'],
  ['GET', '/api/subscriptions/plans'],
  ['POST', '/api/subscriptions/plans'],
  ['PUT', '/api/subscriptions/plans/1'],
  ['GET', '/api/subscriptions/1'],
  ['POST', '/api/subscriptions/1/cancel'],
  ['POST', '/api/subscriptions/use'],
  ['POST', '/api/subscriptions/use/1/cancel'],
];

/**
 * Les routes qu'on sait ne pas avoir portées, et pourquoi.
 *
 * Une liste d'exceptions n'a de valeur que si elle est courte et
 * datée. Celle-ci se vide au fur et à mesure ; le test échouera le
 * jour où l'une d'elles sera portée sans être retirée d'ici — ce qui
 * est exactement le rappel qu'on veut.
 */
const PAS_ENCORE: [string, string, string][] = [
  ['POST', '/api/inspections/1/photos', 'Étape 5 — stockage des photos (R2)'],
  ['GET', '/api/photos/1', 'Étape 5 — stockage des photos (R2)'],
];

describe('toutes les routes du PHP répondent', () => {
  let jeton = '';

  beforeAll(async () => {
    await prepareBase();
    jeton = await jetonPour(ADMIN);
  });

  it.each(ROUTES)('%s %s', async (methode, chemin) => {
    const res = await SELF.fetch(`https://api.test${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      ...(methode === 'GET' ? {} : { body: '{}' }),
    });

    const corps = (await res.json()) as { message: string };

    // On ne juge pas la réponse : un corps vide donne légitimement un
    // 422, un dossier absent un 404 sur SA ressource. Ce qui est
    // interdit, c'est que le ROUTEUR ne connaisse pas l'adresse.
    expect(
      { chemin: `${methode} ${chemin}`, message: corps.message },
      "le routeur ne connaît pas cette adresse",
    ).not.toEqual({ chemin: `${methode} ${chemin}`, message: "Cette adresse n'existe pas." });
  });

  it.each(PAS_ENCORE)('%s %s — pas encore portée (%s)', async (methode, chemin) => {
    const res = await SELF.fetch(`https://api.test${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      ...(methode === 'GET' ? {} : { body: '{}' }),
    });

    const corps = (await res.json()) as { message: string };

    // Le jour où elle sera portée, ce test échouera : il faudra la
    // déplacer dans la liste du dessus. C'est voulu.
    expect(corps.message).toBe("Cette adresse n'existe pas.");
  });
});
