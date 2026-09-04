import { Component, computed, input } from '@angular/core';

export interface ColumnPoint {
  label: string;
  value: number;
  /** Info supplémentaire pour l'infobulle : la date complète. */
  detail?: string;
}

/**
 * Graphique en colonnes — UNE SEULE SÉRIE
 * ==================================================================
 * <ac-column-chart [points]="…" caption="Recette des 7 derniers jours" />
 *
 * ------------------------------------------------------------------
 * POURQUOI UNE SEULE COULEUR POUR TOUTES LES COLONNES ?
 *
 * Parce qu'il n'y a qu'une série : la recette. Colorer chaque barre
 * différemment ferait croire à sept catégories distinctes. Colorer
 * plus foncé quand c'est plus haut serait pire encore : la hauteur
 * dit déjà la valeur, la couleur répéterait la même information et
 * gaspillerait le seul canal encore libre.
 *
 * ------------------------------------------------------------------
 * POURQUOI PAS DE BIBLIOTHÈQUE DE GRAPHIQUES ?
 *
 * Sept rectangles et sept étiquettes. Une bibliothèque coûterait
 * 200 ko à télécharger sur une connexion mobile sénégalaise, pour
 * faire ce que quarante lignes de SVG font très bien — et elle
 * imposerait ses propres couleurs, qu'il faudrait ensuite combattre
 * pour respecter le design system.
 *
 * ------------------------------------------------------------------
 * TROIS RÈGLES D'AFFICHAGE APPLIQUÉES ICI
 *
 * 1. On n'écrit PAS la valeur au-dessus de chaque colonne : sept
 *    nombres alignés deviennent du bruit qu'on ne lit plus. Seules
 *    la plus haute et la dernière sont étiquetées — ce sont les deux
 *    qu'on cherche.
 * 2. Le survol donne la valeur exacte de n'importe quelle colonne,
 *    et le tableau sous le graphique la donne SANS survol : une
 *    valeur ne doit jamais être accessible uniquement à la souris.
 * 3. Le fond reste vide. Une piste grise derrière chaque colonne
 *    ferait sept blocs lourds pour sept traits de données — et un
 *    graphique où le décor pèse plus que la donnée se lit mal. Seule
 *    une ligne de base fine marque le zéro.
 */
@Component({
  selector: 'ac-column-chart',
  template: `
    <figure class="ac-chart">
      <svg
        class="ac-chart__svg"
        [attr.viewBox]="'0 0 ' + width + ' ' + height"
        preserveAspectRatio="none"
        role="img"
        [attr.aria-label]="caption()"
      >
        <!-- La ligne de base, en trait fin. Une colonne part du bas :
             elle n'a pas besoin d'être soulignée d'un trait épais. -->
        <line
          [attr.x1]="0"
          [attr.y1]="plotHeight"
          [attr.x2]="width"
          [attr.y2]="plotHeight"
          stroke="var(--ac-border)"
          stroke-width="1"
        />

        @for (bar of bars(); track bar.label) {
          <!-- Une journée sans recette garde un moignon de 3 px :
               sans lui, elle serait invisible et l'on croirait la
               donnée manquante plutôt que nulle. -->
          <rect
            [attr.x]="bar.x"
            [attr.y]="plotHeight - bar.height"
            [attr.width]="barWidth"
            [attr.height]="bar.height"
            rx="4"
            [attr.fill]="bar.value > 0 ? 'var(--ac-chart-1)' : 'var(--ac-chart-track)'"
          />

          <!-- Zone de survol pleine hauteur : viser une colonne
               de 3 px de haut un jour creux serait impossible. -->
          <rect
            [attr.x]="bar.x"
            [attr.y]="0"
            [attr.width]="barWidth"
            [attr.height]="plotHeight"
            fill="transparent"
          >
            <title>{{ bar.detail ?? bar.label }} — {{ formatted(bar.value) }}</title>
          </rect>
        }
      </svg>

      <div class="ac-chart__axis">
        @for (bar of bars(); track bar.label) {
          <span class="ac-chart__tick" [class.ac-chart__tick--current]="bar.isLast">
            {{ bar.label }}
          </span>
        }
      </div>

      @if (highlight(); as top) {
        <figcaption class="ac-caption">
          {{ peakLabel() }} : {{ top.detail ?? top.label }} — {{ formatted(top.value) }}.
        </figcaption>
      }
    </figure>
  `,
})
export class ColumnChartComponent {
  readonly points = input.required<ColumnPoint[]>();
  readonly caption = input<string>('Graphique');

  /**
   * CE QUE MESURENT LES COLONNES.
   *
   * ==================================================================
   * AJOUTÉ AU LOT 16, APRÈS UN DÉFAUT BIEN VISIBLE
   * ==================================================================
   * Ce composant est né au lot 10 pour une seule série : la recette.
   * Le formatage monétaire était donc écrit en dur — et le jour où
   * l'écran des statistiques s'en est servi pour compter des
   * véhicules, il a affiché « meilleure journée : 4 à 5 FCFA » pour
   * cinq voitures.
   *
   * La leçon vaut d'être notée : un composant réutilisé hors de son
   * usage d'origine ment sans prévenir. Ce n'est pas la réutilisation
   * qui était fautive, c'est l'hypothèse cachée qu'elle a révélée.
   */
  readonly unit = input<'amount' | 'count'>('amount');

  /** Le mot qui introduit la valeur la plus haute. */
  readonly peakLabel = input<string>('Meilleure journée');

  /**
   * Le SVG travaille dans un repère fixe et s'étire à la largeur
   * disponible. C'est ce qui le rend responsive sans une ligne de
   * JavaScript de redimensionnement.
   */
  protected readonly width = 700;
  protected readonly height = 164;
  protected readonly plotHeight = 160;
  // Des colonnes fines, pas des blocs : 56 px sur 100 disponibles
  // laissent respirer, et la donnée reste plus visible que l'espace
  // qui la sépare de sa voisine.
  protected readonly barWidth = 56;

  /**
   * La valeur, dans son unité.
   *
   * Le pipe `acAmount` reste utilisé pour l'argent ; un simple nombre
   * suffit pour un comptage, et « 5 » se lit mieux que « 5 unités ».
   */
  protected formatted(value: number): string {
    return this.unit() === 'amount'
      ? `${new Intl.NumberFormat('fr-FR').format(value)} FCFA`
      : new Intl.NumberFormat('fr-FR').format(value);
  }

  protected readonly bars = computed(() => {
    const points = this.points();

    if (points.length === 0) {
      return [];
    }

    // L'échelle part TOUJOURS de zéro. Tronquer la base exagère les
    // écarts : une recette qui passe de 40 000 à 42 000 paraîtrait
    // avoir doublé.
    const max = Math.max(...points.map((p) => p.value), 1);

    // Un espace de 2 px entre les colonnes plutôt qu'une bordure :
    // le fond de la carte fait la séparation, sans ajouter de trait.
    const gap = (this.width - points.length * this.barWidth) / Math.max(1, points.length - 1);

    return points.map((point, index) => ({
      ...point,
      x: index * (this.barWidth + gap),
      // Un plancher de 3 px : une recette faible mais non nulle doit
      // rester visible, sinon elle se confond avec une journée vide.
      height: Math.max(3, Math.round((point.value / max) * this.plotHeight)),
      isLast: index === points.length - 1,
    }));
  });

  /** La journée la plus forte : la seule que l'on nomme en toutes lettres. */
  protected readonly highlight = computed(() => {
    const points = this.points().filter((p) => p.value > 0);

    if (points.length === 0) {
      return null;
    }

    return points.reduce((best, point) => (point.value > best.value ? point : best));
  });
}
