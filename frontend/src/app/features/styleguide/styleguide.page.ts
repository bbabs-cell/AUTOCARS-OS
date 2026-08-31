import { Component, signal } from '@angular/core';

import { AvatarComponent } from '../../shared/ui/avatar.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { StatCardComponent } from '../../shared/ui/stat-card.component';
import { StatusBadgeComponent } from '../../shared/ui/status-badge.component';
import { OPERATION_STATUS_ORDER } from '../../core/models/operation-status.model';

/**
 * Design system — page de référence
 * ------------------------------------------------------------------
 * CE N'EST PAS UNE PAGE DE DÉMONSTRATION, C'EST UN CONTRAT.
 *
 * Le cahier des charges pose une règle : une fois le design system
 * validé, les couleurs, la typographie, les boutons, les cartes, les
 * rayons et les espacements ne changent plus. Tous les écrans
 * suivants réutilisent ces composants.
 *
 * Pour qu'une telle règle soit tenable, il faut pouvoir vérifier ce
 * qui existe. Cette page sert exactement à ça :
 *
 *   - avant de créer un composant, on vérifie ici s'il existe déjà ;
 *   - après une modification du design system, on regarde cette page
 *     pour voir ce qui a bougé ailleurs ;
 *   - un nouveau développeur y comprend le vocabulaire visuel du
 *     produit en cinq minutes.
 *
 * Elle est écrite avec les VRAIS composants, pas avec des images.
 * Elle ne peut donc jamais se désynchroniser du code.
 */
@Component({
  selector: 'app-styleguide-page',
  imports: [
    AvatarComponent,
    EmptyStateComponent,
    PageHeaderComponent,
    StatCardComponent,
    StatusBadgeComponent,
  ],
  templateUrl: './styleguide.page.html',
  styleUrl: './styleguide.page.scss',
})
export class StyleguidePage {
  /** Les huit statuts métier, dans l'ordre du parcours d'un véhicule. */
  protected readonly statuses = OPERATION_STATUS_ORDER;

  // --- Démonstrations interactives -------------------------------

  protected readonly activeTab = signal('apercu');
  protected readonly isModalOpen = signal(false);
  protected readonly isToastVisible = signal(false);
  protected readonly currentPage = signal(2);

  protected selectTab(tab: string): void {
    this.activeTab.set(tab);
  }

  protected openModal(): void {
    this.isModalOpen.set(true);
  }

  protected closeModal(): void {
    this.isModalOpen.set(false);
  }

  /**
   * Affiche une notification puis la retire au bout de 4 secondes.
   * C'est le comportement que le service de notifications reprendra
   * au Lot 15.
   */
  protected showToast(): void {
    this.isToastVisible.set(true);
    setTimeout(() => this.isToastVisible.set(false), 4000);
  }

  protected goToPage(page: number): void {
    this.currentPage.set(page);
  }

  // --- Données d'exemple ------------------------------------------
  //
  // Volontairement sénégalaises et réalistes : des noms, des plaques
  // et des montants en FCFA plausibles. Une maquette remplie de
  // « Lorem ipsum » et de « John Doe » ne permet pas de juger si
  // l'interface tient avec de vraies données.

  protected readonly demoVehicles = [
    {
      plate: 'DK-1234-AA',
      model: 'Toyota Corolla',
      customer: 'Mamadou Diallo',
      service: 'Lavage premium',
      employee: 'Aliou Sow',
      status: 'WASHING' as const,
      amount: '10 000 FCFA',
    },
    {
      plate: 'DK-5678-BC',
      model: 'Hyundai Tucson',
      customer: 'Fatou Ndiaye',
      service: 'Nettoyage intérieur',
      employee: 'Ousmane Ba',
      status: 'QUALITY_CHECK' as const,
      amount: '7 500 FCFA',
    },
    {
      plate: 'TH-4412-CD',
      model: 'Peugeot 208',
      customer: 'Cheikh Fall',
      service: 'Lavage standard',
      employee: 'Aliou Sow',
      status: 'READY' as const,
      amount: '5 000 FCFA',
    },
    {
      plate: 'DK-9087-DE',
      model: 'Renault Duster',
      customer: 'Aminata Sarr',
      service: 'Detailing complet',
      employee: '—',
      status: 'WAITING' as const,
      amount: '35 000 FCFA',
    },
  ];

  protected readonly palette = [
    { name: 'Primaire', variable: '--ac-primary', hex: '#2563EB', usage: "Actions, liens, éléments actifs" },
    { name: 'Accent', variable: '--ac-accent', hex: '#06B6D4', usage: 'Graphiques secondaires, statut « en lavage »' },
    { name: 'Succès', variable: '--ac-success', hex: '#10B981', usage: 'Pastilles et icônes — les boutons pleins utilisent #047857' },
    { name: 'Avertissement', variable: '--ac-warning', hex: '#F59E0B', usage: 'Contrôle qualité, attention requise' },
    { name: 'Erreur', variable: '--ac-danger', hex: '#EF4444', usage: 'Pastilles et icônes — les boutons pleins utilisent #DC2626' },
    { name: 'Fond', variable: '--ac-background', hex: '#F8FAFC', usage: 'Fond de page' },
    { name: 'Surface', variable: '--ac-surface', hex: '#FFFFFF', usage: 'Cartes, panneaux, tableaux' },
    { name: 'Bordure', variable: '--ac-border', hex: '#E2E8F0', usage: 'Séparations, contours' },
    { name: 'Texte', variable: '--ac-text', hex: '#111827', usage: 'Texte principal' },
    { name: 'Texte secondaire', variable: '--ac-text-secondary', hex: '#475569', usage: 'Libellés, informations de second plan' },
    { name: 'Texte discret', variable: '--ac-text-muted', hex: '#64748B', usage: 'Horodatages, mentions annexes' },
  ];

  protected readonly spacing = [
    { token: '--ac-space-1', px: '4px' },
    { token: '--ac-space-2', px: '8px' },
    { token: '--ac-space-3', px: '12px' },
    { token: '--ac-space-4', px: '16px' },
    { token: '--ac-space-6', px: '24px' },
    { token: '--ac-space-8', px: '32px' },
    { token: '--ac-space-12', px: '48px' },
  ];
}
