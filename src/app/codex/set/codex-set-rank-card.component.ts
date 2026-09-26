import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { toLang } from '../codex.service';
import { ArmorRatingRow, SET_RANK_PROFILES, SetRankAxis, SetRankProfileId, rankSet } from './set-rating';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

/**
 * "Einordnung" for the on-foot set page — mirrors `CodexRankCardComponent`'s
 * look (radar with rings, dashed median polygon, weak-axis marker, verdict
 * line, profile chips, bar list) for the set's fundamentally different
 * cohort shape (set-rating.ts): up to six independently-ranked parts,
 * aggregated per-axis, with real permanent gaps (stealth/activeScan/eva) and
 * "weakest link" axes (heat/cold) that read one limiting part instead of a
 * mean. Purely presentational: `rankSet()` does all the maths, this only
 * draws whatever it returns. `rows` is `null` while the RPC has not answered
 * yet or failed, and `[]` when the set has no armour at all — both render
 * the same honest gap text, never an invented number.
 */
@Component({
  selector: 'sc-codex-set-rank-card',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rank-card sc-card">
      <div class="rank-head">
        <h2>
          <span class="glyph" aria-hidden="true">◈</span>
          {{ 'codex.setRank.header' | translate }}
        </h2>
        @if (result(); as r) {
          <p class="cohort-line">{{ r.cohortKey | translate }}</p>
        }
      </div>

      <div class="profile-row" role="radiogroup" [attr.aria-label]="'codex.setRank.profileLabel' | translate">
        @for (p of profiles; track p.id) {
          <button
            type="button"
            role="radio"
            class="profile-chip"
            [class.active]="profile() === p.id"
            [attr.aria-checked]="profile() === p.id"
            (click)="profile.set(p.id)"
          >
            <span aria-hidden="true">{{ profile() === p.id ? '◈' : '◇' }}</span>
            {{ p.labelKey | translate }}
          </button>
        }
      </div>

      @if (loading()) {
        <div class="rank-skel sc-skel-field" aria-hidden="true"></div>
        <p class="gap-note sr-only">{{ 'codex.setRank.loading' | translate }}</p>
      } @else if (result(); as r) {
        <div class="rank-col-radar">
          <svg
            class="radar"
            viewBox="0 0 200 200"
            role="img"
            [attr.aria-label]="'codex.setRank.radarAria' | translate: { cohort: (r.cohortKey | translate) }"
          >
            <g class="rings" aria-hidden="true">
              @for (ring of rings; track ring) {
                <polygon [attr.points]="ringPoints(ring, r.axes.length)" />
              }
              @for (spoke of spokePoints(r.axes.length); track spoke) {
                <line
                  x1="100" y1="100" [attr.x2]="spoke.x" [attr.y2]="spoke.y"
                  [class.gap-spoke]="r.axes[spoke.i].percentile == null"
                />
              }
            </g>
            <polygon class="median" [attr.points]="medianPolygon(r.axes.length)" />
            @if (setPolygonPoints(); as pts) {
              <polygon class="setpoly" [attr.points]="pts" />
            }
            @for (v of weakVertices(); track v.key) {
              <circle class="weak-axis" [attr.cx]="v.x" [attr.cy]="v.y" r="4" />
            }
            @for (cap of axisCaptions(); track cap.key) {
              <text
                [attr.x]="cap.x" [attr.y]="cap.y" text-anchor="middle"
                [class.gap]="cap.gap"
              >{{ cap.labelKey | translate }}@if (cap.gap) { · –}</text>
            }
          </svg>
          <p class="legend">
            <span class="leg setpoly">— {{ 'codex.setRank.legend.set' | translate }}</span>
            <span class="leg median">·· {{ 'codex.setRank.legend.median' | translate }}</span>
          </p>
        </div>

        <div class="rank-col-bars">
          @if (r.overall != null) {
            <p class="verdict">
              {{ 'codex.setRank.verdict' | translate: { pct: r.overall, band: (r.bandKey! | translate) } }}
            </p>
          } @else {
            <p class="verdict gap">{{ 'codex.kpi.gap' | translate }}</p>
          }
          @if (r.noteKey) {
            <p class="note">{{ r.noteKey | translate: r.noteParams }}</p>
          }
          <ul class="bar-list">
            @for (a of r.axes; track a.key) {
              <li class="bar-row" [class.gap-row]="a.gap">
                <span class="bar-label">{{ a.labelKey | translate }}</span>
                <span class="bar-track">
                  @if (a.percentile != null) {
                    <span class="bar-fill" [class.weak]="a.weak" [style.width.%]="a.percentile"></span>
                  } @else {
                    <span
                      class="bar-gap-hatch"
                      [scTooltip]="a.gapReasonKey ? (a.gapReasonKey | translate) : null"
                      scTooltipTier="label"
                    ></span>
                  }
                </span>
                <span class="bar-value">
                  @if (a.percentile != null) {
                    {{ a.percentile }}%
                  } @else {
                    <span
                      class="gap-dash"
                      [scTooltip]="a.gapReasonKey ? (a.gapReasonKey | translate) : null"
                      scTooltipTier="label"
                      [attr.aria-label]="a.gapReasonKey ? (a.gapReasonKey | translate) : null"
                    >—</span>
                  }
                </span>
              </li>
            }
          </ul>
        </div>
      } @else if (rows()?.length === 0) {
        <!-- An empty set is not a missing value: nothing is equipped yet. -->
        <p class="gap-note">{{ 'codex.setRank.empty' | translate }}</p>
      } @else {
        <p class="gap-note">{{ 'codex.setRank.unavailable' | translate }}</p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .rank-card { padding: 16px 18px; display: grid; grid-template-columns: 210px 1fr; gap: 10px;
      container-type: inline-size; container-name: setrankcard; }
    .rank-head { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 2px; }
    .rank-card:not(:has(.rank-col-radar)) .rank-col-bars,
    .rank-card:not(:has(.rank-col-radar)) .gap-note,
    .rank-card .profile-row { grid-column: 1 / -1; }
    @media (max-width: 560px) {
      .rank-card { grid-template-columns: 1fr; }
    }
    h2 { margin: 0; font-size: max(10.5px, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.14em;
      font-weight: 600; color: var(--sc-accent);
      display: flex; align-items: center; gap: 8px; }
    .glyph { font-size: inherit; letter-spacing: normal; }
    .cohort-line { margin: 0; font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .cohort-line.gap { font-style: italic; }

    .profile-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .profile-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 4px 10px;
      border-radius: 999px; background: var(--sc-bg-2); border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      font: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); cursor: pointer; }
    .profile-chip.active { border-color: var(--sc-accent); color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-2)); }

    .rank-skel { height: 220px; border-radius: 8px; grid-column: 1 / -1; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .gap-note { margin: 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }

    .rank-col-radar { display: flex; flex-direction: column; gap: 8px; }
    .rank-col-bars { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

    .verdict { position: relative; margin: 0; font-size: max(12px, var(--sc-fs-floor)); color: var(--sc-fg-0); }
    .verdict.gap { color: var(--sc-fg-2); font-style: italic; }
    .note { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-warning); font-style: italic; }

    .radar { width: 100%; max-width: 210px; }
    .radar .rings polygon { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 18%, transparent); stroke-width: 1; }
    .radar .rings line { stroke: color-mix(in srgb, var(--sc-accent) 18%, transparent); stroke-width: 1; }
    .radar .rings line.gap-spoke { stroke-dasharray: 2 2; }
    .radar text { font-size: 6px; fill: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.04em; }
    .radar text.gap { fill: color-mix(in srgb, var(--sc-fg-2) 60%, transparent); font-style: italic; }
    .radar .median { fill: none; stroke: var(--sc-fg-2); stroke-width: 1; stroke-dasharray: 3 3; }
    .radar .setpoly { fill: color-mix(in srgb, var(--sc-accent) 22%, transparent); stroke: var(--sc-accent); stroke-width: 1.5; }
    /* Weak axes (low percentile, or heat/cold limited by one part): a
       stroke-only ring like the ship card's weakest-axis marker —
       --sc-warning, not --sc-danger, which CLAUDE.md reserves for errors. */
    .radar .weak-axis { fill: none; stroke: var(--sc-warning); stroke-width: 2; }
    .legend { display: flex; gap: 12px; justify-content: center; margin: 0; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .legend .setpoly { color: var(--sc-accent); }

    .bar-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr;
      gap: 4px 12px; align-content: start; }
    @container setrankcard (min-width: 708px) {
      .bar-list { grid-template-columns: 1fr 1fr; }
    }
    @media (max-width: 520px) {
      .bar-list { grid-template-columns: 1fr; }
    }
    .bar-row { display: grid; grid-template-columns: 74px 1fr 34px; align-items: center; gap: 5px; }
    .bar-label { font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .bar-track { height: 4px; border-radius: 2px; overflow: hidden;
      background: color-mix(in srgb, var(--sc-fg-2) 16%, transparent); }
    .bar-fill { display: block; height: 100%; background: var(--sc-accent);
      transition: width 500ms cubic-bezier(0.2, 0.7, 0.2, 1); }
    .bar-fill.weak { background: var(--sc-warning); }
    /* A gap axis draws NO fill (never a 0-width bar pretending to be a value)
       — a faint diagonal hatch fills the track instead, with the reason as
       its tooltip, so a gap row still reads as "no data" at a glance. */
    .bar-gap-hatch { display: block; height: 100%; width: 100%; cursor: help;
      background: repeating-linear-gradient(45deg,
        color-mix(in srgb, var(--sc-fg-2) 30%, transparent) 0 3px,
        transparent 3px 6px); }
    .bar-value { font-size: max(11px, var(--sc-fs-floor)); text-align: right; color: var(--sc-fg-0);
      font-variant-numeric: tabular-nums; }
    .gap-dash { color: var(--sc-fg-2); cursor: help; }
    @media (prefers-reduced-motion: reduce) {
      .bar-fill { transition: none; }
    }
  `],
})
export class CodexSetRankCardComponent {
  readonly rows = input<ArmorRatingRow[] | null>(null);
  readonly loading = input(false);

  private readonly t = inject(TranslateService);
  private readonly lang = signal(toLang(this.t.getCurrentLang()));

  readonly profile = signal<SetRankProfileId>('cig');
  readonly profiles = SET_RANK_PROFILES;
  readonly rings = [1, 2, 3];

  constructor() {
    const sub = this.t.onLangChange.subscribe((e) => this.lang.set(toLang(e.lang)));
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  /** `null` while loading, while the RPC has not answered, or once it comes
   * back empty (a set with no armour at all) — all three are the same
   * honest gap, never an invented number. */
  readonly result = computed(() => {
    const rows = this.rows();
    if (this.loading() || rows == null || rows.length === 0) return null;
    return rankSet(rows, this.profile(), this.lang());
  });

  readonly axisCaptions = computed(() => {
    const r = this.result();
    if (!r) return [];
    const n = r.axes.length;
    const cx = 100, cy = 100, radius = 92;
    return r.axes.map((a, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return {
        key: a.key,
        labelKey: a.labelKey,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        gap: a.percentile == null,
      };
    });
  });

  readonly setPolygonPoints = computed<string>(() => {
    const r = this.result();
    if (!r) return '';
    const n = r.axes.length;
    const known = r.axes
      .map((a, i) => ({ percentile: a.percentile, i }))
      .filter((v): v is { percentile: number; i: number } => v.percentile != null);
    if (known.length < 3) return '';
    return known.map((v) => this.vertexAt(v.percentile, v.i, n)).join(' ');
  });

  readonly weakVertices = computed<{ key: string; x: number; y: number }[]>(() => {
    const r = this.result();
    if (!r) return [];
    const n = r.axes.length;
    return r.axes
      .map((a: SetRankAxis, i) => ({ a, i }))
      .filter(({ a }) => a.weak && a.percentile != null)
      .map(({ a, i }) => {
        const [x, y] = this.vertexAt(a.percentile!, i, n).split(',').map(Number);
        return { key: a.key, x, y };
      });
  });

  medianPolygon(n: number): string {
    if (n === 0) return '';
    return Array.from({ length: n }, () => 50).map((p, i) => this.vertexAt(p, i, n)).join(' ');
  }

  ringPoints(ring: number, n: number): string {
    if (n === 0) return '';
    const cx = 100, cy = 100, r = 80 * (ring / 3);
    return Array.from({ length: n }, (_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');
  }

  spokePoints(n: number): { i: number; x: number; y: number }[] {
    if (n === 0) return [];
    const cx = 100, cy = 100, r = 80;
    return Array.from({ length: n }, (_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return { i, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  }

  vertexAt(percentile: number, i: number, n: number): string {
    const cx = 100, cy = 100, r = 80;
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const radius = (Math.max(0, Math.min(100, percentile)) / 100) * r;
    return `${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`;
  }
}
