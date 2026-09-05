import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import { InfoNoteComponent } from '../shared/info-note.component';
import type { PatchLineGroup } from './patch-notes';
import { buildPatchCycle } from './patch-cycle';
import type { PatchStack, StackCard } from './patch-stack';

/** Everything the panel puts on screen, resolved once per clock tick. */
interface MonitorView {
  /** 'ontrack' | 'over' — the one bit that colours the whole panel. */
  state: 'ontrack' | 'over';
  /** The answer: the estimated date and how far away it is. */
  date: string;
  when: string;
  /** Which stretch is running: Live → Live, or first test → Live. */
  key: 'cadence' | 'leadTime';
  version: string;
  elapsedDays: number;
  medianDays: number;
  samples: number;
  deltaDays: number;
  hotfixes: number;
  lastHotfix: string;
  /** The cell at the rail's end: the patch the estimate is about. */
  nextLabel: string;
  nextVersion: string;
  /** Rail geometry, 0–100 along the axis. */
  fromPct: number;
  usualPct: number;
  realPct: number;
  /** Coarse month ticks under the rail — the axis said out loud. */
  months: { pct: number; label: string }[];
  /** `grid-template-columns` for the cells, derived from the rail. */
  cols: string;
  aria: string;
}

/**
 * "Wann kommt der nächste Patch?" as a monitoring panel above the board's
 * search and stack (admin feedback 01df732d).
 *
 * The same question already had an answer — but only inside a patch's dossier,
 * three sections down, written out in full sentences with a legend and a facts
 * list. That is the right depth for someone reading ONE patch and the wrong
 * one for the question people come to `/news/patches` with. So this panel puts
 * the answer where the eye lands first and says it the way a status board
 * does: a date, a distance, one rail, three cells.
 *
 * The cells are the rail's legend, not a KPI row (feedback `d83850c7`). Each
 * one explains a part of the rail and sits under it: where the run started
 * (the live patch, with its hotfixes as a side note rather than a readout of
 * their own), how it is going (cadence and state, one judgement instead of two
 * numbers), and where it ends (the next line and its estimated date — the same
 * date as the headline, because that is what the end marker means). A coarse
 * month scale hangs off the rail so the distance has a unit.
 *
 * Nothing here is new data — it is `buildPatchCycle()` on the live line (or the
 * line in testing when nothing is live), the same model the dossier axis draws.
 * The prose that used to carry the caveats — median estimate, no official
 * dates, what the colours mean — sits behind the (i), so the panel is four
 * short lines instead of ten.
 */
@Component({
  selector: 'sc-patch-monitor',
  standalone: true,
  imports: [TranslateModule, InfoNoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      <section class="mon" [attr.data-state]="v.state" [attr.aria-label]="'news.patch.monitor.title' | translate">
        <header class="mh">
          <span class="beacon" aria-hidden="true"></span>
          <h2>{{ 'news.patch.monitor.title' | translate }}</h2>
          <sc-info-note [label]="'news.patch.monitor.infoLabel' | translate">
            <p class="n-first">{{ 'news.patch.next.disclaimer' | translate }}</p>
            <p>{{ 'news.patch.monitor.infoBasis' | translate:{ median: num(v.medianDays), n: v.samples } }}</p>
            <ul class="n-legend">
              <li><i class="sw real"></i>{{ 'news.patch.next.legend.real' | translate }}</li>
              <li><i class="sw usual"></i>{{ 'news.patch.next.legend.usual' | translate }}</li>
              <li><i class="sw over"></i>{{ 'news.patch.next.legend.over' | translate }}</li>
            </ul>
          </sc-info-note>
        </header>

        <!-- The answer, in two words and a number. -->
        <p class="answer">
          <b>{{ v.date }}</b>
          <span>{{ v.when }}</span>
        </p>

        <div class="rail" role="img" [attr.aria-label]="v.aria">
          <span class="bar usual" [style.left.%]="v.fromPct" [style.width.%]="v.usualPct - v.fromPct"></span>
          <span class="bar real" [style.left.%]="v.fromPct" [style.width.%]="min(v.realPct, v.usualPct) - v.fromPct"></span>
          @if (v.realPct > v.usualPct) {
            <span class="bar over" [style.left.%]="v.usualPct" [style.width.%]="v.realPct - v.usualPct"></span>
          }
          <span class="pt from" [style.left.%]="v.fromPct"></span>
          <span class="pt now" [style.left.%]="v.realPct"></span>
          <span class="pt goal" [style.left.%]="v.usualPct"></span>
        </div>

        <!-- Months, deliberately coarse: the rail is a median estimate, so the
             scale under it may not pretend to know days (feedback d83850c7). -->
        @if (v.months.length) {
          <div class="months" aria-hidden="true">
            @for (m of v.months; track m.pct) {
              <span class="mo" [style.left.%]="m.pct">{{ m.label }}</span>
            }
          </div>
        }

        <!-- The cells ARE the rail's legend: each one sits under the stretch it
             explains — where this patch came from, how the run is going, where
             it is headed — so their widths follow the rail (feedback d83850c7). -->
        <dl class="tiles" [style.--tile-cols]="v.cols">
          <div class="tile live">
            <dt>{{ ('news.patch.monitor.tile.' + (v.key === 'cadence' ? 'live' : 'testing')) | translate }}</dt>
            <dd>{{ v.version }}
              <small>{{ 'news.patch.stack.sinceDays' | translate:{ n: v.elapsedDays } }}</small>
              <small class="side">{{ hotfixNote(v) }}</small>
            </dd>
          </div>
          <div class="tile" [attr.data-state]="v.state">
            <dt>{{ 'news.patch.monitor.tile.cadence' | translate }}</dt>
            <dd>{{ stateWord(v) }}<small>{{ 'news.patch.monitor.tile.cadenceStateFoot' | translate:{ days: v.elapsedDays, median: num(v.medianDays), n: v.samples } }}</small></dd>
          </div>
          <div class="tile next">
            <dt>{{ v.nextLabel | translate }}</dt>
            <dd>{{ v.nextVersion }}<small>{{ 'news.patch.monitor.tile.nextEta' | translate:{ date: v.date } }} · {{ v.when }}</small></dd>
          </div>
        </dl>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .mon {
      display: flex; flex-direction: column; gap: 10px;
      padding: 14px 16px 16px; border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--sc-success) 40%, var(--sc-border));
      background: linear-gradient(135deg, color-mix(in srgb, var(--sc-success) 8%, var(--sc-bg-1)), var(--sc-bg-1) 65%);
    }
    .mon[data-state='over'] { border-color: color-mix(in srgb, var(--sc-warning) 45%, var(--sc-border)); background: linear-gradient(135deg, color-mix(in srgb, var(--sc-warning) 8%, var(--sc-bg-1)), var(--sc-bg-1) 65%); }

    .mh { display: flex; align-items: center; gap: 8px; }
    h2 {
      flex: 1 1 auto; margin: 0; font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 600;
      letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-fg-2);
    }
    .beacon { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--sc-success); box-shadow: 0 0 10px var(--sc-success); }
    .mon[data-state='over'] .beacon { background: var(--sc-warning); box-shadow: 0 0 10px var(--sc-warning); }

    .answer { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 0; }
    .answer b { font-family: var(--sc-font-display); font-size: 1.7rem; font-weight: 600; letter-spacing: 0.01em; color: var(--sc-fg-0); }
    .answer span { font-size: max(0.82rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }

    /* The rail: the same construction as the dossier axis, without its labels. */
    .rail { position: relative; height: 10px; margin: 2px 0 4px; border-radius: 5px; background: color-mix(in srgb, var(--sc-fg-2) 16%, transparent); }
    .bar { position: absolute; top: 50%; transform: translateY(-50%); border-radius: 5px; }
    .bar.usual { height: 10px; background: color-mix(in srgb, var(--sc-success) 20%, transparent); }
    .bar.real { height: 4px; background: var(--sc-success); }
    .bar.over { height: 4px; background: var(--sc-warning); }
    .pt { position: absolute; top: 50%; width: 8px; height: 8px; border-radius: 50%; transform: translate(-50%, -50%); background: var(--sc-fg-2); }
    .pt.from { background: color-mix(in srgb, var(--sc-success) 70%, transparent); }
    .pt.now { width: 12px; height: 12px; background: var(--sc-fg-0); box-shadow: 0 0 10px color-mix(in srgb, var(--sc-fg-0) 45%, transparent); }
    .mon[data-state='over'] .pt.now { background: var(--sc-warning); box-shadow: 0 0 10px color-mix(in srgb, var(--sc-warning) 55%, transparent); }
    .pt.goal { width: 10px; height: 10px; border-radius: 2px; transform: translate(-50%, -50%) rotate(45deg); background: var(--sc-bg-0); border: 2px solid var(--sc-accent); }

    /* The month scale: one short name per month, hung off the rail. */
    .months { position: relative; height: 13px; margin: -2px 0 2px; }
    .mo {
      position: absolute; top: 4px; transform: translateX(-50%); white-space: nowrap;
      font-size: max(0.6rem, var(--sc-fs-floor)); color: var(--sc-fg-2); opacity: 0.75;
    }
    .mo::before { content: ''; position: absolute; top: -5px; left: 50%; width: 1px; height: 4px; background: color-mix(in srgb, var(--sc-fg-2) 45%, transparent); }

    /* Three readouts, one row — the rail's legend: the cell boundaries follow
       the rail, so the middle cell straddles "today" and the last one ends at
       the estimate's marker. */
    .tiles { display: grid; grid-template-columns: var(--tile-cols, repeat(3, minmax(0, 1fr))); gap: 1px; margin: 0; background: var(--sc-border); border: 1px solid var(--sc-border); border-radius: 8px; overflow: hidden; }
    .tile { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; background: var(--sc-bg-0); min-width: 0; }
    dt { font-family: var(--sc-font-display); font-size: max(0.6rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-fg-2); }
    dd { display: flex; flex-direction: column; gap: 2px; margin: 0; font-family: var(--sc-font-display); font-size: 1.05rem; font-weight: 600; color: var(--sc-fg-0); overflow-wrap: anywhere; }
    .tile[data-state='ontrack'] dd { color: var(--sc-success); }
    .tile[data-state='over'] dd { color: var(--sc-warning); }
    small { font-family: var(--sc-font-body); font-size: max(0.64rem, var(--sc-fs-floor)); font-weight: 400; color: var(--sc-fg-2); overflow-wrap: anywhere; }
    /* The hotfix line rides along with the live patch — it belongs to it, and
       never earned a readout of its own (feedback d83850c7). */
    .tile .side { opacity: 0.85; }
    .tile.next dd { color: var(--sc-accent); }

    /* Inside the (i): the caveats and the colour key the panel no longer prints. */
    .n-first { margin: 0 0 8px; }
    p { margin: 0 0 8px; }
    p:last-child { margin-bottom: 0; }
    .n-legend { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; color: var(--sc-fg-2); }
    .n-legend li { display: flex; align-items: center; gap: 8px; }
    .sw { display: inline-block; width: 18px; height: 4px; border-radius: 2px; flex: none; }
    .sw.real { background: var(--sc-success); }
    .sw.usual { height: 10px; background: color-mix(in srgb, var(--sc-success) 22%, transparent); }
    .sw.over { background: var(--sc-warning); }

    @media (max-width: 640px) {
      /* Too narrow for the rail alignment to survive: the cells stack and read
         top to bottom in the same order the rail runs left to right. */
      .tiles { grid-template-columns: minmax(0, 1fr); }
      .answer b { font-size: 1.4rem; }
      .months { display: none; }
    }
  `],
})
export class PatchMonitorComponent {
  private readonly t = inject(TranslateService);
  private readonly locale = inject(LocaleService);

  readonly stack = input.required<PatchStack>();
  readonly groups = input.required<readonly PatchLineGroup[]>();
  readonly now = input<number>(Date.now());

  /** The line the question is about: what is live, or what is being tested. */
  private readonly card = computed<StackCard | null>(() => this.stack().live ?? this.stack().next);

  readonly view = computed<MonitorView | null>(() => {
    const card = this.card();
    if (!card) return null;
    const cycle = buildPatchCycle(card, this.groups(), this.now());
    const main = cycle?.main ?? null;
    // A finished cycle answers a historical question, not "when is the next
    // one" — the panel then has nothing to monitor and stays out of the way.
    if (!cycle || !main || main.finished) return null;
    const usualAt = cycle.points.find((p) => p.key === 'usual')?.at ?? NaN;
    if (!Number.isFinite(usualAt)) return null;

    return {
      state: main.deltaDays > 0 ? 'over' : 'ontrack',
      date: this.date(usualAt),
      when: this.until(cycle.daysToNext ?? 0),
      key: main.key,
      version: card.line ? this.t.instant('news.patch.line', { version: card.line }) : '',
      elapsedDays: main.realDays,
      medianDays: main.medianDays,
      samples: main.samples,
      deltaDays: main.deltaDays,
      hotfixes: cycle.hotfixes?.count ?? 0,
      lastHotfix: cycle.hotfixes ? this.date(cycle.hotfixes.lastAt) : '',
      ...this.nextCell(card),
      fromPct: main.fromPct,
      usualPct: main.usualPct,
      realPct: main.realPct,
      months: this.months(cycle.startMs, cycle.endMs),
      cols: this.cols(main.realPct),
      aria: this.t.instant(main.key === 'cadence' ? 'news.patch.next.status.live' : 'news.patch.next.status.testing', {
        line: card.line,
        days: main.realDays,
        median: this.num(main.medianDays),
      }),
    };
  });

  min(a: number, b: number): number {
    return Math.min(a, b);
  }

  /**
   * The cell at the rail's end. While a line is live the estimate is about the
   * NEXT line (`4.11`, the roadmap card); while a line is still in testing the
   * same rail ends at that line's own Live start. Naming the date here repeats
   * the headline on purpose — the cell is the marker's label, and a legend that
   * omits the one number the marker stands for explains nothing.
   */
  private nextCell(card: StackCard): { nextLabel: string; nextVersion: string } {
    const next = this.stack().next;
    if (card.liveAt === null) {
      return { nextLabel: 'news.patch.monitor.tile.goLive', nextVersion: this.lineName(card.line) };
    }
    return next?.line
      ? { nextLabel: 'news.patch.monitor.tile.next', nextVersion: this.lineName(next.line) }
      : { nextLabel: 'news.patch.monitor.tile.next', nextVersion: this.t.instant('news.patch.monitor.tile.nextUnknown') };
  }

  private lineName(line: string): string {
    return line ? this.t.instant('news.patch.line', { version: line }) : '';
  }

  /**
   * Cell widths from the rail: the first boundary sits just left of "today", so
   * the live cell covers the stretch already run, the middle cell straddles the
   * now marker, and the last one reaches the estimate at the far end. Clamped,
   * because a cell narrower than its own label stops being a legend.
   */
  private cols(realPct: number): string {
    const now = Math.min(Math.max(realPct, 0), 100);
    const live = Math.min(Math.max(Math.round(now) - 15, 22), 46);
    const cadence = 30;
    return `minmax(0, ${live}fr) minmax(0, ${cadence}fr) minmax(0, ${100 - live - cadence}fr)`;
  }

  /** "1 Hotfix · 27. Aug." — the live patch's side note, not a readout. */
  hotfixNote(v: MonitorView): string {
    if (v.hotfixes === 0) return this.t.instant('news.patch.monitor.tile.hotfixNone');
    return v.hotfixes === 1
      ? this.t.instant('news.patch.monitor.tile.hotfixOne', { date: v.lastHotfix })
      : this.t.instant('news.patch.monitor.tile.hotfixMany', { n: v.hotfixes, date: v.lastHotfix });
  }

  /**
   * Month starts inside the axis window, short-form. Thinned when the window is
   * long, and dropped near the edges where a centred label would hang over the
   * rail's ends.
   */
  private months(startMs: number, endMs: number): { pct: number; label: string }[] {
    const span = Math.max(endMs - startMs, 1);
    if (!Number.isFinite(span)) return [];
    const first = new Date(startMs);
    const out: { pct: number; label: string }[] = [];
    let cursor = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    while (cursor.getTime() <= endMs && out.length < 24) {
      const pct = Math.round(((cursor.getTime() - startMs) / span) * 1000) / 10;
      if (pct >= 4 && pct <= 96) out.push({ pct, label: this.month(cursor.getTime()) });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return out.length > 6 ? out.filter((_, i) => i % 2 === 0) : out;
  }

  private month(ms: number): string {
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), { month: 'short' }).format(ms);
    } catch {
      return '';
    }
  }

  /** "Im Takt" / "12 T über" — the state tile's one word. */
  stateWord(v: MonitorView): string {
    return v.deltaDays > 0
      ? this.t.instant('news.patch.monitor.over', { n: v.deltaDays })
      : this.t.instant('news.patch.next.fact.onTrack');
  }

  num(n: number): string {
    try {
      return new Intl.NumberFormat(this.locale.intlLocale(), { maximumFractionDigits: 1 }).format(n);
    } catch {
      return String(n);
    }
  }

  private date(ms: number): string {
    if (!Number.isFinite(ms)) return '';
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), { day: 'numeric', month: 'short' }).format(ms);
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  /** "in ~6 Wochen" / "2 Wo. überfällig" — the forecast grammar the app speaks. */
  private until(days: number): string {
    if (days === 0) return this.t.instant('news.patch.forecast.today');
    const overdue = days < 0;
    const n = Math.abs(days);
    if (n < 14) return this.t.instant(overdue ? 'news.patch.forecast.overdueDays' : 'news.patch.forecast.inDays', { n });
    const weeks = Math.round(n / 7);
    return this.t.instant(overdue ? 'news.patch.forecast.overdueWeeks' : 'news.patch.forecast.inWeeks', { n: weeks });
  }
}
