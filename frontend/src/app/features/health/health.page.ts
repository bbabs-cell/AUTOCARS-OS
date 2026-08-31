import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

import { HealthService } from '../../core/services/health.service';
import { HealthStatus } from '../../core/models/health.model';

/**
 * Page de verification de l'installation
 * ------------------------------------------------------------------
 * ROLE : prouver que la chaine complete fonctionne.
 *
 *   Angular  ->  HttpClient  ->  API PHP  ->  MySQL
 *
 * Si cette page affiche "Connexion etablie", c'est que les quatre
 * maillons sont en place. C'est le livrable du Lot 1.
 *
 * Cette page est TEMPORAIRE : elle sera remplacee par le vrai
 * tableau de bord au Lot 10. Elle reste toutefois utile pendant tout
 * le developpement pour diagnostiquer une panne.
 *
 * NOTE SUR LES SIGNALS
 * `signal()` est la facon moderne de gerer un etat en Angular : quand
 * la valeur change, le template se met a jour tout seul.
 *
 * NOTE SUR LES TROIS ETATS
 * On gere des le depart : chargement, succes, erreur. C'est la regle
 * "etats UX" du projet : un ecran qui ne gere que le cas ou tout va
 * bien n'est pas un ecran fini.
 */
@Component({
  selector: 'app-health-page',
  templateUrl: './health.page.html',
})
export class HealthPage implements OnInit {
  private readonly healthService = inject(HealthService);

  /** true tant que la reponse de l'API n'est pas arrivee. */
  protected readonly isLoading = signal(true);

  /** Rempli en cas de succes. */
  protected readonly health = signal<HealthStatus | null>(null);

  /** Rempli en cas d'echec. */
  protected readonly errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.runCheck();
  }

  protected runCheck(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.healthService.check().subscribe({
      next: (status) => {
        this.health.set(status);
        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.health.set(null);
        this.errorMessage.set(this.explain(error));
        this.isLoading.set(false);
      },
    });
  }

  /**
   * Traduit une erreur HTTP en message actionnable.
   * Un "Http failure response" brut n'aide personne : on indique
   * quoi verifier.
   */
  private explain(error: HttpErrorResponse): string {
    // status 0 = le navigateur n'a meme pas pu joindre le serveur
    if (error.status === 0) {
      return (
        "Impossible de joindre l'API. Verifie que le serveur PHP tourne " +
        '(commande : php -S localhost:8000 -t public router.php depuis backend/).'
      );
    }

    if (error.status === 503) {
      return (
        "L'API repond mais la base de donnees est injoignable. " +
        'Lance « php tools/check_db.php » depuis le dossier backend/.'
      );
    }

    return error.error?.message ?? `Erreur HTTP ${error.status}.`;
  }
}
