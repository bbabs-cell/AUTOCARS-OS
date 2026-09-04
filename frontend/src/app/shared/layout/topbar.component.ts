import { Component, computed, inject, output, signal } from '@angular/core';

import { AuthService } from '../../core/services/auth.service';
import { AttendanceService } from '../../core/services/attendance.service';
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
  private readonly attendance = inject(AttendanceService);

  protected readonly isProfileMenuOpen = signal(false);
  protected readonly isClocking = signal(false);

  /**
   * LE POINTAGE EST DANS L'EN-TÊTE, PAS DANS UNE PAGE.
   *
   * Un employé ouvre l'application pour pointer, et rien d'autre.
   * L'obliger à trouver un écran dédié ajoute deux gestes à quelque
   * chose qui doit en demander un seul — et un pointage qui demande
   * un effort finit par être fait « plus tard », c'est-à-dire jamais.
   *
   * Le bouton n'apparaît que si l'utilisateur a le droit de pointer.
   */
  protected readonly canClock = computed(() => this.auth.can('attendance.clock'));
  protected readonly attendanceState = computed(() => this.attendance.mine());
  protected readonly isClockedIn = computed(
    () => this.attendance.mine()?.is_clocked_in === true,
  );

  /** « depuis 3 h 20 » — l'heure du serveur, pas celle du téléphone. */
  protected readonly presenceLabel = computed(() => {
    const minutes = this.attendance.mine()?.current?.minutes_present;

    if (minutes === null || minutes === undefined) {
      return '';
    }

    if (minutes < 60) {
      return `depuis ${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;

    return rest === 0
      ? `depuis ${hours} h`
      : `depuis ${hours} h ${String(rest).padStart(2, '0')}`;
  });

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

    // L'état du pointage est chargé une fois, à l'ouverture de
    // l'application : le bouton doit être juste dès le premier écran.
    this.attendance.refreshMine();
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

  /**
   * Pointer son arrivée ou son départ, d'un seul geste.
   *
   * Le serveur refuse un double pointage (409) : on ne réplique pas
   * cette règle ici, on se contente de désactiver le bouton pendant
   * l'appel pour éviter le double appui sur un téléphone lent.
   */
  protected toggleClock(): void {
    if (this.isClocking()) {
      return;
    }

    this.isClocking.set(true);

    const request = this.isClockedIn()
      ? this.attendance.clockOut()
      : this.attendance.clockIn();

    request.subscribe({
      next: () => this.isClocking.set(false),
      error: () => {
        this.isClocking.set(false);
        // L'état réel vient du serveur : on le recharge plutôt que de
        // deviner ce qui s'est passé.
        this.attendance.refreshMine();
      },
    });
  }
}
