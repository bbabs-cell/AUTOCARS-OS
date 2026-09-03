import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { DurationPipe } from '../../shared/pipes/duration.pipe';
import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { Service, Station, TeamMember } from '../../core/models/catalog.model';

/** Une prestation proposée d'emblée, que le gérant coche ou non. */
interface SuggestedService {
  name: string;
  description: string;
  category: string;
  price: number;
  duration_minutes: number;
  selected: boolean;
}

/**
 * Installation guidée
 * ==================================================================
 * L'ÉCRAN LE PLUS IMPORTANT POUR LA COMMERCIALISATION.
 * ==================================================================
 *
 * C'est le premier contact réel avec le produit. Un gérant qui arrive
 * sur une application vide, sans savoir par où commencer, ne revient
 * pas. Cet écran le conduit d'un compte vide à une station
 * opérationnelle en quelques minutes.
 *
 * TROIS PARTIS PRIS :
 *
 * 1. Les prestations sont PROPOSÉES, pas demandées. Saisir six
 *    prestations à la main décourage ; cocher dans une liste
 *    pré-remplie aux tarifs sénégalais courants prend dix secondes,
 *    et les prix restent modifiables ensuite.
 *
 * 2. L'équipe est FACULTATIVE. Un gérant seul le lundi matin doit
 *    pouvoir arriver au bout. Il ajoutera ses employés plus tard.
 *
 * 3. Chaque étape ENREGISTRE immédiatement. Si la connexion se coupe
 *    à l'étape 4 — situation courante sur un réseau irrégulier — tout
 *    ce qui précède est déjà en base. On ne perd jamais une saisie.
 */
@Component({
  selector: 'app-onboarding-page',
  imports: [ReactiveFormsModule, AmountPipe, DurationPipe],
  templateUrl: './onboarding.page.html',
  styleUrl: './onboarding.page.scss',
})
export class OnboardingPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly catalog = inject(CatalogService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly totalSteps = 6;
  protected readonly step = signal(1);

  protected readonly isSaving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly station = signal<Station | null>(null);
  protected readonly services = signal<Service[]>([]);
  protected readonly team = signal<TeamMember[]>([]);

  protected readonly userName = computed(
    () => this.auth.user()?.full_name.split(' ')[0] ?? '',
  );

  protected readonly progress = computed(() =>
    Math.round(((this.step() - 1) / (this.totalSteps - 1)) * 100),
  );

  // --- Étape 2 : la station ----------------------------------------

  protected readonly stationForm = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    code: ['', [Validators.required, Validators.maxLength(10)]],
    address: [''],
    city: [''],
    phone: [''],
  });

  // --- Étape 5 : les horaires ---------------------------------------

  protected readonly hoursForm = this.formBuilder.nonNullable.group({
    opens_at: ['07:30'],
    closes_at: ['20:00'],
  });

  // --- Étape 3 : les prestations ------------------------------------
  //
  // Tarifs et durées correspondant à la pratique courante au Sénégal.
  // Ce sont des points de départ : le gérant ajuste ce qu'il veut.
  protected readonly suggestions = signal<SuggestedService[]>([
    { name: 'Lavage standard', description: 'Extérieur, jantes et vitres.', category: 'Lavage', price: 5000, duration_minutes: 30, selected: true },
    { name: 'Lavage premium', description: 'Extérieur, intérieur, tableau de bord, cire.', category: 'Lavage', price: 10000, duration_minutes: 60, selected: true },
    { name: 'Nettoyage intérieur', description: 'Aspiration, sièges, moquettes, plastiques.', category: 'Intérieur', price: 7500, duration_minutes: 45, selected: true },
    { name: 'Lavage moteur', description: 'Dégraissage et rinçage du compartiment moteur.', category: 'Lavage', price: 8000, duration_minutes: 40, selected: false },
    { name: 'Polissage', description: 'Correction des micro-rayures de la carrosserie.', category: 'Detailing', price: 20000, duration_minutes: 120, selected: false },
    { name: 'Detailing complet', description: 'Traitement complet intérieur et extérieur.', category: 'Detailing', price: 35000, duration_minutes: 240, selected: false },
  ]);

  protected readonly selectedCount = computed(
    () => this.suggestions().filter((s) => s.selected).length,
  );

  // --- Étape 4 : l'équipe -------------------------------------------

  protected readonly memberForm = this.formBuilder.nonNullable.group({
    first_name: ['', [Validators.required]],
    last_name: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(10)]],
    role: ['EMPLOYEE' as const, [Validators.required]],
  });

  constructor() {
    this.load();
  }

  // ==================================================================

  private load(): void {
    this.catalog.onboardingStatus().subscribe({
      next: (status) => {
        if (status.station) {
          this.station.set(status.station);

          // On pré-remplit avec ce qui existe déjà. Le gérant reprend
          // son installation là où il l'avait laissée plutôt que de
          // tout ressaisir.
          this.stationForm.patchValue({
            name:
              status.station.name === 'Station principale'
                ? status.organization_name
                : status.station.name,
            code: status.station.code === 'ST1' ? '' : status.station.code,
            address: status.station.address ?? '',
            city: status.station.city ?? '',
            phone: status.station.phone ?? '',
          });

          this.hoursForm.patchValue({
            opens_at: status.station.opens_at ?? '07:30',
            closes_at: status.station.closes_at ?? '20:00',
          });
        }
      },
      error: () => this.errorMessage.set("Impossible de charger votre station."),
    });
  }

  protected goToStep(step: number): void {
    this.step.set(step);
    this.errorMessage.set(null);
    this.fieldErrors.set({});
  }

  // --- Étape 2 -------------------------------------------------------

  protected saveStation(): void {
    if (this.stationForm.invalid) {
      this.stationForm.markAllAsTouched();

      return;
    }

    const station = this.station();

    if (!station) {
      return;
    }

    this.save(
      this.catalog.updateStation(station.id, {
        ...this.stationForm.getRawValue(),
        code: this.stationForm.getRawValue().code.toUpperCase(),
        opens_at: station.opens_at,
        closes_at: station.closes_at,
      }),
      (updated) => {
        this.station.set(updated);
        this.goToStep(3);
      },
    );
  }

  /**
   * Propose un code à partir du nom de la station.
   * « Station Dakar Plateau » suggère « SDP ».
   * Le gérant peut le remplacer, mais il n'a rien à inventer.
   */
  protected suggestCode(): void {
    if (this.stationForm.controls.code.value !== '') {
      return;
    }

    const code = this.stationForm.controls.name.value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 2)
      .slice(0, 3)
      .map((word) => word.charAt(0).toUpperCase())
      .join('');

    if (code.length >= 2) {
      this.stationForm.controls.code.setValue(code);
    }
  }

  // --- Étape 3 -------------------------------------------------------

  protected toggleSuggestion(index: number): void {
    this.suggestions.update((list) =>
      list.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)),
    );
  }

  protected saveServices(): void {
    const chosen = this.suggestions().filter((s) => s.selected);

    if (chosen.length === 0) {
      this.errorMessage.set('Choisissez au moins une prestation pour pouvoir enregistrer des véhicules.');

      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);

    // On enregistre les prestations une par une, en série. Le serveur
    // refuse les doublons de nom : relancer l'étape après une coupure
    // ne crée donc pas de doublon.
    let remaining = chosen.length;
    let hadError = false;

    for (const suggestion of chosen) {
      this.catalog
        .createService({
          name: suggestion.name,
          description: suggestion.description,
          category: suggestion.category,
          price: suggestion.price,
          duration_minutes: suggestion.duration_minutes,
        })
        .subscribe({
          next: () => this.afterService(--remaining, hadError),
          error: (error: HttpErrorResponse) => {
            // 422 = nom déjà pris : la prestation existe, ce n'est pas
            // un échec de l'étape.
            if (error.status !== 422) {
              hadError = true;
            }

            this.afterService(--remaining, hadError);
          },
        });
    }
  }

  private afterService(remaining: number, hadError: boolean): void {
    if (remaining > 0) {
      return;
    }

    this.isSaving.set(false);

    if (hadError) {
      this.errorMessage.set("Certaines prestations n'ont pas pu être enregistrées.");

      return;
    }

    this.catalog.services().subscribe((services) => this.services.set(services));
    this.goToStep(4);
  }

  // --- Étape 4 -------------------------------------------------------

  protected addMember(): void {
    if (this.memberForm.invalid) {
      this.memberForm.markAllAsTouched();

      return;
    }

    const station = this.station();

    if (!station) {
      return;
    }

    this.save(
      this.catalog.addTeamMember({
        ...this.memberForm.getRawValue(),
        station_id: station.id,
      }),
      () => {
        this.memberForm.reset({ role: 'EMPLOYEE' });
        this.catalog.team().subscribe((members) => this.team.set(members));
      },
    );
  }

  // --- Étape 5 -------------------------------------------------------

  protected saveHours(): void {
    const station = this.station();

    if (!station) {
      return;
    }

    this.save(
      this.catalog.updateStation(station.id, {
        name: station.name,
        code: station.code,
        address: station.address,
        city: station.city,
        phone: station.phone,
        ...this.hoursForm.getRawValue(),
      }),
      (updated) => {
        this.station.set(updated);
        this.goToStep(6);
      },
    );
  }

  // --- Étape 6 -------------------------------------------------------

  protected finish(): void {
    this.save(this.catalog.completeOnboarding(), () => {
      // On recharge le profil pour que le garde de route sache que
      // l'installation est terminée.
      this.auth.refresh().subscribe(() => void this.router.navigateByUrl('/'));
    });
  }

  // ==================================================================

  /**
   * Enveloppe commune des appels : gère le chargement, les erreurs de
   * validation et les erreurs réseau, pour ne pas répéter le même
   * bloc dans chaque étape.
   *
   * Le paramètre est un Observable<T> typé, et non un objet vague
   * possédant une méthode subscribe. TypeScript vérifie ainsi que le
   * type reçu par onSuccess correspond bien à ce que l'appel renvoie —
   * c'est exactement l'erreur que la compilation a signalée ici.
   */
  private save<T>(request: Observable<T>, onSuccess: (value: T) => void): void {
    this.isSaving.set(true);
    this.errorMessage.set(null);
    this.fieldErrors.set({});

    request.subscribe({
      next: (value: T) => {
        this.isSaving.set(false);
        onSuccess(value);
      },
      error: (error: HttpErrorResponse) => {
        this.isSaving.set(false);

        if (error.status === 422 && error.error?.errors) {
          this.fieldErrors.set(error.error.errors);
        }

        this.errorMessage.set(
          error.status === 0
            ? "Connexion perdue. Vos étapes précédentes sont enregistrées."
            : (error.error?.message ?? "L'enregistrement a échoué."),
        );
      },
    });
  }
}
