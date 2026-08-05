import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import type { PatchLineGroup } from './patch-notes';
import {
  PatchForecastRow,
  PatchKpi,
  PatchKpiPoint,
  computePatchForecast,
  computePatchStats,
  kpiDelta,
  pointPct,
} from './patch-stats';

/** How long one slide stays on screen before the panel moves on. */
const ROTATE_MS = 7000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The carousel window: the recent six months, or the whole feed. */
type CadenceWindow = '6m' | 'all';

/** A carousel slide is either one of the duration charts or the forecast panel. */
type Slide =
  | { kind: 'kpi'; kpi: PatchKpi }
  | { kind: 'forecast'; rows: readonly PatchForecastRow[] };

/**
 * Patch-cadence panel (feedback 44e90e30, follow-up; window + forecast follow-up).
 *
 * "Cool wäre auch wenn die Historie der Patch Notes sich alle x Sekunden
 * abwechselt mit ein bis 3 Grafiken und/oder KPIs, die zeigen wie aktuell die
 * Patch-Performance ist von CIG."
 *
 * Three small charts, one at a time, each pairing the newest measurement with
 * the MEDIAN (9c000427 — release intervals are right-skewed, so a mean would be
 * dragged up by one delayed release and every normal patch would read as "faster
 * than average" forever; see patch-stats.ts). Hand-rolled bars on the existing
 * tokens — this repo has no charting dependency on purpose, and the Fortschritt
 * dashboard sets the precedent for that.
 *
 * ## The window toggle
 *
 * The panel defaults to the last six months and toggles to all-time; the switch
 * lives in the header, so it stays reachable on every slide. It is STRICT — no
 * minimum-sample fallback — so a rare KPI like the major-line cadence can be
 * pruned to nothing inside six months and reappear on all-time. Both the bars
 * AND the median move with the toggle (the yardstick is only honest against the
 * same period it summarises).
 *
 * ## The forecast slide
 *
 * A fourth slide reads the median cadences forward: the next PTU, the next LIVE
 * patch, the next sub-patch, and — only while a build is actually in the PTU —
 * the next PTU sub-patch. Estimates, never promises; a date already past is
 * shown as overdue. It obeys the same window as the charts.
 *
 * Rotation etiquette:
 * - `prefers-reduced-motion: reduce` disables the auto-advance completely; the
 *   dots stay, so the content is all still reachable, just never on its own.
 * - Hovering or tab-focusing the panel holds the current slide.
 * - Picking a dot stops the carousel for good; the play button hands it back.
 * - Nothing here grabs focus. The panel is a labelled region, not a live region.
 */
@Component({
  selector: 'sc-patch-cadence',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasContent()) {
      <section class="cadence" [attr.aria-label]="'news.patch.kpi.title' | translate"
               (mouseenter)="hovered.set(true)" (mouseleave)="hovered.set(false)"
               (focusin)="focused.set(true)" (focusout)="focused.set(false)">
        <header class="cad-head">
          <h3>{{ 'news.patch.kpi.title' | translate }}</h3>
          <span class="cad-sub">{{ 'news.patch.kpi.sub' | translate }}</span>
          <div class="cad-controls">
            <!-- Dots whenever there is more than one slide — including under
                 reduced motion, where they are the ONLY way to reach the others. -->
            @if (hasSlides()) {
              @for (s of slides(); track slideKey(s); let i = $index) {
                <button type="button" class="dot" [class.on]="i === index()"
                        [attr.aria-pressed]="i === index()"
                        [attr.aria-label]="'news.patch.kpi.goto' | translate:{ title: slideTitle(s) }"
                        [attr.title]="slideTitle(s)"
                        (click)="show(i)"></button>
              }
            }
            <!-- Pause/resume only where something actually auto-advances. -->
            @if (canAutoRotate()) {
              <button type="button" class="cad-play"
                      [attr.aria-pressed]="paused()"
                      [attr.aria-label]="(paused() ? 'news.patch.kpi.play' : 'news.patch.kpi.pause') | translate"
                      [attr.title]="(paused() ? 'news.patch.kpi.play' : 'news.patch.kpi.pause') | translate"
                      (click)="togglePause()">{{ paused() ? '▶' : '❚❚' }}</button>
            }
            <!-- Window toggle: always here, so it is reachable on every slide. -->
            <div class="win" role="group" [attr.aria-label]="'news.patch.kpi.window.aria' | translate">
              <button type="button" class="win-opt" [class.on]="window() === '6m'"
                      [attr.aria-pressed]="window() === '6m'"
                      (click)="setWindow('6m')">{{ 'news.patch.kpi.window.6m' | translate }}</button>
              <button type="button" class="win-opt" [class.on]="window() === 'all'"
                      [attr.aria-pressed]="window() === 'all'"
                      (click)="setWindow('all')">{{ 'news.patch.kpi.window.all' | translate }}</button>
            </div>
          </div>
        </header>

        @if (current(); as slide) {
          <!-- Keyed by slide so the element is replaced on every switch and the
               fade replays (a no-op under reduced motion). -->
          @for (s of [slide]; track slideKey(s)) {
            @switch (s.kind) {
              @case ('kpi') {
                <article class="slide">
                  <div class="figures">
                    <h4 class="kpi-title">{{ slideTitle(s) }}</h4>
                    <p class="kpi-sub">{{ subOf(s.kpi) }}</p>
                    <p class="kpi-now">
                      <strong>{{ num(s.kpi.latest) }}</strong>
                      <span class="unit">{{ 'news.patch.kpi.unit.days' | translate }}</span>
                    </p>
                    <p class="kpi-delta" [class.good]="deltaTone(s.kpi) === 'good'" [class.bad]="deltaTone(s.kpi) === 'bad'">
                      {{ deltaLabel(s.kpi) }}
                    </p>
                    <dl class="kpi-avg">
                      <dt>{{ 'news.patch.kpi.median' | translate }}</dt>
                      <dd>{{ num(s.kpi.median) }} {{ 'news.patch.kpi.unit.days' | translate }}</dd>
                      <dt>{{ 'news.patch.kpi.samplesLabel' | translate }}</dt>
                      <dd>{{ 'news.patch.kpi.samples' | translate:{ n: s.kpi.samples } }}</dd>
                    </dl>
                  </div>

                  <div class="chart-wrap">
                    <div class="chart" role="img" [attr.aria-label]="chartAria(s.kpi)">
                      <span class="avg-rule" [style.bottom.%]="medianPct(s.kpi)" aria-hidden="true"></span>
                      @for (p of s.kpi.points; track $index; let last = $last) {
                        <span class="col" [class.now]="last" [attr.title]="pointTitle(p)">
                          <span class="col-bar" [style.height.%]="barPct(s.kpi, p)"></span>
                        </span>
                      }
                    </div>
                    <div class="chart-axis" aria-hidden="true">
                      <span>{{ axisFrom(s.kpi) }}</span>
                      <span>{{ axisTo(s.kpi) }}</span>
                    </div>
                  </div>
                </article>
              }
              @case ('forecast') {
                <article class="slide forecast">
                  <div class="figures">
                    <h4 class="kpi-title">{{ 'news.patch.forecast.title' | translate }}</h4>
                    <p class="kpi-sub">{{ 'news.patch.forecast.sub' | translate }}</p>
                  </div>
                  <ul class="fc-list">
                    @for (row of s.rows; track row.key) {
                      <li class="fc-row" [class.overdue]="isOverdue(row)">
                        <span class="fc-label">{{ ('news.patch.forecast.row.' + row.key) | translate }}</span>
                        <span class="fc-when">
                          <strong>{{ formatDate(row.at) }}</strong>
                          <span class="fc-rel">{{ untilLabel(row) }}</span>
                        </span>
                        <span class="fc-basis">{{ 'news.patch.forecast.basis' | translate:{ version: row.basis, median: num(row.medianDays), n: row.samples } }}</span>
                      </li>
                    }
                  </ul>
                </article>
              }
            }
          }
        } @else {
          <!-- The active window emptied every chart AND the forecast. The header
               (with the toggle) stays, so all-time is one click away. -->
          <p class="cad-empty">{{ 'news.patch.kpi.window.empty' | translate }}</p>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }

    .cadence {
      display: flex; flex-direction: column; gap: 10px;
      padding: 12px 14px;
      border: 1px solid var(--sc-border); border-radius: 8px;
      background: var(--sc-bg-1);
    }
    .cad-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .cad-head h3 {
      margin: 0; font-size: max(0.78rem, var(--sc-fs-floor)); letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sc-accent);
    }
    .cad-sub { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .cad-controls { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; flex-wrap: wrap; }
    /* Dots keep a full tap target while staying visually small. */
    .dot {
      position: relative; width: 10px; height: 10px; padding: 0;
      border-radius: 50%; cursor: pointer;
      border: 1px solid color-mix(in srgb, var(--sc-fg-2) 60%, transparent);
      background: transparent;
    }
    .dot::after {
      content: ''; position: absolute; left: 50%; top: 50%;
      width: var(--sc-tap-min); height: var(--sc-tap-min);
      transform: translate(-50%, -50%);
    }
    .dot.on { background: var(--sc-accent); border-color: var(--sc-accent); }
    .dot:hover { border-color: var(--sc-accent); }
    .dot:focus-visible, .cad-play:focus-visible, .win-opt:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .cad-play {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: var(--sc-tap-min); min-height: var(--sc-tap-min);
      padding: 0 6px; border-radius: 6px;
      background: transparent; border: 1px solid transparent; color: var(--sc-fg-2);
      font-family: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); line-height: 1; cursor: pointer;
    }
    .cad-play:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    /* Two-state window toggle, same grammar as the section's filter chips. */
    .win { display: inline-flex; align-items: center; gap: 2px; margin-left: 4px; }
    .win-opt {
      min-height: var(--sc-tap-min); padding: 3px 9px;
      border: 1px solid var(--sc-border); background: transparent;
      color: var(--sc-fg-2); font-family: inherit;
      font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0.04em;
      cursor: pointer; transition: all 0.16s;
    }
    .win-opt:first-child { border-radius: 999px 0 0 999px; }
    .win-opt:last-child { border-radius: 0 999px 999px 0; }
    .win-opt:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .win-opt.on {
      background: color-mix(in srgb, var(--sc-accent) 18%, transparent);
      border-color: var(--sc-accent); color: var(--sc-fg-0); font-weight: 600;
    }

    /* A fixed floor keeps the page from jumping as the slides swap. */
    .slide {
      display: grid; gap: 14px; align-items: end;
      grid-template-columns: minmax(0, 1fr);
      min-height: 150px;
      animation: cad-in 0.32s ease;
    }
    @media (min-width: 620px) { .slide { grid-template-columns: minmax(150px, 0.8fr) minmax(0, 1.4fr); } }
    @keyframes cad-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    .figures { display: flex; flex-direction: column; gap: 2px; align-self: start; min-width: 0; }
    .kpi-title { margin: 0; font-family: var(--sc-font-display); font-size: 0.94rem; letter-spacing: 0.03em; }
    .kpi-sub { margin: 0; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .kpi-now { display: flex; align-items: baseline; gap: 6px; margin: 6px 0 0; }
    .kpi-now strong {
      font-family: var(--sc-font-display); font-size: 1.9rem; line-height: 1;
      color: var(--sc-fg-0); font-variant-numeric: tabular-nums;
    }
    .kpi-now .unit { font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .kpi-delta { margin: 4px 0 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .kpi-delta.good { color: var(--sc-success); }
    .kpi-delta.bad { color: var(--sc-warning); }
    .kpi-avg {
      display: grid; grid-template-columns: auto auto; gap: 1px 8px;
      margin: 8px 0 0; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .kpi-avg dt { color: var(--sc-fg-2); }
    .kpi-avg dd { margin: 0; color: var(--sc-fg-1); font-variant-numeric: tabular-nums; }

    /* ---- Bars: same grammar as the Fortschritt dashboard's sparkline ---- */
    .chart-wrap { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .chart {
      position: relative;
      display: flex; align-items: flex-end; gap: 3px; height: 96px;
      padding: 0 2px;
      border-bottom: 1px solid var(--sc-border);
    }
    .col { flex: 1 1 0; min-width: 4px; display: flex; align-items: flex-end; height: 100%; }
    .col-bar {
      width: 100%; border-radius: 2px 2px 0 0;
      background: color-mix(in srgb, var(--sc-accent) 40%, transparent);
      transition: height 0.3s ease;
    }
    .col.now .col-bar { background: var(--sc-accent); }
    .avg-rule {
      position: absolute; left: 0; right: 0; height: 0;
      border-top: 1px dashed color-mix(in srgb, var(--sc-fg-2) 75%, transparent);
      pointer-events: none;
    }
    .chart-axis {
      display: flex; justify-content: space-between; gap: 8px;
      font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }

    /* ---- Forecast slide: a list of projected dates, not a bar chart ---- */
    .slide.forecast { grid-template-columns: minmax(0, 1fr); align-items: start; gap: 10px; }
    .fc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .fc-row {
      display: grid; gap: 2px 12px; align-items: baseline;
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 7px 0;
      border-top: 1px solid color-mix(in srgb, var(--sc-border) 55%, transparent);
    }
    .fc-row:first-child { border-top: 0; }
    .fc-label { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .fc-when { display: inline-flex; align-items: baseline; gap: 8px; justify-self: end; text-align: right; }
    .fc-when strong {
      font-family: var(--sc-font-display); font-size: 0.98rem;
      color: var(--sc-fg-0); font-variant-numeric: tabular-nums;
    }
    .fc-rel { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-accent); white-space: nowrap; }
    .fc-basis {
      grid-column: 1 / -1;
      font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
      font-variant-numeric: tabular-nums;
    }
    /* An overdue estimate is a signal, not an error — a warning tint, not alarm red. */
    .fc-row.overdue .fc-rel { color: var(--sc-warning); }

    .cad-empty {
      margin: 0; padding: 18px 2px; min-height: 96px;
      display: flex; align-items: center;
      font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }

    @media (prefers-reduced-motion: reduce) {
      .slide { animation: none; }
      .col-bar { transition: none; }
    }
  `],
})
export class PatchCadenceComponent implements OnDestroy {
  private readonly t = inject(TranslateService);
  private readonly locale = inject(LocaleService);

  /** The grouped patch notes; the panel derives its own KPIs and forecast. */
  readonly groups = input.required<readonly PatchLineGroup[]>();

  /** Six months (default) or the whole feed — steers bars, median AND forecast. */
  readonly window = signal<CadenceWindow>('6m');

  readonly index = signal(0);
  readonly paused = signal(false);
  readonly hovered = signal(false);
  readonly focused = signal(false);

  /** Ticking clock, so the forecast's "in ~N days" stays live between refreshes. */
  private readonly now = signal(Date.now());
  private readonly clockTimer = setInterval(() => this.now.set(Date.now()), 60_000);

  /** Live, because a user can flip the OS setting while the page is open. */
  private readonly reducedMotion = signal(prefersReducedMotion());
  private mediaQuery: MediaQueryList | null = null;
  private readonly onMotionChange = (ev: MediaQueryListEvent) => this.reducedMotion.set(ev.matches);

  /**
   * The cutoff the window resolves to. Recomputes only when the toggle flips
   * (not on every clock tick), so the charts do not churn once a minute; the
   * six-month boundary is fixed at toggle time, which drifts by only minutes
   * over a session.
   */
  private readonly cutoffMs = computed<number | null>(() =>
    this.window() === 'all' ? null : sixMonthsBefore(Date.now()),
  );

  /** Whether there is anything to show at all — decided on the ALL-TIME data, so
   *  a six-month view that happens to be empty still renders (with its toggle). */
  readonly hasContent = computed(() =>
    computePatchStats(this.groups()).length > 0 || computePatchForecast(this.groups()).length > 0,
  );

  private readonly kpis = computed(() => computePatchStats(this.groups(), this.cutoffMs()));
  private readonly forecast = computed(() => computePatchForecast(this.groups(), this.cutoffMs()));

  /** The rotation order: the duration charts, then the forecast if it has rows. */
  readonly slides = computed<Slide[]>(() => {
    const out: Slide[] = this.kpis().map((kpi) => ({ kind: 'kpi', kpi }));
    const rows = this.forecast();
    if (rows.length > 0) out.push({ kind: 'forecast', rows });
    return out;
  });

  /** Clamped, so a shrinking slide list can never strand the panel on nothing. */
  readonly current = computed<Slide | null>(() => {
    const list = this.slides();
    if (list.length === 0) return null;
    return list[Math.min(this.index(), list.length - 1)];
  });

  /** More than one slide, i.e. there is somewhere to go — drives the dots. */
  readonly hasSlides = computed(() => this.slides().length > 1);

  /** Whether the panel advances by itself — drives the pause/resume button. */
  readonly canAutoRotate = computed(() => this.hasSlides() && !this.reducedMotion());

  private readonly autoAdvance = effect((onCleanup) => {
    const count = this.slides().length;
    const running = count > 1
      && !this.reducedMotion()
      && !this.paused()
      && !this.hovered()
      && !this.focused();
    if (!running) return;
    const id = setInterval(() => this.index.update((i) => (i + 1) % count), ROTATE_MS);
    onCleanup(() => clearInterval(id));
  });

  constructor() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      this.mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.mediaQuery.addEventListener('change', this.onMotionChange);
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.clockTimer);
    this.mediaQuery?.removeEventListener('change', this.onMotionChange);
    this.mediaQuery = null;
  }

  /** Switching the window is a deliberate re-scope; snap back to the first slide
   *  so the reader is never left clamped onto a slide the new window dropped. */
  setWindow(w: CadenceWindow): void {
    if (this.window() === w) return;
    this.window.set(w);
    this.index.set(0);
  }

  /** Jumping to a slide is a deliberate pick — the carousel yields to it. */
  show(i: number): void {
    this.index.set(i);
    this.paused.set(true);
  }

  togglePause(): void {
    this.paused.update((p) => !p);
  }

  slideKey(slide: Slide): string {
    return slide.kind === 'forecast' ? 'forecast' : slide.kpi.key;
  }

  slideTitle(slide: Slide): string {
    return slide.kind === 'forecast'
      ? this.t.instant('news.patch.forecast.title')
      : this.t.instant(`news.patch.kpi.${slide.kpi.key}.title`);
  }

  subOf(kpi: PatchKpi): string {
    return this.t.instant(`news.patch.kpi.${kpi.key}.sub`);
  }

  /**
   * Whole units for a headline figure, one decimal for an average of few samples.
   * Grouped and decimal-separated by the RESOLVED locale (#332).
   */
  num(value: number): string {
    const digits = Number.isInteger(value) ? 0 : 1;
    try {
      return new Intl.NumberFormat(this.locale.intlLocale(), {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
      }).format(value);
    } catch {
      return String(Math.round(value * 10) / 10);
    }
  }

  deltaLabel(kpi: PatchKpi): string {
    const delta = kpiDelta(kpi);
    if (delta === 0) return this.t.instant('news.patch.kpi.deltaSame');
    const n = Math.abs(delta);
    return this.t.instant(delta < 0 ? 'news.patch.kpi.deltaFaster' : 'news.patch.kpi.deltaSlower', { n });
  }

  deltaTone(kpi: PatchKpi): 'good' | 'bad' | 'neutral' {
    const delta = kpiDelta(kpi);
    if (delta === 0) return 'neutral';
    return delta < 0 ? 'good' : 'bad';
  }

  barPct(kpi: PatchKpi, point: PatchKpiPoint): number {
    return pointPct(kpi, point);
  }

  /** Where the median sits on the same scale as the bars. */
  medianPct(kpi: PatchKpi): number {
    const max = Math.max(...kpi.points.map((p) => p.value), 1);
    return Math.min(100, Math.round((kpi.median / max) * 100));
  }

  pointTitle(point: PatchKpiPoint): string {
    return this.t.instant('news.patch.kpi.barDays', { version: point.label, n: point.value });
  }

  chartAria(kpi: PatchKpi): string {
    return this.t.instant('news.patch.kpi.chartAria', {
      title: this.slideTitle({ kind: 'kpi', kpi }),
      latest: this.num(kpi.latest),
      median: this.num(kpi.median),
      unit: this.t.instant('news.patch.kpi.unit.days'),
      n: kpi.samples,
    });
  }

  axisFrom(kpi: PatchKpi): string {
    return kpi.points[0]?.label ?? '';
  }

  axisTo(kpi: PatchKpi): string {
    return kpi.points[kpi.points.length - 1]?.label ?? '';
  }

  // ── Forecast helpers ──────────────────────────────────────────────────────

  isOverdue(row: PatchForecastRow): boolean {
    return Date.parse(row.at) < this.now();
  }

  /** The predicted date, formatted in the resolved locale ("10. Sep. 2026"). */
  formatDate(iso: string): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(ms);
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  /** "in ~3 weeks" / "overdue by 4 days" — days under a fortnight, else weeks. */
  untilLabel(row: PatchForecastRow): string {
    const days = Math.round((Date.parse(row.at) - this.now()) / DAY_MS);
    if (days === 0) return this.t.instant('news.patch.forecast.today');
    const overdue = days < 0;
    const n = Math.abs(days);
    if (n < 14) {
      return this.t.instant(overdue ? 'news.patch.forecast.overdueDays' : 'news.patch.forecast.inDays', { n });
    }
    const weeks = Math.round(n / 7);
    return this.t.instant(overdue ? 'news.patch.forecast.overdueWeeks' : 'news.patch.forecast.inWeeks', { n: weeks });
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Six calendar months before the given instant. */
function sixMonthsBefore(nowMs: number): number {
  const d = new Date(nowMs);
  d.setMonth(d.getMonth() - 6);
  return d.getTime();
}
