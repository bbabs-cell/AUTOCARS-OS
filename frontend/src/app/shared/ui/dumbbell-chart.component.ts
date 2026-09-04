import { Component, computed, input } from '@angular/core';

export interface DumbbellRow {
  label: string;
  /** La valeur de référence — ce qui était annoncé. */
  from: number;
  /** La valeur mesurée — ce qui s'est réellement passé. */
  to: number;
  /** Sur combien d'observations la mesure repose. */
  samples?: number;
}

/**
 * Graphique en haltères — annoncé contre mesuré
 * ==================================================================
 * <ac-dumbbell-chart [rows]="…" unit="min" fromLabel="Annoncé" … />
 *
 * ------------------------------------------------------------------
 * POURQUOI CETTE FORME, ET PAS DEUX BARRES CÔTE À CÔTE ?
 *
 * Parce que la question n'est pas « combien » mais « DE COMBIEN ILS
 * DIFFÈRENT ». Deux barres groupées obligent l'œil à comparer deux
 * longueurs partant du même bord ; l'haltère montre l'écart
 * directement, comme un segment qu'on peut mesurer du regard.
 *
 * C'est la forme prévue pour un « avant → après par élément », et
 * c'est exactement ce qu'on a ici : la durée promise au client, et
 * celle qu'il a réellement attendue.
 *
 * ------------------------------------------------------------------
 * UNE SEULE TEINTE, DEUX INTENSITÉS
 *
 * Les deux points ne sont pas deux catégories : c'est la MÊME
 * grandeur à deux moments. Leur donner deux couleurs différentes
 * suggérerait deux sujets distincts. Le clair est la référence, le
 * foncé la mesure — et la barre qui les relie porte le sens.
 *
 * ------------------------------------------------------------------
 * PAS DE COULEUR POUR DIRE « C'EST MAUVAIS »
 *
 * Un dépassement n'est pas une faute en soi : une prestation qui dure
 * plus longtemps qu'annoncé peut vouloir dire que l'équipe soigne son
 * travail, ou que le catalogue est trop optimiste. Le graphique
 * montre l'écart et son sens ; il ne le juge pas.
 *
 * ------------------------------------------------------------------
 * LE TABLEAU EST TOUJOURS LÀ
 *
 * Sous le graphique, les mêmes chiffres en toutes lettres. Une
 * information ne doit jamais être accessible uniquement à la souris —
 * ni uniquement à l'œil.
 */
@Component({
  selector: 'ac-dumbbell-chart',
  template: `
    <figure class="ac-dumbbell">
      @for (row of scaled(); track row.label) {
        <div class="ac-dumbbell__row">
          <span class="ac-dumbbell__label">{{ row.label }}</span>

          <span class="ac-dumbbell__track"
                [attr.title]="row.label + ' — ' + fromLabel() + ' ' + row.from + unit()
                              + ', ' + toLabel() + ' ' + row.to + unit()">
            <!--
              La ligne de liaison EST l'information : c'est l'écart.
              Elle passe sous les deux points, qui la terminent.
            -->
            <span class="ac-dumbbell__link"
                  [style.left.%]="row.linkLeft"
                  [style.width.%]="row.linkWidth"></span>

            <span class="ac-dumbbell__dot ac-dumbbell__dot--from"
                  [style.left.%]="row.fromLeft"></span>
            <span class="ac-dumbbell__dot ac-dumbbell__dot--to"
                  [style.left.%]="row.toLeft"></span>
          </span>

          <!--
            L'écart en toutes lettres, à droite. C'est le chiffre que
            le lecteur cherche, et le seul qu'on étiquette : écrire
            aussi les deux valeurs ferait trois nombres par ligne.
          -->
          <span class="ac-dumbbell__gap ac-numeric" [class.ac-dumbbell__gap--over]="row.to > row.from">
            {{ row.to > row.from ? '+' : '' }}{{ row.to - row.from }}{{ unit() }}
          </span>
        </div>
      }

      <figcaption class="ac-dumbbell__legend">
        <span><span class="ac-dumbbell__key ac-dumbbell__key--from"></span>{{ fromLabel() }}</span>
        <span><span class="ac-dumbbell__key ac-dumbbell__key--to"></span>{{ toLabel() }}</span>
      </figcaption>

      <div class="ac-table-wrapper">
        <table class="ac-table">
          <thead>
            <tr>
              <th>{{ caption() }}</th>
              <th class="ac-table__amount">{{ fromLabel() }}</th>
              <th class="ac-table__amount">{{ toLabel() }}</th>
              <th class="ac-table__amount">Écart</th>
              <th class="ac-table__amount">Mesures</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.label) {
              <tr>
                <td>{{ row.label }}</td>
                <td class="ac-table__amount ac-numeric">{{ row.from }}{{ unit() }}</td>
                <td class="ac-table__amount ac-numeric">{{ row.to }}{{ unit() }}</td>
                <td class="ac-table__amount ac-numeric">
                  {{ row.to > row.from ? '+' : '' }}{{ row.to - row.from }}{{ unit() }}
                </td>
                <td class="ac-table__amount ac-numeric ac-text-secondary">
                  {{ row.samples ?? '—' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </figure>
  `,
  styleUrl: './dumbbell-chart.component.scss',
})
export class DumbbellChartComponent {
  readonly rows = input.required<DumbbellRow[]>();
  readonly caption = input<string>('');
  readonly unit = input<string>('');
  readonly fromLabel = input<string>('Annoncé');
  readonly toLabel = input<string>('Mesuré');

  /**
   * L'échelle part TOUJOURS de zéro.
   *
   * Une échelle qui commencerait à la plus petite valeur ferait
   * paraître énorme un écart de deux minutes. Sur des durées, le zéro
   * a un sens : c'est l'instantané.
   */
  protected readonly scaled = computed(() => {
    const rows = this.rows();
    const max = Math.max(1, ...rows.map((row) => Math.max(row.from, row.to)));

    // 6 % de marge à droite pour que le point le plus haut ne touche
    // pas le bord de la piste.
    const position = (value: number): number => (value / max) * 94;

    return rows.map((row) => {
      const fromLeft = position(row.from);
      const toLeft = position(row.to);

      return {
        ...row,
        fromLeft,
        toLeft,
        linkLeft: Math.min(fromLeft, toLeft),
        linkWidth: Math.abs(toLeft - fromLeft),
      };
    });
  });
}
