import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import type { PatchLineGroup } from './patch-notes';
import { PatchCadenceComponent } from './patch-cadence.component';
import { buildPatchCycle, type CyclePoint, type CycleSpan } from './patch-cycle';
import type { StackCard } from './patch-stack';

/**
 * "Wann kommt der nächste?" — the cycle axis (rethink Ⓚ, iteration 4).
 *
 * One axis, two bars: a muted, taller EXPECTED bar behind (today → projected
 * next Live, future only) and a thinner active REAL bar in front (start →
 * today). The three cadence figures sit on the axis as labelled spans with
 * their median, so "Test → Live 24 T" is visibly the stretch between two
 * points instead of a bar chart standing beside two other bar charts.
 *
 * The full KPI charts (`sc-patch-cadence`, rotation and window toggle
 * included) are kept underneath in a closed <details>: nothing the old board
 * could do is gone, it is just no longer the first thing on screen.
 */
@Component({
  selector: 'sc-patch-cycle',
  standalone: true,
  imports: [TranslateModule, PatchCadenceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cycle(); as c) {
      <p class="sentence">
        @if (card().status === 'live' && c.daysToNext !== null) {
          {{ 'news.patch.next.sentenceLive' | translate:{ date: date(nextAt()), when: until(c.daysToNext) } }}
        } @else if (card().status === 'superseded' && nextVersion()) {
          {{ 'news.patch.next.sentenceHistory' | translate:{ line: card().line, date: date(nextAt()), next: nextVersion() } }}
        } @else if (c.daysToNext !== null) {
          {{ 'news.patch.next.sentencePlanned' | translate:{ line: card().line, date: date(nextAt()), when: until(c.daysToNext) } }}
        }
        <span class="disclaimer">{{ 'news.patch.next.disclaimer' | translate }}</span>
      </p>

      <div class="axis" role="img" [attr.aria-label]="aria()">
        <div class="track">
          @if (c.expected; as e) {
            <span class="bar expected" [style.left.%]="e.fromPct" [style.width.%]="e.toPct - e.fromPct"></span>
          }
          <!-- Two evidenced stretches: what came BEFORE this patch (grey) and
               this patch's own cycle (green) — so the axis says which patch it
               is about with the same colours the board uses. -->
          <span class="bar past" [style.left.%]="c.real.fromPct" [style.width.%]="pastEnd() - c.real.fromPct"></span>
          <span class="bar real" [style.left.%]="pastEnd()" [style.width.%]="c.real.toPct - pastEnd()"></span>
          @for (p of c.points; track p.key + p.at) {
            <span class="pt" [attr.data-key]="p.key" [class.est]="p.estimated" [style.left.%]="p.pct"></span>
            @if (p.key !== 'hotfix') {
              <span class="lab" [attr.data-key]="p.key" [class.below]="p.key === 'now'" [style.left.%]="p.pct">
                @if (chipOf(p); as chip) {
                  <span class="chip" [attr.data-status]="chip">{{ ('news.patch.status.' + chip) | translate }}</span>
                }
                <b>{{ pointLabel(p) }}</b>
                <small>{{ date(p.at) }}</small>
              </span>
            }
          }
        </div>
        <ul class="spans">
          @for (s of c.spans; track s.key) {
            <li [attr.data-key]="s.key">
              <b>{{ ('news.patch.next.span.' + s.key) | translate:{ days: s.days } }}</b>
              @if (s.medianDays !== null) {
                <span>{{ 'news.patch.next.median' | translate:{ n: num(s.medianDays), samples: s.samples } }}</span>
                <span class="delta" [class.good]="s.days < s.medianDays" [class.bad]="s.days > s.medianDays">{{ delta(s) }}</span>
              }
            </li>
          }
        </ul>
      </div>
    }

    <!-- The former carousel, untouched, folded away: charts, dots, rotation,
         6-months/all-time toggle. Kept because nothing was approved for
         removal — and because a reader who wants the bars can still have them. -->
    <details class="charts">
      <summary>{{ 'news.patch.next.charts' | translate }}</summary>
      <sc-patch-cadence [groups]="groups()" />
    </details>
  `,
  styles: [`
    :host { display: block; }
    .sentence {
      margin: 0 0 14px; font-size: max(0.82rem, var(--sc-fs-floor)); line-height: 1.55;
      color: var(--sc-fg-1);
    }
    .disclaimer { display: block; margin-top: 4px; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .axis { padding: 62px 8px 0; }
    .track { position: relative; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--sc-fg-2) 25%, transparent); }
    .bar { position: absolute; top: 50%; transform: translateY(-50%); border-radius: 4px; }
    /* Expected: muted, vertically larger, behind. Real: active colour, thin, in front. */
    .bar.expected { height: 14px; background: color-mix(in srgb, var(--sc-accent) 18%, transparent); z-index: 0; }
    .bar.past { height: 4px; background: color-mix(in srgb, var(--sc-fg-2) 45%, transparent); z-index: 1; }
    .bar.real { height: 4px; background: var(--sc-success); z-index: 1; }
    .pt {
      position: absolute; top: 50%; width: 12px; height: 12px; border-radius: 50%; z-index: 2;
      transform: translate(-50%, -50%); background: var(--sc-bg-0); border: 2px solid var(--sc-fg-1);
    }
    /* The same colours as the status words on the board: past = grey,
       PTU = accent, this patch's Live = success and the biggest point. */
    .pt[data-key='prevLive'] { background: var(--sc-fg-2); border-color: var(--sc-fg-2); }
    .pt[data-key='firstTest'] { background: var(--sc-accent); border-color: var(--sc-accent); }
    .pt[data-key='live'] { width: 16px; height: 16px; background: var(--sc-success); border-color: var(--sc-success); box-shadow: 0 0 14px color-mix(in srgb, var(--sc-success) 55%, transparent); }
    .pt[data-key='hotfix'] { width: 6px; height: 6px; background: var(--sc-warning); border-color: var(--sc-warning); }
    .pt[data-key='now'] { width: 8px; height: 8px; background: var(--sc-fg-0); border-color: var(--sc-fg-0); }
    .pt.est { border-style: dashed; border-color: var(--sc-accent); background: var(--sc-bg-0); }
    .lab {
      position: absolute; bottom: 16px; transform: translateX(-50%); z-index: 3;
      display: flex; flex-direction: column; align-items: center; gap: 2px; white-space: nowrap;
      font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); line-height: 1.25;
    }
    .lab b { color: var(--sc-fg-0); font-weight: 600; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .lab.below { bottom: auto; top: 14px; }
    .lab[data-key='prevLive'] { transform: translateX(0); align-items: flex-start; }
    .lab[data-key='prevLive'] b { color: var(--sc-fg-2); font-weight: 500; }
    .lab[data-key='live'] b { font-size: max(0.8rem, var(--sc-fs-floor)); }
    .lab[data-key='nextLive'] { transform: translateX(-100%); align-items: flex-end; }
    .lab[data-key='nextLive'] b { color: var(--sc-accent); }
    /* Status word, board idiom, small. */
    .chip {
      display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 4px;
      font-family: var(--sc-font-display); font-size: max(0.52rem, var(--sc-fs-floor));
      letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600;
    }
    .chip[data-status='live'] { color: var(--sc-bg-0); background: var(--sc-success); }
    .chip[data-status='ptu'] { color: var(--sc-accent); border: 1px solid var(--sc-accent); }
    .chip[data-status='next'] { color: var(--sc-accent); border: 1px dashed var(--sc-accent); }
    .chip[data-status='superseded'] { color: var(--sc-fg-2); border: 1px solid color-mix(in srgb, var(--sc-fg-2) 40%, transparent); }

    .spans { list-style: none; margin: 40px 0 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }
    .spans li {
      display: flex; flex-direction: column; gap: 2px; padding: 8px 10px;
      border: 1px solid var(--sc-border); border-radius: 6px; background: var(--sc-bg-1);
      font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .spans b { color: var(--sc-fg-0); font-weight: 600; font-size: max(0.76rem, var(--sc-fs-floor)); }
    .delta.good { color: var(--sc-success); }
    .delta.bad { color: var(--sc-warning); }

    .charts { margin-top: 18px; }
    .charts summary {
      cursor: pointer; min-height: var(--sc-tap-min); display: flex; align-items: center;
      font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .charts summary:hover { color: var(--sc-accent); }
    .charts[open] summary { color: var(--sc-fg-0); margin-bottom: 8px; }

    @media (max-width: 640px) {
      .axis { padding-top: 40px; }
      .lab { font-size: max(0.6rem, var(--sc-fs-floor)); }
      .lab small { display: none; }
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
  readonly nextAt = computed(() => this.cycle()?.points.find((p) => p.key === 'nextLive')?.at ?? NaN);
  readonly nextVersion = computed(() => this.cycle()?.points.find((p) => p.key === 'nextLive')?.version ?? '');

  readonly aria = computed(() => {
    const c = this.cycle();
    if (!c) return '';
    return c.spans.map((s) => this.t.instant('news.patch.next.span.' + s.key, { days: s.days })).join(', ');
  });

  /** Where the grey "before this patch" stretch ends and the green one begins. */
  readonly pastEnd = computed(() => {
    const c = this.cycle();
    if (!c) return 0;
    const own = c.points.find((p) => p.key === 'firstTest') ?? c.points.find((p) => p.key === 'live');
    return own ? Math.max(own.pct, c.real.fromPct) : c.real.toPct;
  });

  /** The board's status word for a point — the same vocabulary on both surfaces. */
  chipOf(p: CyclePoint): 'live' | 'ptu' | 'next' | 'superseded' | null {
    switch (p.key) {
      case 'prevLive': return 'superseded';
      case 'firstTest': return 'ptu';
      case 'live': return 'live';
      case 'nextLive': return p.estimated ? 'next' : 'live';
      default: return null;
    }
  }

  pointLabel(p: CyclePoint): string {
    return this.t.instant('news.patch.next.point.' + p.key, { version: p.version });
  }

  delta(s: CycleSpan): string {
    if (s.medianDays === null) return '';
    const d = Math.round(s.days) - Math.round(s.medianDays);
    if (d === 0) return this.t.instant('news.patch.kpi.deltaSame');
    return this.t.instant(d < 0 ? 'news.patch.kpi.deltaFaster' : 'news.patch.kpi.deltaSlower', { n: Math.abs(d) });
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

  /** "in ~3 weeks" / "2 weeks overdue" — same grammar as the forecast rows. */
  until(days: number): string {
    if (days === 0) return this.t.instant('news.patch.forecast.today');
    const overdue = days < 0;
    const n = Math.abs(days);
    if (n < 14) return this.t.instant(overdue ? 'news.patch.forecast.overdueDays' : 'news.patch.forecast.inDays', { n });
    const weeks = Math.round(n / 7);
    return this.t.instant(overdue ? 'news.patch.forecast.overdueWeeks' : 'news.patch.forecast.inWeeks', { n: weeks });
  }
}
