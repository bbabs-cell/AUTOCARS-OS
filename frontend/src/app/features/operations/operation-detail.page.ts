import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { StatusBadgeComponent } from '../../shared/ui/status-badge.component';
import { AuthService } from '../../core/services/auth.service';
import { LoyaltyService } from '../../core/services/loyalty.service';
import { LoyaltyCard } from '../../core/models/loyalty.model';
import { OperationService } from '../../core/services/operation.service';
import { PaymentService } from '../../core/services/payment.service';
import { compressPhoto, formatBytes } from '../../core/services/image-compressor';
import { OperationStatus } from '../../core/models/operation-status.model';
import {
  METHODS_WITH_REFERENCE,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  Payment,
  PaymentMethod,
} from '../../core/models/payment.model';
import {
  FUEL_LEVEL_LABELS,
  FuelLevel,
  Inspection,
  InspectionPhoto,
  InspectionSummary,
  Operation,
  PHOTO_POSITION_LABELS,
  PhotoPosition,
  REQUIRED_PHOTO_POSITIONS,
  ReleaseCheckItem,
} from '../../core/models/operation.model';

/** Une photo prête à l'affichage : son URL locale, et son état. */
interface PhotoTile {
  position: PhotoPosition;
  label: string;
  photo: InspectionPhoto | null;
  objectUrl: string | null;
  isUploading: boolean;
  error: string | null;
}

/**
 * Le dossier d'un véhicule
 * ==================================================================
 * L'ÉCRAN OÙ SE JOUE LA VALEUR DU PRODUIT.
 * ==================================================================
 *
 * Il accompagne un véhicule de son arrivée à sa restitution, en
 * trois temps :
 *
 *   1. LE PARCOURS — un seul bouton à la fois, celui de l'étape
 *      suivante. Pas un menu de huit statuts : l'employé n'a pas à
 *      choisir, il a à avancer.
 *
 *   2. L'INSPECTION D'ENTRÉE — le constat et les photos. C'est ce
 *      qui protège la station en cas de litige, et c'est pour ça
 *      qu'on ne peut pas laver sans l'avoir faite.
 *
 *   3. LA RESTITUTION — la liste de vérification et la remise des
 *      clés.
 *
 * ------------------------------------------------------------------
 * UNE RÈGLE QUI TRAVERSE TOUT LE FICHIER
 * Rien de ce qui est décidé ici n'est une protection. Les boutons
 * affichés, les étapes proposées, les blocages : tout est du confort
 * d'affichage. Le serveur revérifie chaque transition, l'existence de
 * l'inspection et l'état du règlement — parce qu'on peut appeler
 * l'API sans jamais ouvrir cet écran.
 */
@Component({
  selector: 'app-operation-detail-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AmountPipe,
    RelativeDatePipe,
    StatusBadgeComponent,
  ],
  templateUrl: './operation-detail.page.html',
})
export class OperationDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly formBuilder = inject(FormBuilder);
  private readonly operationService = inject(OperationService);
  private readonly auth = inject(AuthService);
  private readonly loyalty = inject(LoyaltyService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly fuelLabels = FUEL_LEVEL_LABELS;
  protected readonly fuelLevels = Object.keys(FUEL_LEVEL_LABELS) as FuelLevel[];
  protected readonly formatBytes = formatBytes;

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly noticeMessage = signal<string | null>(null);

  protected readonly operation = signal<Operation | null>(null);
  protected readonly inspectionSummaries = signal<InspectionSummary[]>([]);
  protected readonly entryInspection = signal<Inspection | null>(null);

  protected readonly isChangingStatus = signal(false);
  protected readonly isSavingInspection = signal(false);
  protected readonly isReleasing = signal(false);

  /**
   * LA CARTE DE FIDÉLITÉ SE LIT ICI, PAS SUR UN AUTRE ÉCRAN.
   *
   * Personne n'ira chercher la carte d'un client sur une page à part
   * pendant qu'il attend ses clés. Si la récompense ne se propose pas
   * là où le dossier se règle, elle ne se propose jamais — et un
   * programme qu'on n'applique pas ne fidélise personne.
   *
   * `null` quand l'entreprise n'a pas de programme, ce qui est le cas
   * par défaut : rien ne s'affiche alors.
   */
  protected readonly loyaltyCard = signal<LoyaltyCard | null>(null);
  protected readonly isRedeeming = signal(false);
  protected readonly loyaltyWarnings = signal<string[]>([]);

  protected readonly canRedeem = computed(() => this.auth.can('loyalty.redeem'));

  protected readonly fieldErrors = signal<Record<string, string>>({});
  protected readonly photoTiles = signal<PhotoTile[]>([]);

  protected readonly checklist = signal<ReleaseCheckItem[]>([]);
  protected readonly isReleasePanelOpen = signal(false);
  protected readonly releaseError = signal<string | null>(null);
  protected readonly needsOverride = signal(false);

  private operationId = 0;

  // --- Encaissement ---------------------------------------------------
  private readonly paymentService = inject(PaymentService);

  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly methods = PAYMENT_METHODS;

  protected readonly payments = signal<Payment[]>([]);
  protected readonly isPaymentPanelOpen = signal(false);
  protected readonly isRecordingPayment = signal(false);
  protected readonly paymentErrors = signal<Record<string, string>>({});

  /**
   * L'encaissement en espèces n'a été rattaché à aucune caisse.
   * On le signale TOUT DE SUITE : c'est au moment de la saisie qu'on
   * peut encore ouvrir le tiroir. Le découvrir le soir, à la
   * clôture, ne sert plus à rien.
   */
  protected readonly cashOutsideSession = signal(false);

  /**
   * L'étape suivante du parcours.
   *
   * On ne propose QU'UNE seule direction : celle qui fait avancer.
   * L'annulation est traitée à part, et la restitution passe par son
   * propre écran. Un employé qui a le choix entre six boutons se
   * trompe ; avec un seul, il ne peut pas.
   */
  protected readonly nextStep = computed<OperationStatus | null>(() => {
    const current = this.operation();

    if (!current) {
      return null;
    }

    const forward = current.allowed_transitions.filter(
      (status) => status !== 'CANCELLED' && status !== 'COMPLETED',
    );

    // QUALITY_CHECK propose deux suites : valider (READY) ou renvoyer
    // au lavage. C'est le seul cas où l'écran affiche deux boutons,
    // et il est traité explicitement dans le gabarit.
    return forward.includes('READY') ? 'READY' : (forward[0] ?? null);
  });

  protected readonly canReturnToWashing = computed(
    () => this.operation()?.allowed_transitions.includes('WASHING') === true
      && this.operation()?.status === 'QUALITY_CHECK',
  );

  protected readonly canCancel = computed(
    () => this.operation()?.allowed_transitions.includes('CANCELLED') === true,
  );

  protected readonly isReadyToRelease = computed(() => this.operation()?.status === 'READY');

  /**
   * Le blocage le plus important de l'écran : on ne lave pas un
   * véhicule dont l'état d'arrivée n'a pas été constaté.
   */
  protected readonly needsEntryInspection = computed(() => {
    const current = this.operation();

    return current !== null
      && !current.has_entry_inspection
      && ['WAITING', 'IN_PROGRESS', 'INSPECTION'].includes(current.status);
  });

  /** Seul un responsable peut lever le blocage de paiement. */
  protected readonly canOverridePayment = computed(() => {
    const role = this.auth.role();

    return role === 'ADMIN' || role === 'MANAGER';
  });

  protected readonly photosTaken = computed(
    () => this.photoTiles().filter((tile) => tile.photo !== null).length,
  );

  // --- Formulaires ---------------------------------------------------

  protected readonly inspectionForm = this.formBuilder.nonNullable.group({
    fuel_level: ['HALF' as FuelLevel],
    mileage: [''],
    has_damage: [false],
    damage_notes: [''],
    items_left: [''],
    observations: [''],
    customer_present: [true],
    signature_name: [''],
  });

  protected readonly releaseForm = this.formBuilder.nonNullable.group({
    reference: ['', [Validators.required]],
    plate_number: ['', [Validators.required]],
    override_reason: [''],
  });

  protected readonly paymentForm = this.formBuilder.nonNullable.group({
    amount: [0, [Validators.required, Validators.min(1)]],
    method: ['CASH' as PaymentMethod, [Validators.required]],
    provider: [''],
    external_reference: [''],
    notes: [''],
  });

  /**
   * Faut-il demander le fournisseur et le numéro de transaction ?
   * Pour un règlement en espèces, non : il n'y a rien à recopier.
   */
  protected readonly needsReference = computed(() =>
    METHODS_WITH_REFERENCE.includes(this.paymentForm.controls.method.value),
  );

  constructor() {
    this.operationId = Number(this.route.snapshot.paramMap.get('id'));
    this.load();

    // Les URL d'objet créées pour afficher les photos occupent la
    // mémoire du navigateur jusqu'à ce qu'on les libère. Sur mobile,
    // douze photos oubliées suffisent à faire ramer l'onglet.
    this.destroyRef.onDestroy(() => this.releasePhotoUrls());
  }

  protected load(): void {
    this.isLoading.set(true);

    this.operationService.operation(this.operationId).subscribe({
      next: (result) => {
        this.operation.set(result.operation);
        this.inspectionSummaries.set(result.inspections);
        this.isLoading.set(false);

        const entry = result.inspections.find((item) => item.type === 'ENTRY');

        if (entry) {
          this.loadInspection(entry.id);
        }

        if (result.operation.status === 'READY') {
          this.loadChecklist();
        }

        this.loadPayments();
        this.loadLoyaltyCard(result.operation.customer_id);
      },
      error: (error: HttpErrorResponse) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          error.status === 404
            ? "Ce dossier n'existe pas, ou il appartient à une autre entreprise."
            : 'Le chargement du dossier a échoué.',
        );
      },
    });
  }

  /**
   * Une erreur ne remonte PAS à l'écran : une entreprise sans
   * programme de fidélité, ou un employé sans le droit de lire les
   * cartes, ne doit pas voir un message rouge sur un dossier qui va
   * parfaitement bien. La section disparaît, c'est tout.
   */
  private loadLoyaltyCard(customerId: number): void {
    if (!this.auth.can('loyalty.view')) {
      return;
    }

    this.loyalty.card(customerId).subscribe({
      next: (result) => this.loyaltyCard.set(result.card.has_program ? result.card : null),
      error: () => this.loyaltyCard.set(null),
    });
  }

  /** Le client utilise sa récompense sur ce dossier. */
  protected applyReward(): void {
    if (this.isRedeeming()) {
      return;
    }

    this.isRedeeming.set(true);
    this.loyaltyWarnings.set([]);

    this.loyalty.redeem(this.operationId).subscribe({
      next: (result) => {
        this.isRedeeming.set(false);
        this.operation.set(result.operation);
        this.loyaltyCard.set(result.card);
        this.loyaltyWarnings.set(result.warnings ?? []);
        this.noticeMessage.set('Récompense appliquée.');
        // Le contrôle avant restitution dépend de ce qui reste dû :
        // il faut le refaire, sinon il continuerait de réclamer une
        // somme qui vient d'être remisée.
        this.loadChecklist();
      },
      error: (error: HttpErrorResponse) => {
        this.isRedeeming.set(false);
        this.errorMessage.set(error.error?.message ?? "La récompense n'a pas pu être appliquée.");
      },
    });
  }

  /** Une remise appliquée par erreur. Les tampons sont rendus. */
  protected cancelReward(): void {
    if (this.isRedeeming()) {
      return;
    }

    this.isRedeeming.set(true);

    this.loyalty.cancelRedeem(this.operationId).subscribe({
      next: (result) => {
        this.isRedeeming.set(false);
        this.operation.set(result.operation);
        this.loyaltyCard.set(result.card);
        this.loyaltyWarnings.set(result.warnings ?? []);
        this.noticeMessage.set('Remise retirée. Les tampons sont rendus au client.');
        this.loadChecklist();
      },
      error: (error: HttpErrorResponse) => {
        this.isRedeeming.set(false);
        this.errorMessage.set(error.error?.message ?? "La remise n'a pas pu être retirée.");
      },
    });
  }

  private loadInspection(id: number): void {
    this.operationService.inspection(id).subscribe((result) => {
      this.entryInspection.set(result.inspection);
      this.buildPhotoTiles(result.inspection.photos ?? []);
    });
  }

  // --- Le parcours ---------------------------------------------------

  protected advance(status: OperationStatus): void {
    this.isChangingStatus.set(true);
    this.errorMessage.set(null);

    this.operationService.changeStatus(this.operationId, status).subscribe({
      next: (result) => {
        this.isChangingStatus.set(false);
        this.operation.set(result.operation);
        this.noticeMessage.set(null);

        if (result.operation.status === 'READY') {
          this.loadChecklist();
        }
      },
      error: (error: HttpErrorResponse) => {
        this.isChangingStatus.set(false);
        // Le serveur explique en français pourquoi il refuse : on
        // affiche SON message plutôt qu'un texte générique, il est
        // toujours plus précis que ce qu'on inventerait ici.
        this.errorMessage.set(error.error?.message ?? "Ce changement d'étape a été refusé.");
      },
    });
  }

  protected cancel(): void {
    if (!confirm('Annuler ce dossier ? Cette action est définitive.')) {
      return;
    }

    this.advance('CANCELLED');
  }

  // --- L'inspection d'entrée -----------------------------------------

  protected submitInspection(): void {
    const value = this.inspectionForm.getRawValue();

    this.isSavingInspection.set(true);
    this.fieldErrors.set({});

    this.operationService
      .createInspection(this.operationId, {
        type: 'ENTRY',
        fuel_level: value.fuel_level,
        mileage: value.mileage ? Number(value.mileage) : null,
        has_damage: value.has_damage,
        damage_notes: value.damage_notes || null,
        items_left: value.items_left || null,
        observations: value.observations || null,
        customer_present: value.customer_present,
        signature_name: value.signature_name || null,
      })
      .subscribe({
        next: (result) => {
          this.isSavingInspection.set(false);
          this.entryInspection.set(result.inspection);
          this.buildPhotoTiles([]);
          this.noticeMessage.set(
            'État enregistré. Prenez maintenant les photos : ce sont elles qui feront foi.',
          );
          // Le serveur a fait avancer le dossier à INSPECTION : on
          // recharge pour que les boutons reflètent le nouvel état.
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.isSavingInspection.set(false);

          if (error.status === 422 && error.error?.errors) {
            this.fieldErrors.set(error.error.errors);

            return;
          }

          this.errorMessage.set(error.error?.message ?? "L'enregistrement a échoué.");
        },
      });
  }

  // --- Les photos ----------------------------------------------------

  private buildPhotoTiles(photos: InspectionPhoto[]): void {
    this.releasePhotoUrls();

    const tiles: PhotoTile[] = REQUIRED_PHOTO_POSITIONS.map((position) => ({
      position,
      label: PHOTO_POSITION_LABELS[position],
      photo: photos.find((photo) => photo.position === position) ?? null,
      objectUrl: null,
      isUploading: false,
      error: null,
    }));

    // Les gros plans sur un dommage viennent en plus des cinq faces.
    for (const photo of photos.filter((item) => !REQUIRED_PHOTO_POSITIONS.includes(item.position))) {
      tiles.push({
        position: photo.position,
        label: PHOTO_POSITION_LABELS[photo.position],
        photo,
        objectUrl: null,
        isUploading: false,
        error: null,
      });
    }

    this.photoTiles.set(tiles);

    for (const tile of tiles) {
      if (tile.photo) {
        this.loadPhotoPreview(tile.position, tile.photo);
      }
    }
  }

  /**
   * Charge l'aperçu d'une photo déjà enregistrée.
   *
   * On ne peut pas écrire <img src="/api/photos/42"> : le navigateur
   * n'ajoute pas l'en-tête Authorization sur les images, la requête
   * partirait sans jeton. On télécharge donc le fichier puis on
   * fabrique une URL locale.
   */
  private loadPhotoPreview(position: PhotoPosition, photo: InspectionPhoto): void {
    this.operationService.photoBlobUrl(photo.url).subscribe({
      next: (objectUrl) => this.patchTile(position, { objectUrl }),
      error: () => this.patchTile(position, { error: "L'aperçu n'a pas pu être chargé." }),
    });
  }

  protected async onPhotoSelected(position: PhotoPosition, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // On vide le champ tout de suite : sans cela, reprendre la MÊME
    // photo après un échec ne déclencherait aucun événement, le
    // navigateur considérant que la valeur n'a pas changé.
    input.value = '';

    if (!file) {
      return;
    }

    const inspection = this.entryInspection();

    if (!inspection) {
      return;
    }

    this.patchTile(position, { isUploading: true, error: null });

    // Compression AVANT l'envoi : quatre mégaoctets deviennent moins
    // de deux cents kilooctets, et l'attente passe de la minute à
    // quelques secondes sur une connexion mobile.
    const compressed = await compressPhoto(file);

    this.operationService
      .uploadPhoto(inspection.id, compressed.blob, position, `${position.toLowerCase()}.webp`)
      .subscribe({
        next: (result) => {
          this.patchTile(position, { isUploading: false, photo: result.photo });
          this.loadPhotoPreview(position, result.photo);
        },
        error: (error: HttpErrorResponse) => {
          this.patchTile(position, {
            isUploading: false,
            error: error.error?.errors?.photo ?? error.error?.message ?? "L'envoi a échoué.",
          });
        },
      });
  }

  private patchTile(position: PhotoPosition, changes: Partial<PhotoTile>): void {
    this.photoTiles.update((tiles) =>
      tiles.map((tile) => (tile.position === position ? { ...tile, ...changes } : tile)),
    );
  }

  private releasePhotoUrls(): void {
    for (const tile of this.photoTiles()) {
      if (tile.objectUrl) {
        URL.revokeObjectURL(tile.objectUrl);
      }
    }
  }

  // --- L'encaissement -------------------------------------------------

  private loadPayments(): void {
    this.paymentService.operationPayments(this.operationId).subscribe({
      next: (result) => this.payments.set(result.payments),
      // Un employé sans droit de lecture des paiements ne doit pas
      // voir une erreur rouge : il n'a simplement pas cette section.
      error: () => this.payments.set([]),
    });
  }

  protected openPaymentPanel(): void {
    const operation = this.operation();
    // `amount_due` et non `price` : une récompense de fidélité a pu
    // diminuer ce qui reste à encaisser. Pré-remplir le prix plein
    // ferait payer au client une remise qu'on venait de lui accorder.
    const remaining = operation ? Math.max(0, operation.amount_due - operation.paid_amount) : 0;

    // Le montant restant est PRÉ-REMPLI : neuf fois sur dix, le client
    // règle tout. Le laisser vide ferait ressaisir un nombre déjà
    // affiché à l'écran, avec le risque de faute de frappe que ça
    // suppose sur une somme d'argent.
    this.paymentForm.reset({
      amount: remaining,
      method: 'CASH',
      provider: '',
      external_reference: '',
      notes: '',
    });

    this.paymentErrors.set({});
    this.cashOutsideSession.set(false);
    this.isPaymentPanelOpen.set(true);
  }

  protected closePaymentPanel(): void {
    this.isPaymentPanelOpen.set(false);
  }

  protected submitPayment(): void {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();

      return;
    }

    this.isRecordingPayment.set(true);
    this.paymentErrors.set({});

    const value = this.paymentForm.getRawValue();

    this.paymentService
      .record(this.operationId, {
        amount: Number(value.amount),
        method: value.method,
        provider: value.provider || null,
        external_reference: value.external_reference || null,
        notes: value.notes || null,
      })
      .subscribe({
        next: (result) => {
          this.isRecordingPayment.set(false);
          this.isPaymentPanelOpen.set(false);
          this.cashOutsideSession.set(result.outside_cash_session);
          this.noticeMessage.set(
            result.is_settled
              ? 'Paiement enregistré. Le dossier est réglé.'
              : `Paiement enregistré. Reste ${result.remaining.toLocaleString('fr-FR')} FCFA.`,
          );

          // On recharge le dossier : le montant réglé conditionne la
          // restitution, et la liste de vérification doit suivre.
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.isRecordingPayment.set(false);

          if (error.status === 422 && error.error?.errors) {
            this.paymentErrors.set(error.error.errors);

            return;
          }

          this.paymentErrors.set({
            amount: error.error?.message ?? "L'enregistrement du paiement a échoué.",
          });
        },
      });
  }

  // --- La restitution ------------------------------------------------

  private loadChecklist(): void {
    this.operationService.releaseCheck(this.operationId).subscribe((result) => {
      this.checklist.set(result.checklist);
      this.operation.set(result.operation);
    });
  }

  protected openReleasePanel(): void {
    this.releaseForm.reset({ reference: '', plate_number: '', override_reason: '' });
    this.releaseError.set(null);
    this.needsOverride.set(false);
    this.isReleasePanelOpen.set(true);
    this.loadChecklist();
  }

  protected closeReleasePanel(): void {
    this.isReleasePanelOpen.set(false);
  }

  protected submitRelease(): void {
    if (this.releaseForm.invalid) {
      this.releaseForm.markAllAsTouched();

      return;
    }

    this.isReleasing.set(true);
    this.releaseError.set(null);

    const value = this.releaseForm.getRawValue();

    this.operationService
      .release(this.operationId, {
        reference: value.reference,
        plate_number: value.plate_number,
        override_reason: value.override_reason || null,
      })
      .subscribe({
        next: (result) => {
          this.isReleasing.set(false);
          this.isReleasePanelOpen.set(false);
          this.operation.set(result.operation);
          this.noticeMessage.set('Véhicule restitué. Le dossier est clos.');
        },
        error: (error: HttpErrorResponse) => {
          this.isReleasing.set(false);

          // 402 « Payment Required » : la prestation n'est pas réglée.
          // Un responsable peut lever le blocage, un employé non — et
          // c'est le serveur qui tranche, pas cet affichage.
          if (error.status === 402) {
            this.needsOverride.set(true);
          }

          this.releaseError.set(error.error?.message ?? 'La remise a été refusée.');
        },
      });
  }
}
