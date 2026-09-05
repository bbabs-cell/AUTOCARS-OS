import { Component, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { AttendanceService } from '../../core/services/attendance.service';
import { StationContextService } from '../../core/services/station-context.service';
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
 * Le nom et le rôle viennent du service d'authentification.
 *
 * ------------------------------------------------------------------
 * TROIS ÉLÉMENTS ONT DISPARU AU LOT 19
 *
 * La recherche globale, la cloche de notifications et « Mon profil »
 * étaient là depuis le lot 2, désactivés ou faux, en attendant d'être
 * branchés. Dix-sept lots plus tard, ils ne faisaient toujours rien.
 *
 * Le plus nuisible était la cloche : sa pastille rouge annonçait
 * « 3 » notifications, un chiffre écrit en dur qui n'a jamais bougé.
 * Un élément mort ne se contente pas d'être inutile — il apprend à
 * l'utilisateur que l'interface peut mentir, et cette leçon vaut
 * ensuite pour les éléments qui, eux, disent vrai.
 */
@Component({
  selector: 'ac-topbar',
  imports: [AvatarComponent, RouterLink],
  templateUrl: './topbar.component.html',
  styleUrl: './topbar.component.scss',
})
export class TopbarComponent {
  /** Demande à la coque d'ouvrir la barre latérale (mobile). */
  readonly toggleSidebar = output<void>();

  private readonly auth = inject(AuthService);
  private readonly attendance = inject(AttendanceService);

  /** Public : le gabarit lit directement ses signaux. */
  protected readonly stationContext = inject(StationContextService);

  protected readonly isProfileMenuOpen = signal(false);
  protected readonly isStationMenuOpen = signal(false);
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
   * La station qu'on regarde, en haut à droite.
   *
   * Elle a d'abord été écrite en dur (« Station principale »), puis
   * remplacée au lot 5 par le nom réel de la première station — un
   * libellé faux étant pire qu'un libellé absent.
   *
   * DEPUIS LE LOT 17, C'EST UN CHOIX, pas un affichage. L'entreprise
   * peut avoir plusieurs stations, et ce menu décide de ce que
   * montrent le tableau de bord, la file d'attente, les rendez-vous
   * et les statistiques — tous à la fois. Il reste un simple libellé
   * quand il n'y a qu'une station : proposer un choix qui n'en est
   * pas un ajoute un clic pour rien.
   */
  protected readonly stationLabel = computed(() => this.stationContext.label());

  /**
   * Les paramètres de l'entreprise sont réservés au propriétaire.
   *
   * Le menu est masqué pour les autres — mais c'est du confort
   * d'affichage, pas une protection : le serveur refuse la route à
   * qui n'a pas `organization.view`, et c'est cette barrière-là qui
   * compte.
   */
  protected readonly canSeeSettings = computed(() => this.auth.can('organization.view'));

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

  constructor() {
    // La liste des stations est chargée une seule fois pour toute
    // l'application : c'est le service de contexte qui la garde, pas
    // cet en-tête. Un employé n'a pas `stations.view` — l'appel
    // répond 403 et la liste reste vide, ce qui masque simplement le
    // menu.
    this.stationContext.ensureLoaded();

    // L'état du pointage est chargé une fois, à l'ouverture de
    // l'application : le bouton doit être juste dès le premier écran.
    this.attendance.refreshMine();
  }

  protected toggleStationMenu(): void {
    this.isStationMenuOpen.update((open) => !open);
  }

  protected closeStationMenu(): void {
    this.isStationMenuOpen.set(false);
  }

  protected chooseStation(stationId: number): void {
    this.stationContext.select(stationId);
    this.closeStationMenu();
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
