import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { PatchStabilityVotesService } from './patch-stability-votes.service';
import { TREND_GLYPH, StabilityVerdict, TREND_THRESHOLD, stabilityTrend, stabilityWord } from './patch-stability';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';

/** Everything a chip needs to say, independent of where the number came from (LIVE verdict or test-channel build). */
export interface StabilityChipData {
  /** Patch line the chip leads to (`/verse/patches/<line>#stabilitaet`); null = no link target. */
  line: string | null;
  /** The computed stability S, 0…100; null = too little data. A `live` chip adds the community correction itself. */
  percent: number | null;
  /** Younger than EARLY_DAYS: dashed, no indicator. */
  early: boolean;
  /** Superseded patch: plain chip, no indicator. */
  finished: boolean;
  /** The previous comparable value and its label ("4.3.1", "4.3 PTU"); either null = no comparison. */
  previous: number | null;
  previousLabel: string | null;
}

export function chipFromVerdict(
  v: StabilityVerdict | null,
  o: { previous?: number | null; previousLabel?: string | null; finished?: boolean } = {},
): StabilityChipData | null {
  if (!v) return null;
  return {
    line: v.line,
    percent: v.insufficient ? null : v.stability,
    early: v.early,
    finished: o.finished ?? false,
    previous: o.previous ?? null,
    previousLabel: o.previousLabel ?? null,
  };
}

/**
 * The one short form of the stability: `[▲/▼/≈] Wort NN %`, outlined or filled
 * in the scale's colour (stabil green, wackelig warning outline, instabil
 * warning filled — never red). The indicator is the trend against the previous
 * comparable patch; it is left out while the reading is provisional (dashed
 * border), on a finished patch, and when there is too little data (grey, no %).
 *
 * `live` marks THE current LIVE value: the chip then adds the community
 * correction from {@link PatchStabilityVotesService} and asks it to load that
 * line. Without votes (RPC unreachable, too few) it just shows the computed number.
 *
 * `linked=false` renders a span for places that already sit inside an anchor.
 */
@Component({
  selector: 'sc-stability-chip',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      @let tip = tipParts();
      @let text = (tip.word ? ((('stability.word.' + tip.word) | translate) + ' · ' + tip.n + ' %') : ('stability.tip.noData' | translate))
        + (tip.compareKey ? ' — ' + (tip.compareKey | translate: tip.compareParams) : '')
        + (tip.communityParams ? ' · ' + ('stability.tip.community' | translate: tip.communityParams) : '')
        + (tip.early ? ' · ' + ('stability.tip.early' | translate) : '')
        + (v.link ? ' · ' + ('stability.tip.open' | translate) : '');
      @if (v.link) {
        <a class="chip" [routerLink]="['/verse/patches', v.line]" fragment="stabilitaet"
           [attr.data-word]="v.word" [attr.data-size]="size()" [class.early]="v.early" [class.finished]="v.finished" [class.nodata]="v.word === null"
           [scTooltip]="text" [attr.aria-label]="text">
          <ng-container *ngTemplateOutlet="body; context: { $implicit: v }" />
        </a>
      } @else {
        <span class="chip" tabindex="0"
              [attr.data-word]="v.word" [attr.data-size]="size()" [class.early]="v.early" [class.finished]="v.finished" [class.nodata]="v.word === null"
              [scTooltip]="text" [attr.aria-label]="text">
          <ng-container *ngTemplateOutlet="body; context: { $implicit: v }" />
        </span>
      }
    }
    <ng-template #body let-v>
      @if (v.word === null) {
        <span class="w">{{ 'stability.noData' | translate }}</span>
      } @else {
        @if (v.glyph) { <span class="ind" aria-hidden="true">{{ v.glyph }}</span> }
        <span class="w">{{ ('stability.word.' + v.word) | translate }}</span>
        <span class="pct">{{ v.percent }} %</span>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: inline-flex; }
    .chip {
      --c: var(--sc-success);
      display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box;
      padding: 1px 9px; border-radius: 999px; white-space: nowrap; text-decoration: none;
      font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 700; letter-spacing: 0.02em;
      color: var(--c); border: 1px solid color-mix(in srgb, var(--c) 65%, transparent);
    }
    .chip[data-size='lg'] { padding: 5px 15px; gap: 8px; font-size: max(1.05rem, var(--sc-fs-floor)); }
    .chip[data-word='wackelig'] { --c: var(--sc-warning); }
    .chip[data-word='instabil'] { --c: var(--sc-warning); background: var(--sc-warning); color: var(--sc-bg-0); border-color: var(--sc-warning); }
    .chip.nodata { --c: var(--sc-fg-2); font-weight: 500; border-color: color-mix(in srgb, var(--sc-fg-2) 45%, transparent); }
    .chip.early { border-style: dashed; }
    .pct { font-variant-numeric: tabular-nums; }
    .ind { font-size: 0.82em; line-height: 1; }
    a.chip:hover { background: color-mix(in srgb, var(--c) 14%, transparent); }
    a.chip[data-word='instabil']:hover { background: color-mix(in srgb, var(--sc-warning) 82%, var(--sc-fg-0)); }
    .chip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    /* Touch: the pill keeps its look, the hit area grows to the tap minimum. */
    @media (pointer: coarse) {
      .chip { min-height: var(--sc-tap-min); }
    }
  `],
})
export class StabilityChipComponent {
  private readonly votes = inject(PatchStabilityVotesService);

  readonly data = input<StabilityChipData | null>(null);
  readonly size = input<'sm' | 'lg'>('sm');
  readonly linked = input(true);
  /** This chip shows the current LIVE value — add the community correction. */
  readonly live = input(false);

  private readonly loadVotes = effect(() => {
    const d = this.data();
    if (this.live() && d?.line && d.percent !== null) untracked(() => this.votes.ensure(d.line as string));
  });

  /** Points the community verdict added (0 when none / not live / not loaded). */
  readonly community = computed(() => {
    const d = this.data();
    if (!this.live() || !d || d.percent === null || d.line === null || this.votes.line() !== d.line) return 0;
    return this.votes.correctionFor(d.percent)?.correction ?? 0;
  });

  /** The shown number: S + community correction, clamped to 0…100. */
  readonly shown = computed(() => {
    const d = this.data();
    if (!d || d.percent === null) return null;
    return Math.min(100, Math.max(0, Math.round(d.percent + this.community())));
  });

  readonly view = computed(() => {
    const d = this.data();
    if (!d) return null;
    const percent = this.shown();
    const word = stabilityWord(percent);
    const trend = d.early || d.finished ? null : stabilityTrend(percent, d.previous);
    return {
      line: d.line,
      word,
      percent,
      early: d.early && word !== null,
      finished: d.finished && word !== null,
      glyph: trend ? TREND_GLYPH[trend] : null,
      link: this.linked() && d.line !== null,
    };
  });

  readonly tipParts = computed(() => {
    const d = this.data();
    const n = this.shown();
    const word = stabilityWord(n);
    if (!d || word === null) return { word: null, n: 0, compareKey: null, compareParams: {}, communityParams: null, early: false };
    const diff = d.previous !== null && n !== null ? Math.round(n - d.previous) : null;
    const compareKey = diff === null || d.previousLabel === null ? null
      : Math.abs(diff) < TREND_THRESHOLD ? 'stability.tip.same' : diff > 0 ? 'stability.tip.better' : 'stability.tip.worse';
    const c = this.community();
    return {
      word,
      n,
      compareKey,
      compareParams: { d: diff === null ? 0 : Math.abs(diff), prev: d.previousLabel, p: d.previous === null ? 0 : Math.round(d.previous) },
      communityParams: c === 0 ? null : { c: (c > 0 ? '+' : '−') + Math.abs(c) },
      early: d.early,
    };
  });
}
