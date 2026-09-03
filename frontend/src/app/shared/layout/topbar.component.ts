import { Component, computed, inject, output, signal } from '@angular/core';

import { AuthService } from '../../core/services/auth.service';
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
 * Le nom et le rôle viennent du service d'authentification. Le nombre
 * de notifications reste fictif jusqu'au lot 15.
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

  private readonly auth = inject(AuthService);

  protected readonly isProfileMenuOpen = signal(false);

  protected readonly userName = computed(() => this.auth.user()?.full_name ?? '');

  /** Le rôle est stocké en anglais côté base ; on l'affiche en français. */
  protected readonly userRole = computed(() => {
    const labels = {
      ADMIN: 'Administrateur',
      MANAGER: 'Manager',
      EMPLOYEE: 'Employé',
    } as const;

    const role = this.auth.user()?.role;

    return role ? labels[role] : '';
  });

  // Provisoire : viendra du module stations (lot 17) et du centre de
  // notifications (lot 15).
  protected readonly stationName = 'Station principale';
  protected readonly unreadNotifications = 3;

  protected logout(): void {
    this.closeProfileMenu();
    this.auth.logout();
  }

  protected toggleProfileMenu(): void {
    this.isProfileMenuOpen.update((open) => !open);
  }

  protected closeProfileMenu(): void {
    this.isProfileMenuOpen.set(false);
  }
}
