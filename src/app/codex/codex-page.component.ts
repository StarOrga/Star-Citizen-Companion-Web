import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { CodexLandingComponent } from './codex-landing.component';
import { CodexBrowseComponent } from './codex-browse.component';
import { PageGlide, holdOnLower, lowerStart, wirePageGlide } from '../shared/page-glide';
import { CODEX_MORE_ANCHOR } from './codex-more-anchor';

/** The two parts of the Codex page: the landing on top and the overview under it ("Mehr in Codex"). */
export type CodexPart = 'top' | 'more';

export const CODEX_TOP_URL = '/codex';
export { CODEX_MORE_ANCHOR };

/**
 * The URL a part keeps in the address bar — always /codex, the lower part as the anchor
 * #more (admin feedback #319: never /codex/index while scrolling); the filters ride along.
 */
export function codexPartUrl(part: CodexPart, search: string): string {
  return CODEX_TOP_URL + search + (part === 'more' ? '#' + CODEX_MORE_ANCHOR : '');
}

/**
 * The Codex page: the landing (stage) on top and the overview with all
 * entities — filter and area tree on the left — as the lower part under it.
 * The way between them is the "Mehr im Verse" mechanism (shared/page-glide.ts):
 * scrolling on from the stage glides into the overview, scrolling up from its
 * top glides back, and the shell docks its subheader there exactly as it does
 * under the Verse hub. One page, one URL: the lower part is the anchor
 * `/codex#more` (the old `/codex/index` links redirect there); opening it lands
 * there, and the anchor follows the scroll without a navigation.
 */
@Component({
  selector: 'sc-codex-page',
  standalone: true,
  imports: [CodexLandingComponent, CodexBrowseComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage">
      <sc-codex-landing />
      <button type="button" class="cx-more-cue" [class.gone]="part() === 'docked'" [attr.aria-hidden]="part() === 'docked' ? 'true' : null"
              [attr.tabindex]="part() === 'docked' ? -1 : null" (click)="toMore()">
        {{ 'codex.page.more' | translate }}<span class="chev" aria-hidden="true"></span>
      </button>
    </div>
    <section #more [id]="anchor" class="more sc-below-stage" [attr.aria-label]="'codex.page.moreAria' | translate">
      <sc-codex-browse [headingLevel]="2" />
    </section>
  `,
  styles: [
    `
      /* The page places its scroll itself (glide, deep-link landing): the browser's scroll
         anchoring must not add its own corrections when the stage above re-measures. */
      :host { display: block; overflow-anchor: none; }
      .stage { position: relative; min-height: 100dvh; }
      .more { scroll-margin-top: calc(var(--sc-bar-h, 56px) + 16px); min-height: calc(100dvh - var(--sc-bar-h, 56px) - 16px); }
      /* "Mehr in Codex": the way down to the overview — the Verse cue (verse-briefing-planet.scss). */
      .cx-more-cue {
        position: absolute; z-index: 6; left: 50%; bottom: calc(var(--sc-footer-h, 80px) + 44px); translate: -50% 0;
        display: flex; flex-direction: column; align-items: center; gap: 4px; min-height: 44px; padding: 4px 12px;
        border: 0; background: none; cursor: pointer;
        font: 500 max(11px, 0.7rem) / 1.3 var(--sc-font-body); letter-spacing: 0.24em; text-transform: uppercase; color: var(--sc-fg-1);
        opacity: clamp(0, 1 - var(--dock, 0) * 2.5, 1); transition: opacity 0.4s ease, visibility 0s;
      }
      .cx-more-cue.gone { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.4s ease, visibility 0s 0.4s; }
      .chev { width: 9px; height: 9px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; rotate: 45deg; margin-top: -3px; transition: color 0.15s ease; }
      .cx-more-cue:hover .chev, .cx-more-cue:focus-visible .chev { color: var(--sc-accent); }
      .cx-more-cue:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 6px; }
      @media (max-width: 900px) { .cx-more-cue { display: none; } }
      @media (prefers-reduced-motion: reduce) { .cx-more-cue { transition: none; } }
    `,
  ],
})
export class CodexPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly zone = inject(NgZone);
  private readonly lower = viewChild.required<ElementRef<HTMLElement>>('more');
  private glide: PageGlide | null = null;
  readonly anchor = CODEX_MORE_ANCHOR;

  /** Where the scroll stands: `top` (landing), `fly` (between), `docked` (overview). */
  readonly part = signal<'top' | 'fly' | 'docked'>('top');
  /** The part the page opened with — `/codex#more` (or an old `/codex/index` link) starts down there. */
  private readonly opened: CodexPart = this.route.snapshot.fragment === CODEX_MORE_ANCHOR ? 'more' : 'top';
  /** True while a deep link to the overview waits for the page to grow tall enough to land on it. */
  private settling = false;

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const g = wirePageGlide(() => this.lower().nativeElement, this.zone, (st) => {
        this.part.set(st);
        // While a deep link is still settling, the landing's state must not drop the #more anchor.
        if (this.settling && st !== 'docked') return;
        this.syncUrl(st);
      });
      this.glide = g;
      destroy.onDestroy(() => g.destroy());
      if (this.opened === 'more') {
        this.settling = true;
        let gone = false;
        const stop = holdOnLower(g, () => lowerStart(this.lower().nativeElement), () => {
          this.settling = false;
          // Leaving the page ends the hold too: then the address bar already belongs to the next page.
          if (!gone) this.syncUrl(this.part() === 'fly' ? 'top' : this.part());
        });
        destroy.onDestroy(() => {
          gone = true;
          stop();
        });
      }
    });
  }

  /** "Mehr in Codex": all the way down to the overview. */
  toMore(): void {
    if (this.glide?.glide(1)) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.lower().nativeElement.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  /**
   * Called by the glide's state: the anchor names the part the reader is in — a
   * replaceState, no router navigation and no new history entry, so nothing re-anchors
   * the scroll (admin feedback #319).
   */
  syncUrl(state: 'top' | 'fly' | 'docked'): void {
    if (state === 'fly') return;
    const want = codexPartUrl(state === 'docked' ? 'more' : 'top', window.location.search);
    if (this.location.path(true) !== want) this.location.replaceState(want, '', this.location.getState());
  }
}
