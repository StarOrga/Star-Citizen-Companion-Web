import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Filmstrip } from './codex-landing-data.types';

export type FilmstripMode = 'ready' | 'announced';

/** Query params of the "+ N weitere" link into the Codex index (contract FilmstripMoreQuery). */
export const FILMSTRIP_MORE_QUERY = { kind: 'ship', sort: 'new' } as const;

/**
 * Filmstrip of the Codex landing (round 6): one segmented toggle
 * "Neu & flight-ready" / "Angekündigt", newest first, every tile a real
 * anchor, the last one "+ N weitere" into the Codex index / upcoming list.
 */
@Component({
  selector: 'sc-codex-landing-filmstrip',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toggle" role="group" [attr.aria-label]="'codex.landing.film.label' | translate" [class.right]="mode() === 'announced'">
      <button type="button" [class.on]="mode() === 'ready'" [attr.aria-pressed]="mode() === 'ready'" (click)="mode.set('ready')">
        {{ 'codex.landing.film.newReady' | translate }}
      </button>
      <button type="button" [class.on]="mode() === 'announced'" [attr.aria-pressed]="mode() === 'announced'" (click)="mode.set('announced')">
        {{ 'codex.landing.film.announced' | translate }}
      </button>
    </div>
    <div class="strip" role="list">
      @if (strip(); as s) {
        @for (t of s.tiles; track t.id) {
          <a role="listitem" class="fcard" [class.on]="t.id === activeId()" [routerLink]="t.route">
            <b>{{ t.name }}</b>
            @if (t.isNew) { <em>{{ 'codex.landing.film.isNew' | translate }}</em> }
            @else if (t.manufacturer) { <span>{{ t.manufacturer }}</span> }
          </a>
        } @empty {
          <p class="empty">{{ 'codex.landing.film.empty' | translate }}</p>
        }
        @if (s.more > 0) {
          @if (mode() === 'ready') {
            <a role="listitem" class="fcard rest" routerLink="/codex/index" [queryParams]="moreQuery">
              <b>{{ 'codex.landing.film.more' | translate: { count: s.more } }}</b><span>{{ 'codex.landing.film.moreReady' | translate }}</span>
            </a>
          } @else {
            <a role="listitem" class="fcard rest" routerLink="/codex/upcoming">
              <b>{{ 'codex.landing.film.more' | translate: { count: s.more } }}</b><span>{{ 'codex.landing.film.moreAnnounced' | translate }}</span>
            </a>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      :host { display: flex; align-items: center; gap: 14px; min-width: 0; }
      .toggle {
        position: relative; flex: 0 0 auto; display: inline-grid; grid-template-columns: 1fr 1fr;
        padding: 3px; border-radius: 999px; border: 1px solid var(--sc-border); background: rgba(8, 19, 28, 0.82);
      }
      .toggle::before {
        content: ''; position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc(50% - 3px); border-radius: 999px;
        background: rgba(82, 193, 230, 0.18); box-shadow: inset 0 0 0 1px var(--sc-accent);
        transition: transform 0.22s ease;
      }
      .toggle.right::before { transform: translateX(100%); }
      .toggle button {
        position: relative; min-height: 32px; padding: 0 14px; border: 0; background: none; cursor: pointer;
        font: inherit; font-size: 12px; color: var(--sc-fg-2); white-space: nowrap; text-align: center;
      }
      .toggle button.on { color: var(--sc-fg-0); }
      .toggle button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; border-radius: 999px; }
      .strip { flex: 1; min-width: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 8px; overflow: hidden; }
      .fcard {
        display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 32px; padding: 6px 10px;
        border: 1px solid var(--sc-border); border-radius: 5px; background: rgba(13, 38, 53, 0.75);
        color: var(--sc-fg-0); text-decoration: none;
      }
      .fcard:hover, .fcard:focus-visible { border-color: color-mix(in srgb, var(--sc-accent) 60%, var(--sc-border)); }
      .fcard:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .fcard.on { border-color: var(--sc-accent); box-shadow: 0 0 0 1px var(--sc-accent) inset; }
      .fcard.rest { border-style: dashed; }
      /* Two lines: variants of one hull ("RSI Constellation Mk IV Andromeda / Taurus")
         only differ at the end, which a one-line ellipsis cut off. */
      .fcard b {
        min-width: 0; font-size: 12px; font-weight: 600; line-height: 1.2; overflow: hidden;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere;
      }
      .fcard span { flex: 0 1 auto; min-width: 0; font-size: 11px; color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .fcard em {
        flex: 0 0 auto; padding: 0 5px; border-radius: 999px; border: 1px solid rgba(82, 193, 230, 0.6);
        font: 600 8px / 12px var(--sc-font-display); font-style: normal; letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-accent);
      }
      .empty { margin: 0; font-size: 12px; color: var(--sc-fg-2); }
      @media (prefers-reduced-motion: reduce) { .toggle::before { transition: none; } }
      /* Up to ~1100px only the first tiles fit: the strip shows whole tiles, never half ones. */
      @media (max-width: 1279px) { .strip { grid-auto-columns: minmax(140px, 1fr); } }
      @media (max-width: 720px) {
        :host { flex-direction: column; align-items: stretch; gap: 8px; }
        .toggle { align-self: flex-start; }
        .strip { grid-auto-columns: 42%; overflow-x: auto; scrollbar-width: none; }
      }
    `,
  ],
})
export class CodexLandingFilmstripComponent {
  readonly ready = input<Filmstrip | null>(null);
  readonly announced = input<Filmstrip | null>(null);
  readonly mode = model<FilmstripMode>('ready');
  /** Tile id of the item on the holotable (marked). */
  readonly activeId = input<string | null>(null);
  protected readonly moreQuery = FILMSTRIP_MORE_QUERY;

  readonly strip = computed(() => (this.mode() === 'ready' ? this.ready() : this.announced()));
}
