import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import type { PatchLineGroup } from './patch-notes';
import { PatchCadenceComponent } from './patch-cadence.component';
import { buildPatchCycle, type CyclePoint, type CycleStretch } from './patch-cycle';
import type { StackCard } from './patch-stack';

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
 * test build → Live, in PTU cyan). Hotfixes are one labelled marker with a
 * count. Under the axis: one line of facts per stretch, the median as the
 * subordinate clause, never the headline. The old KPI charts stay folded
 * underneath — nothing was approved for removal.
 */
@Component({
  selector: 'sc-patch-cycle',
  standalone: true,
  imports: [TranslateModule, PatchCadenceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cycle(); as c) {
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
        <span class="disclaimer">{{ 'news.patch.next.disclaimer' | translate }}</span>
      </p>

      <div class="axis" role="img" [attr.aria-label]="aria()">
        <div class="track">
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
            <span class="pt" [attr.data-key]="p.key" [style.left.%]="p.pct"></span>
            <span class="lab" [attr.data-key]="p.key" [class.below]="isBelow(p)" [style.left.%]="p.pct">
              @if (chipOf(p); as chip) {
                <span class="chip" [attr.data-status]="chip">{{ ('news.patch.status.' + chip) | translate }}</span>
              }
              <b>{{ pointLabel(p) }}</b>
              <small>{{ date(p.at) }}</small>
            </span>
          }
        </div>
        <ul class="legend" aria-hidden="true">
          <li><i class="sw lead"></i>{{ 'news.patch.next.legend.lead' | translate }}</li>
          <li><i class="sw real"></i>{{ 'news.patch.next.legend.real' | translate }}</li>
          <li><i class="sw usual"></i>{{ 'news.patch.next.legend.usual' | translate }}</li>
          <li><i class="sw over"></i>{{ 'news.patch.next.legend.over' | translate }}</li>
        </ul>
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
    .sentence { display: flex; flex-direction: column; gap: 4px; margin: 0 0 14px; font-size: max(0.82rem, var(--sc-fs-floor)); line-height: 1.5; color: var(--sc-fg-1); }
    .sentence b { color: var(--sc-fg-0); font-weight: 600; }
    .status { color: var(--sc-fg-1); }
    .disclaimer { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .axis { padding: 66px 8px 0; }
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

    .lab { position: absolute; bottom: 16px; transform: translateX(-50%); z-index: 3; display: flex; flex-direction: column; align-items: center; gap: 2px; white-space: nowrap; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); line-height: 1.25; }
    .lab b { color: var(--sc-fg-0); font-weight: 600; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .lab.below { bottom: auto; top: 14px; }
    .lab[data-key='prevLive'] { transform: translateX(0); align-items: flex-start; }
    .lab[data-key='prevLive'] b { color: var(--sc-fg-2); font-weight: 500; }
    .lab[data-key='live'] b { font-size: max(0.8rem, var(--sc-fs-floor)); }
    .lab[data-key='usual'], .lab[data-key='nextLive'] { transform: translateX(-100%); align-items: flex-end; }
    .lab[data-key='usual'] b { color: var(--sc-accent); }
    .lab[data-key='leadUsual'] b { color: var(--sc-fg-2); font-weight: 500; }
    .lab[data-key='hotfix'] b { color: var(--sc-warning); font-weight: 500; }
    .chip { display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 4px; font-family: var(--sc-font-display); font-size: max(0.52rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; }
    .chip[data-status='live'] { color: var(--sc-bg-0); background: var(--sc-success); }
    .chip[data-status='ptu'] { color: var(--sc-accent); border: 1px solid var(--sc-accent); }
    .chip[data-status='next'] { color: var(--sc-accent); border: 1px dashed var(--sc-accent); }
    .chip[data-status='superseded'] { color: var(--sc-fg-2); border: 1px solid color-mix(in srgb, var(--sc-fg-2) 40%, transparent); }

    .legend { list-style: none; margin: 58px 0 0; padding: 0; display: flex; gap: 16px; flex-wrap: wrap; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .legend li { display: inline-flex; align-items: center; gap: 6px; }
    .sw { display: inline-block; width: 18px; height: 4px; border-radius: 2px; }
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
      .axis { padding-top: 58px; }
      .lab { font-size: max(0.6rem, var(--sc-fs-floor)); }
      .lab small { display: none; }
      .legend { margin-top: 48px; }
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

  isBelow(p: CyclePoint): boolean {
    return p.key === 'now' || p.key === 'prevLive' || p.key === 'hotfix' || p.key === 'leadUsual';
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
