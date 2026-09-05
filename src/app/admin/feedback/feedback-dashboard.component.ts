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
  BoardWeek,
  FeedbackBucket,
  FeedbackPace,
  FeedbackRow,
  LifecycleSnapshot,
  ThreadMap,
  WeekPulse,
  bucketLabelStatus,
  computePace,
  lifecycleSnapshot,
  weeklyPulse,
  weeklySeries,
} from './feedback.types';
import { formatScCalendarDate, formatScCompactDate } from '../../core/locale/date-format';
import { LocaleService } from '../../core/locale/locale.service';

/** Which way a week-over-week change points, and whether that is good news. */
type Tone = 'good' | 'bad' | 'flat' | 'neutral';

/** One headline number for the running week, with last week beside it. */
interface PulseCell {
  key: 'shipped' | 'raised' | 'median';
  label: string;
  /** Already formatted — a count, or a duration like "18 Std." / "—". */
  value: string;
  /** "▲ 3" / "▼ 2" / "±0" — `null` when there is nothing honest to compare. */
  delta: string | null;
  tone: Tone;
  /** The small line under the value: last week's figure, sample size, meaning. */
  hint: string;
  /** Spoken form of value + delta for assistive tech. */
  aria: string;
}

/** One live figure in the "what is on the board right now" strip. */
interface LoadCell {
  key: 'waiting' | 'working' | 'todo';
  label: string;
  value: number;
  hint: string;
  accent: boolean;
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
  /** Detours that leave this stage and come back to it (the two Rückfragen). */
  branches: StageNode[];
}

/** How many weeks the throughput chart covers. */
const WEEKS = 12;

/** Window of the two slow-moving quality figures under the chart, in days. */
const PACE_DAYS = 30;

/**
 * Progress dashboard for the admin feedback board (reachable via the board's
 * chart-glyph view switch).
 *
 * **Rewritten 2026-09-05 (admin feedback a33ba528) around one question: what
 * does a returning admin learn that they did not know last week?** The previous
 * version led with a "This month / All-time" pair — a donut, four bars and two
 * pace figures per column. The all-time column could not move (its share shifts
 * by a fraction of a percent per week, its Done bar only ever grows), the
 * monthly one reset to nothing every 1st, and the lifecycle map underneath was
 * contract documentation rather than a measurement. Together they filled the
 * page with numbers that read the same on every visit.
 *
 * What is here now, in the order it is read:
 *
 * 1. **Diese Woche** — ships, intake and median time-to-ship since Monday, each
 *    against the previous *complete* week, plus a one-line verdict on whether
 *    the backlog grew or shrank. This is the only block with deltas, because it
 *    is the only one whose numbers move on a weekly cadence.
 * 2. **Jetzt auf dem Board** — the live queue: what waits on the admin, what is
 *    in flight, what nobody has picked up, and the age of the oldest open topic.
 *    Not a trend, an action list — the part that is worth knowing *now*.
 * 3. **Durchsatz** — 12 weeks of ships against intake, so "are we keeping up" is
 *    a shape and not an anecdote. The two slow quality figures (median to ship,
 *    Rückfragen rate) sit under it over a 30-day window, where they have enough
 *    topics to mean something.
 * 4. **Lebenszyklus** — the status machine, now collapsed behind a disclosure.
 *    It is reference material: correct, occasionally useful, and unchanged from
 *    week to week, so it no longer occupies the page by default.
 *
 * Honesty rule for everything above: a figure is only printed when the board's
 * own stamps support it. A median over zero ships renders as "—" and never as a
 * zero, a delta is omitted when there is nothing to compare against, and no
 * metric is estimated, projected or hardcoded. There is no transition-history
 * table, so nothing here claims to count transitions.
 *
 * Charts stay hand-rolled SVG/CSS on the existing SCC tokens — no charting
 * dependency, no new palette. The chart is mirrored by a text label for screen
 * readers; bars, dots and meters are decoration and hidden from them.
 */
@Component({
  selector: 'sc-feedback-dashboard',
  standalone: true,
  imports: [TranslateModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="dash" [class.compact]="compact()">
      <!-- ---- 1 · The running week against the one before it ---- -->
      <article class="panel sc-card week">
        <header class="panel-head">
          <h3 class="panel-title">{{ 'adminFeedback.dashboard.weekTitle' | translate }}</h3>
          <span class="panel-sub">{{ weekSub() }}</span>
        </header>

        <dl class="pulse">
          @for (c of pulse(); track c.key) {
            <div class="cell" [attr.data-cell]="c.key">
              <dt>{{ c.label }}</dt>
              <dd>
                <span class="cell-value" [attr.aria-label]="c.aria">
                  <b>{{ c.value }}</b>
                  @if (c.delta) {
                    <span class="delta" [attr.data-tone]="c.tone" aria-hidden="true">{{ c.delta }}</span>
                  }
                </span>
                <small>{{ c.hint }}</small>
              </dd>
            </div>
          }
        </dl>

        <p class="verdict" [attr.data-tone]="verdict().tone">{{ verdict().text }}</p>
      </article>

      <!-- ---- 2 · What is on the board right now ---- -->
      <article class="panel sc-card load">
        <header class="panel-head">
          <h3 class="panel-title">{{ 'adminFeedback.dashboard.loadTitle' | translate }}</h3>
          <span class="panel-sub">{{ 'adminFeedback.dashboard.loadSub' | translate }}</span>
        </header>

        <dl class="load-grid">
          @for (c of load(); track c.key) {
            <div class="cell" [class.accent]="c.accent">
              <dt>{{ c.label }}</dt>
              <dd>
                <b>{{ c.value }}</b>
                <small>{{ c.hint }}</small>
              </dd>
            </div>
          }
        </dl>

        <p class="load-age">{{ oldestLine() }}</p>
      </article>

      <!-- ---- 3 · Throughput: ships against intake, 12 weeks ---- -->
      <article class="panel sc-card">
        <header class="panel-head">
          <h3 class="panel-title">{{ 'adminFeedback.dashboard.throughputTitle' | translate }}</h3>
          <span class="panel-sub">{{ 'adminFeedback.dashboard.throughputSub' | translate: { weeks: weekSpan } }}</span>
        </header>

        <div class="spark" role="img" [attr.aria-label]="throughputLabel()">
          @for (w of weeks(); track w.start) {
            <span class="wk" [class.now]="w.current" [attr.title]="weekTitle(w)">
              <span class="wk-raised" [style.height.%]="weekPct(w.raised)"></span>
              <span class="wk-shipped" [style.height.%]="weekPct(w.count)"></span>
            </span>
          }
        </div>
        <div class="spark-axis" aria-hidden="true">
          <span>{{ 'adminFeedback.dashboard.throughputFrom' | translate: { weeks: weekSpan } }}</span>
          <span>{{ 'adminFeedback.dashboard.throughputNow' | translate }}</span>
        </div>
        <ul class="legend" aria-hidden="true">
          <li><span class="swatch raised"></span>{{ 'adminFeedback.dashboard.legendRaised' | translate }}</li>
          <li><span class="swatch shipped"></span>{{ 'adminFeedback.dashboard.legendShipped' | translate }}</li>
        </ul>

        <dl class="quality">
          <div class="cell">
            <dt>{{ 'adminFeedback.dashboard.paceMedian' | translate }}</dt>
            <dd>{{ paceMedian() }}<small>{{ 'adminFeedback.dashboard.paceWindow' | translate: { days: paceDays } }}</small></dd>
          </div>
          <div class="cell">
            <dt>{{ 'adminFeedback.dashboard.paceQuestions' | translate }}</dt>
            <dd>{{ paceQuestionPct() }}%<small>{{ paceQuestionHint() }}</small></dd>
          </div>
        </dl>
      </article>

      <!-- ---- 4 · Lifecycle map — reference, collapsed by default ---- -->
      <details class="panel sc-card flow">
        <summary class="panel-head">
          <span class="panel-title">{{ 'adminFeedback.dashboard.lifecycleTitle' | translate }}</span>
          <span class="panel-sub">{{ 'adminFeedback.dashboard.lifecycleTeaser' | translate }}</span>
        </summary>

        <div class="flow-body">
          <p class="panel-sub">{{ 'adminFeedback.dashboard.lifecycleIntro' | translate }}</p>

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

          <!-- The spine carries the path itself. A branch (a Rückfrage) is drawn
               INSIDE the stage it leaves from and loops back into, because that is
               what it is — not a second category underneath the diagram. -->
          <ol class="stages">
            @for (s of mainStages(); track s.key) {
              <li class="stage" [attr.data-stage]="s.key">
                <ng-container [ngTemplateOutlet]="node" [ngTemplateOutletContext]="{ $implicit: s }" />
                @if (s.branches.length) {
                  <ul class="branches">
                    @for (b of s.branches; track b.key) {
                      <li class="stage is-branch" [attr.data-stage]="b.key">
                        <span class="branch-tag">{{ 'adminFeedback.dashboard.lifecycleBranch' | translate }}</span>
                        <ng-container [ngTemplateOutlet]="node" [ngTemplateOutletContext]="{ $implicit: b }" />
                      </li>
                    }
                  </ul>
                }
              </li>
            }
          </ol>

          <!-- …and it ends in exactly one of these. Rendered as a visible fork so
               "either shipped or handed to an issue" is the shape of the diagram
               rather than a sentence somebody has to read. -->
          <div class="outcomes">
            <span class="fork" aria-hidden="true"></span>
            <h4 class="outcome-title">{{ 'adminFeedback.dashboard.lifecycleOutcome' | translate }}</h4>
            <ul class="stages outcome-list">
              @for (s of outcomeStages(); track s.key) {
                <li class="stage is-outcome" [attr.data-stage]="s.key">
                  <ng-container [ngTemplateOutlet]="node" [ngTemplateOutletContext]="{ $implicit: s }" />
                </li>
              }
            </ul>
          </div>

          <p class="panel-note">{{ 'adminFeedback.dashboard.lifecycleNote' | translate }}</p>
        </div>
      </details>
    </section>
  `,
  styles: [`
    /* Container query context: the docked FAB panel is far narrower than the
       full board page, and only the container knows which one it is in. */
    .dash { display: flex; flex-direction: column; gap: 10px; container-type: inline-size; }

    /* ---- Shared panel chrome ---- */
    .panel { display: flex; flex-direction: column; gap: 10px; padding: 14px 12px; }
    .panel-head { display: flex; flex-direction: column; gap: 2px; }
    .panel-title {
      display: block;
      margin: 0;
      font-size: max(0.68rem, var(--sc-fs-floor));
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .panel-sub, .panel-note { font-size: max(0.66rem, var(--sc-fs-floor)); line-height: 1.4; color: var(--sc-fg-2); }
    .panel-note { margin: 0; padding-top: 2px; }

    /* ---- 1 · Diese Woche ----
       Three equal cells. They collapse to one column well before the docked
       panel gets narrow, because a two-line number squeezed into a third of
       360px is where a block like this becomes unreadable. */
    .pulse, .load-grid, .quality { display: grid; margin: 0; gap: 10px; }
    .pulse { grid-template-columns: repeat(3, 1fr); }
    @container (max-width: 380px) { .pulse { grid-template-columns: 1fr; gap: 8px; } }

    .cell { min-width: 0; }
    .cell dt {
      font-size: max(0.62rem, var(--sc-fs-floor));
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
      overflow-wrap: anywhere;
    }
    .cell dd { margin: 3px 0 0; min-width: 0; }
    .cell dd b { font-size: 1.5rem; font-weight: 700; line-height: 1.05; color: var(--sc-fg-0); }
    .cell dd small {
      display: block;
      margin-top: 3px;
      font-size: max(0.6rem, var(--sc-fs-floor));
      line-height: 1.35;
      color: var(--sc-fg-2);
      overflow-wrap: anywhere;
    }
    .cell-value { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; }

    .delta {
      flex: 0 0 auto;
      padding: 1px 6px;
      border: 1px solid var(--sc-border);
      border-radius: 999px;
      font-size: max(0.62rem, var(--sc-fs-floor));
      font-weight: 600;
      white-space: nowrap;
      color: var(--sc-fg-2);
    }
    .delta[data-tone='good'] { color: var(--sc-success); border-color: var(--sc-success); }
    .delta[data-tone='bad'] { color: var(--sc-warning); border-color: var(--sc-warning); }

    .verdict {
      margin: 0;
      padding-top: 9px;
      border-top: 1px solid var(--sc-border);
      font-size: max(0.72rem, var(--sc-fs-floor));
      line-height: 1.45;
      color: var(--sc-fg-1);
    }
    .verdict[data-tone='good'] { color: var(--sc-success); }
    .verdict[data-tone='bad'] { color: var(--sc-warning); }

    /* ---- 2 · Jetzt auf dem Board ---- */
    .load-grid { grid-template-columns: repeat(3, 1fr); }
    @container (max-width: 380px) { .load-grid { grid-template-columns: 1fr; gap: 8px; } }
    .load-grid .cell dd b { font-size: 1.25rem; }
    .load-grid .cell.accent dd b { color: var(--sc-accent); }
    .load-age {
      margin: 0;
      padding-top: 9px;
      border-top: 1px solid var(--sc-border);
      font-size: max(0.66rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
    }

    /* ---- 3 · Throughput ----
       One column per week. The faint full-width column is what came IN, the
       solid inner column is what SHIPPED — so a week where the solid bar reaches
       the faint one is a week that kept up, at a glance and without a second
       axis to read. */
    .spark { display: flex; align-items: flex-end; gap: 3px; height: 72px; }
    .wk {
      position: relative;
      flex: 1 1 0;
      min-width: 0;
      height: 100%;
      border-radius: 3px;
      background: var(--sc-bg-2);
      overflow: hidden;
    }
    .wk-raised, .wk-shipped {
      position: absolute;
      bottom: 0;
      display: block;
      border-radius: 3px;
      transition: height 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    .wk-raised { left: 0; right: 0; background: var(--sc-fg-2); opacity: 0.28; }
    .wk-shipped { left: 22%; right: 22%; background: var(--sc-success); }
    .wk.now .wk-shipped { background: var(--sc-accent); }

    .spark-axis {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: max(0.6rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
    }
    .legend {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      margin: 0;
      padding: 0;
      font-size: max(0.62rem, var(--sc-fs-floor));
      color: var(--sc-fg-2);
    }
    .legend li { display: inline-flex; align-items: center; gap: 6px; }
    .swatch { width: 10px; height: 10px; border-radius: 3px; }
    .swatch.raised { background: var(--sc-fg-2); opacity: 0.28; }
    .swatch.shipped { background: var(--sc-success); }

    .quality { grid-template-columns: 1fr 1fr; padding-top: 9px; border-top: 1px solid var(--sc-border); }
    .quality .cell dd { margin: 2px 0 0; font-size: 0.95rem; font-weight: 600; color: var(--sc-fg-0); line-height: 1.15; }
    .quality .cell dd small { font-weight: 400; }

    /* ---- 4 · Lifecycle map, behind a disclosure ----
       A vertical spine rather than a horizontal flow chart: it is the only
       layout that survives the docked panel width unchanged, never scrolls
       sideways, and reads correctly as a plain list for assistive tech. */
    details.flow { position: relative; gap: 0; }
    details.flow > summary { cursor: pointer; list-style: none; padding-right: 20px; }
    details.flow > summary::-webkit-details-marker { display: none; }
    details.flow > summary::after {
      content: '▾';
      position: absolute;
      right: 12px;
      top: 12px;
      color: var(--sc-fg-2);
      transition: transform 0.18s ease;
    }
    details.flow[open] > summary::after { transform: rotate(180deg); }
    details.flow > summary:focus-visible {
      outline: none;
      border-radius: 6px;
      box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.32);
    }
    .flow-body { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; }

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
    .stage[data-stage='review'] .dot { background: var(--sc-success); }
    .stage[data-stage='shipped'] .dot { background: var(--sc-success); }
    .stage[data-stage='issue_created'] .dot { background: #a78bfa; }
    .stage[data-stage='awaiting_admin'] .dot { background: #a78bfa; }
    .stage[data-stage='awaiting_author'] .dot { background: #a78bfa; }
    .stage[data-stage='declined'] .dot { background: var(--sc-fg-2); }
    .stage[data-stage='rejected'] .dot { background: var(--sc-danger); }

    /* ---- Branches: a Rückfrage lives inside the stage it detours from ---- */
    .branches {
      list-style: none;
      margin: 8px 0 0;
      padding: 0 0 0 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-left: 2px dashed var(--sc-border);
    }
    .stage.is-branch {
      padding: 7px 9px 7px 22px;
      border: 1px dashed var(--sc-border);
      border-radius: 6px;
      background: var(--sc-bg-1);
    }
    .stage.is-branch .dot { left: 8px; top: 12px; }
    .branch-tag {
      display: inline-block;
      margin-bottom: 3px;
      font-size: max(0.56rem, var(--sc-fs-floor));
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }

    /* ---- Outcome fork: the path ends in exactly one of these ---- */
    .outcomes { position: relative; margin-top: 12px; padding-top: 14px; }
    .fork {
      position: absolute;
      left: 4px;
      top: -10px;
      width: 2px;
      height: 22px;
      background: var(--sc-border);
    }
    .outcome-title {
      margin: 0 0 8px;
      padding-left: 18px;
      font-size: max(0.62rem, var(--sc-fs-floor));
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--sc-fg-2);
    }
    .outcome-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    @container (max-width: 380px) { .outcome-list { grid-template-columns: 1fr; } }
    .stage.is-outcome {
      padding: 9px 10px 9px 22px;
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      background: var(--sc-bg-1);
    }
    .stage.is-outcome .dot { left: 8px; top: 13px; }
    .stage.is-outcome[data-stage='shipped'] { border-color: var(--sc-success); }
    .stage.is-outcome[data-stage='issue_created'] { border-color: #a78bfa; }

    .stage-head { display: flex; align-items: baseline; gap: 8px; }
    .stage-name { font-size: max(0.78rem, var(--sc-fs-floor)); font-weight: 600; color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .stage-count { margin-left: auto; font-size: 0.92rem; font-weight: 700; color: var(--sc-fg-1); }
    .stage[data-stage='todo'] .stage-count { color: var(--sc-accent); }
    .stage[data-stage='in_progress'] .stage-count { color: var(--sc-warning); }
    .stage[data-stage='review'] .stage-count { color: var(--sc-success); }
    .stage[data-stage='shipped'] .stage-count { color: var(--sc-success); }
    .stage[data-stage='issue_created'] .stage-count { color: #a78bfa; }
    .stage[data-stage='awaiting_admin'] .stage-count { color: #a78bfa; }
    .stage[data-stage='awaiting_author'] .stage-count { color: #a78bfa; }

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
    .stage[data-stage='review'] .meter-fill { background: var(--sc-success); }
    .stage[data-stage='shipped'] .meter-fill { background: var(--sc-success); }
    .stage[data-stage='issue_created'] .meter-fill { background: #a78bfa; }
    .stage[data-stage='awaiting_admin'] .meter-fill { background: #a78bfa; }
    .stage[data-stage='awaiting_author'] .meter-fill { background: #a78bfa; }

    .facts, .exits { list-style: none; margin: 5px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
    .facts li { font-size: max(0.64rem, var(--sc-fs-floor)); line-height: 1.35; color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .exits li {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 6px;
      font-size: max(0.64rem, var(--sc-fs-floor));
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
      .wk-raised, .wk-shipped, .meter-fill { transition: none; }
      details.flow > summary::after { transition: none; }
    }

    .dash.compact .panel { padding: 12px 10px; }
    .dash.compact .spark { height: 58px; }
    .dash.compact .cell dd b { font-size: 1.3rem; }
  `],
})
export class FeedbackDashboardComponent {
  private readonly translate = inject(TranslateService);
  private readonly locale = inject(LocaleService);

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

  readonly weekSpan = WEEKS;
  readonly paceDays = PACE_DAYS;

  private readonly weekPulse = computed<WeekPulse>(() => weeklyPulse(this.rows()));

  readonly weeks = computed<BoardWeek[]>(() => weeklySeries(this.rows(), WEEKS));

  /** Tallest column across BOTH series, floored at 1 so an empty board renders. */
  private readonly weekMax = computed(() =>
    Math.max(1, ...this.weeks().flatMap((w) => [w.count, w.raised])),
  );

  private readonly snapshot = computed<LifecycleSnapshot>(() =>
    lifecycleSnapshot(this.rows(), this.threads()),
  );

  /**
   * The 30-day quality window. Wide enough that the median and the Rückfragen
   * rate are computed over a double-digit number of topics on a normal board —
   * at one week these two swing between 0 % and 50 % on a single topic, which is
   * noise dressed up as a trend.
   */
  private readonly pace = computed<FeedbackPace>(() =>
    computePace(this.rows(), this.threads(), Date.now() - PACE_DAYS * 86_400_000),
  );

  /** "Seit Montag, 01.09." — the frame every number in the block is counted in. */
  readonly weekSub = computed(() => {
    this.lang();
    return this.translate.instant('adminFeedback.dashboard.weekSub', {
      date: formatScCalendarDate(
        new Date(this.weekPulse().weekStart),
        this.locale.language(),
        this.locale.region(),
      ),
    });
  });

  readonly pulse = computed<PulseCell[]>(() => {
    const p = this.weekPulse();
    this.lang();
    return [
      this.countCell('shipped', p.shipped, p.shippedPrev, true),
      // More topics arriving is not bad news — it is a busier week, and the
      // verdict line below is where "in vs. out" is actually judged. So the
      // intake delta stays tone-neutral rather than being painted as a warning.
      this.countCell('raised', p.raised, p.raisedPrev, false),
      this.medianCell(p),
    ];
  });

  /**
   * The one sentence the block exists for: did the pile grow or shrink this
   * week? Stated in words because "7 against 4" is a comparison the reader
   * should not have to perform.
   */
  readonly verdict = computed<{ text: string; tone: Tone }>(() => {
    const p = this.weekPulse();
    this.lang();
    if (p.shipped === 0 && p.raised === 0) {
      return { text: this.t('verdictIdle'), tone: 'neutral' };
    }
    const net = p.shipped - p.raised;
    if (net > 0) return { text: this.t('verdictDown', { count: net }), tone: 'good' };
    if (net < 0) return { text: this.t('verdictUp', { count: -net }), tone: 'bad' };
    return { text: this.t('verdictEven'), tone: 'flat' };
  });

  /** The live queue — three counts, each with what it is made of. */
  readonly load = computed<LoadCell[]>(() => {
    const s = this.snapshot();
    this.lang();
    // Everything that cannot move without the admin: a Rückfrage aimed at them,
    // a finished topic in the sign-off gate, and a review hold whose PR waits
    // for a human merge.
    const waiting = s.counts.awaiting_admin + s.counts.review + s.reviewHolds;
    const waitingParts: string[] = [];
    if (s.counts.awaiting_admin) {
      waitingParts.push(this.t('loadWaitingAsk', { count: s.counts.awaiting_admin }));
    }
    if (s.counts.review) waitingParts.push(this.t('loadWaitingReview', { count: s.counts.review }));
    if (s.reviewHolds) waitingParts.push(this.t('loadWaitingHold', { count: s.reviewHolds }));

    const todoParts: string[] = [];
    if (s.answered) todoParts.push(this.t('loadTodoAnswered', { count: s.answered }));
    if (s.continuations) {
      todoParts.push(this.t('loadTodoContinuation', { count: s.continuations }));
    }

    return [
      {
        key: 'waiting',
        label: this.t('loadWaiting'),
        value: waiting,
        hint: waitingParts.length ? waitingParts.join(' · ') : this.t('loadWaitingNone'),
        accent: waiting > 0,
      },
      {
        key: 'working',
        label: this.t('loadWorking'),
        value: s.working + s.counts.awaiting_author,
        hint: this.t('loadWorkingHint', { working: s.working, author: s.counts.awaiting_author }),
        accent: false,
      },
      {
        key: 'todo',
        label: this.t('loadTodo'),
        value: s.counts.todo,
        hint: todoParts.length ? todoParts.join(' · ') : this.t('loadTodoHint'),
        accent: false,
      },
    ];
  });

  /** Age of the oldest topic still in flight — the number that only ever rots. */
  readonly oldestLine = computed(() => {
    const days = this.snapshot().oldestActiveDays;
    this.lang();
    return days === null ? this.t('oldestNone') : this.t('oldest', { days });
  });

  readonly paceMedian = computed(() => {
    this.lang();
    return this.formatDuration(this.pace().medianShipHours);
  });

  readonly paceQuestionPct = computed(() => this.pct(this.pace().questionRate));

  readonly paceQuestionHint = computed(() => {
    const p = this.pace();
    this.lang();
    return this.t('paceQuestionsHint', { questioned: p.questioned, raised: p.raised });
  });

  /**
   * The path itself: ToDo → In Arbeit → Abnahme. Each Rückfrage hangs off the
   * stage it leaves from as a `branch`, so the diagram shows what it is — a
   * detour that comes back — instead of listing it as a separate category
   * underneath.
   */
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

    const reviewFacts: string[] = [this.t('fact.reviewWhy')];
    if (s.reviewShipped) reviewFacts.push(this.t('fact.reviewShipped', { count: s.reviewShipped }));
    if (s.reviewIssues) reviewFacts.push(this.t('fact.reviewIssues', { count: s.reviewIssues }));

    // The two Rückfrage flavours: one the routine asks the admin, one the admin
    // asks the person who filed the topic. Both leave "In Arbeit" and both come
    // back to it — that loop is the point, hence `back: true` on the return.
    const branches: StageNode[] = [
      this.toStage('awaiting_admin', s, s.counts.awaiting_admin ? [this.t('fact.awaiting')] : [], [
        { label: this.t('flow.answered'), target: this.stageLabel('todo'), back: true },
      ]),
      this.toStage('awaiting_author', s, [], [
        { label: this.t('flow.authorAnswered'), target: this.stageLabel('todo'), back: true },
      ]),
    ];

    return [
      this.toStage('todo', s, todoFacts, [
        { label: this.t('flow.pickup'), target: this.stageLabel('in_progress'), back: false },
      ]),
      this.toStage(
        'in_progress',
        s,
        workFacts,
        [
          { label: this.t('flow.toReview'), target: this.stageLabel('review'), back: false },
          { label: this.t('flow.toReviewIssue'), target: this.stageLabel('review'), back: false },
          { label: this.t('flow.question'), target: this.stageLabel('awaiting_admin'), back: false },
          { label: this.t('flow.askAuthor'), target: this.stageLabel('awaiting_author'), back: false },
          { label: this.t('flow.hold'), target: this.t('flow.holdTarget'), back: true },
          { label: this.t('flow.reaper'), target: this.stageLabel('todo'), back: true },
        ],
        branches,
      ),
      this.toStage('review', s, reviewFacts, [
        { label: this.t('flow.accepted'), target: this.stageLabel('shipped'), back: false },
        { label: this.t('flow.reopened'), target: this.stageLabel('todo'), back: true },
      ]),
    ];
  });

  /**
   * Where the path ends — exactly one of these per topic. A fork rather than a
   * list: "either shipped or handed to an issue" is the shape of the machine,
   * and `declined` is the third way out for a topic somebody filed and the admin
   * decided against. Legacy `rejected` only appears while such rows still exist.
   */
  readonly outcomeStages = computed<StageNode[]>(() => {
    const s = this.snapshot();
    this.lang();
    const stages: StageNode[] = [
      this.toStage('shipped', s, [this.t('fact.doneTerminal')], [
        { label: this.t('flow.continue'), target: this.stageLabel('in_progress'), back: true },
      ]),
      this.toStage('issue_created', s, [this.t('fact.issueTerminal')], []),
    ];
    if (s.counts.declined) {
      stages.push(this.toStage('declined', s, [this.t('fact.declinedTerminal')], []));
    }
    if (s.counts.rejected) {
      stages.push(this.toStage('rejected', s, [this.t('fact.rejectedLegacy')], []));
    }
    return stages;
  });

  /**
   * A plain count against last week's. `upIsGood` decides the colour, not the
   * sign — more ships is progress, more intake is just a busier week.
   */
  private countCell(
    key: 'shipped' | 'raised',
    value: number,
    prev: number,
    upIsGood: boolean,
  ): PulseCell {
    const diff = value - prev;
    const tone: Tone = !upIsGood ? 'neutral' : diff > 0 ? 'good' : diff < 0 ? 'bad' : 'flat';
    return {
      key,
      label: this.t(`${key}Label`),
      value: String(value),
      delta: this.deltaChip(diff),
      tone,
      hint: this.t('prevWeek', { value: prev }),
      aria: this.t(`${key}Aria`, { value, prev }),
    };
  }

  /**
   * Median time-to-ship, which needs more care than a count: it does not exist
   * for a week without ships (rendered "—", never a 0), the delta is direction
   * only (a percentage change over a handful of ships pretends to a precision
   * the data has not got), and the sample size is printed so a median over a
   * single ship is visibly a median over a single ship.
   */
  private medianCell(p: WeekPulse): PulseCell {
    const now = p.medianShipHours;
    const prev = p.medianShipHoursPrev;
    let delta: string | null = null;
    let tone: Tone = 'neutral';
    if (now !== null && prev !== null) {
      // Faster is better, so a FALLING median is the good direction.
      const same = Math.round(now) === Math.round(prev);
      const faster = now < prev;
      delta = same ? '±' : faster ? '▼' : '▲';
      tone = same ? 'flat' : faster ? 'good' : 'bad';
    }
    return {
      key: 'median',
      label: this.t('medianLabel'),
      value: this.formatDuration(now),
      delta,
      tone,
      hint: this.t(p.medianSample === 0 ? 'medianHintNone' : 'medianHint', {
        count: p.medianSample,
        prev: this.formatDuration(prev),
      }),
      aria: this.t('medianAria', {
        value: this.formatDuration(now),
        prev: this.formatDuration(prev),
      }),
    };
  }

  /** "▲ 3" / "▼ 2" / "±0" — never a bare sign, so the size is always visible. */
  private deltaChip(diff: number): string {
    if (diff === 0) return '±0';
    return diff > 0 ? `▲ ${diff}` : `▼ ${-diff}`;
  }

  private toStage(
    key: FeedbackBucket,
    snapshot: LifecycleSnapshot,
    facts: string[],
    exits: StageExit[],
    branches: StageNode[] = [],
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
      branches,
    };
  }

  /** Bucket → its board label, so the map speaks the board's vocabulary. */
  private stageLabel(key: FeedbackBucket): string {
    return this.translate.instant(`adminFeedback.status.${bucketLabelStatus(key)}`);
  }

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(`adminFeedback.dashboard.${key}`, params);
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

  pct(ratio: number): number {
    return Math.round(ratio * 100);
  }

  weekPct(value: number): number {
    return value === 0 ? 0 : (value / this.weekMax()) * 100;
  }

  weekTitle(w: BoardWeek): string {
    return this.t('throughputWeek', {
      date: this.weekDate(w.start),
      count: w.count,
      raised: w.raised,
    });
  }

  /** Text equivalent of the chart — both series, the peak and the running week. */
  throughputLabel(): string {
    const weeks = this.weeks();
    const shipped = weeks.reduce((sum, w) => sum + w.count, 0);
    const raised = weeks.reduce((sum, w) => sum + w.raised, 0);
    return this.t('throughputAria', {
      weeks: WEEKS,
      shipped,
      raised,
      max: Math.max(0, ...weeks.map((w) => w.count)),
      current: weeks[weeks.length - 1]?.count ?? 0,
    });
  }

  /**
   * Chart axis tick. Numeric short form on purpose — a spelled-out month does
   * not fit a few-pixel chart label; the field ORDER still follows the resolved
   * region (feedback 38b3d25a).
   */
  private weekDate(start: number): string {
    return formatScCompactDate(new Date(start), this.locale.language(), this.locale.region());
  }
}
