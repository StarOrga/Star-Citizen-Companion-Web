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
import { formatScCompactDate, toDateOrNull } from '../core/locale/date-format';
import {
  PatchKpi,
  PatchKpiPoint,
  VOLUME_WINDOWS,
  VOLUME_WINDOW_DAYS,
  kpiDelta,
  pointPct,
} from './patch-stats';

/** How long one KPI stays on screen before the panel moves on. */
const ROTATE_MS = 7000;

/**
 * Patch-cadence panel (feedback 44e90e30, follow-up).
 *
 * "Cool wäre auch wenn die Historie der Patch Notes sich alle x Sekunden
 * abwechselt mit ein bis 3 Grafiken und/oder KPIs, die zeigen wie aktuell die
 * Patch-Performance ist von CIG."
 *
 * Three small charts, one at a time, each pairing the newest measurement with
 * the all-time average. Hand-rolled bars on the existing tokens — this repo has
 * no charting dependency on purpose, and the Fortschritt dashboard sets the
 * precedent for that.
 *
 * Rotation etiquette:
 * - `prefers-reduced-motion: reduce` disables the auto-advance completely; the
 *   dots stay, so the content is all still reachable, just never on its own.
 * - Hovering or tab-focusing the panel holds the current slide, so a chart can
 *   be read without racing the timer.
 * - Picking a dot stops the carousel for good: an explicit choice outranks a
 *   timer, and the play button hands it back.
 * - Nothing here grabs focus. The panel is a labelled region, not a live region:
 *   a screen reader is never interrupted by a slide it did not ask for.
 */
@Component({
  selector: 'sc-patch-cadence',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (current(); as kpi) {
      <section class="cadence" [attr.aria-label]="'news.patch.kpi.title' | translate"
               (mouseenter)="hovered.set(true)" (mouseleave)="hovered.set(false)"
               (focusin)="focused.set(true)" (focusout)="focused.set(false)">
        <header class="cad-head">
          <h3>{{ 'news.patch.kpi.title' | translate }}</h3>
          <span class="cad-sub">{{ 'news.patch.kpi.sub' | translate }}</span>
          <!-- Dots whenever there is more than one KPI — including under reduced
               motion, where they are the ONLY way to reach slides 2 and 3. Gating
               them on the rotation would delete two thirds of the content for
               anyone who asked the OS to stop things moving. -->
          @if (hasSlides()) {
            <div class="cad-controls">
              <!-- Real actions, not navigation → buttons. -->
              @for (k of kpis(); track k.key; let i = $index) {
                <button type="button" class="dot" [class.on]="i === index()"
                        [attr.aria-pressed]="i === index()"
                        [attr.aria-label]="'news.patch.kpi.goto' | translate:{ title: titleOf(k) }"
                        [attr.title]="titleOf(k)"
                        (click)="show(i)"></button>
              }
              <!-- Pause/resume only where something actually auto-advances: under
                   reduced motion nothing does, and a button offering to start it
                   would hand back the very motion the user switched off. -->
              @if (canAutoRotate()) {
                <button type="button" class="cad-play"
                        [attr.aria-pressed]="paused()"
                        [attr.aria-label]="(paused() ? 'news.patch.kpi.play' : 'news.patch.kpi.pause') | translate"
                        [attr.title]="(paused() ? 'news.patch.kpi.play' : 'news.patch.kpi.pause') | translate"
                        (click)="togglePause()">{{ paused() ? '▶' : '❚❚' }}</button>
              }
            </div>
          }
        </header>

        <!-- Keyed by KPI so the slide element is replaced on every switch and the
             fade actually replays (it is a no-op under reduced motion). -->
        @for (slide of [kpi]; track slide.key) {
          <article class="slide">
            <div class="figures">
              <h4 class="kpi-title">{{ titleOf(slide) }}</h4>
              <p class="kpi-sub">{{ subOf(slide) }}</p>
              <p class="kpi-now">
                <strong>{{ num(slide.latest) }}</strong>
                <span class="unit">{{ ('news.patch.kpi.unit.' + slide.unit) | translate }}</span>
              </p>
              <p class="kpi-delta" [class.good]="deltaTone(slide) === 'good'" [class.bad]="deltaTone(slide) === 'bad'">
                {{ deltaLabel(slide) }}
              </p>
              <dl class="kpi-avg">
                <dt>{{ 'news.patch.kpi.average' | translate }}</dt>
                <dd>{{ num(slide.average) }} {{ ('news.patch.kpi.unit.' + slide.unit) | translate }}</dd>
                <dt>{{ 'news.patch.kpi.samplesLabel' | translate }}</dt>
                <dd>{{ 'news.patch.kpi.samples' | translate:{ n: slide.samples } }}</dd>
              </dl>
            </div>

            <div class="chart-wrap">
              <div class="chart" role="img" [attr.aria-label]="chartAria(slide)">
                <!-- The all-time average as a rule across the bars: the comparison
                     the admin asked for, readable without doing the arithmetic. -->
                <span class="avg-rule" [style.bottom.%]="avgPct(slide)" aria-hidden="true"></span>
                @for (p of slide.points; track $index; let last = $last) {
                  <span class="col" [class.now]="last" [attr.title]="pointTitle(slide, p)">
                    <span class="col-bar" [style.height.%]="barPct(slide, p)"></span>
                  </span>
                }
              </div>
              <div class="chart-axis" aria-hidden="true">
                <span>{{ axisFrom(slide) }}</span>
                <span>{{ axisTo(slide) }}</span>
              </div>
            </div>
          </article>
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
      margin: 0; font-size: 0.78rem; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sc-accent);
    }
    .cad-sub { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .cad-controls { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
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
    .dot:focus-visible, .cad-play:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .cad-play {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: var(--sc-tap-min); min-height: var(--sc-tap-min);
      padding: 0 6px; border-radius: 6px;
      background: transparent; border: 1px solid transparent; color: var(--sc-fg-2);
      font-family: inherit; font-size: 0.7rem; line-height: 1; cursor: pointer;
    }
    .cad-play:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

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

    @media (prefers-reduced-motion: reduce) {
      .slide { animation: none; }
      .col-bar { transition: none; }
    }
  `],
})
export class PatchCadenceComponent implements OnDestroy {
  private readonly t = inject(TranslateService);
  private readonly locale = inject(LocaleService);

  /** All-time KPIs, computed from the unfiltered patch notes. */
  readonly kpis = input.required<readonly PatchKpi[]>();

  readonly index = signal(0);
  readonly paused = signal(false);
  readonly hovered = signal(false);
  readonly focused = signal(false);

  /** Live, because a user can flip the OS setting while the page is open. */
  private readonly reducedMotion = signal(prefersReducedMotion());
  private mediaQuery: MediaQueryList | null = null;
  private readonly onMotionChange = (ev: MediaQueryListEvent) => this.reducedMotion.set(ev.matches);

  /** Clamped, so a shrinking KPI list can never strand the panel on nothing. */
  readonly current = computed<PatchKpi | null>(() => {
    const list = this.kpis();
    if (list.length === 0) return null;
    return list[Math.min(this.index(), list.length - 1)];
  });

  /** More than one KPI, i.e. there is somewhere to go — drives the dots. */
  readonly hasSlides = computed(() => this.kpis().length > 1);

  /** Whether the panel advances by itself — drives the pause/resume button. */
  readonly canAutoRotate = computed(() => this.hasSlides() && !this.reducedMotion());

  private readonly autoAdvance = effect((onCleanup) => {
    const count = this.kpis().length;
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
    this.mediaQuery?.removeEventListener('change', this.onMotionChange);
    this.mediaQuery = null;
  }

  /** Jumping to a slide is a deliberate pick — the carousel yields to it. */
  show(i: number): void {
    this.index.set(i);
    this.paused.set(true);
  }

  togglePause(): void {
    this.paused.update((p) => !p);
  }

  titleOf(kpi: PatchKpi): string {
    return this.t.instant(`news.patch.kpi.${kpi.key}.title`);
  }

  subOf(kpi: PatchKpi): string {
    return this.t.instant(`news.patch.kpi.${kpi.key}.sub`, {
      days: VOLUME_WINDOW_DAYS,
    });
  }

  /**
   * Whole units for a headline figure, one decimal for an average of few samples.
   * Grouped and decimal-separated by the RESOLVED locale (#332), so `12,5` and
   * `12.5` follow the same setting the dates do.
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
    if (kpi.unit === 'days') {
      return this.t.instant(delta < 0 ? 'news.patch.kpi.deltaFaster' : 'news.patch.kpi.deltaSlower', { n });
    }
    return this.t.instant(delta > 0 ? 'news.patch.kpi.deltaMore' : 'news.patch.kpi.deltaLess', { n });
  }

  /**
   * Only the two duration KPIs carry a verdict — shipping faster than usual is
   * good news. "More patch notes than average" is activity, not quality, so it
   * stays uncoloured rather than pretending to be a grade.
   */
  deltaTone(kpi: PatchKpi): 'good' | 'bad' | 'neutral' {
    const delta = kpiDelta(kpi);
    if (!kpi.lowerIsBetter || delta === 0) return 'neutral';
    return delta < 0 ? 'good' : 'bad';
  }

  barPct(kpi: PatchKpi, point: PatchKpiPoint): number {
    return pointPct(kpi, point);
  }

  /** Where the all-time average sits on the same scale as the bars. */
  avgPct(kpi: PatchKpi): number {
    const max = Math.max(...kpi.points.map((p) => p.value), 1);
    return Math.min(100, Math.round((kpi.average / max) * 100));
  }

  pointTitle(kpi: PatchKpi, point: PatchKpiPoint): string {
    if (kpi.unit === 'notes') {
      return this.t.instant('news.patch.kpi.barNotes', { n: point.value, date: this.shortDate(point.at) });
    }
    return this.t.instant('news.patch.kpi.barDays', { version: point.label, n: point.value });
  }

  chartAria(kpi: PatchKpi): string {
    return this.t.instant('news.patch.kpi.chartAria', {
      title: this.titleOf(kpi),
      latest: this.num(kpi.latest),
      average: this.num(kpi.average),
      unit: this.t.instant(`news.patch.kpi.unit.${kpi.unit}`),
      n: kpi.samples,
    });
  }

  axisFrom(kpi: PatchKpi): string {
    if (kpi.unit === 'notes') {
      return this.t.instant('news.patch.kpi.axisFrom', { days: VOLUME_WINDOWS * VOLUME_WINDOW_DAYS });
    }
    return kpi.points[0]?.label ?? '';
  }

  axisTo(kpi: PatchKpi): string {
    if (kpi.unit === 'notes') return this.t.instant('news.patch.kpi.axisNow');
    return kpi.points[kpi.points.length - 1]?.label ?? '';
  }

  /**
   * A bar's own date. The app's default is the spelled-out
   * `31 / Juli / 2026` (#332), which cannot fit a bar a few pixels wide — so this
   * is the documented compact exception, still region-ordered and never a
   * hand-rolled format.
   */
  private shortDate(iso: string): string {
    const date = toDateOrNull(iso);
    if (!date) return '';
    return formatScCompactDate(date, this.locale.language(), this.locale.region());
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
