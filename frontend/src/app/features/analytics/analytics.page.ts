import { Component, computed, inject, signal, effect} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { ColumnChartComponent, ColumnPoint } from '../../shared/ui/column-chart.component';
import { DumbbellChartComponent, DumbbellRow } from '../../shared/ui/dumbbell-chart.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { SplitBarComponent, SplitSegment } from '../../shared/ui/split-bar.component';
import { AnalyticsService } from '../../core/services/analytics.service';
import { StationContextService } from '../../core/services/station-context.service';
import { Analytics } from '../../core/models/analytics.model';

/**
 * Les statistiques
 * ==================================================================
 * LE PREMIER ÉCRAN QUI N'AJOUTE RIEN AU MÉTIER.
 * ==================================================================
 *
 * Aucune table, aucune colonne, aucune migration. Quinze lots ont
 * enregistré honnêtement ce qui se passait dans une station ;
 * celui-ci se contente de leur poser des questions.
 *
 * ------------------------------------------------------------------
 * IL NE REMPLACE PAS LE TABLEAU DE BORD
 *
 *   TABLEAU DE BORD (lot 10)   « qu'est-ce qui demande une action
 *                                aujourd'hui ? » — se vide quand tout
 *                                va bien, se regarde le matin.
 *   STATISTIQUES (ici)         « comment se porte l'affaire depuis un
 *                                mois ? » — ne se vide jamais, se
 *                                regarde le dimanche soir.
 *
 * Les confondre aurait produit un écran qu'on ouvre sans savoir ce
 * qu'on y cherche.
 *
 * ------------------------------------------------------------------
 * DEUX PÉRIMÈTRES QUI NE SE CONFONDENT PAS
 *
 *   ENCAISSÉ   l'argent reçu pendant la période, forfaits compris —
 *              dont les lavages seront livrés plus tard.
 *   LIVRÉ      la valeur des prestations rendues pendant la période,
 *              dont des lavages payés il y a six mois et des lavages
 *              offerts.
 *
 * Les deux sont vrais et ils ne sont pas égaux. L'écran les montre
 * côte à côte et explique le passage de l'un à l'autre, plutôt que
 * d'en choisir un et laisser croire que c'est LE chiffre.
 *
 * ------------------------------------------------------------------
 * AUCUN GRAPHIQUE À DEUX AXES
 *
 * Les véhicules et les francs ne partagent pas d'échelle. Les tracer
 * ensemble avec un axe à gauche et un à droite inventerait une
 * corrélation que la donnée ne contient pas : l'alignement des deux
 * échelles serait arbitraire. Deux graphiques côte à côte disent la
 * même chose sans mentir.
 */
@Component({
  selector: 'app-analytics-page',
  imports: [
    ReactiveFormsModule,
    AmountPipe,
    ColumnChartComponent,
    DumbbellChartComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    SplitBarComponent,
  ],
  templateUrl: './analytics.page.html',
  styleUrl: './analytics.page.scss',
})
export class AnalyticsPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly analytics = inject(AnalyticsService);
  private readonly stationContext = inject(StationContextService);

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly data = signal<Analytics | null>(null);

  // La station a quitté ce formulaire au lot 17 : elle se choisit
  // dans l'en-tête, et le choix vaut pour tous les écrans à la fois.
  protected readonly filterForm = this.formBuilder.nonNullable.group({
    from: [this.daysAgo(29)],
    to: [this.today()],
  });

  protected readonly period = computed(() => this.data()?.period ?? null);
  protected readonly delivered = computed(() => this.data()?.delivered ?? null);
  protected readonly collected = computed(() => this.data()?.collected ?? null);
  protected readonly customers = computed(() => this.data()?.customers ?? null);
  protected readonly services = computed(() => this.data()?.services ?? []);

  /** Y a-t-il seulement quelque chose à montrer ? */
  protected readonly hasActivity = computed(
    () => (this.data()?.daily ?? []).some((day) => day.vehicles > 0 || day.revenue > 0),
  );

  // --- Les deux graphiques du haut --------------------------------------
  // DEUX SÉRIES, DEUX GRAPHIQUES. Voir la note en tête de classe.

  protected readonly vehiclePoints = computed<ColumnPoint[]>(() =>
    (this.data()?.daily ?? []).map((day) => ({
      label: this.shortDay(day.day),
      value: day.vehicles,
      detail: this.longDay(day.day),
    })),
  );

  protected readonly revenuePoints = computed<ColumnPoint[]>(() =>
    (this.data()?.daily ?? []).map((day) => ({
      label: this.shortDay(day.day),
      value: day.revenue,
      detail: this.longDay(day.day),
    })),
  );

  /**
   * La décomposition de ce qui a été livré.
   *
   * LES EMPLACEMENTS DE COULEUR SONT FIXES, décidés par ce que chaque
   * part REPRÉSENTE et non par sa taille. Le jour où les lavages
   * offerts dépasseront les prépayés, ils ne changeront pas de
   * couleur : quelqu'un qui a appris « le violet, c'est l'abonnement »
   * doit pouvoir continuer à lire le graphique.
   */
  protected readonly deliveredSegments = computed<SplitSegment[]>(() => {
    const breakdown = this.delivered();

    if (breakdown === null) {
      return [];
    }

    return [
      { key: 'paid', label: 'Encaissé', value: breakdown.paid, slot: 0 },
      { key: 'prepaid', label: 'Prépayé (forfait)', value: breakdown.prepaid, slot: 2 },
      { key: 'gifted', label: 'Offert (fidélité)', value: breakdown.gifted, slot: 1 },
      // Un reste négatif ne s'affiche pas comme une part : il signale
      // une incohérence, et c'est le bandeau au-dessus qui le dit.
      { key: 'unpaid', label: 'Jamais réglé', value: Math.max(0, breakdown.unpaid), slot: 3 },
    ].filter((segment) => segment.value > 0);
  });

  protected readonly hourPoints = computed<ColumnPoint[]>(() =>
    (this.data()?.hours ?? [])
      // On ne montre que les heures où la station a vu passer quelque
      // chose, plus une marge d'une heure de chaque côté : afficher
      // les vingt-quatre écraserait les six qui comptent.
      .filter((hour) => this.isWorkingHour(hour.hour))
      .map((hour) => ({
        label: String(hour.hour).padStart(2, '0'),
        value: hour.operations,
        detail: `${String(hour.hour).padStart(2, '0')} h`,
      })),
  );

  protected readonly weekdayPoints = computed<ColumnPoint[]>(() =>
    (this.data()?.weekdays ?? []).map((day) => ({
      label: day.label.slice(0, 3),
      value: day.operations,
      detail: day.label,
    })),
  );

  protected readonly durationRows = computed<DumbbellRow[]>(() =>
    (this.data()?.durations ?? []).map((row) => ({
      label: row.service,
      from: row.announced,
      to: row.actual,
      samples: row.samples,
    })),
  );

  /**
   * Les prestations qui dépassent leur durée annoncée.
   *
   * C'EST LA QUESTION LAISSÉE OUVERTE AU LOT 8. Les seuils d'alerte
   * de la file d'attente venaient « du bon sens, pas de mesures :
   * aucune station ne tourne encore avec le produit ». Les mesures
   * arrivent ici, et si toutes les prestations dépassent, ce n'est pas
   * l'équipe qui est lente — c'est le catalogue qui ment aux clients.
   */
  protected readonly overrunning = computed(
    () => (this.data()?.durations ?? []).filter((row) => row.actual > row.announced).length,
  );

  /** La part de clients déjà venus avant la période. */
  protected readonly returningShare = computed(() => {
    const customers = this.customers();

    if (customers === null || customers.total === 0) {
      return 0;
    }

    return Math.round((customers.returning / customers.total) * 100);
  });

  /** La plus grosse part du chiffre d'affaires par prestation. */
  protected readonly serviceMax = computed(() =>
    Math.max(1, ...this.services().map((service) => service.value)),
  );

  constructor() {
    // Les statistiques suivent la station de l'en-tête. L'effet couvre
    // le premier affichage comme les changements suivants.
    effect(() => {
      this.stationContext.selectedId();
      this.load();
    });
  }

  protected load(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    const { from, to } = this.filterForm.getRawValue();

    this.analytics.load(from, to, this.stationContext.queryId()).subscribe({
      next: (data) => {
        this.data.set(data);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          error.error?.errors?.from ?? 'Le chargement des statistiques a échoué.',
        );
      },
    });
  }

  protected setRange(days: number): void {
    this.filterForm.patchValue({ from: this.daysAgo(days - 1), to: this.today() });
    this.load();
  }

  /** La largeur d'une barre de prestation, en pourcentage du maximum. */
  protected serviceWidth(value: number): string {
    return `${Math.round((value / this.serviceMax()) * 100)}%`;
  }

  /** « lun. 12 » — court, pour l'axe d'un graphique. */
  private shortDay(iso: string): string {
    const parsed = new Date(`${iso}T00:00:00`);

    return Number.isNaN(parsed.getTime())
      ? iso
      : parsed.toLocaleDateString('fr-FR', { day: 'numeric' });
  }

  /** « lundi 12 septembre » — pour l'infobulle et le tableau. */
  private longDay(iso: string): string {
    const parsed = new Date(`${iso}T00:00:00`);

    return Number.isNaN(parsed.getTime())
      ? iso
      : parsed.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        });
  }

  /**
   * Les heures qu'on montre.
   *
   * Une station de lavage ne travaille pas la nuit : tracer les
   * vingt-quatre heures écraserait les six qui portent l'activité. On
   * garde 6 h – 21 h, ce qui couvre large sans diluer.
   */
  private isWorkingHour(hour: number): boolean {
    return hour >= 6 && hour <= 21;
  }

  private today(): string {
    return this.format(new Date());
  }

  private daysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);

    return this.format(date);
  }

  private format(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
  }
}
