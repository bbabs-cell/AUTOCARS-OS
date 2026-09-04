import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { AttendanceService } from '../../core/services/attendance.service';
import { AttendanceRegister, TimeEntry } from '../../core/models/attendance.model';

/**
 * Le registre de présence
 * ==================================================================
 * L'ÉCRAN QU'ON OUVRE LE JOUR DE LA PAIE.
 * ==================================================================
 *
 * L'ORDRE EST CELUI DU TRAVAIL À FAIRE :
 *
 *   1. LES POINTAGES OUBLIÉS, en premier. Quelqu'un est parti sans
 *      pointer, et le compteur tourne depuis. Tant que la ligne n'est
 *      pas corrigée, les totaux du mois sont faux.
 *   2. QUI EST LÀ MAINTENANT.
 *   3. LES TOTAUX du mois — le chiffre qui sert à payer.
 *   4. LE DÉTAIL, ligne par ligne.
 *
 * ------------------------------------------------------------------
 * POURQUOI LES POINTAGES OUBLIÉS NE SE FERMENT PAS TOUT SEULS
 *
 * Le logiciel ne sait pas à quelle heure la personne est partie.
 * Fermer automatiquement à une heure arbitraire — 18 h, ou après huit
 * heures — reviendrait à fabriquer une donnée de paie. On signale, un
 * responsable tranche avec ce qu'il sait, et la correction porte son
 * nom.
 *
 * ------------------------------------------------------------------
 * ON MONTRE LES JOURS AVANT LES HEURES
 *
 * La paie d'une station de lavage se fait le plus souvent à la
 * journée travaillée. « 14 jours » est le chiffre qu'on cherche ;
 * « 112 h 30 » est celui qu'un logiciel européen mettrait en avant.
 */
@Component({
  selector: 'app-attendance-page',
  imports: [
    ReactiveFormsModule,
    DurationPipe,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './attendance.page.html',
})
export class AttendancePage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly attendance = inject(AttendanceService);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly noticeMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly data = signal<AttendanceRegister | null>(null);
  protected readonly correcting = signal<TimeEntry | null>(null);

  protected readonly stale = computed(() => this.data()?.stale ?? []);
  protected readonly present = computed(() => this.data()?.present ?? []);
  protected readonly totals = computed(() => this.data()?.totals ?? []);
  protected readonly entries = computed(() => this.data()?.entries ?? []);

  /**
   * « Du 1 septembre au 4 septembre 2026 ».
   *
   * Les dates circulent en ISO (2026-09-04) parce que c'est le seul
   * format qu'une base de données et une API lisent sans ambiguïté.
   * Mais un gérant à Dakar ne lit pas de l'ISO : il lit une date
   * française. Le format technique reste dans les échanges, jamais
   * dans une phrase affichée.
   */
  protected readonly periodLabel = computed(() => {
    const period = this.data()?.period;

    if (!period) {
      return 'Chargement…';
    }

    // Les bornes sont facultatives côté API : sans filtre, le registre
    // renvoie tout, et la phrase doit le dire plutôt que d'afficher
    // deux tirets.
    if (period.from === null || period.to === null) {
      return 'Toute la période';
    }

    // « Du 1 septembre au 4 septembre 2026 » : l'année une seule fois
    // quand les deux bornes tombent la même année.
    const sameYear = period.from.substring(0, 4) === period.to.substring(0, 4);

    return `Du ${this.frenchDate(period.from, !sameYear)} au ${this.frenchDate(period.to)}`;
  });

  protected readonly filterForm = this.formBuilder.nonNullable.group({
    from: [this.firstOfMonth()],
    to: [this.today()],
  });

  protected readonly correctionForm = this.formBuilder.nonNullable.group({
    clock_in_at: ['', [Validators.required]],
    clock_out_at: [''],
    reason: ['', [Validators.required]],
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);

    const value = this.filterForm.getRawValue();

    this.attendance.register({ from: value.from, to: value.to }).subscribe({
      next: (register) => {
        this.data.set(register);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set('Le chargement du registre a échoué.');
      },
    });
  }

  // --- Correction -------------------------------------------------------

  protected openCorrection(entry: TimeEntry): void {
    this.correcting.set(entry);
    this.correctionForm.reset({
      // Les champs `datetime-local` attendent « AAAA-MM-JJTHH:MM ».
      clock_in_at: this.toLocalInput(entry.clock_in_at),
      clock_out_at: this.toLocalInput(entry.clock_out_at),
      reason: '',
    });
    this.fieldErrors.set({});
  }

  protected closeCorrection(): void {
    this.correcting.set(null);
  }

  protected submitCorrection(): void {
    const entry = this.correcting();

    if (!entry || this.correctionForm.invalid) {
      this.correctionForm.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const value = this.correctionForm.getRawValue();

    this.attendance
      .correct(entry.id, {
        clock_in_at: value.clock_in_at,
        clock_out_at: value.clock_out_at || null,
        reason: value.reason,
      })
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.correcting.set(null);
          this.noticeMessage.set(
            'Pointage corrigé. La modification est visible dans le registre.',
          );
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving.set(false);

          if (error.status === 422 && error.error?.errors) {
            this.fieldErrors.set(error.error.errors);

            return;
          }

          this.fieldErrors.set({
            reason: error.error?.message ?? 'La correction a échoué.',
          });
        },
      });
  }

  // --- Affichage --------------------------------------------------------

  /** « 08:15 » — juste l'heure, la date est portée par la ligne. */
  protected timeOf(value: string | null): string {
    return value ? value.substring(11, 16) : '—';
  }

  protected dateOf(value: string | null): string {
    return value ? value.substring(0, 10) : '';
  }

  protected today(): string {
    return this.format(new Date());
  }

  /** 2026-09-04 → « 4 septembre 2026 ». */
  private frenchDate(iso: string, withYear = true): string {
    const parsed = new Date(`${iso}T00:00:00`);

    return Number.isNaN(parsed.getTime())
      ? iso
      : parsed.toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'long',
          ...(withYear ? { year: 'numeric' as const } : {}),
        });
  }

  /**
   * La même date, pour une PHRASE.
   *
   * `dateOf()` reste en ISO dans la colonne « Jour » du tableau : on
   * y parcourt une colonne du regard, et l'ISO s'aligne et se compare
   * mieux qu'un mois écrit en toutes lettres. Dans une phrase, en
   * revanche, « 2026-09-01 » est du format technique laissé à la vue
   * de l'utilisateur.
   */
  protected longDateOf(value: string | null): string {
    return value ? this.frenchDate(value.substring(0, 10)) : '';
  }

  protected firstOfMonth(): string {
    const date = new Date();

    return this.format(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  protected setThisMonth(): void {
    this.filterForm.patchValue({ from: this.firstOfMonth(), to: this.today() });
    this.load();
  }

  protected setLastMonth(): void {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);

    this.filterForm.patchValue({ from: this.format(first), to: this.format(last) });
    this.load();
  }

  /**
   * Date au format local, jamais via `toISOString()` : celui-ci
   * convertit en UTC et donnerait la veille pour quelqu'un à l'est de
   * Greenwich passé une certaine heure.
   */
  private format(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${date.getFullYear()}-${month}-${day}`;
  }

  /** « 2026-09-04 08:15:00 » → « 2026-09-04T08:15 ». */
  private toLocalInput(value: string | null): string {
    return value ? value.substring(0, 16).replace(' ', 'T') : '';
  }
}
