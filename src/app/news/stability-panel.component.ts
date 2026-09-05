import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EARLY_DAYS, StabilityComponents, StabilityDay, StabilityVerdict } from './patch-stability';

const ISSUE_URL = 'https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/';
type CompKey = keyof StabilityComponents;
const COMP_KEYS: CompKey[] = ['community', 'service', 'cig'];

/**
 * The stability block inside an expanded LIVE note: the verdict, what it is
 * made of, how it moved since LIVE, and which tickets the community is loudest
 * about. Same CSS-bar grammar as the cadence panel (no chart library).
 *
 * The first EARLY_DAYS columns are hatched: a verdict from day 3 is a guess
 * that the next hotfix may overturn, and the chart says so without a footnote.
 * Hotfixes are ticks under the columns, never part of the bar height.
 */
@Component({
  selector: 'sc-stability-panel',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (verdict(); as v) {
      <section class="sp" [attr.aria-label]="'news.patch.stability.title' | translate">
        @if (v.insufficient) {
          <p class="state insufficient">{{ 'news.patch.stability.insufficient' | translate }}</p>
        } @else {
          <div class="headline" [attr.data-level]="v.level">
            <span class="dot" aria-hidden="true"></span>
            <span class="lvl">{{ ('news.patch.stability.level.' + v.level) | translate }}</span>
            <span class="score">{{ 'news.patch.stability.score' | translate:{ score: pct(v.score) } }}</span>
            @if (v.early) {
              <span class="early">{{ 'news.patch.stability.early' | translate:{ day: day(), threshold: threshold } }}</span>
            }
          </div>

          <ul class="comps">
            @for (k of compKeys; track k) {
              <li class="comp" [attr.title]="('news.patch.stability.componentHint.' + k) | translate">
                <span class="comp-name">{{ ('news.patch.stability.component.' + k) | translate }}</span>
                <span class="comp-bar" aria-hidden="true">
                  @if (v.components[k] !== null) {
                    <span class="comp-fill" [style.width.%]="pct(v.components[k])"></span>
                  }
                </span>
                <span class="comp-val">
                  {{ v.components[k] === null ? ('news.patch.stability.component.none' | translate) : pct(v.components[k]) }}
                </span>
              </li>
            }
          </ul>

          @if (v.historical) {
            <p class="state historical">{{ 'news.patch.stability.historical' | translate }}</p>
          } @else {
            <div class="chart-wrap">
              <p class="chart-title">{{ 'news.patch.stability.timeline' | translate }}</p>
              <div class="chart" role="img" [attr.aria-label]="'news.patch.stability.timelineAria' | translate:{ days: v.days.length }">
                @for (d of v.days; track d.date) {
                  <span class="col" [class.early]="isEarlyDay(v, d)" [class.hotfix]="d.hotfixes.length > 0"
                        [attr.data-level]="d.level" [attr.title]="dayTitle(d)">
                    <span class="col-bar" [style.height.%]="pct(d.score)"></span>
                    @if (d.hotfixes.length > 0) {
                      <span class="tick" [attr.title]="hotfixTitle(d)" aria-hidden="true"></span>
                    }
                  </span>
                }
              </div>
              <div class="chart-axis" aria-hidden="true">
                <span>{{ v.days[0]?.date }}</span>
                <span>{{ v.days[v.days.length - 1]?.date }}</span>
              </div>
            </div>
          }

          <div class="facts">
            @if (v.kbOpen !== null) {
              <span>{{ 'news.patch.stability.kb' | translate:{ count: v.kbOpen } }}</span>
            }
            @if (v.hotfixes.length > 0) {
              <span>{{ 'news.patch.stability.hotfixes' | translate:{ count: v.hotfixes.length } }}</span>
            }
            @if (cigFixes() !== null && cigFixesIc() !== null) {
              <span>{{ 'news.patch.stability.cigFixes' | translate:{ fixes: cigFixes(), ic: cigFixesIc() } }}</span>
            }
          </div>

          @if (!v.historical) {
            <div class="tickets">
              <p class="tk-title">{{ 'news.patch.stability.tickets.title' | translate }}
                <span class="tk-hint">{{ 'news.patch.stability.tickets.hint' | translate }}</span></p>
              @if (v.tickets.length === 0) {
                <p class="state">{{ 'news.patch.stability.tickets.empty' | translate }}</p>
              } @else {
                <ul class="tk-list">
                  @for (t of v.tickets; track t.id) {
                    <li>
                      <!-- The ticket lives on the Issue Council → real anchor, new tab. -->
                      <a class="ticket" [href]="issueUrl + t.id" target="_blank" rel="noopener noreferrer">
                        <span class="tk-id">{{ t.id }}</span>
                        <span class="tk-votes">{{ 'news.patch.stability.tickets.votes' | translate:{ count: t.votes } }}</span>
                        <span class="tk-text">{{ t.excerpt }}</span>
                      </a>
                    </li>
                  }
                </ul>
              }
            </div>
          }
          <p class="source">{{ 'news.patch.stability.source' | translate }}</p>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .sp {
      display: flex; flex-direction: column; gap: 10px;
      padding: 10px 12px; margin-bottom: 4px;
      border: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent); border-radius: 8px;
      background: color-mix(in srgb, var(--sc-bg-1) 60%, transparent);
    }
    .state { margin: 0; color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); }
    .headline {
      display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
      font-family: var(--sc-font-display); font-size: max(0.95rem, var(--sc-fs-floor));
      color: var(--level);
    }
    .headline .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--level); }
    .headline .score, .headline .early { font-family: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .headline .early { border: 1px dashed color-mix(in srgb, var(--sc-fg-2) 60%, transparent); border-radius: 999px; padding: 0 7px; }
    [data-level='1'] { --level: var(--sc-success); }
    [data-level='2'] { --level: var(--sc-accent); }
    [data-level='3'] { --level: var(--sc-warning); }
    [data-level='4'] { --level: var(--sc-warn); }
    [data-level='5'] { --level: var(--sc-danger); }

    .comps { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .comp { display: grid; grid-template-columns: 9rem 1fr 3rem; align-items: center; gap: 8px; font-size: max(0.72rem, var(--sc-fs-floor)); }
    .comp-name { color: var(--sc-fg-1); }
    .comp-bar { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--sc-fg-2) 20%, transparent); overflow: hidden; }
    .comp-fill { display: block; height: 100%; background: var(--sc-accent); }
    .comp-val { text-align: right; color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }

    /* ---- Bars: same grammar as the cadence panel ---- */
    .chart-wrap { display: flex; flex-direction: column; gap: 4px; }
    .chart-title { margin: 0; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.07em; }
    .chart { position: relative; display: flex; align-items: flex-end; gap: 2px; height: 72px; padding: 0 2px 6px; border-bottom: 1px solid var(--sc-border); }
    .col { position: relative; flex: 1 1 0; min-width: 3px; max-width: 18px; display: flex; align-items: flex-end; height: 100%; }
    .col-bar { width: 100%; border-radius: 2px 2px 0 0; background: var(--level); transition: height 0.3s ease; }
    .col.early .col-bar {
      background: repeating-linear-gradient(135deg, var(--level) 0 2px, transparent 2px 5px);
      outline: 1px dashed color-mix(in srgb, var(--level) 70%, transparent);
    }
    .tick { position: absolute; left: 50%; bottom: -6px; width: 2px; height: 6px; background: var(--sc-fg-1); transform: translateX(-50%); }
    .chart-axis { display: flex; justify-content: space-between; gap: 8px; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .facts { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }

    .tickets { display: flex; flex-direction: column; gap: 4px; }
    .tk-title { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 700; color: var(--sc-fg-1); }
    .tk-hint { font-weight: 400; color: var(--sc-fg-2); margin-left: 6px; }
    .tk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .ticket {
      display: grid; grid-template-columns: auto auto 1fr; gap: 8px; align-items: baseline;
      min-height: var(--sc-tap-min); padding: 2px 4px; border-radius: 4px;
      color: inherit; text-decoration: none; font-size: max(0.74rem, var(--sc-fs-floor));
    }
    .ticket:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .ticket:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .tk-id { color: var(--sc-accent); font-weight: 700; }
    .tk-votes { color: var(--sc-fg-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .tk-text { color: var(--sc-fg-1); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .source { margin: 0; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    @media (max-width: 480px) {
      .comp { grid-template-columns: 6.5rem 1fr 2.5rem; }
      .ticket { grid-template-columns: auto 1fr; }
      .tk-text { grid-column: 1 / -1; white-space: normal; }
    }
  `],
})
export class StabilityPanelComponent {
  private readonly t = inject(TranslateService);

  readonly verdict = input<StabilityVerdict | null>(null);
  /** CIG's own fix count from the notes (display only). */
  readonly cigFixes = input<number | null>(null);
  readonly cigFixesIc = input<number | null>(null);

  readonly compKeys = COMP_KEYS;
  readonly threshold = EARLY_DAYS;
  readonly issueUrl = ISSUE_URL;

  readonly day = computed(() => Math.max(1, Math.ceil(this.verdict()?.daysLive ?? 0)));

  pct(v: number | null): number {
    return v === null ? 0 : Math.round(Math.min(1, Math.max(0, v)) * 100);
  }

  isEarlyDay(v: StabilityVerdict, d: StabilityDay): boolean {
    return (Date.parse(d.date + 'T00:00:00Z') - Date.parse(v.liveAt)) / 86_400_000 < EARLY_DAYS;
  }

  dayTitle(d: StabilityDay): string {
    return this.t.instant('news.patch.stability.dayTitle', {
      date: d.date,
      level: this.t.instant(`news.patch.stability.level.${d.level}`),
      score: this.pct(d.score),
      velocity: Math.round(d.velocity),
    });
  }

  hotfixTitle(d: StabilityDay): string {
    return d.hotfixes.map((h) => this.t.instant('news.patch.stability.hotfixMark', { build: h.build || '—', date: h.date })).join(' · ');
  }
}
