import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { CodexLandingComponent } from './codex-landing.component';
import { CodexBrowseComponent } from './codex-browse.component';
import { PageGlide, wirePageGlide } from '../shared/page-glide';

/** The two URLs of the Codex page: `/codex` (the landing on top) and `/codex/index` (the overview, "Mehr in Codex"). */
export type CodexPart = 'top' | 'more';

export const CODEX_TOP_URL = '/codex';
export const CODEX_MORE_URL = '/codex/index';

/** The URL a part keeps in the address bar; the filters ride along unchanged. */
export function codexPartUrl(part: CodexPart, search: string): string {
  return (part === 'more' ? CODEX_MORE_URL : CODEX_TOP_URL) + search;
}

/**
 * The Codex page: the landing (stage) on top and the overview with all
 * entities — filter and area tree on the left — as the lower part under it.
 * The way between them is the "Mehr im Verse" mechanism (shared/page-glide.ts):
 * scrolling on from the stage glides into the overview and the shell docks its
 * subheader there exactly as it does under the Verse hub. The lower part has
 * its own URL (`/codex/index`, filters in the query): opening it lands there,
 * and the address bar follows the scroll between the two parts.
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
    <section #more id="codex-more" class="more sc-below-stage" [attr.aria-label]="'codex.page.moreAria' | translate">
      <sc-codex-browse />
    </section>
  `,
  styles: [
    `
      :host { display: block; }
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

  /** Where the scroll stands: `top` (landing), `fly` (between), `docked` (overview). */
  readonly part = signal<'top' | 'fly' | 'docked'>('top');
  /** The part the route opened with — a deep link to the overview starts down there. */
  private readonly opened: CodexPart = this.route.snapshot.data['codexPart'] === 'more' ? 'more' : 'top';

  constructor() {
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const g = wirePageGlide(() => this.lower().nativeElement, this.zone, (st) => {
        this.part.set(st);
        this.syncUrl(st);
      });
      this.glide = g;
      destroy.onDestroy(() => g.destroy());
      if (this.opened === 'more') g.jumpToLower();
    });
  }

  /** "Mehr in Codex": all the way down to the overview. */
  toMore(): void {
    if (this.glide?.glide(1)) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.lower().nativeElement.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  /** Called by the glide's state: the address bar names the part the reader is in (no new history entry). */
  syncUrl(state: 'top' | 'fly' | 'docked'): void {
    if (state === 'fly') return;
    const want = codexPartUrl(state === 'docked' ? 'more' : 'top', window.location.search);
    if (this.location.path() !== want) this.location.replaceState(...splitUrl(want));
  }
}

function splitUrl(url: string): [string, string] {
  const i = url.indexOf('?');
  return i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i + 1)];
}
