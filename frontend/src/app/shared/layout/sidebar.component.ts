import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import {
  NAVIGATION,
  NAVIGATION_AVAILABLE,
  NAVIGATION_FOOTER,
} from '../../core/config/navigation.config';
import { AuthService } from '../../core/services/auth.service';

/**
 * Barre latérale de navigation
 * ------------------------------------------------------------------
 * Sur ordinateur : toujours visible, à gauche.
 * Sur mobile : masquée, ouverte par le bouton menu de l'en-tête.
 *
 * Le composant ne décide pas s'il est ouvert : il reçoit `isOpen` de
 * la coque applicative. Un composant qui gère son propre état
 * d'ouverture devient vite impossible à contrôler depuis l'extérieur
 * (fermer la barre après un clic sur un lien, par exemple).
 */
@Component({
  selector: 'ac-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  /** Contrôle l'affichage sur mobile uniquement. */
  readonly isOpen = input<boolean>(false);

  /** Émis quand l'utilisateur clique un lien : la coque referme le panneau. */
  readonly navigate = output<void>();

  private readonly auth = inject(AuthService);

  /**
   * Les modules disponibles, filtrés selon les droits.
   *
   * Un employé ne voit ni « Encaissements » ni « Caisse » : l'API les
   * lui refuserait, et proposer une porte fermée fait passer le
   * logiciel pour cassé.
   *
   * Ce filtrage est du CONFORT D'AFFICHAGE. Taper /cash dans la barre
   * d'adresse afficherait l'écran, qui resterait vide : le serveur ne
   * lui envoie aucune donnée.
   */
  protected readonly available = computed(() =>
    NAVIGATION_AVAILABLE.filter(
      (item) => item.permission === undefined || this.auth.can(item.permission),
    ),
  );
  protected readonly groups = NAVIGATION;
  protected readonly footerItems = NAVIGATION_FOOTER;
}
