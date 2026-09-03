import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { StatusBadgeComponent } from '../../shared/ui/status-badge.component';
import { CrmService } from '../../core/services/crm.service';
import { OperationStatus } from '../../core/models/operation-status.model';
import {
  VEHICLE_TYPE_LABELS,
  Vehicle,
  VehicleHistoryEntry,
} from '../../core/models/crm.model';

/**
 * Fiche véhicule
 * ==================================================================
 * L'ÉCRAN QU'ON OUVRE EN CAS DE LITIGE.
 * ==================================================================
 *
 * « Cette rayure était-elle là avant ? » « Qui s'en est occupé ? »
 * « Quand est-il passé la dernière fois ? »
 *
 * Toute la valeur du produit tient dans la capacité à répondre à ces
 * questions en dix secondes. C'est pourquoi l'historique occupe la
 * place principale, et non les caractéristiques du véhicule — celles-ci
 * ne changent jamais, l'historique si.
 *
 * L'historique est vide au lot 6 : les opérations arrivent au lot 8.
 * L'écran est construit dès maintenant pour être prêt le jour où les
 * données existeront, et pour montrer l'état vide correctement.
 */
@Component({
  selector: 'app-vehicle-detail-page',
  imports: [
    RouterLink,
    AmountPipe,
    RelativeDatePipe,
    EmptyStateComponent,
    StatusBadgeComponent,
  ],
  templateUrl: './vehicle-detail.page.html',
})
export class VehicleDetailPage {
  private readonly crm = inject(CrmService);
  private readonly route = inject(ActivatedRoute);

  protected readonly typeLabels = VEHICLE_TYPE_LABELS;

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly vehicle = signal<Vehicle | null>(null);
  protected readonly history = signal<VehicleHistoryEntry[]>([]);

  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));

    this.crm.vehicle(id).subscribe({
      next: (result) => {
        this.vehicle.set(result.vehicle);
        this.history.set(result.history);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          error.status === 404
            ? "Ce véhicule n'existe pas, ou il appartient à une autre station."
            : 'Le chargement a échoué.',
        );
      },
    });
  }

  /** Le statut vient de l'API sous forme de chaîne : on le typifie. */
  protected asStatus(status: string): OperationStatus {
    return status as OperationStatus;
  }
}
