import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Composant racine de l'application.
 * Il ne contient volontairement rien d'autre que le point d'insertion
 * du routeur : c'est le layout (Lot 2) qui portera la navigation.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {}
