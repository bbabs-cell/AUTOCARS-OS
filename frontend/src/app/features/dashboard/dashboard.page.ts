import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import {
  ColumnChartComponent,
  ColumnPoint,
} from '../../shared/ui/column-chart.component';
import { SplitBarComponent, SplitSegment } from '../../shared/ui/split-bar.component';
import { AuthService } from '../../core/services/auth.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { StationContextService } from '../../core/services/station-context.service';
import { Dashboard } from '../../core/models/dashboard.model';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../../core/models/payment.model';

/**
 * Le tableau de bord
 * ==================================================================
 * LE PREMIER ÉCRAN DE LA JOURNÉE — ET LE DERNIER DU MVP.
 * ==================================================================
 *
 * L'ORDRE DES BLOCS EST LE SUJET DE CET ÉCRAN :
 *
 *   1. CE QUI VA MAL. Les alertes en premier, avant tout chiffre.
 *      Un tableau de bord qui commence par « 47 véhicules ce mois-ci »
 *      laisse passer le véhicule prêt depuis deux heures que personne
 *      n'a rappelé — et l'on découvre le problème par le client, pas
 *      par le logiciel.
 *   2. OÙ EN EST-ON AUJOURD'HUI. Quatre chiffres, pas quinze.
 *   3. COMMENT ÇA SE PASSE. La tendance de la semaine.
 *
 * Quand il n'y a rien à signaler, le premier bloc DISPARAÎT. Une
 * alerte affichée tous les jours cesse d'être lue au bout d'une
 * semaine.
 *
 * ------------------------------------------------------------------
 * CE QUE CET ÉCRAN NE FAIT PAS : décider de ce que vous avez le droit
 * de voir. Le serveur n'envoie tout simplement pas les montants à qui
 * n'y a pas droit. `can_see_money` sert à afficher proprement un
 * écran sans blocs financiers, pas à protéger quoi que ce soit —
 * l'onglet réseau du navigateur montrerait ce qui a été envoyé.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [
    RouterLink,
    AmountPipe,
    DurationPipe,
    PageHeaderComponent,
    ColumnChartComponent,
    SplitBarComponent,
  ],
  templateUrl: './dashboard.page.html',
})
export class DashboardPage {
  private readonly service = inject(DashboardService);
  private readonly stationContext = inject(StationContextService);
  private readonly auth = inject(AuthService);

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly data = signal<Dashboard | null>(null);

  /**
   * Le prénom seul, pris dans le nom complet.
   * « Bonjour, Mamadou » se lit ; « Bonjour, Mamadou Diallo » sonne
   * comme un courrier administratif.
   */
  protected readonly firstName = computed(
    () => (this.auth.user()?.full_name ?? '').split(' ')[0] ?? '',
  );

  protected readonly alerts = computed(() => this.data()?.alerts ?? []);
  protected readonly canSeeMoney = computed(() => this.data()?.can_see_money === true);

  /**
   * L'évolution du nombre de véhicules par rapport à hier.
   *
   * On compare à HIER et non à une moyenne sur 30 jours : « on a fait
   * moins qu'hier » est une phrase qu'un gérant peut vérifier de
   * mémoire. Une moyenne mobile ne se vérifie pas, donc ne se croit
   * pas — et un chiffre qu'on ne croit pas ne sert à rien.
   */
  protected readonly vehiclesDelta = computed(() => {
    const dashboard = this.data();

    if (!dashboard) {
      return null;
    }

    return dashboard.today.vehicles_in - dashboard.yesterday.vehicles_in;
  });

  protected readonly revenueDelta = computed(() => {
    const dashboard = this.data();

    if (!dashboard || dashboard.today.revenue === undefined) {
      return null;
    }

    return dashboard.today.revenue - (dashboard.yesterday.revenue ?? 0);
  });

  protected readonly revenuePoints = computed<ColumnPoint[]>(() =>
    (this.data()?.revenue_series ?? []).map((point) => ({
      label: point.label,
      value: point.total,
      detail: point.date,
    })),
  );

  /**
   * La ventilation des paiements, chaque moyen avec SA couleur.
   *
   * L'emplacement vient de PAYMENT_METHODS, une liste figée : les
   * espèces sont toujours en bleu, le mobile money toujours en cyan,
   * que l'un dépasse l'autre ou non. Colorer selon le classement du
   * jour ferait changer les couleurs d'un matin à l'autre.
   */
  protected readonly paymentSegments = computed<SplitSegment[]>(() =>
    (this.data()?.payment_split ?? []).map((row) => ({
      key: row.method,
      label: PAYMENT_METHOD_LABELS[row.method] ?? row.method,
      value: row.total,
      slot: PAYMENT_METHODS.indexOf(row.method),
    })),
  );

  /** Le plus gros compteur du classement, pour dimensionner les barres. */
  protected readonly topServiceMax = computed(() =>
    Math.max(...(this.data()?.top_services ?? []).map((s) => s.count), 1),
  );

  constructor() {
    // LE TABLEAU DE BORD SUIT LA STATION CHOISIE EN HAUT DE L'ÉCRAN.
    //
    // L'effet se déclenche une première fois au démarrage — il
    // remplace donc l'appel direct qui était ici — puis à chaque
    // changement de station. Le gérant qui bascule sur Thiès voit
    // Thiès, sans avoir à recharger la page.
    effect(() => {
      this.stationContext.selectedId();
      this.load();
    });
  }

  protected load(): void {
    this.isLoading.set(true);

    this.service.dashboard(this.stationContext.queryId() ?? undefined).subscribe({
      next: (dashboard) => {
        this.data.set(dashboard);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set('Le chargement du tableau de bord a échoué.');
      },
    });
  }

  /**
   * « Bonjour », « Bon après-midi », « Bonsoir ».
   *
   * Un détail, mais qui coûte trois lignes et fait la différence
   * entre un logiciel qu'on subit et un logiciel qu'on ouvre.
   */
  protected greeting(): string {
    const hour = new Date().getHours();

    if (hour < 12) {
      return 'Bonjour';
    }

    return hour < 18 ? 'Bon après-midi' : 'Bonsoir';
  }

  /** « +3 » ou « −2 », jamais « 3 » tout court. */
  protected signed(value: number): string {
    if (value === 0) {
      return 'identique à hier';
    }

    // Le vrai signe moins « − », pas le trait d'union : il s'aligne
    // avec le « + » et se lit comme un signe, pas comme un tiret.
    return value > 0 ? `+${value} par rapport à hier` : `−${Math.abs(value)} par rapport à hier`;
  }
}
