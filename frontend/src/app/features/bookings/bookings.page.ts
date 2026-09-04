import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { BookingService } from '../../core/services/booking.service';
import { CatalogService } from '../../core/services/catalog.service';
import { CrmService } from '../../core/services/crm.service';
import { Booking, BookingDay, BookingStatus } from '../../core/models/booking.model';
import { Service, Station } from '../../core/models/catalog.model';
import { Vehicle } from '../../core/models/crm.model';

/**
 * Le carnet de rendez-vous
 * ==================================================================
 * CE QUI REMPLACE LE CAHIER POSÉ À CÔTÉ DU TÉLÉPHONE.
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * L'ORDRE DE L'ÉCRAN EST L'ORDRE DU TRAVAIL
 *
 *   1. LES RENDEZ-VOUS DÉPASSÉS, en premier. L'heure est passée et
 *      personne n'a rien noté : quelqu'un est peut-être arrivé sans
 *      être enregistré. C'est la seule chose de cet écran qui ne peut
 *      pas attendre demain.
 *   2. LA JOURNÉE, heure par heure.
 *   3. CE QUI RESTE À RAPPELER — la liste d'appels du soir.
 *
 * C'est le même principe qu'au tableau de bord (lot 10) et au
 * registre de pointage (lot 12) : ce qui demande une action passe
 * devant ce qui informe.
 *
 * ------------------------------------------------------------------
 * UNE JOURNÉE À LA FOIS, PAS UN CALENDRIER
 *
 * La tentation était de dessiner une grille hebdomadaire avec des
 * blocs colorés. C'est joli sur une capture d'écran, et inutilisable
 * sur le téléphone de quelqu'un qui a une clé de voiture dans
 * l'autre main.
 *
 * Une station de lavage travaille à la journée : « qui vient
 * aujourd'hui », « qui vient demain ». La liste répond à cette
 * question en une lecture, et elle tient sur un écran de 390 pixels.
 * La semaine viendra si un gérant la réclame — pas avant.
 *
 * ------------------------------------------------------------------
 * LE LOGICIEL NE FERME RIEN TOUT SEUL
 *
 * Un rendez-vous dépassé n'est PAS marqué « absent » automatiquement.
 * Le logiciel ne sait pas ce qui s'est passé, et cette absence
 * restera dans l'historique du client. On signale, quelqu'un au
 * comptoir tranche — exactement comme pour les pointages oubliés.
 */
@Component({
  selector: 'app-bookings-page',
  imports: [
    ReactiveFormsModule,
    AmountPipe,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './bookings.page.html',
  styleUrl: './bookings.page.scss',
})
export class BookingsPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly bookings = inject(BookingService);
  private readonly catalog = inject(CatalogService);
  private readonly crm = inject(CrmService);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly noticeMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  /**
   * Les phrases que le serveur renvoie sans rien refuser.
   *
   * C'est la particularité de ce module : plutôt que d'interdire une
   * quatrième voiture à 10 h — un maximum que le logiciel serait
   * incapable de fixer justement — il PRÉVIENT, et laisse trancher
   * celui qui connaît sa station.
   */
  protected readonly warnings = signal<string[]>([]);

  protected readonly data = signal<BookingDay | null>(null);
  protected readonly services = signal<Service[]>([]);
  protected readonly stations = signal<Station[]>([]);

  /** Le rendez-vous ouvert dans une fenêtre, et pour quoi faire. */
  protected readonly editing = signal<Booking | null>(null);
  protected readonly closing = signal<{ booking: Booking; target: BookingStatus } | null>(null);
  protected readonly arriving = signal<Booking | null>(null);

  /** La recherche de véhicule, quand un rendez-vous n'en porte pas. */
  protected readonly vehicleMatches = signal<Vehicle[]>([]);
  protected readonly isSearchingVehicle = signal(false);

  protected readonly isCreating = signal(false);

  protected readonly overdue = computed(() => this.data()?.overdue ?? []);
  protected readonly list = computed(() => this.data()?.bookings ?? []);
  protected readonly load = computed(() => this.data()?.load ?? []);

  protected readonly counts = computed(() => {
    const counts = this.data()?.counts;

    return [
      { key: 'SCHEDULED' as const, label: 'Prévus', value: counts?.SCHEDULED ?? 0 },
      { key: 'CONFIRMED' as const, label: 'Confirmés', value: counts?.CONFIRMED ?? 0 },
      { key: 'ARRIVED' as const, label: 'Arrivés', value: counts?.ARRIVED ?? 0 },
      { key: 'NO_SHOW' as const, label: 'Absents', value: counts?.NO_SHOW ?? 0 },
      { key: 'CANCELLED' as const, label: 'Annulés', value: counts?.CANCELLED ?? 0 },
    ];
  });

  /**
   * Ce qu'il reste à rappeler : les rendez-vous notés mais jamais
   * confirmés, et encore à venir.
   *
   * C'est la seule mesure qui réduit vraiment les absences, et elle
   * demande de savoir QUI appeler. Sans cette liste, on la refait de
   * tête tous les soirs — donc on ne la fait plus.
   */
  protected readonly toCallBack = computed(() => {
    // On ne rappelle QUE ceux qui sont encore à venir. Un rendez-vous
    // dont l'heure est passée relève du bloc « à traiter », en haut :
    // téléphoner à quelqu'un pour confirmer un créneau qu'il a déjà
    // manqué n'est pas le même geste, et mélanger les deux ferait
    // rappeler deux fois les mêmes personnes.
    const now = Date.now();

    return this.list().filter(
      (booking) =>
        booking.status === 'SCHEDULED' &&
        new Date(booking.scheduled_at.replace(' ', 'T')).getTime() > now,
    );
  });

  /**
   * L'échelle des barres de charge.
   *
   * ==================================================================
   * POURQUOI UN PLANCHER À QUATRE ?
   * ==================================================================
   * Rapporter chaque barre à la plus chargée de la journée donne un
   * résultat absurde les jours calmes : trois heures à un rendez-vous
   * chacune produisent trois barres PLEINES, et l'écran annonce une
   * saturation là où il n'y a presque personne.
   *
   * L'échelle part donc d'un minimum : en dessous de quatre
   * rendez-vous, la barre reste courte. Au-delà, elle s'étire sur
   * l'heure la plus chargée — c'est alors une vraie comparaison.
   *
   * Le chiffre exact est un point de départ, pas une vérité : aucune
   * station ne tourne encore avec le produit. Il se règle ici, en une
   * ligne, après le test terrain.
   */
  protected readonly loadScale = computed(() =>
    Math.max(4, ...this.load().map((slot) => slot.bookings)),
  );

  protected readonly dayLabel = computed(() => {
    const day = this.filterForm.getRawValue().day;
    const parsed = new Date(`${day}T00:00:00`);

    if (Number.isNaN(parsed.getTime())) {
      return '';
    }

    // ISO dans les échanges, français à l'écran (règle du lot 12).
    const label = parsed.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

    return label.charAt(0).toUpperCase() + label.slice(1);
  });

  protected readonly filterForm = this.formBuilder.nonNullable.group({
    day: [this.today()],
    station_id: [0],
  });

  protected readonly bookingForm = this.formBuilder.nonNullable.group({
    customer_name: ['', [Validators.required]],
    customer_phone: ['', [Validators.required]],
    plate_number: [''],
    service_id: [0, [Validators.required]],
    station_id: [0, [Validators.required]],
    scheduled_at: ['', [Validators.required]],
    notes: [''],
  });

  /** Le motif d'une annulation ou d'une absence — FACULTATIF. */
  protected readonly closingForm = this.formBuilder.nonNullable.group({
    reason: [''],
  });

  protected readonly vehicleSearchForm = this.formBuilder.nonNullable.group({
    search: [''],
  });

  constructor() {
    // Un employé n'a pas le droit de lister les stations : l'appel
    // échouerait avec un 403. On affiche alors simplement la station
    // par défaut, plutôt que de laisser une erreur en console.
    this.catalog.stations().subscribe({
      next: (stations) => {
        this.stations.set(stations);

        if (stations[0]) {
          this.filterForm.patchValue({ station_id: stations[0].id });
        }

        this.load_();
      },
      error: () => this.load_(),
    });

    this.catalog.services().subscribe({
      next: (services) => this.services.set(services.filter((s) => s.status === 'ACTIVE')),
      error: () => this.services.set([]),
    });
  }

  // --- Chargement -------------------------------------------------------

  /**
   * Nommée `load_` parce que `load` est déjà pris par la charge horaire
   * affichée dans le gabarit. Deux sens du même mot français, et le
   * gabarit n'a pas de moyen de les distinguer.
   */
  protected load_(): void {
    this.isLoading.set(true);

    const { day, station_id } = this.filterForm.getRawValue();

    this.bookings.day(day, day, station_id || null).subscribe({
      next: (data) => {
        this.data.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set('Le chargement du carnet a échoué.');
      },
    });
  }

  protected showToday(): void {
    this.filterForm.patchValue({ day: this.today() });
    this.load_();
  }

  protected showTomorrow(): void {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    this.filterForm.patchValue({ day: this.format(tomorrow) });
    this.load_();
  }

  // --- Noter et modifier ------------------------------------------------

  protected openCreate(): void {
    this.editing.set(null);
    this.isCreating.set(true);
    this.warnings.set([]);
    this.fieldErrors.set({});

    const { day, station_id } = this.filterForm.getRawValue();

    this.bookingForm.reset({
      customer_name: '',
      customer_phone: '',
      plate_number: '',
      service_id: this.services()[0]?.id ?? 0,
      station_id: station_id || (this.stations()[0]?.id ?? 0),
      // Pré-rempli sur le jour affiché : on note presque toujours un
      // rendez-vous pour la journée qu'on est en train de regarder.
      scheduled_at: `${day}T09:00`,
      notes: '',
    });
  }

  protected openEdit(booking: Booking): void {
    this.editing.set(booking);
    this.isCreating.set(true);
    this.warnings.set([]);
    this.fieldErrors.set({});

    this.bookingForm.reset({
      customer_name: booking.customer_name,
      customer_phone: booking.customer_phone,
      plate_number: booking.plate_number ?? '',
      service_id: booking.service_id,
      station_id: booking.station_id,
      scheduled_at: `${booking.scheduled_date}T${booking.scheduled_time}`,
      notes: booking.notes ?? '',
    });
  }

  protected closeForm(): void {
    this.isCreating.set(false);
    this.editing.set(null);
  }

  protected submitBooking(): void {
    if (this.bookingForm.invalid) {
      this.bookingForm.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const value = this.bookingForm.getRawValue();
    const existing = this.editing();

    const payload = {
      customer_name: value.customer_name.trim(),
      customer_phone: value.customer_phone.trim(),
      plate_number: value.plate_number.trim() || null,
      service_id: Number(value.service_id),
      station_id: Number(value.station_id),
      scheduled_at: value.scheduled_at,
      notes: value.notes.trim() || null,
    };

    const request = existing
      ? this.bookings.update(existing.id, payload)
      : this.bookings.create(payload);

    request.subscribe({
      next: (saved) => {
        this.isSaving.set(false);
        this.closeForm();
        // Les avertissements survivent à la fermeture de la fenêtre :
        // ils portent sur ce qui vient d'être enregistré, et l'écran
        // qui réapparaît doit les montrer.
        this.warnings.set(saved.warnings ?? []);
        this.noticeMessage.set(
          existing
            ? 'Rendez-vous modifié.'
            : `Rendez-vous noté pour ${saved.booking.scheduled_time}.`,
        );
        this.load_();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.fieldErrors.set(error.error?.errors ?? {});
        this.errorMessage.set(error.error?.message ?? "L'enregistrement a échoué.");
      },
    });
  }

  // --- Confirmer, annuler, déclarer une absence -------------------------

  protected confirm(booking: Booking): void {
    this.changeStatus(booking, 'CONFIRMED');
  }

  /**
   * Annuler et déclarer une absence passent par une fenêtre, pas par
   * un clic direct.
   *
   * Le motif y est FACULTATIF — au lot 12, corriger un pointage
   * l'exigeait, parce que la modification changeait ce qu'on doit à
   * quelqu'un. Ici, rien de tel : un client annule, cela arrive.
   * Exiger une justification partout apprend à taper « x ».
   *
   * La fenêtre reste utile pour autre chose : elle empêche de
   * déclarer une absence par un clic mal placé sur un téléphone.
   */
  protected openClosing(booking: Booking, target: BookingStatus): void {
    this.closing.set({ booking, target });
    this.closingForm.reset({ reason: '' });
    this.errorMessage.set(null);
  }

  protected closeClosing(): void {
    this.closing.set(null);
  }

  protected submitClosing(): void {
    const pending = this.closing();

    if (pending === null) {
      return;
    }

    this.changeStatus(
      pending.booking,
      pending.target,
      this.closingForm.getRawValue().reason.trim() || null,
    );
  }

  private changeStatus(booking: Booking, target: BookingStatus, reason?: string | null): void {
    if (target === 'ARRIVED' || target === 'SCHEDULED') {
      return;
    }

    this.isSaving.set(true);

    this.bookings.changeStatus(booking.id, target, reason).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.closeClosing();
        this.noticeMessage.set(
          target === 'CONFIRMED'
            ? 'Rendez-vous confirmé.'
            : target === 'NO_SHOW'
              ? 'Absence enregistrée.'
              : 'Rendez-vous annulé.',
        );
        this.load_();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.errorMessage.set(error.error?.message ?? "L'enregistrement a échoué.");
      },
    });
  }

  // --- L'arrivée --------------------------------------------------------

  /**
   * « Le client est là ».
   *
   * Quand le rendez-vous porte déjà un véhicule, l'appel part
   * directement : c'est le geste qu'on veut à un seul clic, avec un
   * client debout devant le comptoir.
   *
   * Sinon — le cas normal d'un rendez-vous pris au téléphone — il
   * faut d'abord dire de quelle voiture il s'agit.
   */
  protected arrive(booking: Booking): void {
    if (booking.vehicle_id !== null) {
      this.sendArrival(booking, booking.vehicle_id);

      return;
    }

    this.arriving.set(booking);
    this.vehicleMatches.set([]);
    this.vehicleSearchForm.reset({ search: booking.plate_number ?? '' });
    this.searchVehicle();
  }

  protected closeArrival(): void {
    this.arriving.set(null);
    this.vehicleMatches.set([]);
  }

  protected searchVehicle(): void {
    const search = this.vehicleSearchForm.getRawValue().search.trim();

    if (search.length < 2) {
      this.vehicleMatches.set([]);

      return;
    }

    this.isSearchingVehicle.set(true);

    this.crm.vehicles(search).subscribe({
      next: (vehicles) => {
        this.vehicleMatches.set(vehicles);
        this.isSearchingVehicle.set(false);
      },
      error: () => {
        this.vehicleMatches.set([]);
        this.isSearchingVehicle.set(false);
      },
    });
  }

  protected chooseVehicle(vehicle: Vehicle): void {
    const booking = this.arriving();

    if (booking !== null) {
      this.sendArrival(booking, vehicle.id);
    }
  }

  private sendArrival(booking: Booking, vehicleId: number): void {
    this.isSaving.set(true);

    this.bookings.arrive(booking.id, vehicleId).subscribe({
      next: (result) => {
        this.isSaving.set(false);
        this.closeArrival();
        this.noticeMessage.set(
          `Dossier ${result.booking.operation_reference} ouvert. Le véhicule est dans la file.`,
        );
        this.load_();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        this.errorMessage.set(error.error?.message ?? "L'ouverture du dossier a échoué.");
      },
    });
  }

  // --- Affichage --------------------------------------------------------

  /**
   * La classe du badge de statut.
   *
   * La couleur suit le STATUT, jamais sa position dans la liste :
   * « annulé » est gris partout dans le produit, sur cet écran comme
   * sur la file d'attente.
   */
  protected badgeFor(status: BookingStatus): string {
    const classes: Record<BookingStatus, string> = {
      SCHEDULED: 'ac-badge--info',
      CONFIRMED: 'ac-badge--success',
      ARRIVED: 'ac-badge--completed',
      NO_SHOW: 'ac-badge--danger',
      CANCELLED: 'ac-badge--cancelled',
    };

    return classes[status];
  }

  /** « 09 h » — l'étiquette d'une barre de charge. */
  protected hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')} h`;
  }

  protected barWidth(count: number): string {
    return `${Math.round((count / this.loadScale()) * 100)}%`;
  }

  /** « 10:00 → 10:30 », ce que le créneau occupe réellement. */
  protected slotOf(booking: Booking): string {
    const [hours, minutes] = booking.scheduled_time.split(':').map(Number);
    const end = new Date(2000, 0, 1, hours, minutes + booking.duration_minutes);

    return `${booking.scheduled_time} → ${String(end.getHours()).padStart(2, '0')}:${String(
      end.getMinutes(),
    ).padStart(2, '0')}`;
  }

  /** « il y a 2 h » pour un rendez-vous dépassé. */
  protected lateBy(booking: Booking): string {
    const minutes = Math.floor(
      (Date.now() - new Date(booking.scheduled_at.replace(' ', 'T')).getTime()) / 60000,
    );

    if (minutes < 60) {
      return `${minutes} min de retard`;
    }

    const hours = Math.floor(minutes / 60);

    return hours < 24 ? `${hours} h de retard` : `${Math.floor(hours / 24)} j de retard`;
  }

  protected can(booking: Booking, status: BookingStatus): boolean {
    return booking.allowed_next.includes(status);
  }

  protected dismissNotice(): void {
    this.noticeMessage.set(null);
    this.warnings.set([]);
  }

  protected dismissError(): void {
    this.errorMessage.set(null);
  }

  private today(): string {
    return this.format(new Date());
  }

  private format(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
  }
}
