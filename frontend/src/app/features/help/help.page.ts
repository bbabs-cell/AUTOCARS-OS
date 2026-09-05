import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { PageHeaderComponent } from '../../shared/ui/page-header.component';
import { HELP, HelpSection } from '../../core/config/help.config';

/**
 * L'aide
 * ==================================================================
 * ORGANISÉE PAR REFUS, PAS PAR MENU.
 * ==================================================================
 *
 * Personne n'ouvre l'aide pour apprendre à quoi sert un écran qu'il a
 * sous les yeux. On l'ouvre quand le logiciel a dit NON — et à ce
 * moment-là, une table des matières par module ne sert à rien.
 *
 * Chaque entrée est donc la question qu'on se pose devant le refus,
 * et répond dans l'ordre : ce qui est refusé, POURQUOI, et QUOI FAIRE.
 *
 * ------------------------------------------------------------------
 * TOUT EST DÉPLIÉ, ET C'EST VOLONTAIRE
 *
 * Le réflexe serait un accordéon : vingt-six questions repliées, une
 * seule ouverte à la fois. C'est joli et ça oblige à cliquer vingt-six
 * fois pour savoir si la réponse qu'on cherche est là.
 *
 * Ici tout est visible d'emblée, et la recherche filtre. Le navigateur
 * peut chercher dans la page, et l'impression donne le manuel complet.
 *
 * ------------------------------------------------------------------
 * LES ANCRES SONT PUBLIQUES
 *
 * `/help#restitution-impayee` mène directement à la bonne réponse.
 * C'est ce qui permettra à un message d'erreur d'y renvoyer, plutôt
 * que de déposer l'utilisateur en haut d'une longue page.
 */
@Component({
  selector: 'app-help-page',
  imports: [ReactiveFormsModule, EmptyStateComponent, PageHeaderComponent],
  templateUrl: './help.page.html',
  styleUrl: './help.page.scss',
})
export class HelpPage {
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  protected readonly searchForm = this.formBuilder.nonNullable.group({
    search: [''],
  });

  private readonly search = toSignal(this.searchForm.controls.search.valueChanges, {
    initialValue: '',
  });

  /** L'ancre demandée dans l'URL, pour surligner la bonne réponse. */
  private readonly fragment = toSignal(this.route.fragment, { initialValue: null });

  protected readonly highlighted = computed(() => this.fragment() ?? '');

  /**
   * Les sections filtrées.
   *
   * La recherche porte sur la question ET sur la réponse : quelqu'un
   * qui tape « caisse » cherche tout ce qui parle de caisse, pas
   * seulement les questions dont le titre contient le mot.
   *
   * Une section qui ne garde aucune entrée disparaît : afficher un
   * titre suivi de rien fait croire à un écran cassé.
   */
  protected readonly sections = computed<HelpSection[]>(() => {
    const needle = this.normalize(this.search());

    if (needle === '') {
      return [...HELP];
    }

    return HELP.map((section) => ({
      ...section,
      entries: section.entries.filter((entry) =>
        this.normalize(`${entry.question} ${entry.answer} ${entry.todo}`).includes(needle),
      ),
    })).filter((section) => section.entries.length > 0);
  });

  protected readonly matchCount = computed(() =>
    this.sections().reduce((total, section) => total + section.entries.length, 0),
  );

  protected readonly totalCount = HELP.reduce(
    (total, section) => total + section.entries.length,
    0,
  );

  protected clearSearch(): void {
    this.searchForm.reset({ search: '' });
  }

  /**
   * Comparaison insensible à la casse ET aux accents.
   *
   * Quelqu'un qui tape « rendez vous » ou « RENDEZ-VOUS » cherche la
   * même chose que « rendez-vous ». Une recherche qui exige les
   * accents exacts sur un clavier de téléphone ne trouve rien, et
   * l'utilisateur en conclut que la réponse n'existe pas.
   */
  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }
}
