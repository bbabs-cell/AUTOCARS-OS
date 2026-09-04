import { Component, computed, inject, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

import { AmountPipe } from '../../shared/pipes/amount.pipe';
import {
  CONTACT,
  FEATURES,
  LOCAL_FIT,
  PLANS,
  PROBLEMS,
  STEPS,
} from '../../core/config/marketing.config';

/**
 * La page d'accueil publique
 * ==================================================================
 * LE PREMIER CONTACT — SOUVENT SUR UN TÉLÉPHONE, EN 4G.
 * ==================================================================
 *
 * L'ORDRE DES SECTIONS EST L'ARGUMENTAIRE :
 *
 *   1. LE PROBLÈME, avant tout le reste. Trois phrases qu'un gérant
 *      de station a déjà prononcées lui-même. Il se reconnaît avant
 *      qu'on lui vende quoi que ce soit — une page qui commence par
 *      « notre plateforme innovante » ne convainc personne.
 *   2. CE QUE FAIT LE PRODUIT, et uniquement ce qui est livré.
 *   3. COMMENT ÇA SE PASSE, en trois temps.
 *   4. POURQUOI ICI — ce qui distingue le produit d'un logiciel
 *      importé et traduit après coup.
 *   5. COMBIEN ÇA COÛTE.
 *
 * ------------------------------------------------------------------
 * CE QUE CETTE PAGE NE FAIT PAS
 *
 * Elle n'appelle aucune API, ne charge aucune donnée, n'affiche aucun
 * chiffre inventé — pas de « 200 stations nous font confiance » quand
 * il y en a zéro. Un témoignage fabriqué se repère, et il coûte plus
 * cher en crédibilité qu'il ne rapporte en conversion.
 *
 * ------------------------------------------------------------------
 * RÉFÉRENCEMENT : CE QUI EST FAIT, ET CE QUI MANQUE
 *
 * Le titre et la description sont posés ici, ce qui suffit au partage
 * d'un lien sur WhatsApp ou Facebook — le canal principal dans la
 * zone visée.
 *
 * En revanche, Angular construit cette page DANS le navigateur : un
 * robot d'indexation qui n'exécute pas le JavaScript ne verra qu'une
 * page vide. Pour un vrai référencement, il faudra un rendu côté
 * serveur (Angular SSR) — c'est une décision de déploiement, elle
 * appartient au lot 22. Mieux vaut le dire que le laisser croire.
 */
@Component({
  selector: 'app-landing-page',
  imports: [RouterLink, AmountPipe],
  templateUrl: './landing.page.html',
  styleUrl: './landing.page.scss',
})
export class LandingPage {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  protected readonly problems = PROBLEMS;
  protected readonly features = FEATURES;
  protected readonly steps = STEPS;
  protected readonly localFit = LOCAL_FIT;
  protected readonly plans = PLANS;
  protected readonly contact = CONTACT;

  /**
   * Tant qu'aucun tarif n'est publié, la section invite à prendre
   * contact plutôt que d'afficher des prix inventés. Voir la note
   * dans marketing.config.ts.
   */
  protected readonly hasPricing = computed(() => this.plans.length > 0);

  /** Le menu déroulant du bandeau, sur téléphone. */
  protected readonly isMenuOpen = signal(false);

  constructor() {
    this.title.setTitle(
      'AUTOCARE OS — Le logiciel des stations de lavage et de detailing',
    );

    // Ce que verront WhatsApp et Facebook quand quelqu'un partagera
    // le lien : c'est par là que passera l'essentiel du trafic.
    this.meta.updateTag({
      name: 'description',
      content:
        'Inspection photo à l\'arrivée, file d\'attente en temps réel, '
        + 'encaissements et caisse. Chaque véhicule tracé de son arrivée '
        + 'à sa restitution. Conçu pour les stations sénégalaises.',
    });
  }

  protected toggleMenu(): void {
    this.isMenuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.isMenuOpen.set(false);
  }
}
