import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Écran d'erreur
 * ------------------------------------------------------------------
 * <ac-error-state code="404" title="Cette page n'existe pas" …>
 *
 * ------------------------------------------------------------------
 * TROIS CHOSES, TOUJOURS DANS CET ORDRE
 *
 *   1. CE QUI S'EST PASSÉ, en français et sans jargon.
 *   2. POURQUOI — quand on le sait. « Erreur 403 » n'apprend rien à
 *      personne ; « cet écran est réservé aux responsables » se
 *      comprend et se résout.
 *   3. UNE SORTIE. Un écran d'erreur sans lien est un cul-de-sac :
 *      l'utilisateur ferme l'onglet, et c'est la dernière fois qu'il
 *      ouvre le produit ce jour-là.
 *
 * ------------------------------------------------------------------
 * LE CODE HTTP EST AFFICHÉ, EN PETIT
 *
 * Il ne sert pas à l'utilisateur. Il sert à la personne qu'il
 * appellera : « il est écrit 403 » raccourcit le diagnostic de dix
 * minutes. On le montre donc, discrètement, sous le message — jamais
 * en gros chiffre au milieu de l'écran, ce qui donnerait au code plus
 * d'importance qu'à l'explication.
 *
 * ------------------------------------------------------------------
 * PAS D'ILLUSTRATION, PAS D'HUMOUR
 *
 * Ni robot cassé, ni « oups ! ». Quelqu'un qui tombe là a un client
 * devant lui et une voiture à rendre. Une plaisanterie ajoute une
 * seconde de lecture à un moment où il n'en a pas envie.
 */
@Component({
  selector: 'ac-error-state',
  imports: [RouterLink],
  template: `
    <div class="ac-error">
      <div class="ac-error__icon">
        <i class="bi" [class]="'bi-' + icon()" aria-hidden="true"></i>
      </div>

      <h1 class="ac-error__title">{{ title() }}</h1>

      <p class="ac-error__text">{{ text() }}</p>

      @if (hint()) {
        <p class="ac-error__hint">{{ hint() }}</p>
      }

      <div class="ac-error__actions">
        <a class="btn btn-primary" [routerLink]="homeLink()">{{ homeLabel() }}</a>

        @if (helpAnchor()) {
          <a class="btn btn-outline-secondary" [routerLink]="['/help']"
             [fragment]="helpAnchor()">
            Comprendre pourquoi
          </a>
        }
      </div>

      @if (code()) {
        <p class="ac-error__code">
          Code technique : {{ code() }}. Donnez-le si vous nous appelez.
        </p>
      }
    </div>
  `,
  styleUrl: './error-state.component.scss',
})
export class ErrorStateComponent {
  readonly icon = input<string>('exclamation-triangle');
  readonly title = input.required<string>();
  readonly text = input<string>('');
  readonly hint = input<string>('');
  readonly code = input<string>('');
  readonly homeLink = input<string>('/dashboard');
  readonly homeLabel = input<string>('Revenir au tableau de bord');
  /** Ancre de l'aide, quand une réponse existe : `/help#…`. */
  readonly helpAnchor = input<string>('');
}
