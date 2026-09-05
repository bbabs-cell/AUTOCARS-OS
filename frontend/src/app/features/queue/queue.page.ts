import { Component, DestroyRef, effect, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import { DurationPipe, formatDuration } from '../../shared/pipes/duration.pipe';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { AuthService } from '../../core/services/auth.service';
import { CatalogService } from '../../core/services/catalog.service';
import { StationContextService } from '../../core/services/station-context.service';
import { OperationService } from '../../core/services/operation.service';
import {
  OPERATION_STATUS_LABELS,
  OperationStatus,
} from '../../core/models/operation-status.model';
import { TeamMember } from '../../core/models/catalog.model';
import { Operation, QueueBoard, QueueColumn } from '../../core/models/operation.model';

/**
 * La file d'attente
 * ==================================================================
 * L'ÉCRAN QUE LE GÉRANT LAISSE OUVERT TOUTE LA JOURNÉE.
 * ==================================================================
 *
 * Un tableau à colonnes, une par étape du parcours. Les colonnes
 * viennent du SERVEUR : leur liste et leur ordre sont une règle
 * métier, et la recopier ici en ferait une seconde source de vérité.
 *
 * ------------------------------------------------------------------
 * TROIS DÉCISIONS D'INTERFACE À COMPRENDRE
 *
 * 1. LE GLISSER-DÉPOSER N'EST JAMAIS LE SEUL CHEMIN.
 *    L'API HTML5 de glisser-déposer ne fonctionne pas au doigt : sur
 *    un téléphone, elle ne déclenche aucun événement. Elle est aussi
 *    inutilisable au clavier. Chaque carte porte donc un bouton qui
 *    ouvre la liste des étapes possibles — et ce bouton est le chemin
 *    principal, pas la solution de repli. Le glisser-déposer est un
 *    raccourci pour la souris, rien de plus.
 *
 * 2. ON NE DÉPLACE PAS LA CARTE SOI-MÊME.
 *    Au dépôt, on appelle le serveur et on attend sa réponse avant de
 *    recharger. Déplacer la carte tout de suite serait plus fluide,
 *    mais si le serveur refuse — inspection manquante, étape
 *    interdite — il faudrait la remettre en place sous les yeux de
 *    l'utilisateur. Un écran qui se rétracte fait douter de tout le
 *    reste.
 *
 * 3. LE RAFRAÎCHISSEMENT S'ARRÊTE QUAND L'ONGLET EST CACHÉ.
 *    Plusieurs postes affichent cet écran en permanence. Interroger
 *    l'API toutes les trente secondes sur un onglet que personne ne
 *    regarde consomme de la connexion mobile pour rien.
 */
@Component({
  selector: 'app-queue-page',
  imports: [RouterLink, AmountPipe, DurationPipe, PageHeaderComponent],
  templateUrl: './queue.page.html',
})
export class QueuePage {
  private readonly operations = inject(OperationService);
  private readonly catalog = inject(CatalogService);
  private readonly stationContext = inject(StationContextService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  /** 30 secondes : assez pour suivre, assez peu pour ne pas peser. */
  private static readonly REFRESH_MS = 30_000;

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);

  protected readonly board = signal<QueueBoard | null>(null);
  protected readonly refreshedAt = signal<string | null>(null);
  protected readonly movingId = signal<number | null>(null);

  /** La carte survolée pendant un glisser, pour éclairer sa cible. */
  protected readonly dragging = signal<Operation | null>(null);
  protected readonly hoveredColumn = signal<OperationStatus | null>(null);

  /** La carte dont le menu « étape suivante » est ouvert. */
  protected readonly openMenuId = signal<number | null>(null);
  protected readonly assigningId = signal<number | null>(null);
  protected readonly team = signal<TeamMember[]>([]);

  protected readonly columns = computed<QueueColumn[]>(() => this.board()?.columns ?? []);
  protected readonly metrics = computed(() => this.board()?.metrics ?? null);

  /**
   * Réorganiser la file et répartir le travail sont des décisions de
   * responsable. On masque ce qui n'est pas permis — mais c'est un
   * confort d'affichage : le serveur refuse de toute façon.
   */
  protected readonly canManage = computed(() => {
    const role = this.auth.role();

    return role === 'ADMIN' || role === 'MANAGER';
  });

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // La file suit la station choisie dans l'en-tête. L'effet couvre
    // aussi le premier chargement : une seule façon de déclencher une
    // lecture, donc une seule à maintenir.
    effect(() => {
      this.stationContext.selectedId();
      this.load();
    });

    this.timer = setInterval(() => {
      // document.hidden est vrai quand l'onglet est en arrière-plan.
      if (!document.hidden) {
        this.load(true);
      }
    }, QueuePage.REFRESH_MS);

    this.catalog.team().subscribe((members) => this.team.set(members));

    this.destroyRef.onDestroy(() => {
      if (this.timer !== null) {
        clearInterval(this.timer);
      }
    });
  }

  /**
   * @param silent Rafraîchissement automatique : on ne remet pas
   *        l'écran en squelette, sinon le tableau clignoterait toutes
   *        les trente secondes sous les yeux de l'utilisateur.
   */
  protected load(silent = false): void {
    if (!silent) {
      this.isLoading.set(true);
    }

    this.operations.queue(this.stationContext.queryId() ?? undefined).subscribe({
      next: (board) => {
        this.board.set(board);
        this.refreshedAt.set(board.generated_at);
        this.isLoading.set(false);
        this.errorMessage.set(null);
      },
      error: () => {
        this.isLoading.set(false);

        // Sur un rafraîchissement automatique raté, on garde le
        // tableau précédent à l'écran plutôt que de le vider : des
        // données d'il y a trente secondes valent mieux qu'une page
        // blanche.
        if (!silent) {
          this.errorMessage.set("Le chargement de la file d'attente a échoué.");
        }
      },
    });
  }

  // --- Le déplacement d'un dossier ------------------------------------

  /**
   * Cette carte peut-elle aller dans cette colonne ?
   * Lu dans `allowed_transitions`, que le serveur calcule.
   */
  protected canMoveTo(operation: Operation, status: OperationStatus): boolean {
    // La restitution suit sa propre procédure de vérification : on ne
    // rend pas un véhicule en faisant glisser une carte.
    if (status === 'COMPLETED') {
      return false;
    }

    return operation.allowed_transitions.includes(status);
  }

  protected move(operation: Operation, status: OperationStatus): void {
    this.openMenuId.set(null);
    this.actionError.set(null);

    if (!this.canMoveTo(operation, status)) {
      return;
    }

    this.movingId.set(operation.id);

    this.operations.changeStatus(operation.id, status).subscribe({
      next: () => {
        this.movingId.set(null);
        this.load(true);
      },
      error: (error: HttpErrorResponse) => {
        this.movingId.set(null);
        // Le serveur explique en français pourquoi il refuse —
        // « l'inspection d'entrée doit être enregistrée avant… ».
        // Son message est toujours plus précis que ce qu'on
        // inventerait ici.
        this.actionError.set(error.error?.message ?? "Ce déplacement a été refusé.");
      },
    });
  }

  /** Les étapes proposées dans le menu d'une carte. */
  protected nextSteps(operation: Operation): OperationStatus[] {
    return operation.allowed_transitions.filter((status) => status !== 'COMPLETED');
  }

  protected toggleMenu(operation: Operation, event: Event): void {
    event.stopPropagation();
    event.preventDefault();

    this.openMenuId.update((current) => (current === operation.id ? null : operation.id));
    this.assigningId.set(null);
  }

  protected closeMenus(): void {
    this.openMenuId.set(null);
    this.assigningId.set(null);
  }

  // --- Glisser-déposer (souris uniquement) ----------------------------

  protected onDragStart(operation: Operation): void {
    this.dragging.set(operation);
  }

  protected onDragEnd(): void {
    this.dragging.set(null);
    this.hoveredColumn.set(null);
  }

  /**
   * `preventDefault()` est ce qui autorise le dépôt : sans lui, le
   * navigateur refuse la zone et affiche le curseur « interdit ».
   * On ne l'appelle donc QUE sur une colonne réellement atteignable.
   */
  protected onDragOver(status: OperationStatus, event: DragEvent): void {
    const operation = this.dragging();

    if (!operation || !this.canMoveTo(operation, status)) {
      return;
    }

    event.preventDefault();
    this.hoveredColumn.set(status);
  }

  protected onDragLeave(status: OperationStatus): void {
    if (this.hoveredColumn() === status) {
      this.hoveredColumn.set(null);
    }
  }

  protected onDrop(status: OperationStatus, event: DragEvent): void {
    event.preventDefault();

    const operation = this.dragging();
    this.onDragEnd();

    if (operation) {
      this.move(operation, status);
    }
  }

  // --- Priorité et affectation ----------------------------------------

  protected setPriority(operation: Operation, priority: number, event: Event): void {
    event.stopPropagation();
    this.openMenuId.set(null);
    this.actionError.set(null);

    this.operations.setPriority(operation.id, priority).subscribe({
      next: () => this.load(true),
      error: (error: HttpErrorResponse) =>
        this.actionError.set(error.error?.message ?? 'La priorité n\'a pas pu être changée.'),
    });
  }

  protected openAssign(operation: Operation, event: Event): void {
    event.stopPropagation();
    event.preventDefault();

    this.openMenuId.set(null);
    this.assigningId.update((current) => (current === operation.id ? null : operation.id));
  }

  protected assign(operation: Operation, userId: number | null, event: Event): void {
    event.stopPropagation();
    this.assigningId.set(null);
    this.actionError.set(null);

    this.operations.assign(operation.id, userId).subscribe({
      next: () => this.load(true),
      error: (error: HttpErrorResponse) =>
        this.actionError.set(error.error?.message ?? "L'affectation a échoué."),
    });
  }

  // --- Affichage --------------------------------------------------------

  /**
   * Le libellé du bouton qui mène à une étape.
   *
   * Formulé en ACTION — « Commencer le lavage » — et non en état —
   * « Passer à : En lavage ». L'employé ne choisit pas un statut, il
   * fait quelque chose. Le vocabulaire de la base n'a rien à faire
   * sous ses yeux.
   */
  protected stepLabel(status: OperationStatus): string {
    const actions: Partial<Record<OperationStatus, string>> = {
      IN_PROGRESS: 'Prendre en charge',
      INSPECTION: "Passer à l'inspection",
      WASHING: 'Commencer le lavage',
      QUALITY_CHECK: 'Passer au contrôle qualité',
      READY: 'Contrôle validé, véhicule prêt',
      CANCELLED: 'Annuler le dossier',
    };

    return actions[status] ?? OPERATION_STATUS_LABELS[status];
  }

  /**
   * La mise en forme des durées vient du pipe partagé — utilisé ici
   * en fonction pour composer le texte d'une infobulle. Une seule
   * implémentation : sans quoi une carte afficherait « 1 h 30 » et
   * une autre « 90 min » pour la même durée.
   */
  protected readonly duration = formatDuration;

  /** « actualisé à 10 h 42 », depuis l'heure du serveur. */
  protected refreshedLabel(): string {
    const value = this.refreshedAt();

    if (!value) {
      return '';
    }

    return new Date(value).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
