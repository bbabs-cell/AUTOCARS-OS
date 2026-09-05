import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { StationContextService } from '../../core/services/station-context.service';
import { Station } from '../../core/models/catalog.model';

/**
 * Les points de service
 * ==================================================================
 * OUVRIR UNE SECONDE STATION — ET EN FERMER UNE.
 * ==================================================================
 *
 * Le produit était écrit pour plusieurs stations depuis le lot 3 :
 * chaque table porte `station_id`, chaque écran de consultation
 * accepte un filtre, et le serveur vérifie qui a le droit de voir
 * quoi. Il manquait la porte d'entrée, et c'est cet écran.
 *
 * ------------------------------------------------------------------
 * ON FERME, ON NE SUPPRIME PAS
 *
 * Troisième fois dans le produit, après les prestations (lot 5) et
 * les comptes (lot 12), et toujours pour la même raison : une station
 * figure sur des milliers de dossiers passés. Effacer la ligne
 * troue l'historique — c'est-à-dire exactement ce qui sert le jour
 * d'un litige ou d'un contrôle.
 *
 * ------------------------------------------------------------------
 * LE REFUS EST ANNONCÉ AVANT LE CLIC
 *
 * Une station qui a des véhicules sur place ne peut pas fermer : ces
 * voitures appartiennent à des clients qui vont revenir les chercher.
 * Plutôt que de laisser cliquer puis d'expliquer, la ligne affiche le
 * nombre de véhicules présents et le bouton se désactive de lui-même.
 *
 * C'est un principe général de cet écran : un refus qu'on voit venir
 * ne ressemble pas à une panne.
 */
@Component({
  selector: 'app-stations-page',
  imports: [ReactiveFormsModule, EmptyStateComponent, PageHeaderComponent],
  templateUrl: './stations.page.html',
  styleUrl: './stations.page.scss',
})
export class StationsPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly catalog = inject(CatalogService);
  private readonly auth = inject(AuthService);
  private readonly stationContext = inject(StationContextService);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly noticeMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly stations = signal<Station[]>([]);

  protected readonly editing = signal<Station | null>(null);
  protected readonly isFormOpen = signal(false);

  /** Ouvrir et fermer une station appartiennent au propriétaire. */
  protected readonly canManage = computed(() => this.auth.can('stations.create'));

  protected readonly openCount = computed(
    () => this.stations().filter((station) => station.status === 'ACTIVE').length,
  );

  /**
   * La dernière station ouverte ne se ferme pas : l'entreprise ne
   * pourrait plus rien enregistrer. Le serveur refuse (409) ; ici on
   * évite simplement de proposer le geste.
   */
  protected readonly isLastOpen = computed(() => this.openCount() <= 1);

  protected readonly form = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    code: ['', [Validators.required]],
    city: [''],
    address: [''],
    phone: [''],
    opens_at: [''],
    closes_at: [''],
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);

    this.catalog.stations().subscribe({
      next: (stations) => {
        this.stations.set(stations);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set('Le chargement des stations a échoué.');
      },
    });
  }

  protected openCreate(): void {
    this.editing.set(null);
    this.fieldErrors.set({});
    this.form.reset({
      name: '',
      code: '',
      city: '',
      address: '',
      phone: '',
      opens_at: '08:00',
      closes_at: '19:00',
    });
    this.isFormOpen.set(true);
  }

  protected openEdit(station: Station): void {
    this.editing.set(station);
    this.fieldErrors.set({});
    this.form.reset({
      name: station.name,
      code: station.code,
      city: station.city ?? '',
      address: station.address ?? '',
      phone: station.phone ?? '',
      opens_at: station.opens_at ?? '',
      closes_at: station.closes_at ?? '',
    });
    this.isFormOpen.set(true);
  }

  protected closeForm(): void {
    this.isFormOpen.set(false);
  }

  protected submit(): void {
    if (this.form.invalid || this.isSaving()) {
      this.form.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const payload = this.form.getRawValue();
    const station = this.editing();

    const request = station
      ? this.catalog.updateStation(station.id, payload)
      : this.catalog.createStation(payload);

    request.subscribe({
      next: (saved) => {
        this.isSaving.set(false);
        this.isFormOpen.set(false);
        this.noticeMessage.set(
          station ? 'Station enregistrée.' : `« ${saved.name} » est ouverte.`,
        );
        this.afterChange();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.fieldErrors.set(error.error?.errors ?? {});
        this.errorMessage.set(
          Object.keys(error.error?.errors ?? {}).length > 0
            ? null
            : (error.error?.message ?? "L'enregistrement a échoué."),
        );
      },
    });
  }

  protected toggleStatus(station: Station): void {
    const closing = station.status === 'ACTIVE';

    this.errorMessage.set(null);
    this.noticeMessage.set(null);

    this.catalog
      .setStationStatus(station.id, closing ? 'INACTIVE' : 'ACTIVE')
      .subscribe({
        next: () => {
          this.noticeMessage.set(
            closing
              ? `« ${station.name} » est fermée. Son historique reste consultable.`
              : `« ${station.name} » est rouverte.`,
          );
          this.afterChange();
        },
        // Le serveur refuse en 409 avec une phrase qui dit quoi faire
        // (« 3 véhicules sont encore sur place… ») : on l'affiche telle
        // quelle plutôt que d'en inventer une autre.
        error: (error: HttpErrorResponse) =>
          this.errorMessage.set(error.error?.message ?? 'La station n\'a pas pu être modifiée.'),
      });
  }

  /**
   * Après toute écriture, on recharge DEUX listes.
   *
   * Celle de cet écran, et celle du sélecteur de l'en-tête — qui vit
   * dans un service partagé. Sans le second appel, une station qu'on
   * vient d'ouvrir n'apparaîtrait dans le menu du haut qu'au prochain
   * rechargement complet de l'application.
   */
  private afterChange(): void {
    this.load();
    this.stationContext.refresh();
  }

  /**
   * Peut-on basculer l'état de cette station ?
   *
   * On rouvre toujours. On ferme sauf dans les deux cas que le serveur
   * refuse — et c'est bien le serveur qui décide : ceci évite un aller
   * -retour perdu, ça ne remplace pas sa vérification.
   */
  protected canToggle(station: Station): boolean {
    if (station.status !== 'ACTIVE') {
      return true;
    }

    return !this.isLastOpen() && (station.vehicles_on_site ?? 0) === 0;
  }

  /**
   * Pourquoi le bouton est grisé.
   *
   * Un bouton désactivé sans explication est une impasse : l'utilisateur
   * conclut à une panne et cherche ailleurs.
   */
  protected toggleHint(station: Station): string {
    if (station.status !== 'ACTIVE') {
      return `Rouvrir ${station.name}`;
    }

    if ((station.vehicles_on_site ?? 0) > 0) {
      return station.vehicles_on_site === 1
        ? 'Un véhicule est encore sur place'
        : `${station.vehicles_on_site} véhicules sont encore sur place`;
    }

    if (this.isLastOpen()) {
      return "C'est votre dernière station ouverte";
    }

    return `Fermer ${station.name}`;
  }

  /** « 08:00 – 19:00 », ou rien si les horaires ne sont pas renseignés. */
  protected hoursLabel(station: Station): string {
    return station.opens_at && station.closes_at
      ? `${station.opens_at} – ${station.closes_at}`
      : '—';
  }
}
