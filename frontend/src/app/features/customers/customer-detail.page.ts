import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { AvatarComponent } from '../../shared/ui/avatar.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import { CrmService } from '../../core/services/crm.service';
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
})
export class CustomerDetailPage {
  private readonly crm = inject(CrmService);
  private readonly route = inject(ActivatedRoute);

  protected readonly typeLabels = VEHICLE_TYPE_LABELS;

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly customer = signal<Customer | null>(null);
  protected readonly vehicles = signal<Vehicle[]>([]);

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
  }
}
