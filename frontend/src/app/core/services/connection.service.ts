import { Injectable, signal } from '@angular/core';

/**
 * L'état du lien avec le serveur
 * ==================================================================
 * UN BANDEAU, PAS UNE PAGE D'ERREUR.
 * ==================================================================
 *
 * Quand l'API ne répond plus — coupure réseau à la station, serveur
 * arrêté — le réflexe serait d'envoyer l'utilisateur sur un écran
 * « panne serveur ». C'est un mauvais réflexe, et c'est la décision
 * la plus discutée de ce lot.
 *
 * Une page d'erreur DÉTRUIT l'écran en cours. Quelqu'un en train de
 * saisir une inspection, avec un client devant lui, perdrait sa
 * saisie parce qu'un rafraîchissement automatique de la file
 * d'attente a échoué en arrière-plan. Le remède serait pire que le
 * mal — et sur le terrain visé, une coupure de trente secondes est
 * ordinaire.
 *
 * On affiche donc un bandeau : visible, permanent tant que le lien
 * est coupé, et qui disparaît de lui-même dès qu'une requête
 * aboutit. Ce qui est à l'écran reste à l'écran.
 *
 * ------------------------------------------------------------------
 * ON NE COMPTE QUE LES ÉCHECS RÉSEAU
 *
 * `status === 0` : la requête n'a jamais atteint le serveur. Une
 * réponse 500, elle, prouve que le serveur répond — c'est un bug, pas
 * une coupure, et l'écran concerné l'affiche à sa façon.
 *
 * Confondre les deux ferait apparaître « connexion perdue » sur une
 * erreur applicative, et enverrait le gérant redémarrer son routeur
 * pour rien.
 */
@Injectable({ providedIn: 'root' })
export class ConnectionService {
  /**
   * Le lien est-il rompu ?
   *
   * Une seule requête échouée suffit à l'annoncer, et une seule
   * réussie à l'effacer. Pas de compteur, pas de seuil : un bandeau
   * qui hésite est un bandeau auquel on ne croit plus.
   */
  readonly isOffline = signal(false);

  /** Depuis quand, pour l'afficher dans le bandeau. */
  readonly since = signal<Date | null>(null);

  reportFailure(): void {
    if (!this.isOffline()) {
      this.since.set(new Date());
      this.isOffline.set(true);
    }
  }

  reportSuccess(): void {
    if (this.isOffline()) {
      this.isOffline.set(false);
      this.since.set(null);
    }
  }
}
