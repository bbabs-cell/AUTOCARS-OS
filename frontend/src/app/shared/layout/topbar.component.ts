import { Component, computed, inject, output, signal } from '@angular/core';

import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
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
  private readonly catalog = inject(CatalogService);

  protected readonly isProfileMenuOpen = signal(false);

  /**
   * Nom de la station affiché en haut à droite.
   *
   * Il était écrit en dur jusqu'au lot 5 — ce qui affichait
   * « Station principale » alors que le gérant venait de la renommer.
   * Un libellé faux est pire qu'un libellé absent : il fait douter du
   * reste de l'écran.
   *
   * On charge la première station au démarrage. Le sélecteur pour les
   * entreprises multi-stations arrive au lot 17.
   */
  protected readonly stationName = signal('');

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

  // Provisoire : viendra du centre de notifications (lot 15).
  protected readonly unreadNotifications = 3;

  constructor() {
    // Un employé n'a pas le droit de lister les stations : l'appel
    // échouerait avec un 403. On n'affiche alors simplement rien,
    // plutôt que de laisser une erreur remonter dans la console.
    this.catalog.stations().subscribe({
      next: (stations) => this.stationName.set(stations[0]?.name ?? ''),
      error: () => this.stationName.set(''),
    });
  }

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
