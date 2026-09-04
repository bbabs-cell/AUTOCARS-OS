import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { AvatarComponent } from '../../shared/ui/avatar.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import { CrmService } from '../../core/services/crm.service';
import { AuthService } from '../../core/services/auth.service';
import { LoyaltyService } from '../../core/services/loyalty.service';
import { LoyaltyCard, LoyaltyEntry } from '../../core/models/loyalty.model';
import { VEHICLE_TYPE_LABELS, Customer, Vehicle } from '../../core/models/crm.model';

/**
 * Fiche client
 * ------------------------------------------------------------------
 * Ce qu'un gérant veut savoir d'un client en un coup d'œil :
 * combien de véhicules, combien de visites, combien il a dépensé,
 * et quand il est venu la dernière fois.
 *
 * Ces quatre chiffres décident du traitement qu'on lui réserve — un
 * habitué qui vient chaque semaine n'attend pas comme un premier
 * passage.
 */
@Component({
  selector: 'app-customer-detail-page',
  imports: [
    RouterLink,
    AmountPipe,
    RelativeDatePipe,
    AvatarComponent,
    EmptyStateComponent,
    StatCardComponent,
  ],
  templateUrl: './customer-detail.page.html',
  styleUrl: './customer-detail.page.scss',
})
export class CustomerDetailPage {
  private readonly crm = inject(CrmService);
  private readonly loyalty = inject(LoyaltyService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  protected readonly typeLabels = VEHICLE_TYPE_LABELS;

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly customer = signal<Customer | null>(null);
  protected readonly vehicles = signal<Vehicle[]>([]);

  /**
   * LA CARTE DE FIDÉLITÉ SE MONTRE SUR LA FICHE DU CLIENT.
   *
   * C'est ici qu'on ouvre quand un client demande « il m'en reste
   * combien ? ». L'écran /loyalty, lui, parle du programme — pas des
   * personnes.
   *
   * `null` quand l'entreprise n'a pas de programme, ce qui est l'état
   * par défaut : la section n'apparaît simplement pas.
   */
  protected readonly loyaltyCard = signal<LoyaltyCard | null>(null);
  protected readonly loyaltyHistory = signal<LoyaltyEntry[]>([]);

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));

    this.crm.customer(id).subscribe({
      next: (result) => {
        this.customer.set(result.customer);
        this.vehicles.set(result.vehicles);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          error.status === 404
            ? "Ce client n'existe pas, ou il appartient à une autre station."
            : 'Le chargement a échoué.',
        );
      },
    });

    // Une erreur ne remonte pas : pas de programme, ou pas le droit de
    // lire les cartes, et la section disparaît. Un message rouge sur
    // une fiche client qui va bien ferait douter du reste de l'écran.
    if (this.auth.can('loyalty.view')) {
      this.loyalty.card(id).subscribe({
        next: (result) => {
          this.loyaltyCard.set(result.card.has_program ? result.card : null);
          this.loyaltyHistory.set(result.history);
        },
        error: () => this.loyaltyCard.set(null),
      });
    }
  }

  /**
   * Les tampons d'une carte, un par case — comme sur le carton.
   *
   * On n'en dessine jamais plus d'une carte complète : un client à 23
   * tampons sur un programme à 10 a deux récompenses en poche et
   * 3 tampons entamés. Aligner 23 cases ne dirait rien de plus et
   * déborderait de l'écran.
   */
  protected stampSlots(): boolean[] {
    const card = this.loyaltyCard();

    if (card === null) {
      return [];
    }

    const filled = card.rewards_available > 0
      ? card.stamps_required
      : card.balance % card.stamps_required;

    return Array.from({ length: card.stamps_required }, (_, index) => index < filled);
  }
}
