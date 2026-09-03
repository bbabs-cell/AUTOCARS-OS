import { Component, input } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Coque des pages publiques
 * ------------------------------------------------------------------
 * Connexion, inscription, mot de passe oublié.
 *
 * Ces pages n'utilisent PAS la coque applicative : ni barre latérale,
 * ni en-tête. Quelqu'un qui n'est pas connecté n'a rien à faire dans
 * une navigation vers des modules auxquels il n'a pas accès.
 *
 * Sur grand écran, un panneau de gauche rappelle la promesse du
 * produit. Sur mobile, il disparaît : l'écran est trop précieux pour
 * du discours, on va droit au formulaire.
 */
@Component({
  selector: 'ac-auth-layout',
  imports: [RouterOutlet],
  templateUrl: './auth-layout.component.html',
  styleUrl: './auth-layout.component.scss',
})
export class AuthLayoutComponent {
  readonly showPromise = input<boolean>(true);
}
