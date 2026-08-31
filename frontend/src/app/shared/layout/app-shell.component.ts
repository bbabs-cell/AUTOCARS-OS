import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { SidebarComponent } from './sidebar.component';
import { TopbarComponent } from './topbar.component';

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
 */
@Component({
  selector: 'ac-app-shell',
  imports: [RouterOutlet, SidebarComponent, TopbarComponent],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent {
  protected readonly isSidebarOpen = signal(false);

  protected toggleSidebar(): void {
    this.isSidebarOpen.update((open) => !open);
  }

  protected closeSidebar(): void {
    this.isSidebarOpen.set(false);
  }
}
