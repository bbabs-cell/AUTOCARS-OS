import { Component, computed, input } from '@angular/core';

import { AmountPipe } from '../pipes/amount.pipe';

export interface SplitSegment {
  key: string;
  label: string;
  value: number;
  /**
   * L'emplacement de couleur, 0 à 3, DÉCIDÉ PAR L'APPELANT.
   *
   * C'est le point le plus important de ce composant. Sans lui, on
   * colorerait par ordre d'arrivée — et le jour où les espèces
   * passeraient devant le mobile money, elles échangeraient leur
   * couleur. Quelqu'un qui a appris « le bleu, c'est les espèces »
   * lirait alors le graphique à l'envers sans s'en apercevoir.
   *
   * La couleur suit l'ENTITÉ, jamais son rang.
   */
  slot?: number;
}

/**
 * Barre de répartition — la part de chacun dans un total
 * ==================================================================
 * <ac-split-bar [segments]="…" />
 *
 * ------------------------------------------------------------------
 * POURQUOI UNE BARRE ET PAS UN CAMEMBERT ?
 *
 * Parce qu'on compare des longueurs, ce que l'œil fait très bien,
 * plutôt que des angles, ce qu'il fait très mal. Deux parts de 28 %
 * et 31 % sont indiscernables dans un camembert ; côte à côte sur une
 * barre, la différence se voit.
 *
 * ------------------------------------------------------------------
 * QUATRE COULEURS AU MAXIMUM, PUIS « AUTRE »
 *
 * Chaque segment porte son emplacement de couleur (`slot`), décidé
 * par l'appelant à partir de ce que le segment REPRÉSENTE — pas de sa
 * position dans la liste. Si les espèces passaient devant le mobile
 * money demain, elles garderaient leur couleur.
 *
 * Au-delà de quatre catégories, on ne fabrique pas une cinquième
 * teinte — elle serait indiscernable pour un daltonien. Le reste est
 * regroupé sous « Autre », en gris.
 *
 * ------------------------------------------------------------------
 * LA LÉGENDE PORTE LES MONTANTS, ET C'EST VOULU
 *
 * Écrire les chiffres DANS les segments ne marche pas : un segment de
 * 6 % ne peut pas contenir « 3 500 FCFA », et le texte serait tronqué.
 * La légende les donne tous, lisiblement, et sert en même temps de
 * tableau de valeurs — la couleur n'est donc jamais le seul moyen de
 * lire l'information.
 */
@Component({
  selector: 'ac-split-bar',
  imports: [AmountPipe],
  template: `
    @if (total() === 0) {
      <p class="ac-text-secondary mb-0">Aucun encaissement aujourd'hui.</p>
    } @else {
      <div
        class="ac-split"
        role="img"
        [attr.aria-label]="'Répartition de ' + total() + ' francs'"
      >
        @for (segment of rows(); track segment.key) {
          <span
            class="ac-split__segment"
            [style.width.%]="segment.share"
            [style.background-color]="segment.color"
            [attr.title]="segment.label + ' — ' + segment.value + ' FCFA'"
          ></span>
        }
      </div>

      <dl class="ac-split__legend">
        @for (segment of rows(); track segment.key) {
          <dt>
            <span class="ac-split__dot" [style.background-color]="segment.color"></span>
            {{ segment.label }}
            <span class="ac-caption">{{ segment.percent }} %</span>
          </dt>
          <dd class="ac-numeric">{{ segment.value | acAmount }}</dd>
        }
      </dl>
    }
  `,
})
export class SplitBarComponent {
  readonly segments = input.required<SplitSegment[]>();

  /** Quatre teintes vérifiées, puis le gris du « reste ». */
  private static readonly COLORS = [
    'var(--ac-chart-1)',
    'var(--ac-chart-2)',
    'var(--ac-chart-3)',
    'var(--ac-chart-4)',
  ];

  protected readonly total = computed(() =>
    this.segments().reduce((sum, segment) => sum + segment.value, 0),
  );

  protected readonly rows = computed(() => {
    const total = this.total();

    if (total === 0) {
      return [];
    }

    // On trie par montant décroissant pour l'AFFICHAGE — la plus
    // grosse part en premier se lit mieux. Mais la COULEUR ne vient
    // pas de ce tri : elle vient du `slot` porté par le segment.
    const sorted = [...this.segments()].sort((a, b) => b.value - a.value);
    const head = sorted.filter((segment) => this.slotOf(segment) !== null);
    const tail = sorted.filter((segment) => this.slotOf(segment) === null);

    const rows = head.map((segment) => ({
      ...segment,
      color: SplitBarComponent.COLORS[this.slotOf(segment) as number],
      share: (segment.value / total) * 100,
      percent: Math.round((segment.value / total) * 100),
    }));

    if (tail.length > 0) {
      const rest = tail.reduce((sum, segment) => sum + segment.value, 0);

      rows.push({
        key: 'other',
        label: 'Autre',
        value: rest,
        color: 'var(--ac-chart-other)',
        share: (rest / total) * 100,
        percent: Math.round((rest / total) * 100),
      });
    }

    return rows;
  });

  /**
   * L'emplacement de couleur d'un segment, ou null s'il doit tomber
   * dans « Autre ».
   *
   * Sans `slot` explicite, on retombe sur la position d'origine dans
   * la liste reçue — jamais sur le classement par montant, qui change
   * d'un jour à l'autre.
   */
  private slotOf(segment: SplitSegment): number | null {
    const slot = segment.slot ?? this.segments().indexOf(segment);

    return slot >= 0 && slot < SplitBarComponent.COLORS.length ? slot : null;
  }
}
