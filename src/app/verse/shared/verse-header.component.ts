import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, effect, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { NavOriginService, PageCrumb } from '../../shared/page-header/nav-origin.service';
import { ShellChromeService } from '../../shell/fusion-bar/shell-chrome.service';
import { FeedbackSpotDirective } from '../../feedback/feedback-spot.directive';
import { ExplorerGlyphComponent } from '../starmap/explorer-glyph.component';
import { BetaService } from '../../core/beta.service';
import { VerseStatusComponent } from './verse-status.component';
import { VerseWorld } from './verse-world';

/**
 * `<sc-verse-header>` — the one page head of the Verse subpages (News,
 * Patches, Galerie, Sternkarte; concept 2026-10-28-verse-unterseiten-struktur
 * §3). One slim line, no boxes, a fixed gap below:
 *
 *   (planet)  PAGE NAME  subtitle ………………………  action │ action │ action
 *
 * STABLE API (wave-2 pages build on it — extend, don't rename):
 *
 *   <sc-verse-header
 *       planet="news" | "patches" | "gallery" | "starmap"   the page's planet from the hub,
 *                                                         a 64px emblem; omitted = no emblem
 *       [title]="..."        the page's ONLY <h1> (small, display font, uppercase)
 *       [subtitle]="..."     one line next to it, ellipsised; wraps under it on phones
 *       [rememberAs]="..."   name later crumbs show for this page (defaults to title)
 *       [trail]="crumbs"     ancestor crumbs (real anchors); shown on phones only — from
 *                            tablet up the shell subheader carries the trail
 *       [eyebrow]="..."      legacy; used as the h1 text when no title is given
 *       [root]="true">       legacy (hub only): no crumbs
 *     <a vhActions ...>…</a>          right-aligned actions/aside row; every direct
 *     <button vhActions ...>…</button>  child gets a fine divider to its left, no boxes
 *   </sc-verse-header>
 *
 * The emblem carries `view-transition-name: verse-emblem`
 * (VERSE_EMBLEM_TRANSITION_NAME): the hub → subpage flight lands the clicked
 * planet here, see `verse-flight.ts`. Exactly one head per page, or the
 * transition aborts on the duplicate name.
 *
 * Shell beta: hands title + trail to the Fusion bar (`publishCrumbs`), the way
 * `<sc-page-header>` does, so the subheader path keeps working. Without the
 * shell beta the slim status instrument joins the actions; while the Verse
 * beta is on, the star-map glyph is the last action (not on the Sternkarte).
 */
@Component({
  selector: 'sc-verse-header',
  standalone: true,
  imports: [RouterLink, TranslatePipe, FeedbackSpotDirective, VerseStatusComponent, ExplorerGlyphComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Not encapsulated: the dividers style the PROJECTED actions. Every rule is scoped under `sc-verse-header`.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './verse-header.component.scss',
  host: { class: 'sc-enter', '[attr.data-planet]': 'planet()' },
  template: `
    @if (crumbs().length) {
      <nav class="vh-crumbs" [attr.aria-label]="'pageHeader.crumbsAria' | translate">
        <ol>
          @for (c of crumbs(); track $index) {
            <li>
              <a class="vh-crumb" [routerLink]="$any(c.link)" [queryParams]="c.queryParams ?? null">{{
                c.label ?? (c.labelKey! | translate: (c.labelParams ?? undefined))
              }}</a>
            </li>
          }
        </ol>
      </nav>
    }
    <div class="vh-row">
      @if (planet(); as p) {
        <span class="vh-emblem" [attr.data-world]="p" aria-hidden="true">
          @if (p === 'starmap') {
            <svg viewBox="0 0 64 64"><polyline points="16,40 26,26 38,30 48,18" /><polyline points="38,30 42,44" />
              <circle cx="16" cy="40" r="1.8" /><circle cx="26" cy="26" r="2.2" /><circle cx="38" cy="30" r="1.8" />
              <circle cx="48" cy="18" r="2.4" /><circle cx="42" cy="44" r="1.6" /></svg>
          }
        </span>
      }
      <div class="vh-line" [scFeedbackSpot]="'feedbackSpot.headline'" [scFeedbackSpotText]="heading()">
        @if (heading(); as h) { <h1 class="vh-title">{{ h }}</h1> }
        @if (subtitle(); as s) { <p class="vh-sub">{{ s }}</p> }
      </div>
      <div class="vh-actions">
        <ng-content select="[vhActions]" />
        @if (!shell()) { <sc-verse-status /> }
        @if (starmap() && planet() !== 'starmap') { <sc-explorer-glyph /> }
      </div>
    </div>
  `,
})
export class VerseHeaderComponent {
  private readonly beta = inject(BetaService);

  readonly planet = input<VerseWorld | null>(null);
  readonly trail = input<readonly PageCrumb[]>([]);
  readonly root = input(false);
  readonly eyebrow = input<string | null>(null);
  readonly title = input<string | null>(null);
  readonly subtitle = input<string | null>(null);
  readonly rememberAs = input<string | null>(null);

  readonly crumbs = computed<readonly PageCrumb[]>(() => (this.root() ? [] : this.trail()));
  /** The one h1: the title, else the legacy eyebrow. */
  readonly heading = computed(() => this.title() ?? this.eyebrow() ?? null);
  readonly starmap = this.beta.isEnabled('verse');
  readonly shell = this.beta.isEnabled('shell');

  constructor() {
    const origin = inject(NavOriginService);
    const router = inject(Router);
    effect(() => {
      const name = this.rememberAs() ?? this.heading();
      if (name) origin.rememberTitle(router.url, name);
    });
    const chrome = inject(ShellChromeService);
    let unpublish: (() => void) | null = null;
    effect(() => {
      unpublish?.();
      unpublish = this.shell()
        ? chrome.publishCrumbs(this, { crumbs: this.crumbs(), title: this.heading() ?? this.rememberAs() ?? null })
        : null;
    });
    inject(DestroyRef).onDestroy(() => unpublish?.());
  }
}
