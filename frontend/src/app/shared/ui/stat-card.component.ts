import { Component, computed, input } from '@angular/core';

/**
 * Carte de statistique (KPI)
 * ------------------------------------------------------------------
 * <ac-stat-card
 *    label="Chiffre d'affaires du jour"
 *    value="485 000 FCFA"
 *    icon="bi-cash-stack"
 *    tone="success"
 *    trend="+12 %"
 *    trendDirection="up" />
 *
 * Sert au tableau de bord (Lot 10), aux paiements (Lot 9) et aux
 * analytics (Lot 16). C'est le premier élément que voit un gérant en
 * ouvrant l'application : il doit se lire en moins d'une seconde.
 *
 * D'où le choix d'un chiffre très gros et d'un libellé discret :
 * l'information est le nombre, pas son intitulé.
 */
@Component({
  selector: 'ac-stat-card',
  // Le composant occupe toute la hauteur de sa colonne : dans une
  // rangée d'indicateurs, les cartes restent alignées même si l'une
  // d'elles a un libellé sur deux lignes.
  styles: `:host { display: block; height: 100%; }`,
  template: `
    <div class="ac-card h-100">
      <div class="ac-card__body">
        <div class="d-flex align-items-start justify-content-between gap-3">
          <div class="ac-stat">
            <span class="ac-stat__label">{{ label() }}</span>
            <span class="ac-stat__value">{{ value() }}</span>

            @if (trend()) {
              <span class="ac-stat__trend" [class]="trendClass()">
                <i class="bi" [class]="trendIcon()" aria-hidden="true"></i>
                {{ trend() }}
                @if (trendCaption()) {
                  <span class="ac-text-muted fw-normal">{{ trendCaption() }}</span>
                }
              </span>
            }
          </div>

          @if (icon()) {
            <span class="ac-stat__icon" [style.background-color]="iconBackground()"
                  [style.color]="iconColor()">
              <i class="bi" [class]="icon()" aria-hidden="true"></i>
            </span>
          }
        </div>
      </div>
    </div>
  `,
})
export class StatCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly icon = input<string>('');

  /** Couleur de l'icône. Sobre par défaut : le bleu doit rester rare. */
  readonly tone = input<'primary' | 'success' | 'warning' | 'danger' | 'neutral'>('neutral');

  readonly trend = input<string>('');
  readonly trendDirection = input<'up' | 'down' | 'flat'>('flat');

  /** Précision du type « vs hier », affichée en gris à côté de la tendance. */
  readonly trendCaption = input<string>('');

  protected readonly iconBackground = computed(
    () => `var(--ac-${this.tone() === 'neutral' ? 'gray-100' : this.tone() + '-50'})`,
  );

  protected readonly iconColor = computed(
    () => `var(--ac-${this.tone() === 'neutral' ? 'gray-500' : this.tone() + '-700'})`,
  );

  protected readonly trendClass = computed(() => `ac-stat__trend--${this.trendDirection()}`);

  protected readonly trendIcon = computed(() => {
    const icons = {
      up: 'bi-arrow-up-short',
      down: 'bi-arrow-down-short',
      flat: 'bi-dash',
    } as const;

    return icons[this.trendDirection()];
  });
}
