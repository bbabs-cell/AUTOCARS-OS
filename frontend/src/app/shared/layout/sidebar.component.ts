import { Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import {
  NAVIGATION,
  NAVIGATION_AVAILABLE,
  NAVIGATION_FOOTER,
} from '../../core/config/navigation.config';

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

  protected readonly available = NAVIGATION_AVAILABLE;
  protected readonly groups = NAVIGATION;
  protected readonly footerItems = NAVIGATION_FOOTER;
}
