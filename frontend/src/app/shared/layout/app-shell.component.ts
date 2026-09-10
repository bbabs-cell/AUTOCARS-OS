import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

import { SidebarComponent } from './sidebar.component';
import { TopbarComponent } from './topbar.component';
import { ConnectionService } from '../../core/services/connection.service';

/**
 * Coque de l'application
 * ------------------------------------------------------------------
 * Assemble la barre latérale, l'en-tête et la zone de contenu.
 * Toutes les pages connectées s'affichent à l'intérieur.
 *
 * C'est aussi le composant qui détient l'état d'ouverture de la
 * barre latérale sur mobile. Ce choix est délibéré : la barre et
 * l'en-tête doivent tous deux agir sur cet état (l'un se ferme,
 * l'autre l'ouvre). Le placer dans leur parent commun évite qu'ils
 * aient à communiquer entre eux.
 *
 * Les pages publiques (connexion, inscription, page vitrine)
 * n'utiliseront PAS cette coque : elles n'ont ni menu ni en-tête.
 *
 * Depuis le lot 18, elle porte aussi le BANDEAU DE PERTE DE
 * CONNEXION. Il est ici et pas dans une page parce qu'il ne remplace
 * rien : ce qui est à l'écran doit y rester. Quelqu'un en train de
 * saisir une inspection, un client devant lui, ne doit pas perdre sa
 * saisie parce qu'un rafraîchissement de la file a échoué en
 * arrière-plan.
 */
/**
 * À quel domaine appartient chaque adresse.
 *
 * LA COULEUR EST UNE INFORMATION, PAS UNE DÉCORATION. Un employé de
 * comptoir passe cinquante fois par jour de la file d'attente à la
 * caisse. Ces écrans étaient rigoureusement de la même couleur : seul
 * le titre les distinguait, et un titre se LIT, il ne se perçoit pas.
 *
 * Le regroupement suit le geste, pas l'arborescence du code :
 *   · véhicules avec clients — on cherche l'un par l'autre ;
 *   · pointage avec équipe — c'est le même sujet vu de deux côtés ;
 *   · paiements avec caisse — un encaissement finit toujours là.
 *
 * Ce qui n'est pas listé reste bleu, et c'est voulu : le tableau de
 * bord, les réglages ou l'aide ne sont pas un « domaine métier », ils
 * traversent tout le produit.
 */
const DOMAINES: Record<string, string> = {
  queue: 'queue',
  operations: 'operations',
  cash: 'cash',
  payments: 'cash',
  customers: 'customers',
  vehicles: 'customers',
  loyalty: 'loyalty',
  bookings: 'bookings',
  subscriptions: 'bookings',
  analytics: 'analytics',
  team: 'team',
  attendance: 'team',
};

@Component({
  selector: 'ac-app-shell',
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})

export class AppShellComponent {
  /** Public pour le gabarit : le bandeau lit ses signaux. */
  protected readonly connection = inject(ConnectionService);

  private readonly router = inject(Router);

  /**
   * Le domaine de l'écran affiché.
   *
   * POSÉ ICI PLUTÔT QUE DANS CHAQUE PAGE. Seize pages auraient été
   * seize occasions d'oublier, et la teinte aurait fini par mentir sur
   * l'un des écrans — pire que pas de teinte du tout, puisqu'on
   * apprendrait à s'y fier.
   *
   * `startWith` donne la valeur du PREMIER affichage : sans lui, la
   * teinte n'apparaîtrait qu'après la première navigation, et un
   * utilisateur arrivant directement sur /caisse verrait du bleu.
   */
  protected readonly domaine = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
      map((url) => DOMAINES[url.split('?')[0].split('/').filter(Boolean)[0] ?? ''] ?? null),
    ),
    { initialValue: null },
  );

  protected readonly isSidebarOpen = signal(false);

  protected toggleSidebar(): void {
    this.isSidebarOpen.update((open) => !open);
  }

  protected closeSidebar(): void {
    this.isSidebarOpen.set(false);
  }
}
