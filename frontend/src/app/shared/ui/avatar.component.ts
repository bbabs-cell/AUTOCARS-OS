import { Component, computed, input } from '@angular/core';

/**
 * Avatar utilisateur
 * ------------------------------------------------------------------
 * <ac-avatar name="Mamadou Diallo" />
 * <ac-avatar name="Aliou Sow" size="lg" [imageUrl]="photo" />
 *
 * À défaut de photo, affiche les initiales. C'est le cas le plus
 * fréquent dans notre contexte : un gérant qui inscrit ses employés
 * un lundi matin ne va pas prendre une photo de chacun.
 */
@Component({
  selector: 'ac-avatar',
  template: `
    <span class="ac-avatar" [class]="sizeClass()" [attr.title]="name()">
      @if (imageUrl()) {
        <img [src]="imageUrl()" [alt]="name()" />
      } @else {
        {{ initials() }}
      }
    </span>
  `,
})
export class AvatarComponent {
  readonly name = input.required<string>();
  readonly imageUrl = input<string | null>(null);
  readonly size = input<'sm' | 'md' | 'lg'>('md');

  protected readonly sizeClass = computed(() =>
    this.size() === 'md' ? '' : `ac-avatar--${this.size()}`,
  );

  /**
   * « Mamadou Diallo » donne « MD », « Aliou » donne « A ».
   * On se limite à deux lettres : au-delà, ça ne tient plus dans le
   * cercle et ça devient illisible.
   */
  protected readonly initials = computed(() =>
    this.name()
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join(''),
  );
}
