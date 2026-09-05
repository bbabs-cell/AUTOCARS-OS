import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { RelativeDatePipe } from '../../shared/pipes/relative-date.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { Station, TeamMember } from '../../core/models/catalog.model';

interface Activity {
  id: number;
  operations: number;
  revenue?: number;
}

/**
 * L'équipe
 * ==================================================================
 * QUI TRAVAILLE ICI, AVEC QUEL RÔLE, ET CE QU'IL A FAIT.
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * IL N'Y A PAS DE BOUTON « SUPPRIMER », ET C'EST DÉLIBÉRÉ
 *
 * Le nom d'un employé figure sur des inspections, des encaissements
 * et des restitutions. Effacer sa ligne casserait cet historique —
 * précisément ce qui sert en cas de litige, des mois après son
 * départ.
 *
 * On DÉSACTIVE le compte : l'accès est coupé à la seconde, la trace
 * reste. C'est la même règle que pour les photos d'inspection et les
 * écritures comptables.
 *
 * ------------------------------------------------------------------
 * DEUX CHIFFRES CÔTE À CÔTE, ET ILS NE DISENT PAS LA MÊME CHOSE
 *
 * Le nombre de dossiers pris en charge dit ce qui est sorti des mains
 * de quelqu'un. Le pointage, sur l'autre écran, dit combien de temps
 * il était là. Un employé présent douze jours qui a lavé quatre
 * voitures, ce n'est pas la même conversation qu'un employé présent
 * douze jours qui en a lavé soixante.
 */
@Component({
  selector: 'app-team-page',
  imports: [
    ReactiveFormsModule,
    AmountPipe,
    RelativeDatePipe,
    EmptyStateComponent,
    PageHeaderComponent,
  ],
  templateUrl: './team.page.html',
})
export class TeamPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly catalog = inject(CatalogService);
  private readonly auth = inject(AuthService);

  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly noticeMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly members = signal<TeamMember[]>([]);
  protected readonly stations = signal<Station[]>([]);
  protected readonly activity = signal<Record<number, Activity>>({});
  protected readonly canSeeMoney = signal(false);

  protected readonly isFormOpen = signal(false);
  protected readonly editing = signal<TeamMember | null>(null);

  /**
   * Ajouter, modifier ou désactiver un compte donne — ou retire —
   * l'accès aux données de l'entreprise. C'est une décision de
   * propriétaire, pas de responsable de station.
   *
   * Confort d'affichage : l'API refuse de toute façon.
   */
  protected readonly canManage = computed(() => this.auth.can('employees.update'));

  protected readonly currentUserId = computed(() => this.auth.user()?.id ?? 0);

  protected readonly roles = [
    { value: 'ADMIN', label: 'Administrateur', hint: 'Accès complet, gère les comptes' },
    { value: 'MANAGER', label: 'Manager', hint: 'Pilote la station au quotidien' },
    { value: 'EMPLOYEE', label: 'Employé', hint: 'Travaille sur les véhicules' },
  ] as const;

  /** Le formulaire d'ajout : un compte complet, avec mot de passe. */
  protected readonly createForm = this.formBuilder.nonNullable.group({
    first_name: ['', [Validators.required]],
    last_name: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    password: ['', [Validators.required, Validators.minLength(10)]],
    // Le type littéral, et non `string` : sans lui, TypeScript
    // refuse le formulaire au moment de l'envoyer à l'API — et c'est
    // exactement son travail, puisqu'un rôle inventé serait rejeté
    // par le serveur.
    role: ['EMPLOYEE' as 'ADMIN' | 'MANAGER' | 'EMPLOYEE', [Validators.required]],
    station_id: [0, [Validators.required, Validators.min(1)]],
  });

  /** La modification ne touche QUE le rôle et l'état. */
  protected readonly editForm = this.formBuilder.nonNullable.group({
    role: ['EMPLOYEE', [Validators.required]],
    status: ['ACTIVE', [Validators.required]],
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.isLoading.set(true);

    this.catalog.team().subscribe({
      next: (members) => {
        this.members.set(members);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.errorMessage.set("Le chargement de l'équipe a échoué.");
      },
    });

    this.catalog.stations().subscribe((stations) => this.stations.set(stations));

    this.catalog.teamActivity().subscribe({
      next: (result) => {
        const byId: Record<number, Activity> = {};

        for (const member of result.members) {
          byId[member.id] = member;
        }

        this.activity.set(byId);
        this.canSeeMoney.set(result.can_see_money);
      },
      // L'activité est un complément : son échec ne doit pas vider la
      // liste de l'équipe, qui est l'information principale.
      error: () => this.activity.set({}),
    });
  }

  protected activityFor(memberId: number): Activity | null {
    return this.activity()[memberId] ?? null;
  }

  protected roleLabel(role: string): string {
    return this.roles.find((entry) => entry.value === role)?.label ?? role;
  }

  // --- Ajouter ---------------------------------------------------------

  protected openCreate(): void {
    const firstStation = this.stations()[0]?.id ?? 0;

    this.createForm.reset({ role: 'EMPLOYEE', station_id: firstStation });
    this.fieldErrors.set({});
    this.editing.set(null);
    this.isFormOpen.set(true);
  }

  protected submitCreate(): void {
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();

      return;
    }

    this.isSaving.set(true);
    this.fieldErrors.set({});

    const value = this.createForm.getRawValue();

    this.catalog
      .addTeamMember({ ...value, station_id: Number(value.station_id) })
      .subscribe({
        next: () => {
          this.isSaving.set(false);
          this.isFormOpen.set(false);
          this.noticeMessage.set(
            'Membre ajouté. Communiquez-lui son mot de passe : il ne lui sera pas envoyé.',
          );
          this.load();
        },
        error: (error: HttpErrorResponse) => {
          this.isSaving.set(false);

          if (error.status === 422 && error.error?.errors) {
            this.fieldErrors.set(error.error.errors);

            return;
          }

          this.fieldErrors.set({ email: error.error?.message ?? "L'ajout a échoué." });
        },
      });
  }

  // --- Modifier --------------------------------------------------------

  protected openEdit(member: TeamMember): void {
    this.editing.set(member);
    this.editForm.setValue({ role: member.role, status: member.status });
    this.fieldErrors.set({});
    this.isFormOpen.set(true);
  }

  protected submitEdit(): void {
    const member = this.editing();

    if (!member) {
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);

    this.catalog.updateMember(member.id, this.editForm.getRawValue()).subscribe({
      next: (result) => {
        this.isSaving.set(false);
        this.isFormOpen.set(false);
        this.noticeMessage.set(
          result.status === 'DISABLED'
            ? "Compte désactivé. L'historique de cette personne est conservé."
            : 'Membre mis à jour.',
        );
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        // Le serveur explique pourquoi il refuse — « c'est le dernier
        // administrateur actif », par exemple. Son message est
        // toujours plus utile que ce qu'on inventerait ici.
        this.errorMessage.set(error.error?.message ?? 'La modification a échoué.');
        this.isFormOpen.set(false);
      },
    });
  }

  protected closeForm(): void {
    this.isFormOpen.set(false);
  }

  // --- Affecter à des stations (lot 17) --------------------------------

  /**
   * DEUX FORMULAIRES, PAS UN SEUL AVEC UN CHAMP DE PLUS.
   *
   * « Quel est son rôle, et son compte est-il ouvert ? » et « où
   * travaille-t-il ? » sont deux décisions différentes, prises à des
   * moments différents et par des gestes différents. Les fondre dans
   * une même fenêtre obligerait à renvoyer le rôle chaque fois qu'on
   * déplace quelqu'un d'une station à l'autre — et un jour, à le
   * renvoyer périmé.
   *
   * L'API a la même séparation : deux routes, deux décisions.
   */
  protected readonly assigning = signal<TeamMember | null>(null);
  protected readonly selectedStations = signal<number[]>([]);

  /** Le bouton n'apparaît que s'il y a réellement un choix à faire. */
  protected readonly hasSeveralStations = computed(() => this.stations().length > 1);

  protected openAssign(member: TeamMember): void {
    this.errorMessage.set(null);
    this.selectedStations.set([...(member.station_ids ?? [])]);
    this.assigning.set(member);
  }

  protected closeAssign(): void {
    this.assigning.set(null);
  }

  protected isAssignedTo(stationId: number): boolean {
    return this.selectedStations().includes(stationId);
  }

  protected toggleStation(stationId: number): void {
    this.selectedStations.update((ids) =>
      ids.includes(stationId) ? ids.filter((id) => id !== stationId) : [...ids, stationId],
    );
  }

  /**
   * Une station fermée reste cochable SI la personne y est déjà :
   * sinon, fermer une station rendrait impossible le moindre
   * enregistrement de la fiche de ceux qui y travaillaient. Le
   * serveur applique exactement la même règle.
   */
  protected canAssignTo(station: Station): boolean {
    return station.status === 'ACTIVE' || this.isAssignedTo(station.id);
  }

  protected submitStations(): void {
    const member = this.assigning();

    if (!member || this.isSaving()) {
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);

    this.catalog.setMemberStations(member.id, this.selectedStations()).subscribe({
      next: () => {
        this.isSaving.set(false);
        this.assigning.set(null);
        this.noticeMessage.set(`Affectation de ${member.full_name} enregistrée.`);
        this.load();
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);
        // Le serveur refuse une liste vide en expliquant quoi faire à
        // la place (« désactivez son compte ») : on montre sa phrase.
        this.errorMessage.set(
          error.error?.errors?.station_ids
            ?? error.error?.message
            ?? "L'affectation a échoué.",
        );
      },
    });
  }
}
