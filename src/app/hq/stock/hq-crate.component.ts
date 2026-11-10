import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { averageLabel, rangeLabel } from '../data/hq-quality';
import type { ScrapState } from '../data/scrap-info';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import type { DeckCrate } from './hq-stock-deck';

/** Colour band of a quality mark (frachtdeck3 `.d14-crate .q`): grey below 500 … bright from 950. */
export function qualityTone(q: number | null): 'unknown' | 'low' | 'mid' | 'high' | 'top' {
  if (q === null) return 'unknown';
  if (q >= 950) return 'top';
  if (q >= 700) return 'high';
  if (q >= 500) return 'mid';
  return 'low';
}

/**
 * One Frachtdeck container (I3): the resource box with the average quality mark "Ø Q 780" and the range beside it.
 * Only the reserved share is hatched (I5); hover AND keyboard focus show the word "reserviert", the reserved amount
 * and the exact quality per stack (I4, via `[scTooltip]`). Pieces render as the smaller box with their Codex slot and
 * the scrap state (I18: zerlegbar / nicht zerlegbar / unbekannt in grey, never a guessed yes).
 * A click toggles the selection (I8: highlight, no checkbox) — the host lists `aria-pressed`.
 */
@Component({
  selector: 'sc-hq-crate',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="crate" [class.box]="crate().unit !== 'scu'" [attr.data-tone]="tone()"
            [class.sel]="selected()" [attr.aria-pressed]="selected()" [scTooltip]="tip()" scTooltipTier="info" (click)="chosen.emit()">
      @if (crate().unit === 'scu') {
        <i class="qs" aria-hidden="true"></i>
        <span class="q">{{ avg() ?? ('hq.bestand.deck.qUnknown' | translate) }}</span>
      } @else if (crate().sub) {
        <span class="k">{{ 'hq.bestand.deck.sub.' + crate().sub | translate }}</span>
      }
      @if (crate().reserved > 0) {
        <i class="rh" aria-hidden="true" [style.--rf.%]="reservedShare()"></i>
        <em><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z" /></svg>{{ amount(crate().reserved) }}</em>
      }
      <b class="nm">{{ crate().name }}</b>
      <span class="s mono">{{ amountText() }}@if (range(); as r) { · {{ r }}}</span>
      @if (showPlace()) { <small class="pl">{{ placeLabel() }}</small> }
      @if (crate().unit !== 'scu') {
        <i class="scr" [attr.data-scrap]="scrap()" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></svg>
        </i>
      }
      <span class="sc-sr-only">{{ 'hq.bestand.deck.scrap.' + scrap() | translate }}</span>
    </button>
  `,
  styles: [
    `
      :host { display: block; min-width: 0; }
      .crate { position: relative; display: flex; flex-direction: column; justify-content: flex-end; gap: 1px; width: 100%; height: 100%; min-height: 90px; padding: 24px 9px 7px; border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); border-radius: 4px; overflow: hidden; color: var(--sc-fg); font: inherit; text-align: start; cursor: pointer;
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 14%, transparent), color-mix(in srgb, var(--sc-bg-0) 95%, transparent)), repeating-linear-gradient(90deg, transparent 0 18px, color-mix(in srgb, var(--sc-accent) 5%, transparent) 18px 19px); transition: border-color .15s, box-shadow .15s; }
      .crate.box { justify-content: flex-start; padding: 8px 10px; border-color: var(--sc-border); border-radius: 8px; background: var(--sc-bg-1); }
      .crate:hover { border-color: var(--sc-accent); }
      .crate:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .crate.sel { border-color: var(--sc-accent); box-shadow: 0 0 0 2px var(--sc-accent), 0 0 18px color-mix(in srgb, var(--sc-accent) 45%, transparent); background: color-mix(in srgb, var(--sc-accent) 22%, var(--sc-bg-1)); }
      .crate { --qc: var(--sc-fg-2); }
      .crate[data-tone='unknown'] { --qc: var(--sc-border); }
      .crate[data-tone='low'] { --qc: color-mix(in srgb, var(--sc-fg-2) 70%, var(--sc-bg-1)); }
      .crate[data-tone='mid'] { --qc: color-mix(in srgb, var(--sc-accent) 60%, var(--sc-bg-1)); }
      .crate[data-tone='high'] { --qc: var(--sc-accent); }
      .crate[data-tone='top'] { --qc: color-mix(in srgb, var(--sc-accent) 55%, white); }
      .qs { position: absolute; inset: 0 0 auto; height: 4px; background: var(--qc); }
      .q { position: absolute; left: 8px; top: 8px; padding: 1px 7px; border-radius: 4px; background: var(--qc); color: var(--sc-bg-0); font: 700 0.69rem / 1.4 var(--sc-font-display, inherit); }
      .crate[data-tone='unknown'] .q { color: var(--sc-fg-1); font-weight: 500; }
      .rh { position: absolute; left: 0; top: 4px; bottom: 0; width: var(--rf); background: repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in srgb, var(--sc-accent) 22%, transparent) 6px 9px); border-right: 1px dashed color-mix(in srgb, var(--sc-accent) 60%, transparent); pointer-events: none; }
      em { position: absolute; right: 7px; top: 9px; display: inline-flex; align-items: center; gap: 3px; color: var(--sc-accent); font-style: normal; font-size: 0.66rem; }
      em svg, .scr svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .box em { top: auto; bottom: 7px; }
      .k { color: var(--sc-fg-2); font-size: 0.6rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: calc(100% - 16px); letter-spacing: .12em; text-transform: uppercase; }
      .nm { font-size: 0.78rem; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; padding-right: 16px; position: relative; }
      .s { color: var(--sc-fg-1); font-size: 0.69rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: relative; }
      .box .s { color: var(--sc-accent); font-weight: 700; }
      .pl { color: var(--sc-fg-2); font-size: 0.66rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; position: relative; }
      .scr { position: absolute; right: 8px; top: 8px; }
      .scr[data-scrap='yes'] { color: var(--sc-success, var(--sc-accent)); }
      .scr[data-scrap='no'] { color: var(--sc-warning); }
      .scr[data-scrap='unknown'] { color: var(--sc-fg-2); opacity: .55; }
      @media (prefers-reduced-motion: reduce) { .crate { transition: none; } }
    `,
  ],
})
export class HqCrateComponent {
  private readonly tr = inject(TranslateService);
  readonly crate = input.required<DeckCrate>();
  readonly selected = input(false);
  readonly showPlace = input(true);
  readonly placeLabel = input('');
  readonly scrap = input<ScrapState>('unknown');
  /** Friend id → display name for the reservation hover. */
  readonly friendName = input<(id: string) => string | null>(() => null);
  readonly chosen = output<void>();

  protected readonly avg = computed(() => averageLabel(this.crate()));
  protected readonly range = computed(() => (this.crate().unit === 'scu' && this.crate().min !== this.crate().max ? rangeLabel(this.crate()) : null));
  protected readonly tone = computed(() => qualityTone(this.crate().avg));
  protected readonly reservedShare = computed(() => {
    const c = this.crate();
    return c.qty > 0 ? Math.min(100, Math.round((c.reserved / c.qty) * 100)) : 0;
  });

  protected amount(n: number): string {
    const v = n.toLocaleString(this.tr.getCurrentLang() || undefined, { maximumFractionDigits: 3 });
    return this.crate().unit === 'scu' ? `${v} SCU` : `×${v}`;
  }

  protected readonly amountText = computed(() => this.amount(this.crate().qty));

  /** "Eisen · Area18 — Q 940: 5 SCU, 4 reserviert (Kaelis) · Q 620: 6 SCU · Qualität unbekannt: 4 SCU" (I4). */
  protected readonly tip = computed(() => {
    const c = this.crate();
    const parts: string[] = [`${c.name} · ${this.placeLabel()}`];
    for (const s of c.stacks) {
      const q = s.quality === null ? this.tr.instant('hq.bestand.deck.qUnknownLong') : `Q ${s.quality}`;
      let line = `${q}: ${this.amount(s.qty)}`;
      if (s.reserved > 0) line += `, ${this.tr.instant('hq.bestand.deck.reservedN', { n: this.amount(s.reserved) })}${this.who(s.reservations)}`;
      parts.push(line);
    }
    const anyRes = c.anyReservations.reduce((n, r) => n + r.amount, 0);
    if (anyRes > 0) parts.push(`${this.tr.instant('hq.bestand.deck.reservedAny', { n: this.amount(anyRes) })}${this.who(c.anyReservations)}`);
    parts.push(this.tr.instant('hq.bestand.deck.scrap.' + this.scrap()));
    return parts.join(' · ');
  });

  private who(list: readonly { note: string; friendId?: string | null }[]): string {
    const names = list.map((r) => (r.friendId ? this.friendName()(r.friendId) : null) ?? r.note).filter((x) => !!x);
    return names.length ? ` (${names.join(', ')})` : '';
  }
}
