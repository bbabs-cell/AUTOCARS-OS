import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { AuthService } from '../../core/services/auth.service';
import { LoyaltyService } from '../../core/services/loyalty.service';
import { LoyaltyOverview } from '../../core/models/loyalty.model';

/**
 * La fidélité
 * ==================================================================
 * UNE CARTE À TAMPONS, PAS UN PROGRAMME À POINTS.
 * ==================================================================
 *
 * « Après 10 lavages, 5 000 F offerts. » Le client compte lui-même —
 * et c'est tout l'intérêt. Un programme à points lui demanderait de
 * croire une arithmétique qu'il ne peut pas vérifier, faite par un
 * logiciel qu'il ne connaît pas.
 *
 * ------------------------------------------------------------------
 * CET ÉCRAN N'EST PAS CELUI OÙ LA FIDÉLITÉ S'UTILISE
 *
 * La récompense s'applique sur le DOSSIER, au moment d'encaisser :
 * c'est là qu'un client attend ses clés. Personne n'ira ouvrir un
 * écran séparé à ce moment-là.
 *
 * Celui-ci sert à trois choses, et à rien d'autre :
 *
 *   1. RAPPELER CEUX QUI ONT GAGNÉ QUELQUE CHOSE. Ils ne le savent
 *      peut-être pas. Un appel, et ils reviennent — c'est le seul
 *      bloc actionnable de la page, donc il passe devant.
 *   2. DIRE CE QUE LE PROGRAMME COÛTE. Un programme dont on ne peut
 *      pas mesurer le coût est un programme qu'on ne peut pas juger.
 *   3. RÉGLER LES RÈGLES — pour l'administrateur seulement.
 *
 * ------------------------------------------------------------------
 * LE COÛT EST UN VRAI CHIFFRE, PAS UNE ESTIMATION
 *
 * Il est lu sur les remises RÉELLEMENT appliquées aux dossiers, et
 * non sur la valeur annoncée des récompenses : une récompense de
 * 5 000 F posée sur un dossier de 3 000 F ne coûte que 3 000 F.
 *
 * Ce chiffre n'existerait pas si une récompense avait été enregistrée
 * comme un faux encaissement — elle se serait fondue dans la recette.
 * C'est la raison d'être du choix « remise plutôt que paiement ».
 */
@Component({
  selector: 'app-loyalty-page',
  imports: [
    ReactiveFormsModule,
    AmountPipe,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './loyalty.page.html',
  styleUrl: './loyalty.page.scss',
})
export class LoyaltyPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly loyalty = inject(LoyaltyService);
  private readonly auth = inject(AuthService);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly noticeMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly data = signal<LoyaltyOverview | null>(null);
  protected readonly isEditing = signal(false);

  protected readonly program = computed(() => this.data()?.program ?? null);
  protected readonly ready = computed(() => this.data()?.ready ?? []);
  protected readonly summary = computed(() => this.data()?.summary ?? null);

  /**
   * Régler les règles est réservé au propriétaire.
   *
   * Un client qui collecte des tampons a une promesse en cours :
   * passer de « 10 lavages » à « 12 » au milieu touche des gens qui
   * ont déjà commencé. Ce n'est pas une décision d'exploitation
   * quotidienne, contrairement à l'ajustement d'un prix.
   *
   * Ce masquage est un CONFORT : le serveur refuse de toute façon.
   */
  protected readonly canManage = computed(() => this.auth.can('loyalty.manage'));

  /** « après 10 lavages, 5 000 F offerts » — la phrase du programme. */
  protected readonly programSentence = computed(() => {
    const program = this.program();

    if (program === null) {
      return '';
    }

    return `Après ${program.stamps_required} lavages, ${new Intl.NumberFormat('fr-FR').format(
      program.reward_amount,
    )} FCFA offerts.`;
  });

  protected readonly filterForm = this.formBuilder.nonNullable.group({
    from: [this.firstOfMonth()],
    to: [this.today()],
  });

  protected readonly programForm = this.formBuilder.nonNullable.group({
    name: ['Carte de fidélité', [Validators.required]],
    stamps_required: [10, [Validators.required, Validators.min(3), Validators.max(50)]],
    reward_amount: [5000, [Validators.required, Validators.min(1)]],
    min_operation_amount: [0],
    status: ['INACTIVE' as 'ACTIVE' | 'INACTIVE'],
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);

    const { from, to } = this.filterForm.getRawValue();

    this.loyalty.overview(from, to).subscribe({
      next: (data) => {
        this.data.set(data);
        this.isLoading.set(false);

        if (data.program) {
          this.programForm.patchValue({
            name: data.program.name,
            stamps_required: data.program.stamps_required,
            reward_amount: data.program.reward_amount,
            min_operation_amount: data.program.min_operation_amount,
            status: data.program.status,
          });
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set('Le chargement du programme a échoué.');
      },
    });
  }

  protected openEditor(): void {
    this.isEditing.set(true);
    this.fieldErrors.set({});
  }

  protected closeEditor(): void {
    this.isEditing.set(false);
  }

  protected submitProgram(): void {
    if (this.programForm.invalid) {
      this.programForm.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const value = this.programForm.getRawValue();

    this.loyalty
      .updateProgram({
        name: value.name.trim(),
        stamps_required: Number(value.stamps_required),
        reward_amount: Number(value.reward_amount),
        min_operation_amount: Number(value.min_operation_amount),
        status: value.status,
      })
      .subscribe({
        next: (result) => {
          this.isSaving.set(false);
          this.closeEditor();
          this.noticeMessage.set(
            result.program.is_active
              ? 'Programme actif. Les prochains lavages payés donneront un tampon.'
              : 'Programme enregistré, mais inactif : aucun tampon ne sera distribué.',
          );
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving.set(false);
          this.fieldErrors.set(error.error?.errors ?? {});
          this.errorMessage.set(error.error?.message ?? "L'enregistrement a échoué.");
        },
      });
  }

  /**
   * Combien de récompenses complètes ce client peut prendre.
   *
   * Le calcul est refait ici pour une liste, alors que le serveur le
   * fait déjà pour une carte : c'est le seul endroit du produit où
   * une règle métier est recopiée côté client. Elle est tolérable
   * parce qu'elle ne DÉCIDE de rien — le serveur revérifie à chaque
   * utilisation, et une divergence n'aurait pour effet qu'un chiffre
   * d'affichage temporairement faux.
   */
  protected rewardsFor(balance: number): number {
    const required = this.program()?.stamps_required ?? 0;

    return required > 0 ? Math.floor(balance / required) : 0;
  }

  protected dismissNotice(): void {
    this.noticeMessage.set(null);
  }

  protected dismissError(): void {
    this.errorMessage.set(null);
  }

  private today(): string {
    return this.format(new Date());
  }

  private firstOfMonth(): string {
    const now = new Date();

    return this.format(new Date(now.getFullYear(), now.getMonth(), 1));
  }

  private format(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
  }
}
