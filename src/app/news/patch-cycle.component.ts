import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import type { PatchLineGroup } from './patch-notes';
import { InfoNoteComponent } from '../shared/info-note.component';
import { PatchCadenceComponent } from './patch-cadence.component';
import { buildPatchCycle, type CyclePoint, type CyclePointKey, type CycleStretch } from './patch-cycle';
import { computePatchStats, liveReleaseAt } from './patch-stats';
import type { StackCard } from './patch-stack';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One labelled milestone under the axis: the chip, the name, the date. */
interface CycleMark {
  key: CyclePointKey;
  chip: 'live' | 'ptu' | 'next' | 'superseded' | null;
  label: string;
  date: string;
}

/**
 * "Wann kommt der nächste?" — the cycle axis (rethink Ⓚ, iteration 4; anchor
 * logic corrected 2026-09-05 after the PO + designer review).
 *
 * PRIMARY is the real situation, SECONDARY the usual one — and both are drawn
 * from the SAME anchor over the SAME stretch, so the eye can compare them:
 *
 *   ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬   usual (muted, taller, behind): anchor + median
 *   ━━━━━━━━━━●                real (active, thinner, in front): anchor → today
 *              ━━━━            overshoot (warning): only the part past "usual"
 *
 * The same construction is applied retrospectively to the test phase (first
 * test build → Live, in PTU cyan). Hotfixes collapse into one counted marker.
 *
 * The rail carries markers, not prose (feedback 01df732d, follow-up). Labels
 * used to be pinned to their own percentage above and below the rail, and as
 * soon as two markers sat close together — which the middle of every cycle
 * does — their chips, names and dates printed over each other and over the
 * facts underneath. So the naming moved off the rail: at most THREE milestones
 * (start → Live → end) in a flow row that shares the width, "today" alone in a
 * band of its own, and one line of facts per stretch below — the median as the
 * subordinate clause, never the headline. A marker that has no room for a name
 * keeps its dot and gives it up; hover still tells. The old KPI charts stay
 * folded underneath — nothing was approved for removal.
 */
@Component({
  selector: 'sc-patch-cycle',
  standalone: true,
  imports: [TranslateModule, InfoNoteComponent, PatchCadenceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cycle(); as c) {
      <div class="lede">
        <p class="sentence">
          @if (c.main; as m) {
            @if (!m.finished) {
              <b>{{ (m.key === 'cadence' ? 'news.patch.next.sentenceLive' : 'news.patch.next.sentencePlanned')
                    | translate:{ line: card().line, date: date(usualAt()), when: until(c.daysToNext ?? 0) } }}</b>
              <span class="status">{{ statusLine(m) }}</span>
            } @else {
              <b>{{ 'news.patch.next.sentenceHistory' | translate:{ line: card().line, next: nextVersion(), date: date(nextAt()), days: m.realDays, median: num(m.medianDays) } }}</b>
              <span class="status">{{ deviation(m) }}</span>
            }
          }
        </p>
        <!-- The caveats and the colour key: true, and not worth four lines of
             screen on every read (feedback 01df732d) — they live under the (i). -->
        <sc-info-note [label]="'news.patch.next.infoLabel' | translate">
          <p class="note-p">{{ 'news.patch.next.disclaimer' | translate }}</p>
          <p class="note-p">{{ 'news.patch.next.markers' | translate }}</p>
          <ul class="note-legend">
            <li><i class="sw lead"></i>{{ 'news.patch.next.legend.lead' | translate }}</li>
            <li><i class="sw real"></i>{{ 'news.patch.next.legend.real' | translate }}</li>
            <li><i class="sw usual"></i>{{ 'news.patch.next.legend.usual' | translate }}</li>
            <li><i class="sw over"></i>{{ 'news.patch.next.legend.over' | translate }}</li>
          </ul>
        </sc-info-note>
      </div>

      <div class="axis">
        <!-- Only the rail itself is the picture: the milestones and facts under
             it are text, and a role="img" around them would hide them from a
             screen reader that could otherwise just read them. -->
        <div class="track" role="img" [attr.aria-label]="aria()">
          @if (pastEnd(); as end) {
            <span class="bar past" [style.left.%]="0" [style.width.%]="end"></span>
          }
          @if (c.lead; as l) {
            <span class="bar usual lead" [style.left.%]="l.fromPct" [style.width.%]="l.usualPct - l.fromPct"></span>
            <span class="bar real lead" [style.left.%]="l.fromPct" [style.width.%]="min(l.realPct, l.usualPct) - l.fromPct"></span>
            @if (l.realPct > l.usualPct) {
              <span class="bar over" [style.left.%]="l.usualPct" [style.width.%]="l.realPct - l.usualPct"></span>
            }
          }
          @if (c.main; as m) {
            <span class="bar usual" [style.left.%]="m.fromPct" [style.width.%]="m.usualPct - m.fromPct"></span>
            <span class="bar real" [style.left.%]="m.fromPct" [style.width.%]="min(m.realPct, m.usualPct) - m.fromPct"></span>
            @if (m.realPct > m.usualPct) {
              <span class="bar over" [style.left.%]="m.usualPct" [style.width.%]="m.realPct - m.usualPct"></span>
            }
          }
          @for (p of c.points; track p.key + p.at) {
            <span class="pt" [attr.data-key]="p.key" [style.left.%]="p.pct" [attr.title]="pointTitle(p)"></span>
          }
        </div>

        <!-- The only marker that still carries its name ON the rail: today.
             A single caption has nothing to collide with, and it is clamped at
             both ends so it cannot leave the axis either. -->
        @if (nowPoint(); as n) {
          <div class="nowband">
            <span class="tick" [style.left.%]="n.pct"></span>
            <span class="today" [attr.data-edge]="edgeOf(n.pct)" [style.left.%]="n.pct">
              <b>{{ 'news.patch.next.point.now' | translate }}</b> · {{ date(n.at) }}
            </span>
          </div>
        }

        <!-- The axis' legend: at most three milestones — where the run starts,
             where it stands, where it ends — laid out as a row IN FLOW. Every
             label used to float at its own percentage, so on a narrow axis they
             collided with each other and with the facts underneath (feedback
             01df732d). Boxes in a flow row cannot overlap at any width, and the
             markers they name keep their place on the rail. -->
        <ol class="marks">
          @for (m of milestones(); track m.key) {
            <li class="mark" [attr.data-key]="m.key">
              <span class="head">
                @if (m.chip; as chip) {
                  <span class="chip" [attr.data-status]="chip">{{ ('news.patch.status.' + chip) | translate }}</span>
                }
                <b>{{ m.label }}</b>
              </span>
              <small>{{ m.date }}</small>
            </li>
          }
        </ol>

        <ul class="facts">
          @if (c.lead; as l) {
            <li><b>{{ 'news.patch.next.fact.lead' | translate:{ days: l.realDays } }}</b>
              <span>{{ 'news.patch.next.fact.usual' | translate:{ median: num(l.medianDays), n: l.samples } }}</span>
              <span class="dev" [class.good]="l.deltaDays < 0" [class.bad]="l.deltaDays > 0">{{ deviation(l) }}</span></li>
          }
          @if (c.previousCycle; as pc) {
            <li><b>{{ 'news.patch.next.fact.cadence' | translate:{ days: pc.days } }}</b>
              <span>{{ 'news.patch.next.fact.usual' | translate:{ median: num(pc.medianDays), n: pc.samples } }}</span>
              <span class="dev" [class.good]="pc.days < pc.medianDays" [class.bad]="pc.days > pc.medianDays">{{ deviationDays(pc.days - pc.medianDays) }}</span></li>
          }
          @if (c.hotfixes; as h) {
            <li><b>{{ 'news.patch.next.fact.hotfix' | translate:{ n: h.count } }}</b>
              <span>{{ 'news.patch.next.fact.hotfixLast' | translate:{ date: date(h.lastAt) } }}</span></li>
          }
        </ul>
      </div>
    } @else {
      <!-- Announced, nothing built yet: there is no real stretch to draw, so
           the section answers its own question in words. An axis here would
           have to borrow another patch's dates — misleading under this
           heading — so it stays out; the medians carry the estimate. -->
      <div class="lede">
        <p class="sentence">
          @if (plannedQuarter(); as q) {
            <b>{{ 'news.patch.next.planned.sentence' | translate:{ line: card().line, quarter: q } }}</b>
          } @else {
            <b>{{ 'news.patch.next.planned.unknown' | translate:{ line: card().line } }}</b>
          }
          @if (hasProjection()) {
            <span class="status">{{ 'news.patch.next.planned.status' | translate:{ date: date(projectedLiveAt()) } }}</span>
          }
        </p>
        <sc-info-note [label]="'news.patch.next.infoLabel' | translate">
          <p class="note-p">{{ 'news.patch.next.disclaimer' | translate }}</p>
        </sc-info-note>
      </div>
      <ul class="facts">
        @if (cadenceKpi(); as k) {
          <li><b>{{ 'news.patch.next.span.cadence' | translate:{ days: num(k.median) } }}</b>
            <span>{{ 'news.patch.next.planned.basisCadence' | translate:{ n: k.samples } }}</span></li>
        }
        @if (leadKpi(); as k) {
          <li><b>{{ 'news.patch.next.span.leadTime' | translate:{ days: num(k.median) } }}</b>
            <span>{{ 'news.patch.next.planned.basisLead' | translate:{ n: k.samples } }}</span></li>
        }
      </ul>
    }

    <!-- The former carousel, untouched, folded away: charts, dots, rotation,
         6-months/all-time toggle, sub-patch cadence. Kept because nothing was
         approved for removal — and because a reader who wants the bars can
         still have them. -->
    <details class="charts">
      <summary>{{ 'news.patch.next.charts' | translate }}</summary>
      <sc-patch-cadence [groups]="groups()" />
    </details>
  `,
  styles: [`
    :host { display: block; }
    .lede { display: flex; align-items: flex-start; gap: 10px; margin: 0 0 14px; }
    .sentence { flex: 1 1 auto; display: flex; flex-direction: column; gap: 4px; margin: 0; font-size: max(0.82rem, var(--sc-fs-floor)); line-height: 1.5; color: var(--sc-fg-1); }
    .sentence b { color: var(--sc-fg-0); font-weight: 600; }
    .status { color: var(--sc-fg-1); }
    .note-p { margin: 0 0 6px; }
    .note-p:last-of-type { margin-bottom: 0; }
    .note-legend { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; color: var(--sc-fg-2); }
    .note-legend li { display: flex; align-items: center; gap: 8px; }

    /* Room above for the dots' glow, nothing more: the axis no longer parks
       text in reserved bands, so it cannot run out of them either. */
    .axis { padding: 12px 8px 0; }
    .track { position: relative; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--sc-fg-2) 20%, transparent); }
    .bar { position: absolute; top: 50%; transform: translateY(-50%); border-radius: 4px; }
    /* Usual: muted, taller, behind. Real: active, thin, in front. Over: the part past usual. */
    .bar.usual { height: 14px; z-index: 0; background: color-mix(in srgb, var(--sc-success) 16%, transparent); }
    .bar.usual.lead { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
    .bar.real { height: 4px; z-index: 1; background: var(--sc-success); }
    .bar.real.lead { background: var(--sc-accent); }
    .bar.over { height: 4px; z-index: 1; background: var(--sc-warning); }
    .bar.past { height: 4px; z-index: 1; background: color-mix(in srgb, var(--sc-fg-2) 40%, transparent); }

    .pt { position: absolute; top: 50%; width: 12px; height: 12px; border-radius: 50%; z-index: 2; transform: translate(-50%, -50%); background: var(--sc-bg-0); border: 2px solid var(--sc-fg-1); }
    .pt[data-key='prevLive'] { background: var(--sc-fg-2); border-color: var(--sc-fg-2); }
    .pt[data-key='firstTest'] { background: var(--sc-accent); border-color: var(--sc-accent); }
    .pt[data-key='live'], .pt[data-key='nextLive'] { background: var(--sc-success); border-color: var(--sc-success); }
    .pt[data-key='live'] { width: 16px; height: 16px; box-shadow: 0 0 14px color-mix(in srgb, var(--sc-success) 55%, transparent); }
    .pt[data-key='hotfix'] { width: 10px; height: 10px; border-radius: 2px; transform: translate(-50%, -50%) rotate(45deg); background: var(--sc-warning); border-color: var(--sc-warning); }
    .pt[data-key='now'] { width: 8px; height: 8px; background: var(--sc-fg-0); border-color: var(--sc-fg-0); }
    .pt[data-key='usual'] { width: 12px; height: 12px; border-radius: 2px; transform: translate(-50%, -50%) rotate(45deg); background: var(--sc-bg-0); border: 2px dashed var(--sc-accent); }
    .pt[data-key='leadUsual'] { width: 2px; height: 18px; border-radius: 1px; border: 0; background: var(--sc-fg-1); opacity: 0.8; }

    /* "heute", the one caption left on the rail: its own band, so the facts and
       milestones below can never be printed over. */
    .nowband { position: relative; height: 20px; margin-top: 8px; }
    .tick { position: absolute; top: -8px; width: 1px; height: 10px; transform: translateX(-50%); background: color-mix(in srgb, var(--sc-fg-0) 55%, transparent); }
    .today { position: absolute; top: 4px; transform: translateX(-50%); white-space: nowrap; font-size: max(0.66rem, var(--sc-fs-floor)); line-height: 1.2; color: var(--sc-fg-2); }
    .today b { color: var(--sc-fg-0); font-weight: 600; }
    /* Clamped at the rail's ends: a centred caption at 0% or 100% would hang
       out of the panel instead of over another label. */
    .today[data-edge='start'] { transform: translateX(0); }
    .today[data-edge='end'] { transform: translateX(-100%); }

    /* The milestones: a flow row, so they share the width instead of fighting
       for it. First one opens the axis, the last one closes it. */
    .marks { list-style: none; display: flex; gap: 10px 16px; margin: 12px 0 0; padding: 0; }
    .mark { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; font-size: max(0.66rem, var(--sc-fs-floor)); line-height: 1.3; color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .mark:nth-child(2) { align-items: center; text-align: center; }
    .mark:last-child:not(:first-child) { align-items: flex-end; text-align: right; }
    .mark .head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .mark b { color: var(--sc-fg-0); font-weight: 600; font-size: max(0.72rem, var(--sc-fs-floor)); }
    .mark[data-key='prevLive'] b { color: var(--sc-fg-2); font-weight: 500; }
    .mark[data-key='usual'] b { color: var(--sc-accent); }
    .chip { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 4px; font-family: var(--sc-font-display); font-size: max(0.52rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; }
    .chip[data-status='live'] { color: var(--sc-bg-0); background: var(--sc-success); }
    .chip[data-status='ptu'] { color: var(--sc-accent); border: 1px solid var(--sc-accent); }
    .chip[data-status='next'] { color: var(--sc-accent); border: 1px dashed var(--sc-accent); }
    .chip[data-status='superseded'] { color: var(--sc-fg-2); border: 1px solid color-mix(in srgb, var(--sc-fg-2) 40%, transparent); }

    .sw { display: inline-block; width: 18px; height: 4px; border-radius: 2px; flex: none; }
    .sw.lead { background: var(--sc-accent); }
    .sw.real { background: var(--sc-success); }
    .sw.usual { height: 10px; background: color-mix(in srgb, var(--sc-success) 18%, transparent); }
    .sw.over { background: var(--sc-warning); }

    .facts { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .facts li { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; padding: 6px 0; border-top: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .facts b { color: var(--sc-fg-0); font-weight: 600; font-size: max(0.76rem, var(--sc-fs-floor)); }
    .dev.good { color: var(--sc-success); }
    .dev.bad { color: var(--sc-warning); }

    .charts { margin-top: 18px; }
    .charts summary { cursor: pointer; min-height: var(--sc-tap-min); display: flex; align-items: center; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .charts summary:hover { color: var(--sc-accent); }
    .charts[open] summary { color: var(--sc-fg-0); margin-bottom: 8px; }

    @media (max-width: 640px) {
      /* Too narrow for three columns: the milestones become three short rows,
         read top to bottom in the order the rail runs left to right. */
      .marks { flex-direction: column; gap: 6px; margin-top: 10px; }
      .mark,
      .mark:nth-child(2),
      .mark:last-child:not(:first-child) { flex-direction: row; align-items: baseline; text-align: left; gap: 8px; }
      .mark .head { flex: 0 1 auto; }
    }
  `],
})
export class PatchCycleComponent {
  private readonly t = inject(TranslateService);
  private readonly locale = inject(LocaleService);

  readonly card = input.required<StackCard>();
  readonly groups = input.required<readonly PatchLineGroup[]>();
  readonly now = input<number>(Date.now());

  readonly cycle = computed(() => buildPatchCycle(this.card(), this.groups(), this.now()));

  // ── The announced-patch fallback (no build, nothing to draw) ───────────
  private readonly kpis = computed(() => computePatchStats(this.groups()));
  readonly cadenceKpi = computed(() => this.kpis().find((k) => k.key === 'cadence') ?? null);
  readonly leadKpi = computed(() => this.kpis().find((k) => k.key === 'leadTime') ?? null);
  /** RSI's own scheduling note for the line (`Q3 2026`), same source as the hero line. */
  readonly plannedQuarter = computed(() => this.card().release?.quarter ?? '');
  /**
   * The live line's release plus the median cadence — the only Live date that
   * can be named honestly before a test build exists. NaN when either half is
   * missing; the status line is then left out rather than invented.
   */
  readonly projectedLiveAt = computed(() => {
    const median = this.cadenceKpi()?.median ?? null;
    const liveGroup = this.groups().find((g) => g.isCurrentLive) ?? null;
    const live = liveGroup ? liveReleaseAt(liveGroup) : null;
    if (median === null || live === null) return NaN;
    return live + median * DAY_MS;
  });
  readonly hasProjection = computed(() => Number.isFinite(this.projectedLiveAt()));

  readonly usualAt = computed(() => this.cycle()?.points.find((p) => p.key === 'usual')?.at ?? NaN);
  readonly nextAt = computed(() => this.cycle()?.points.find((p) => p.key === 'nextLive')?.at ?? NaN);
  readonly nextVersion = computed(() => this.cycle()?.points.find((p) => p.key === 'nextLive')?.version ?? '');
  /** The grey "before this patch" stretch ends where this patch's own stretch begins. */
  readonly pastEnd = computed(() => {
    const c = this.cycle();
    if (!c || !c.points.some((p) => p.key === 'prevLive')) return 0;
    const own = c.points.find((p) => p.key === 'firstTest') ?? c.points.find((p) => p.key === 'live');
    return own?.pct ?? 0;
  });

  readonly aria = computed(() => {
    const c = this.cycle();
    if (!c?.main) return '';
    return this.statusLine(c.main);
  });

  min(a: number, b: number): number {
    return Math.min(a, b);
  }

  /** The "today" marker, when the cycle still has one to show. */
  readonly nowPoint = computed<CyclePoint | null>(() => this.cycle()?.points.find((p) => p.key === 'now') ?? null);

  /**
   * The three milestones the axis is named by: where this patch's run starts
   * (its first test build, or the patch it replaced when there was none), where
   * it stands (Live), and where it ends (the actual successor, or the usual
   * next date). Everything else — the hotfix diamond, today, the usual end of
   * testing — keeps its marker but loses its label: those three sit close
   * together in the middle of the axis, and a label per marker is what turned
   * the diagram into stacked text (feedback 01df732d). Each of them is already
   * spelled out in a fact line underneath, so nothing is lost but the collision.
   */
  readonly milestones = computed<CycleMark[]>(() => {
    const c = this.cycle();
    if (!c) return [];
    const at = (key: CyclePointKey) => c.points.find((p) => p.key === key) ?? null;
    const picked: CyclePoint[] = [];
    for (const p of [at('firstTest') ?? at('prevLive'), at('live'), at('nextLive') ?? at('usual')]) {
      if (p && !picked.includes(p)) picked.push(p);
    }
    return picked.map((p) => ({
      key: p.key,
      chip: this.chipOf(p),
      label: this.pointLabel(p),
      date: this.date(p.at),
    }));
  });

  /** Which way the "today" caption reads from its marker, so it stays inside. */
  edgeOf(pct: number): 'start' | 'end' | null {
    if (pct < 15) return 'start';
    if (pct > 85) return 'end';
    return null;
  }

  /** The name a marker no longer prints — on hover, where it costs no room. */
  pointTitle(p: CyclePoint): string {
    const date = this.date(p.at);
    return date ? `${this.pointLabel(p)} · ${date}` : this.pointLabel(p);
  }

  /** The board's status word for a point — the same vocabulary on both surfaces. */
  chipOf(p: CyclePoint): 'live' | 'ptu' | 'next' | 'superseded' | null {
    switch (p.key) {
      case 'prevLive': return 'superseded';
      case 'firstTest': return 'ptu';
      case 'live':
      case 'nextLive': return 'live';
      case 'usual': return 'next';
      default: return null;
    }
  }

  pointLabel(p: CyclePoint): string {
    if (p.key === 'nextLive') return this.t.instant('news.patch.next.point.live', { version: p.version });
    return this.t.instant('news.patch.next.point.' + p.key, { version: p.version, n: p.count ?? 0 });
  }

  /** "Alpha 4.10 ist seit 8 Tagen live — üblich sind 49 Tage bis zum nächsten. CIG liegt im Takt." */
  statusLine(m: CycleStretch): string {
    const base = m.key === 'cadence' ? 'news.patch.next.status.live' : 'news.patch.next.status.testing';
    const head = this.t.instant(base, { line: this.card().line, days: m.realDays, median: this.num(m.medianDays) });
    const tail = m.deltaDays > 0
      ? this.t.instant('news.patch.next.status.over', { n: m.deltaDays })
      : this.t.instant('news.patch.next.status.onTrack');
    return `${head} ${tail}`;
  }

  deviation(s: CycleStretch): string {
    return this.deviationDays(s.deltaDays);
  }

  deviationDays(delta: number): string {
    const d = Math.round(delta);
    if (d === 0) return this.t.instant('news.patch.next.fact.onTrack');
    return this.t.instant(d > 0 ? 'news.patch.next.fact.later' : 'news.patch.next.fact.earlier', { n: Math.abs(d) });
  }

  num(n: number): string {
    try {
      return new Intl.NumberFormat(this.locale.intlLocale(), { maximumFractionDigits: 1 }).format(n);
    } catch {
      return String(n);
    }
  }

  date(ms: number): string {
    if (!Number.isFinite(ms)) return '';
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), { day: 'numeric', month: 'short' }).format(ms);
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  /** "in ~3 weeks" / "2 weeks overdue" — the forecast grammar the app already speaks. */
  until(days: number): string {
    if (days === 0) return this.t.instant('news.patch.forecast.today');
    const overdue = days < 0;
    const n = Math.abs(days);
    if (n < 14) return this.t.instant(overdue ? 'news.patch.forecast.overdueDays' : 'news.patch.forecast.inDays', { n });
    const weeks = Math.round(n / 7);
    return this.t.instant(overdue ? 'news.patch.forecast.overdueWeeks' : 'news.patch.forecast.inWeeks', { n: weeks });
  }
}
