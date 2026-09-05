import { Injectable, computed, inject, signal } from '@angular/core';

import { CatalogService } from './catalog.service';
import { Station } from '../models/catalog.model';

/** La clé de mémorisation. Nommée une fois, utilisée deux fois. */
const STORAGE_KEY = 'autocare.station';

/**
 * La station qu'on est en train de regarder
 * ==================================================================
 * CHOISIE UNE FOIS, DANS L'EN-TÊTE, ET VALABLE PARTOUT.
 * ==================================================================
 *
 * Avant le lot 17, chaque écran qui savait filtrer par station
 * portait son propre menu déroulant : un dans les statistiques, un
 * dans les rendez-vous, et rien du tout dans la file d'attente ou le
 * tableau de bord. Un gérant de deux stations devait donc répéter le
 * même choix sur chaque page, et se souvenir de ce qu'il regardait.
 *
 * Le choix vit maintenant ici, une seule fois.
 *
 * ------------------------------------------------------------------
 * UN FILTRE DE CONSULTATION N'EST PAS UN CHOIX DE SAISIE
 *
 * C'est la distinction qui décide de tout dans ce service, et elle
 * mérite d'être écrite parce que les deux se ressemblent à l'écran.
 *
 *   FILTRER   « montre-moi les rendez-vous de Thiès » — une question
 *             posée à un écran de lecture. C'est ce service.
 *   SAISIR    « ce véhicule est accueilli à Thiès » — une donnée
 *             écrite dans un dossier. Cela reste un champ du
 *             formulaire concerné, à côté du client et de la
 *             prestation.
 *
 * Les confondre produirait la pire catégorie de bug : un dossier
 * enregistré sur la mauvaise station parce que quelqu'un avait changé
 * un menu en haut de l'écran une heure plus tôt.
 *
 * ------------------------------------------------------------------
 * « TOUTES LES STATIONS » EST UNE VALEUR LÉGITIME
 *
 * Représentée par 0, et transmise à l'API comme l'ABSENCE de filtre.
 * Le serveur répond alors avec toutes les stations auxquelles
 * l'utilisateur a accès — ce qui est exactement ce qu'un propriétaire
 * veut le dimanche soir, et ce qu'un employé rattaché à une seule
 * station obtient de toute façon.
 */
@Injectable({ providedIn: 'root' })
export class StationContextService {
  private readonly catalog = inject(CatalogService);

  /** Toutes les stations de l'entreprise, fermées comprises. */
  readonly stations = signal<Station[]>([]);

  /** 0 = toutes les stations. */
  readonly selectedId = signal<number>(this.readStored());

  private loaded = false;

  /**
   * Les stations qu'on propose au choix.
   *
   * Une station fermée reste dans `stations()` — l'écran de gestion
   * en a besoin pour la rouvrir — mais elle ne s'offre pas comme
   * filtre courant, sauf si c'est celle qu'on regarde déjà : la
   * retirer du menu au moment où on la ferme donnerait un sélecteur
   * qui affiche un choix absent de sa propre liste.
   */
  readonly selectable = computed(() =>
    this.stations().filter(
      (station) => station.status === 'ACTIVE' || station.id === this.selectedId(),
    ),
  );

  /** Le sélecteur ne s'affiche que s'il y a réellement un choix. */
  readonly hasChoice = computed(() => this.selectable().length > 1);

  readonly current = computed(
    () => this.stations().find((station) => station.id === this.selectedId()) ?? null,
  );

  /** « Toutes les stations » ou le nom de celle qu'on regarde. */
  readonly label = computed(() => this.current()?.name ?? 'Toutes les stations');

  /**
   * Le paramètre à passer à l'API : `null` veut dire « ne filtre pas ».
   *
   * On expose une méthode plutôt que le signal brut pour que les
   * appelants n'aient pas à connaître la convention du zéro.
   */
  readonly queryId = computed<number | null>(() => this.selectedId() || null);

  /**
   * Charge la liste au démarrage de l'application.
   *
   * Un employé n'a pas `stations.view` : l'appel répond 403 et on
   * garde simplement une liste vide, ce qui masque le sélecteur. Il
   * continue de voir ses propres stations, puisque le serveur filtre
   * déjà ce qu'il envoie.
   */
  ensureLoaded(): void {
    if (this.loaded) {
      return;
    }

    this.loaded = true;
    this.refresh();
  }

  refresh(): void {
    this.catalog.stations().subscribe({
      next: (stations) => {
        this.stations.set(stations);

        // LA STATION MÉMORISÉE PEUT NE PLUS ÊTRE ACCESSIBLE.
        //
        // Quelqu'un a pu être retiré de cette station depuis sa
        // dernière visite — ou l'ouvrir dans une autre entreprise
        // après avoir changé de compte sur le même navigateur. Sans
        // cette vérification, tous ses écrans demanderaient une
        // station interdite et répondraient 403, sans qu'il comprenne
        // pourquoi.
        if (this.selectedId() !== 0 && !stations.some((s) => s.id === this.selectedId())) {
          this.select(0);
        }
      },
      error: () => this.stations.set([]),
    });
  }

  select(stationId: number): void {
    this.selectedId.set(stationId);

    try {
      if (stationId === 0) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, String(stationId));
      }
    } catch {
      // Navigation privée, stockage plein, cookies bloqués : le choix
      // reste valable pour la session en cours. Ne pas pouvoir s'en
      // souvenir n'est pas une raison de refuser le changement.
    }
  }

  private readStored(): number {
    try {
      return Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch {
      return 0;
    }
  }
}
