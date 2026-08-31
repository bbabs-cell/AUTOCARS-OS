import { Component, output, signal } from '@angular/core';

import { AvatarComponent } from '../ui/avatar.component';

/**
 * En-tête de l'application
 * ------------------------------------------------------------------
 * Recherche, notifications, profil — et sur mobile, le bouton qui
 * ouvre la barre latérale.
 *
 * NOTE TECHNIQUE : le menu déroulant du profil est écrit en Angular
 * (un signal + une classe CSS) plutôt qu'avec le JavaScript de
 * Bootstrap. Raison : Bootstrap manipule le DOM directement, ce qui
 * entre en conflit avec la façon dont Angular gère l'affichage. Une
 * quinzaine de lignes d'Angular évitent toute une catégorie de bugs,
 * et le comportement reste maîtrisé de bout en bout.
 *
 * Les données affichées (nom, rôle, nombre de notifications) sont
 * pour l'instant fictives. Elles viendront du service
 * d'authentification au Lot 4.
 */
@Component({
  selector: 'ac-topbar',
  imports: [AvatarComponent],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.scss',
})
export class TopbarComponent {
  /** Demande à la coque d'ouvrir la barre latérale (mobile). */
  readonly toggleSidebar = output<void>();

  protected readonly isProfileMenuOpen = signal(false);

  // --- Données provisoires, remplacées au Lot 4 ------------------
  protected readonly userName = 'Mamadou Diallo';
  protected readonly userRole = 'Administrateur';
  protected readonly stationName = 'Station Dakar Plateau';
  protected readonly unreadNotifications = 3;

  protected toggleProfileMenu(): void {
    this.isProfileMenuOpen.update((open) => !open);
  }

  protected closeProfileMenu(): void {
    this.isProfileMenuOpen.set(false);
  }
}
