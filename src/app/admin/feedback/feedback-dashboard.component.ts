import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  FeedbackRow,
  FeedbackStats,
  ThreadMap,
  computeStats,
  startOfMonth,
} from './feedback.types';

/** One rendered column: a labelled time window with its numbers. */
interface StatWindow {
  key: 'month' | 'all';
  label: string;
  stats: FeedbackStats;
  /** Share of resolved work (shipped / shipped+open), 0..1 — drives the donut. */
  ratio: number;
  /** Largest bar value in the column, so the bars scale within their own window. */
  max: number;
}

/** Circumference of the donut ring (r = 26) — precomputed for the dash array. */
const RING = 2 * Math.PI * 26;

/**
 * Progress dashboard for the admin feedback board (permanently reachable via
 * the board's view switch).
 *
 * Shows "Diesen Monat" and "All-time" **side by side** rather than behind a
 * period picker, so the current month always has its all-time context. Charts
 * are hand-rolled SVG/CSS on the existing SCC tokens — no charting dependency,
 * no new palette.
 */
@Component({
  selector: 'sc-feedback-dashboard',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="dash" [class.compact]="compact()">
      <div class="windows">
        @for (w of windows(); track w.key) {
          <article class="win sc-card">
            <h3 class="win-title">{{ w.label }}</h3>

            <!-- Donut: share of everything raised in this window that shipped. -->
            <div class="donut-wrap">
              <svg viewBox="0 0 64 64" class="donut" role="img" [attr.aria-label]="donutLabel(w)">
                <circle class="track" cx="32" cy="32" r="26" />
                <circle
                  class="arc"
                  cx="32"
                  cy="32"
                  r="26"
                  [attr.stroke-dasharray]="ring"
                  [attr.stroke-dashoffset]="ring * (1 - w.ratio)" />
              </svg>
              <div class="donut-centre">
                <strong>{{ pct(w.ratio) }}%</strong>
                <span>{{ 'adminFeedback.dashboard.shippedShare' | translate }}</span>
              </div>
            </div>

            <!-- Bars: the three headline metrics, scaled inside this window. -->
            <dl class="bars">
              <div class="bar-row shipped">
                <dt>{{ 'adminFeedback.dashboard.shipped' | translate }}</dt>
                <dd>
                  <span class="bar"><span class="fill" [style.width.%]="barPct(w, w.stats.shipped)"></span></span>
                  <b>{{ w.stats.shipped }}</b>
                </dd>
              </div>
              <div class="bar-row open">
                <dt>{{ 'adminFeedback.dashboard.open' | translate }}</dt>
                <dd>
                  <span class="bar"><span class="fill" [style.width.%]="barPct(w, w.stats.open)"></span></span>
                  <b>{{ w.stats.open }}</b>
                </dd>
              </div>
              <div class="bar-row answered">
                <dt>{{ 'adminFeedback.dashboard.answered' | translate }}</dt>
                <dd>
                  <span class="bar"><span class="fill" [style.width.%]="barPct(w, w.stats.answered)"></span></span>
                  <b>{{ w.stats.answered }}</b>
                </dd>
              </div>
            </dl>
          </article>
        }
      </div>

      <p class="dash-note">{{ 'adminFeedback.dashboard.note' | translate }}</p>
    </section>
  `,
  styles: [`
    /* Container query context: the docked FAB panel is far narrower than the
       full board page, and only the container knows which one it is in. */
    .dash { display: flex; flex-direction: column; gap: 10px; container-type: inline-size; }

    /* Both windows stay visible at once — side by side wherever they fit (the
       docked 480px panel still does), stacking only on very narrow screens. */
    .windows { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    @container (max-width: 360px) { .windows { grid-template-columns: 1fr; } }

    .win { display: flex; flex-direction: column; align-items: stretch; gap: 10px; padding: 14px 12px; }
    .win-title {
      margin: 0;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
      text-align: center;
    }

    /* ---- Donut ---- */
    .donut-wrap { position: relative; align-self: center; width: 104px; height: 104px; }
    .donut { width: 100%; height: 100%; transform: rotate(-90deg); }
    .donut .track { fill: none; stroke: var(--sc-bg-2); stroke-width: 8; }
    .donut .arc {
      fill: none;
      stroke: var(--sc-success);
      stroke-width: 8;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .donut-centre {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      pointer-events: none;
    }
    .donut-centre strong { font-size: 1.15rem; color: var(--sc-fg-0); line-height: 1; }
    .donut-centre span {
      font-size: 0.56rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }

    /* ---- Bars ---- */
    .bars { display: flex; flex-direction: column; gap: 7px; margin: 0; }
    .bar-row { display: flex; flex-direction: column; gap: 3px; }
    .bar-row dt { font-size: 0.68rem; letter-spacing: 0.04em; color: var(--sc-fg-2); }
    .bar-row dd { display: flex; align-items: center; gap: 8px; margin: 0; }
    .bar {
      flex: 1 1 auto;
      height: 6px;
      border-radius: 999px;
      background: var(--sc-bg-2);
      overflow: hidden;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: 999px;
      transform-origin: left center;
      animation: bar-grow 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
      transition: width 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .bar-row dd b { flex: 0 0 auto; min-width: 1.6em; text-align: right; font-size: 0.86rem; }
    .bar-row.shipped .fill { background: var(--sc-success); }
    .bar-row.shipped dd b { color: var(--sc-success); }
    .bar-row.open .fill { background: var(--sc-accent); }
    .bar-row.open dd b { color: var(--sc-accent); }
    .bar-row.answered .fill { background: #a78bfa; }
    .bar-row.answered dd b { color: #a78bfa; }

    @keyframes bar-grow {
      from { transform: scaleX(0); }
      to { transform: scaleX(1); }
    }

    .dash-note { margin: 0; font-size: 0.68rem; line-height: 1.4; color: var(--sc-fg-2); }

    @media (prefers-reduced-motion: reduce) {
      .fill { animation: none; transition: none; }
      .donut .arc { transition: none; }
    }

    .dash.compact .win { padding: 12px 10px; }
    .dash.compact .donut-wrap { width: 88px; height: 88px; }
  `],
})
export class FeedbackDashboardComponent {
  private readonly translate = inject(TranslateService);

  /** Every topic on the board (all statuses). */
  readonly rows = input.required<readonly FeedbackRow[]>();
  /** Replies per topic — needed to count answered Rückfragen. */
  readonly threads = input.required<ThreadMap>();
  /** Rendering inside the docked FAB panel rather than the full page. */
  readonly compact = input(false);

  readonly ring = RING;

  readonly windows = computed<StatWindow[]>(() => {
    const rows = this.rows();
    const threads = this.threads();
    const month = computeStats(rows, threads, startOfMonth());
    const all = computeStats(rows, threads, null);
    return [
      this.toWindow('month', this.monthLabel(), month),
      this.toWindow('all', this.translate.instant('adminFeedback.dashboard.allTime'), all),
    ];
  });

  private toWindow(key: 'month' | 'all', label: string, stats: FeedbackStats): StatWindow {
    const resolvable = stats.shipped + stats.open;
    return {
      key,
      label,
      stats,
      ratio: resolvable === 0 ? 0 : stats.shipped / resolvable,
      max: Math.max(stats.shipped, stats.open, stats.answered, 1),
    };
  }

  /** "Diesen Monat" with the actual month name appended, e.g. "Diesen Monat · Juli". */
  private monthLabel(): string {
    const name = new Intl.DateTimeFormat(this.translate.currentLang || 'en', { month: 'long' })
      .format(new Date());
    return `${this.translate.instant('adminFeedback.dashboard.thisMonth')} · ${name}`;
  }

  pct(ratio: number): number {
    return Math.round(ratio * 100);
  }

  barPct(w: StatWindow, value: number): number {
    return (value / w.max) * 100;
  }

  donutLabel(w: StatWindow): string {
    return this.translate.instant('adminFeedback.dashboard.donutLabel', {
      label: w.label,
      pct: this.pct(w.ratio),
    });
  }
}
