import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import {
  RANK_PROFILES,
  RankProfileId,
  RankResult,
  RankScope,
} from './codex-rank';

/**
 * "Einordnung" — the right half of the masthead (MASTER §3). Purely
 * presentational: every number comes in through `result`, computed by the
 * page from `rankShip()`. `result === null` (and `loading === false`) is the
 * honest gap state for when the cohort has not been fetched yet — never an
 * invented percentile.
 *
 * The cohort fetch (`CodexService.getRankCohort`, batched stock-loadout KPI
 * sheets for every buyable ship of the build, cached per build id) and the
 * `rankShip()` call both live in `codex-detail.component.ts` — this card
 * only renders whatever `RankResult` it is handed, `null` being the honest
 * gap state for "no cohort yet" (still loading, or the fetch failed).
 */
@Component({
  selector: 'sc-codex-rank-card',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rank-card sc-card">
      <div class="rank-head">
        <h2>
          <span class="glyph" aria-hidden="true">◈</span>
          {{ 'codex.rank.header' | translate }}
        </h2>
        @if (result()) {
          <p class="cohort-line">
            @if (scope() === 'sizeClass' && sizeClass() != null) {
              {{ 'codex.rank.nShipsOfSizeClass' | translate: { n: result()!.cohortSize, k: sizeClass() } }}
            } @else if (scope() === 'career') {
              {{ 'codex.rank.nShipsOfCareer' | translate: { n: result()!.cohortSize } }}
            } @else {
              {{ 'codex.rank.nShips' | translate: { n: result()!.cohortSize } }}
            }
          </p>
        } @else {
          <p class="cohort-line gap">{{ 'codex.kpi.gap' | translate }}</p>
        }
      </div>


      @if (ready()) {
        <div class="rank-col-radar">
          <svg class="radar" viewBox="0 0 200 200" [attr.aria-label]="'codex.rank.radarAria' | translate: { name: shipName(), n: result()!.cohortSize }" role="img">
            <g class="rings" aria-hidden="true">
              @for (ring of rings; track ring) {
                <polygon [attr.points]="ringPoints(ring, result()!.axes.length)" />
              }
              @for (spoke of spokePoints(result()!.axes.length); track spoke) {
                <line x1="100" y1="100" [attr.x2]="spoke.x" [attr.y2]="spoke.y" />
              }
            </g>
            <polygon class="median" [attr.points]="polygonPoints(result()!.medianPolygon)" />
            @if (shipPolygonPoints(); as shipPts) {
              <polygon class="ship" [attr.points]="shipPts" />
            }
            @for (cap of axisCaptions(); track cap.key) {
              <text [attr.x]="cap.x" [attr.y]="cap.y" [attr.text-anchor]="'middle'">{{ (cap.gap ? cap.labelKey! : cap.labelKey) | translate }}</text>
            }
          </svg>
          <dl class="sr-only axis-mirror">
            @for (a of result()!.axes; track a.key) {
              <dt>{{ a.labelKey | translate }}</dt>
              <dd>{{ a.percentile != null ? (a.percentile + '%') : ('codex.rank.gapAxis' | translate) }}</dd>
            }
          </dl>
          <p class="legend">
            <span class="leg ship">— {{ 'codex.rank.legend.ship' | translate: { name: shipName() } }}</span>
            <span class="leg median">·· {{ 'codex.rank.legend.median' | translate }}</span>
          </p>
        </div>
      }

      <div class="rank-col-bars">
        @if (loading()) {
          <div class="rank-skel sc-skel-field" aria-hidden="true"></div>
        } @else if (!result()) {
          <p class="gap-note">{{ 'codex.rank.gapAxis' | translate }}</p>
        } @else if (result()!.overall != null) {
            <p class="verdict">
              {{ 'codex.rank.verdict' | translate: { pct: result()!.overall, band: (result()!.bandKey! | translate), n: result()!.cohortSize } }}
              <button
                type="button"
                class="tip"
                [attr.aria-describedby]="'rank-pct-tip'"
              >{{ 'codex.rank.percentile' | translate }} ⓘ</button>
              <span id="rank-pct-tip" class="pct-tip" role="tooltip">{{ 'codex.rank.percentileTooltip' | translate }}</span>
            </p>
        } @else {
          <p class="verdict gap">{{ 'codex.kpi.gap' | translate }}</p>
        }

      <div class="profile-row" role="radiogroup" [attr.aria-label]="'codex.rank.profileLabel' | translate">
        @for (p of profiles; track p.id) {
          <button
            type="button"
            role="radio"
            class="profile-chip"
            [class.active]="profile() === p.id"
            [disabled]="disabledReason(p.id)"
            [attr.aria-checked]="profile() === p.id"
            [attr.aria-describedby]="disabledReason(p.id) ? ('rank-reason-' + p.id) : null"
            [attr.title]="disabledReason(p.id) ? (disabledReason(p.id)! | translate) : (p.labelKey | translate)"
            (click)="profileChange.emit(p.id)"
          >
            <span aria-hidden="true">{{ profile() === p.id ? '◈' : '◇' }}</span>
            {{ p.labelKey | translate }}
          </button>
          @if (disabledReason(p.id)) {
            <span [id]="'rank-reason-' + p.id" class="sr-only">{{ disabledReason(p.id)! | translate }}</span>
          }
        }
        <label class="scope-select">
          <span class="sr-only">{{ 'codex.rank.scopeLabel' | translate }}</span>
          <select [value]="scope()" (change)="onScopeChange($event)">
            <option value="sizeClass" disabled>
              {{ 'codex.rank.scope.sizeClass' | translate }}
            </option>
            <option value="all">{{ 'codex.rank.scope.all' | translate }}</option>
            <option value="career">{{ 'codex.rank.scope.career' | translate }}</option>
          </select>
        </label>
        <span class="scope-hint">{{ 'codex.rank.disabled.noSizeClass' | translate }}</span>
      </div>
        @if (ready()) {
          <ul class="bar-list">
            @for (a of result()!.bars; track a.key) {
              <li class="bar-row">
                <span class="bar-label">{{ a.labelKey | translate }}</span>
                <span class="bar-track">
                  @if (a.percentile != null) {
                    <span class="bar-fill" [class.weak]="a.weak" [style.width.%]="a.percentile"></span>
                  }
                </span>
                <span class="bar-value">
                  @if (a.percentile != null) {
                    {{ a.percentile }}%
                  } @else {
                    <span class="gap-dash" [attr.title]="a.gapKey ? (a.gapKey | translate) : null">—</span>
                  }
                </span>
              </li>
            }
          </ul>
          <p class="lens-note">{{ 'codex.rank.lensNote' | translate }}</p>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    /* container-type makes the card itself the yardstick for the bar list
       inside it. The card is NARROWEST when the viewport is widest — the
       masthead splits 50/50 from 1100px up, so the card is half the shell
       there and the full shell below it. A viewport breakpoint would
       therefore answer the question backwards; only the card's own inline
       size can say whether two bar columns still leave a readable track.
       Column gap is the concept's .8rem (10.4px at the mock's 13px root). */
    .rank-card { padding: 16px 18px; display: grid; grid-template-columns: 210px 1fr; gap: 10px;
      container-type: inline-size; container-name: rankcard; }
    .rank-head { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 2px; }
    .rank-col-radar { display: flex; flex-direction: column; gap: 8px; }
    .rank-col-bars { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    /* Loading and the no-cohort gap draw no radar, so the one remaining column
       takes the whole card instead of leaving a 210px hole beside itself. */
    .rank-card:not(:has(.rank-col-radar)) .rank-col-bars { grid-column: 1 / -1; }
    /* Below 560px the 210px radar column eats more than a third of the card,
       so radar and bars stack instead and each gets the full width. Kept as a
       viewport query: at these sizes the card IS the viewport minus the shell
       padding, so the two measure the same thing. */
    @media (max-width: 560px) {
      .rank-card { grid-template-columns: 1fr; }
    }
    /* Card head type comes straight off the concept's head rule: 10.5px,
       .14em tracking, weight 600 accent caps, with the cohort count beside
       it at 11px in the muted role and no caps of its own. */
    h2 { margin: 0; font-size: max(10.5px, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.14em;
      font-weight: 600; color: var(--sc-accent);
      display: flex; align-items: center; gap: 8px; }
    /* In the concept the diamond is just the first character of the head, so
       it takes the head size; only the tracking is reset so it does not sit
       8px + .14em away from the word. */
    .glyph { font-size: inherit; letter-spacing: normal; }
    .cohort-line { margin: 0; font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .profile-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .profile-chip { display: inline-flex; align-items: center; gap: 5px; min-height: 32px; padding: 4px 10px;
      border-radius: 999px; background: var(--sc-bg-2); border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      font: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); cursor: pointer; }
    .profile-chip.active { border-color: var(--sc-accent); color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 14%, var(--sc-bg-2)); }
    .profile-chip:disabled { opacity: 0.45; cursor: not-allowed; }
    .scope-select { margin-left: auto; }
    .scope-hint { flex-basis: 100%; margin: 0; font-size: max(0.66rem, var(--sc-fs-floor));
      color: var(--sc-fg-2); font-style: italic; }
    .scope-select select { padding: 5px 8px; border-radius: 6px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-1); font: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

    .rank-skel { height: 220px; border-radius: 8px; }
    .gap-note { margin: 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }

    .verdict { position: relative; margin: 0; font-size: max(12px, var(--sc-fs-floor)); color: var(--sc-fg-0); }
    /* The concept sets the percentage itself in a 15px accent b, the rest of
       the line in 12px body text. The app's verdict is ONE translated string
       with the number interpolated into it, so there is no element to hit
       today — this is the rule that b lands on the moment the template (or
       the i18n string, rendered as markup) carries one. */
    .verdict b { font-size: 15px; color: var(--sc-accent); font-variant-numeric: tabular-nums; }
    .verdict.gap { color: var(--sc-fg-2); font-style: italic; }
    .cohort-line.gap { font-style: italic; }
    .tip { margin-left: 4px; cursor: help; color: var(--sc-fg-2); background: none; border: none; padding: 0;
      font: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .tip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pct-tip { position: absolute; display: none; }
    .tip:focus + .pct-tip, .tip:hover + .pct-tip {
      display: block; position: absolute; z-index: 5; max-width: 260px; padding: 8px 10px;
      border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border);
      font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }

    .radar { width: 100%; max-width: 210px; }
    .radar .rings polygon { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 18%, transparent); stroke-width: 1; }
    .radar .rings line { stroke: color-mix(in srgb, var(--sc-accent) 18%, transparent); stroke-width: 1; }
    .radar text { font-size: 6px; fill: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.04em; }
    .radar .median { fill: none; stroke: var(--sc-fg-2); stroke-width: 1; stroke-dasharray: 3 3; }
    .radar .ship { fill: color-mix(in srgb, var(--sc-accent) 22%, transparent); stroke: var(--sc-accent); stroke-width: 1.5; }
    .axis-mirror.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .legend { display: flex; gap: 12px; justify-content: center; margin: 0; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .legend .ship { color: var(--sc-accent); }

    /* ONE column by default. A row spends 74 + 34 + two 5px gaps = 118px on
       label, value and gutters and gives the rest to the track, so the track
       is only as wide as the column it sits in. On the widest desktop the
       card is 604px (1224px of shell content halved with a 16px gap) = 566px
       of content, 346px of that in the bars column: one column leaves a
       228px track, two would leave 114px each — and every step narrower took
       the two-column track towards zero and then overflowed the row. */
    .bar-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr;
      gap: 4px 12px; align-content: start; }
    /* Two columns only once the CARD can pay for them: 708px of card content
       = 210 radar + 10 gap + 2x238 bar columns + 12 gap, and 238 - 118 leaves
       the ~120px track the concept draws (part-02 renders 121px). The card
       reaches that only where the masthead is a single column, i.e. below
       1100px viewport, where the card is the full shell minus its padding. */
    @container rankcard (min-width: 708px) {
      .bar-list { grid-template-columns: 1fr 1fr; }
    }
    /* Floor for the phone and for any engine without container queries — it
       follows the container block, so below 520px it wins outright. */
    @media (max-width: 520px) {
      .bar-list { grid-template-columns: 1fr; }
    }
    .bar-row { display: grid; grid-template-columns: 74px 1fr 34px; align-items: center; gap: 5px; }
    .bar-label { font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    /* The concept's track is a 4px hairline with a 2px radius on a faint
       muted ground (16% of the muted foreground) — not an 8px pill. The fill
       is square-ended; the track's own radius and overflow clip it. */
    .bar-track { height: 4px; border-radius: 2px; overflow: hidden;
      background: color-mix(in srgb, var(--sc-fg-2) 16%, transparent); }
    .bar-fill { display: block; height: 100%; background: var(--sc-accent); }
    .bar-fill.weak { background: var(--sc-danger); }
    .bar-value { font-size: max(11px, var(--sc-fs-floor)); text-align: right; color: var(--sc-fg-0);
      font-variant-numeric: tabular-nums; }
    .gap-dash { color: var(--sc-fg-2); cursor: help; }
    /* The concept's own footnote under the bars: 10px, muted, upright — it is
       a caption, not an aside, so it carries no italic there. */
    .lens-note { margin: 0; font-size: max(10px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
  `],
})
export class CodexRankCardComponent {
  readonly shipName = input.required<string>();
  readonly sizeClass = input<number | null>(null);
  readonly result = input<RankResult | null>(null);
  readonly loading = input(false);

  /** The card has a cohort to draw: radar, bars and the lens note all render. */
  readonly ready = computed(() => !this.loading() && this.result() != null);
  readonly profile = input<RankProfileId>('combat');
  readonly scope = input<RankScope>('sizeClass');
  readonly disabledReasons = input<Partial<Record<RankProfileId, string | null>>>({});

  readonly profileChange = output<RankProfileId>();
  readonly scopeChange = output<RankScope>();

  readonly profiles = RANK_PROFILES;
  readonly rings = [1, 2, 3];

  /**
   * Vertices of the ship's line — ONLY the axes the cohort could actually
   * rank. An axis with no percentile contributes no vertex at all: the line
   * cuts straight across it and the caption on that spoke says
   * `codex.rank.gapAxis`. Substituting the median (let alone a flat 50) would
   * draw a number the data does not have, which is the one thing this page
   * must never do (MASTER §11, R-A29). Below three known axes there is no
   * honest shape left, so the line is dropped and only the bars speak.
   */
  readonly shipPolygonPoints = computed<string>(() => {
    const r = this.result();
    if (!r) return '';
    const n = r.axes.length;
    const known = r.axes
      .map((a, i) => ({ percentile: a.percentile, i }))
      .filter((v): v is { percentile: number; i: number } => v.percentile != null);
    if (known.length < 3) return '';
    return known.map((v) => this.vertexAt(v.percentile, v.i, n)).join(' ');
  });

  /** How many axes the ship's line actually rests on (specs + a11y text). */
  readonly rankedAxisCount = computed<number>(
    () => this.result()?.axes.filter((a) => a.percentile != null).length ?? 0,
  );

  readonly axisCaptions = computed<{ key: string; labelKey: string; x: number; y: number; gap: boolean }[]>(() => {
    const r = this.result();
    if (!r) return [];
    const n = r.axes.length;
    const cx = 100, cy = 100, r2 = 92;
    return r.axes.map((a, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return {
        key: a.key,
        labelKey: a.percentile == null ? 'codex.rank.gapAxis' : a.labelKey,
        x: cx + r2 * Math.cos(angle),
        y: cy + r2 * Math.sin(angle),
        gap: a.percentile == null,
      };
    });
  });

  disabledReason(id: RankProfileId): string | null {
    return this.disabledReasons()[id] ?? null;
  }

  onScopeChange(ev: Event): void {
    this.scopeChange.emit((ev.target as HTMLSelectElement).value as RankScope);
  }

  ringPoints(ring: number, n: number): string {
    if (n === 0) return '';
    const cx = 100, cy = 100, r = 80 * (ring / 3);
    return Array.from({ length: n }, (_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');
  }

  spokePoints(n: number): { x: number; y: number }[] {
    if (n === 0) return [];
    const cx = 100, cy = 100, r = 80;
    return Array.from({ length: n }, (_, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
    });
  }

  /** One `x,y` vertex for axis `i` of `n` at `percentile` (0-100). */
  vertexAt(percentile: number, i: number, n: number): string {
    const cx = 100, cy = 100, r = 80;
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const radius = (Math.max(0, Math.min(100, percentile)) / 100) * r;
    return `${(cx + radius * Math.cos(angle)).toFixed(1)},${(cy + radius * Math.sin(angle)).toFixed(1)}`;
  }

  polygonPoints(percentiles: readonly number[]): string {
    const n = percentiles.length;
    if (n === 0) return '';
    const cx = 100;
    const cy = 100;
    const r = 80;
    return percentiles
      .map((p, i) => {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const radius = (Math.max(0, Math.min(100, p)) / 100) * r;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }
}
