import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  FeedbackBucket,
  FeedbackPace,
  FeedbackRow,
  FeedbackStats,
  LifecycleSnapshot,
  ShipWeek,
  ThreadMap,
  bucketLabelStatus,
  computePace,
  computeStats,
  lifecycleSnapshot,
  shippedPerWeek,
  startOfMonth,
} from './feedback.types';

/** One rendered column: a labelled time window with its numbers. */
interface StatWindow {
  key: 'month' | 'all';
  label: string;
  stats: FeedbackStats;
  pace: FeedbackPace;
  /** Share of resolved work (shipped / shipped+open), 0..1 — drives the donut. */
  ratio: number;
  /** Largest bar value in the column, so the bars scale within their own window. */
  max: number;
  /** Median time-to-ship, already formatted ("18 h", "2,4 T", "—"). */
  median: string;
  /** Rückfrage rate in percent, plus the raw fraction behind it. */
  questionPct: number;
  questionHint: string;
}

/** One outgoing transition of a lifecycle stage. */
interface StageExit {
  label: string;
  target: string;
  /** A branch that leads *backwards* (or sideways) rather than forward. */
  back: boolean;
}

/** One node of the lifecycle map. */
interface StageNode {
  key: FeedbackBucket;
  label: string;
  count: number;
  /** Occupancy relative to the fullest stage, 0..100 — drives the mini meter. */
  share: number;
  /** Live annotations ("2 Review-Hold", "ältestes 4 Tage offen"). */
  facts: string[];
  exits: StageExit[];
}

/** Circumference of the donut ring (r = 26) — precomputed for the dash array. */
const RING = 2 * Math.PI * 26;

/** How many weeks the throughput sparkline covers. */
const WEEKS = 12;

/**
 * Progress dashboard for the admin feedback board (permanently reachable via
 * the board's view switch).
 *
 * Three blocks, all of them read-only and always-on — the view carries **no
 * filters, pickers or toggles** by design (feedback ef15ea67): it has to be
 * informative the second it opens.
 *
 * 1. **Windows** — "Diesen Monat" and "All-time" side by side rather than behind
 *    a period picker, so the current month always has its all-time context.
 *    Donut (shipped share) + bars, plus the pace pair (median time-to-ship and
 *    the Rückfrage rate) that says *how* that volume came about.
 * 2. **Durchsatz** — ships per week over the last 12 weeks, so a stalling or
 *    accelerating routine is visible as a trend instead of a single number.
 * 3. **Lebenszyklus** — the status machine from docs/feedback-routine
 *    ("Contract") drawn as a live map: every stage a topic can be in, every
 *    branch it can take (Rückfrage and back, the reaper reopening a stale claim,
 *    the post-ship continuation loop, the terminal issue hand-off), annotated
 *    with how many topics sit there right now.
 *
 * Charts are hand-rolled SVG/CSS on the existing SCC tokens — no charting
 * dependency, no new palette. The map is a semantic list, so the whole diagram
 * is readable as text by a screen reader; the dots, connectors and meters are
 * decoration and hidden from it.
 */
@Component({
  selector: 'sc-feedback-dashboard',
  standalone: true,
  imports: [TranslateModule, NgTemplateOutlet],
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

            <!-- Pace: the two rates the volume bars can't show. -->
            <dl class="pace">
              <div class="pace-cell">
                <dt>{{ 'adminFeedback.dashboard.paceMedian' | translate }}</dt>
                <dd>{{ w.median }}</dd>
              </div>
              <div class="pace-cell">
                <dt>{{ 'adminFeedback.dashboard.paceQuestions' | translate }}</dt>
                <dd>{{ w.questionPct }}%<small>{{ w.questionHint }}</small></dd>
              </div>
            </dl>
          </article>
        }
      </div>

      <p class="dash-note">{{ 'adminFeedback.dashboard.note' | translate }}</p>

      <!-- ---- Throughput: ships per week over the last 12 weeks ---- -->
      <article class="panel sc-card">
        <header class="panel-head">
          <h3 class="panel-title">{{ 'adminFeedback.dashboard.throughputTitle' | translate }}</h3>
          <span class="panel-sub">{{ 'adminFeedback.dashboard.throughputSub' | translate: { weeks: weekSpan } }}</span>
        </header>

        <div class="spark" role="img" [attr.aria-label]="throughputLabel()">
          @for (w of weeks(); track w.start) {
            <span class="wk" [class.now]="w.current" [attr.title]="weekTitle(w)">
              <span class="wk-bar" [style.height.%]="weekPct(w)"></span>
            </span>
          }
        </div>
        <div class="spark-axis" aria-hidden="true">
          <span>{{ 'adminFeedback.dashboard.throughputFrom' | translate: { weeks: weekSpan } }}</span>
          <span>{{ 'adminFeedback.dashboard.throughputNow' | translate }}</span>
        </div>
      </article>

      <!-- ---- Lifecycle map: stages + branches, annotated with live counts ---- -->
      <article class="panel sc-card flow">
        <header class="panel-head">
          <h3 class="panel-title">{{ 'adminFeedback.dashboard.lifecycleTitle' | translate }}</h3>
          <span class="panel-sub">{{ 'adminFeedback.dashboard.lifecycleIntro' | translate }}</span>
        </header>

        <!-- One node renderer for the spine and the side track alike, so the two
             lists can differ in semantics (ordered path vs. unordered branches)
             without duplicating the node markup. -->
        <ng-template #node let-s>
          <span class="dot" aria-hidden="true"></span>
          <div class="stage-head">
            <span class="stage-name">{{ s.label }}</span>
            <span class="stage-count"
              >{{ s.count }}<span class="sr-only"> {{ 'adminFeedback.dashboard.stageNow' | translate }}</span></span
            >
          </div>
          <span class="meter" aria-hidden="true"><span class="meter-fill" [style.width.%]="s.share"></span></span>
          @if (s.facts.length) {
            <ul class="facts">
              @for (f of s.facts; track $index) {
                <li>{{ f }}</li>
              }
            </ul>
          }
          @if (s.exits.length) {
            <ul class="exits">
              @for (x of s.exits; track $index) {
                <li [class.back]="x.back">
                  <span class="arrow" aria-hidden="true">{{ x.back ? '↺' : '↓' }}</span>
                  <span class="exit-label">{{ x.label }}</span>
                  <span class="exit-target">→ {{ x.target }}</span>
                </li>
              }
            </ul>
          }
        </ng-template>

        <ol class="stages">
          @for (s of mainStages(); track s.key) {
            <li class="stage" [attr.data-stage]="s.key">
              <ng-container [ngTemplateOutlet]="node" [ngTemplateOutletContext]="{ $implicit: s }" />
            </li>
          }
        </ol>

        <h4 class="side-title">{{ 'adminFeedback.dashboard.lifecycleSide' | translate }}</h4>
        <ul class="stages side">
          @for (s of sideStages(); track s.key) {
            <li class="stage" [attr.data-stage]="s.key">
              <ng-container [ngTemplateOutlet]="node" [ngTemplateOutletContext]="{ $implicit: s }" />
            </li>
          }
        </ul>

        <p class="panel-note">{{ 'adminFeedback.dashboard.lifecycleNote' | translate }}</p>
      </article>
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

    /* ---- Pace pair ---- */
    .pace {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin: 0;
      padding-top: 9px;
      border-top: 1px solid var(--sc-border);
    }
    .pace-cell { min-width: 0; }
    .pace-cell dt {
      font-size: 0.6rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
      overflow-wrap: anywhere;
    }
    .pace-cell dd {
      margin: 2px 0 0;
      font-size: 0.92rem;
      font-weight: 600;
      color: var(--sc-fg-0);
      line-height: 1.15;
    }
    .pace-cell dd small {
      display: block;
      font-size: 0.6rem;
      font-weight: 400;
      color: var(--sc-fg-2);
    }

    .dash-note { margin: 0; font-size: 0.68rem; line-height: 1.4; color: var(--sc-fg-2); }

    /* ---- Shared panel chrome (throughput + lifecycle) ---- */
    .panel { display: flex; flex-direction: column; gap: 9px; padding: 14px 12px; }
    .panel-head { display: flex; flex-direction: column; gap: 2px; }
    .panel-title {
      margin: 0;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .panel-sub, .panel-note { font-size: 0.66rem; line-height: 1.4; color: var(--sc-fg-2); }
    .panel-note { margin: 0; padding-top: 2px; }

    /* ---- Throughput sparkline ---- */
    .spark { display: flex; align-items: flex-end; gap: 3px; height: 64px; }
    .wk {
      position: relative;
      flex: 1 1 0;
      min-width: 0;
      height: 100%;
      display: flex;
      align-items: flex-end;
      border-radius: 3px;
      background: var(--sc-bg-2);
      overflow: hidden;
    }
    .wk-bar {
      display: block;
      width: 100%;
      min-height: 2px;
      border-radius: 3px;
      background: var(--sc-success);
      transition: height 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .wk.now .wk-bar { background: var(--sc-accent); }
    .spark-axis {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 0.6rem;
      color: var(--sc-fg-2);
    }

    /* ---- Lifecycle map ----
       A vertical spine rather than a horizontal flow chart: it is the only
       layout that survives the docked panel width unchanged, never scrolls
       sideways, and reads correctly as a plain list for assistive tech. */
    .stages { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .stage { position: relative; padding: 0 0 0 18px; }
    /* The spine — connects a stage to the next one; the last node ends it. */
    .stages:not(.side) .stage::before {
      content: '';
      position: absolute;
      left: 4px;
      top: 14px;
      bottom: -12px;
      width: 2px;
      background: var(--sc-border);
    }
    .stages:not(.side) .stage:last-child::before { display: none; }
    .dot {
      position: absolute;
      left: 0;
      top: 5px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--sc-fg-2);
    }
    .stage[data-stage='todo'] .dot { background: var(--sc-accent); }
    .stage[data-stage='in_progress'] .dot { background: var(--sc-warning); }
    .stage[data-stage='shipped'] .dot { background: var(--sc-success); }
    .stage[data-stage='awaiting_admin'] .dot { background: #a78bfa; }
    .stage[data-stage='rejected'] .dot { background: var(--sc-danger); }

    .stage-head { display: flex; align-items: baseline; gap: 8px; }
    .stage-name { font-size: 0.78rem; font-weight: 600; color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .stage-count { margin-left: auto; font-size: 0.92rem; font-weight: 700; color: var(--sc-fg-1); }
    .stage[data-stage='todo'] .stage-count { color: var(--sc-accent); }
    .stage[data-stage='in_progress'] .stage-count { color: var(--sc-warning); }
    .stage[data-stage='shipped'] .stage-count { color: var(--sc-success); }
    .stage[data-stage='awaiting_admin'] .stage-count { color: #a78bfa; }

    .meter {
      display: block;
      height: 4px;
      margin-top: 4px;
      border-radius: 999px;
      background: var(--sc-bg-2);
      overflow: hidden;
    }
    .meter-fill {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: var(--sc-fg-2);
      transition: width 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .stage[data-stage='todo'] .meter-fill { background: var(--sc-accent); }
    .stage[data-stage='in_progress'] .meter-fill { background: var(--sc-warning); }
    .stage[data-stage='shipped'] .meter-fill { background: var(--sc-success); }
    .stage[data-stage='awaiting_admin'] .meter-fill { background: #a78bfa; }

    .facts, .exits { list-style: none; margin: 5px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
    .facts li { font-size: 0.64rem; line-height: 1.35; color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .exits li {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 6px;
      font-size: 0.64rem;
      line-height: 1.35;
      color: var(--sc-fg-1);
    }
    .exits .arrow { flex: 0 0 auto; color: var(--sc-fg-2); }
    .exits .exit-label { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .exits .exit-target {
      flex: 0 0 auto;
      padding: 1px 6px;
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      color: var(--sc-fg-2);
      white-space: nowrap;
    }
    .exits li.back .arrow, .exits li.back .exit-target { color: var(--sc-warning); border-color: var(--sc-warning); }
    .exits li.back .arrow { border: 0; }

    .side-title {
      margin: 4px 0 0;
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }

    @media (prefers-reduced-motion: reduce) {
      .fill { animation: none; transition: none; }
      .donut .arc, .wk-bar, .meter-fill { transition: none; }
    }

    .dash.compact .win { padding: 12px 10px; }
    .dash.compact .donut-wrap { width: 88px; height: 88px; }
    .dash.compact .panel { padding: 12px 10px; }
    .dash.compact .spark { height: 52px; }
  `],
})
export class FeedbackDashboardComponent {
  private readonly translate = inject(TranslateService);

  /**
   * Ticks on every language switch so the computed labels below (which resolve
   * through `translate.instant`) re-run instead of freezing in the language the
   * panel happened to open in.
   */
  private readonly lang = toSignal(this.translate.onLangChange, { initialValue: null });

  /** Every topic on the board (all statuses). */
  readonly rows = input.required<readonly FeedbackRow[]>();
  /** Replies per topic — needed to count answered Rückfragen. */
  readonly threads = input.required<ThreadMap>();
  /** Rendering inside the docked FAB panel rather than the full page. */
  readonly compact = input(false);

  readonly ring = RING;
  readonly weekSpan = WEEKS;

  readonly windows = computed<StatWindow[]>(() => {
    const rows = this.rows();
    const threads = this.threads();
    this.lang();
    const from = startOfMonth();
    return [
      this.toWindow('month', this.monthLabel(), computeStats(rows, threads, from), computePace(rows, threads, from)),
      this.toWindow(
        'all',
        this.translate.instant('adminFeedback.dashboard.allTime'),
        computeStats(rows, threads, null),
        computePace(rows, threads, null),
      ),
    ];
  });

  readonly weeks = computed<ShipWeek[]>(() => shippedPerWeek(this.rows(), WEEKS));

  /** Tallest bar in the sparkline, floored at 1 so an empty board still renders. */
  private readonly weekMax = computed(() => Math.max(1, ...this.weeks().map((w) => w.count)));

  private readonly snapshot = computed<LifecycleSnapshot>(() =>
    lifecycleSnapshot(this.rows(), this.threads()),
  );

  /** The happy path every topic walks: ToDo → In Arbeit → Geshipped. */
  readonly mainStages = computed<StageNode[]>(() => {
    const s = this.snapshot();
    this.lang();
    const todoFacts: string[] = [];
    if (s.oldestActiveDays !== null) {
      todoFacts.push(this.t('fact.oldest', { days: s.oldestActiveDays }));
    }
    if (s.answered) todoFacts.push(this.t('fact.answered', { count: s.answered }));
    if (s.continuations) todoFacts.push(this.t('fact.continuation', { count: s.continuations }));
    if (s.reopened) todoFacts.push(this.t('fact.reopened', { count: s.reopened }));

    const workFacts: string[] = [];
    if (s.working) workFacts.push(this.t('fact.working', { count: s.working }));
    if (s.reviewHolds) workFacts.push(this.t('fact.hold', { count: s.reviewHolds }));

    const shippedFacts: string[] = [this.t('fact.terminalAtRest')];
    if (s.continuations) {
      shippedFacts.push(this.t('fact.pendingContinuation', { count: s.continuations }));
    }

    return [
      this.toStage('todo', s, todoFacts, [
        { label: this.t('flow.pickup'), target: this.stageLabel('in_progress'), back: false },
      ]),
      this.toStage('in_progress', s, workFacts, [
        { label: this.t('flow.green'), target: this.stageLabel('shipped'), back: false },
        { label: this.t('flow.question'), target: this.stageLabel('awaiting_admin'), back: false },
        { label: this.t('flow.hold'), target: this.t('flow.holdTarget'), back: true },
        { label: this.t('flow.reaper'), target: this.stageLabel('todo'), back: true },
      ]),
      this.toStage('shipped', s, shippedFacts, [
        { label: this.t('flow.continue'), target: this.stageLabel('in_progress'), back: true },
      ]),
    ];
  });

  /**
   * The branches off the spine: the Rückfrage a topic bounces into and returns
   * from, and the terminal stages nothing ever picks up again. Legacy `rejected`
   * only appears while such rows still exist.
   */
  readonly sideStages = computed<StageNode[]>(() => {
    const s = this.snapshot();
    this.lang();
    const stages: StageNode[] = [
      this.toStage(
        'awaiting_admin',
        s,
        s.counts.awaiting_admin ? [this.t('fact.awaiting')] : [],
        [{ label: this.t('flow.answered'), target: this.stageLabel('todo'), back: true }],
      ),
      this.toStage('issue_created', s, [this.t('fact.issueTerminal')], []),
    ];
    if (s.counts.rejected) {
      stages.push(this.toStage('rejected', s, [this.t('fact.rejectedLegacy')], []));
    }
    return stages;
  });

  private toStage(
    key: FeedbackBucket,
    snapshot: LifecycleSnapshot,
    facts: string[],
    exits: StageExit[],
  ): StageNode {
    const peak = Math.max(1, ...Object.values(snapshot.counts));
    const count = snapshot.counts[key];
    return {
      key,
      label: this.stageLabel(key),
      count,
      share: (count / peak) * 100,
      facts,
      exits,
    };
  }

  /** Bucket → its board label, so the map speaks the board's vocabulary. */
  private stageLabel(key: FeedbackBucket): string {
    return this.translate.instant(`adminFeedback.status.${bucketLabelStatus(key)}`);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(`adminFeedback.dashboard.${key}`, params);
  }

  private toWindow(
    key: 'month' | 'all',
    label: string,
    stats: FeedbackStats,
    pace: FeedbackPace,
  ): StatWindow {
    const resolvable = stats.shipped + stats.open;
    return {
      key,
      label,
      stats,
      pace,
      ratio: resolvable === 0 ? 0 : stats.shipped / resolvable,
      max: Math.max(stats.shipped, stats.open, stats.answered, 1),
      median: this.formatDuration(pace.medianShipHours),
      questionPct: this.pct(pace.questionRate),
      questionHint: this.t('paceQuestionsHint', {
        questioned: pace.questioned,
        raised: pace.raised,
      }),
    };
  }

  /** Hours rendered as the coarsest honest unit: "< 1 h", "18 h", "2,4 T". */
  private formatDuration(hours: number | null): string {
    if (hours === null) return this.t('noneShort');
    if (hours < 1) return this.t('underHour');
    if (hours < 48) return this.t('unitHours', { value: Math.round(hours) });
    const days = new Intl.NumberFormat(this.translate.currentLang || 'en', {
      maximumFractionDigits: 1,
    }).format(hours / 24);
    return this.t('unitDays', { value: days });
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

  weekPct(w: ShipWeek): number {
    return w.count === 0 ? 0 : (w.count / this.weekMax()) * 100;
  }

  weekTitle(w: ShipWeek): string {
    return this.t('throughputWeek', { date: this.weekDate(w.start), count: w.count });
  }

  /** Text equivalent of the sparkline — total, peak week and the running week. */
  throughputLabel(): string {
    const weeks = this.weeks();
    const total = weeks.reduce((sum, w) => sum + w.count, 0);
    return this.t('throughputAria', {
      weeks: WEEKS,
      total,
      max: Math.max(0, ...weeks.map((w) => w.count)),
      current: weeks[weeks.length - 1]?.count ?? 0,
    });
  }

  private weekDate(start: number): string {
    return new Intl.DateTimeFormat(this.translate.currentLang || 'en', {
      day: '2-digit',
      month: '2-digit',
    }).format(new Date(start));
  }

  donutLabel(w: StatWindow): string {
    return this.translate.instant('adminFeedback.dashboard.donutLabel', {
      label: w.label,
      pct: this.pct(w.ratio),
    });
  }
}
