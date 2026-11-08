import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { PATH_ICONS } from '../item-path/path-icons';

/** One collected thing in the strip: a news post or a wallpaper. */
export interface SammlungStripItem {
  readonly id: string;
  readonly title: string;
  /** Second line (channel and date); optional. */
  readonly sub?: string | null;
  readonly thumb: string | null;
  readonly link: readonly string[];
  readonly queryParams?: Record<string, string> | null;
  readonly queryParamsHandling?: 'merge' | '';
}

/**
 * `<sc-sammlung-strip>` - the Sammlung pattern inside the News and Galerie pages (concept nachschub-hq r4-d1-s7g / s7n):
 * what the reader collected (news posts; up-voted wallpapers count as collected) as one strip of tiles above the page's own
 * content. Nothing in the page itself changes. A long list scrolls sideways inside the strip, titles clamp to two lines, so
 * neither the strip nor the page grows with the number of things collected.
 */
@Component({
  selector: 'sc-sammlung-strip',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <section class="coll" [attr.aria-label]="ariaLabel()">
        <h3>
          <svg viewBox="0 0 24 24" aria-hidden="true">@for (d of mark; track $index) { <path [attr.d]="d" /> }</svg>
          {{ 'sammlungStrip.title' | translate }} <small>{{ items().length }}</small>
        </h3>
        <ul class="row" [class.wide]="wide()" tabindex="-1">
          @for (it of items(); track it.id) {
            <li>
              <a class="tile" [routerLink]="it.link" [queryParams]="it.queryParams ?? null" [queryParamsHandling]="it.queryParamsHandling ?? ''">
                <span class="thumb">
                  @if (it.thumb) { <img [src]="it.thumb" alt="" loading="lazy" decoding="async" /> }
                  <i class="got" aria-hidden="true"><svg viewBox="0 0 24 24">@for (d of mark; track $index) { <path [attr.d]="d" /> }</svg></i>
                </span>
                <span class="t"><b>{{ it.title }}</b>@if (it.sub) { <small>{{ it.sub }}</small> }</span>
              </a>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; min-width: 0; }
      .coll { padding: 8px 12px 6px; border: 1px solid var(--sc-border); border-radius: 12px; background: color-mix(in srgb, var(--sc-bg-0) 40%, transparent); }
      h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font: 600 0.74rem/1.2 var(--sc-font-display, inherit); letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-accent); }
      h3 svg { width: 16px; height: 16px; fill: color-mix(in srgb, currentColor 28%, transparent); stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      h3 small { font: 500 0.78rem var(--sc-font-body, inherit); letter-spacing: 0; color: var(--sc-fg-2); }
      .row {
        display: grid; grid-auto-flow: column; grid-auto-columns: 148px; gap: 8px; margin: 0; padding: 0 0 8px; list-style: none;
        overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity;
      }
      .row.wide { grid-auto-columns: 252px; }
      .row > li { scroll-snap-align: start; min-width: 0; }
      .tile { display: flex; flex-direction: column; gap: 6px; height: 100%; padding: 6px; border: 1px solid var(--sc-border); border-radius: 10px; color: var(--sc-fg-0); text-decoration: none; background: color-mix(in srgb, var(--sc-bg-1) 80%, transparent); }
      .row.wide .tile { flex-direction: row; align-items: center; }
      .tile:hover, .tile:focus-visible { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 8%, transparent); outline: none; }
      .tile:focus-visible { box-shadow: inset 0 0 0 2px var(--sc-accent); }
      .thumb { position: relative; display: block; flex: none; aspect-ratio: 16 / 9; width: 100%; overflow: hidden; border-radius: 7px; background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
      .row.wide .thumb { width: 84px; }
      .thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .got { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: color-mix(in srgb, var(--sc-bg-0) 80%, transparent); color: var(--sc-accent); }
      .got svg { width: 12px; height: 12px; fill: color-mix(in srgb, currentColor 40%, transparent); stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
      .t { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
      .t b { font-size: 0.8rem; font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
      .t small { font-size: max(0.72rem, var(--sc-fs-floor, 0.75rem)); color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    `,
  ],
})
export class SammlungStripComponent {
  readonly items = input.required<readonly SammlungStripItem[]>();
  readonly ariaLabel = input<string>('');
  /** News tiles sit thumbnail left, title right; wallpaper tiles are image-first. */
  readonly wide = input(false);
  protected readonly mark = PATH_ICONS.sammlung;
}
