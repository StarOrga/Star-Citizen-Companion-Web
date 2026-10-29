import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { CommunityVerdictComponent } from './community-verdict.component';
import {
  EARLY_DAYS, STABIL_MIN, TREND_GLYPH, TREND_THRESHOLD, WACKELIG_MIN, StabilityDay, StabilityVerdict,
  componentDeductions, stabilityPercent, stabilityTrend, stabilityWord,
} from './patch-stability';
import { PatchStabilityVotesService } from './patch-stability-votes.service';

const ISSUE_URL = 'https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/';
const DEDUCTION_KEYS = ['community', 'service', 'cig'] as const;
const DAY_MS = 86_400_000;

/**
 * The Stabilitäts-Langform: the one place that shows how the number comes to
 * be — head (word, %, comparison), the three-band scale with a ghost tick for
 * the previous patch, the deduction sum including the Community-Urteil, a
 * two-line Datenbasis, the calm daily history, what the community reports and
 * the Community-Urteil card. First section of the dossier (`id="stabilitaet"`).
 *
 * BLIND: for a signed-in user without a vote on the LIVE line, everything that
 * would reveal the number is blurred and inert until they voted, abstained or
 * asked for it; the vote entry then leads the section instead.
 */
@Component({
  selector: 'sc-stability-long',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, CommunityVerdictComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (verdict(); as v) {
      @if (blind()) {
        <sc-community-verdict [line]="v.line" [stability]="v.stability" />
      }
      <div class="calc" [class.blind]="blind()" [attr.inert]="blind() ? '' : null" [attr.aria-hidden]="blind() ? 'true' : null">
        @if (v.insufficient) {
          <p class="muted">{{ 'news.patch.stability.insufficient' | translate }}</p>
        } @else {
          <div class="head" [attr.data-word]="word()">
            <span class="hw">{{ ('stability.word.' + word()) | translate }}</span>
            <span class="hp">{{ shown() }} %</span>
            @if (compare(); as cmp) {
              <span class="hc"><i aria-hidden="true">{{ cmp.glyph }}</i> {{ cmp.key | translate: cmp.params }}</span>
            }
          </div>

          <div class="scale">
            <div class="track" aria-hidden="true">
              <span class="band" data-word="instabil" [style.flex-grow]="wackeligMin"></span>
              <span class="band" data-word="wackelig" [style.flex-grow]="stabilMin - wackeligMin"></span>
              <span class="band" data-word="stabil" [style.flex-grow]="100 - stabilMin"></span>
              @if (previousPct(); as p) {
                <span class="ghost" [style.left.%]="p" [scTooltip]="'stability.long.ghost' | translate: { prev: prevLabel(), p: p }"></span>
              }
              <span class="mark" [style.left.%]="shown()"></span>
            </div>
            <div class="bounds">
              <span>{{ 'stability.long.bandInstabil' | translate: { n: wackeligMin } }}</span>
              <span>{{ 'stability.long.bandWackelig' | translate: { a: wackeligMin, b: stabilMin - 1 } }}</span>
              <span>{{ 'stability.long.bandStabil' | translate: { n: stabilMin } }}</span>
            </div>
            @if (previousPct() !== null) {
              <p class="ghost-note"><i aria-hidden="true"></i> {{ prevLabel() }}</p>
            }
          </div>

          <h4>{{ 'stability.long.sumTitle' | translate: { n: shown() } }}</h4>
          <ul class="sum">
            <li class="start"><span>{{ 'stability.long.start' | translate }}</span><b>100</b></li>
            @for (k of keys; track k) {
              @let d = deductions()[k];
              <li class="ded" [scTooltip]="('news.patch.stability.componentHint.' + k) | translate">
                <span>{{ ('stability.long.ded.' + k) | translate }}
                  @if (k === 'cig' && v.kbOpen !== null) { <small>{{ 'stability.long.kbOpen' | translate: { n: v.kbOpen } }}</small> }
                </span>
                <span class="bar" aria-hidden="true">@if (d !== null) { <i [style.width.%]="min(100, d * 2)"></i> }</span>
                <b>{{ d === null ? ('news.patch.stability.component.none' | translate) : '−' + d }}</b>
              </li>
            }
            @if (communityRow(); as cr) {
              <li class="ded comm">
                <span>{{ 'stability.long.ded.verdict' | translate }} <small>{{ 'stability.long.votesN' | translate: { n: cr.votes } }}</small></span>
                <span class="bar" aria-hidden="true"></span>
                <b>{{ cr.text }}</b>
              </li>
            }
            <li class="total"><span>{{ 'stability.long.total' | translate }}</span><b>{{ shown() }}</b></li>
          </ul>

          <div class="basis">
            <p>
              @if (v.historical) {
                {{ 'stability.long.final' | translate }}
              } @else {
                {{ 'stability.long.asOf' | translate: { date: asOf() } }}
                @if (v.early) {
                  · {{ 'stability.long.day' | translate: { day: day(), threshold: threshold } }} · {{ 'stability.long.provisional' | translate }}
                }
              }
            </p>
            <p class="muted">{{ 'stability.long.sources' | translate }} {{ sources() }}</p>
          </div>

          @if (!v.historical && v.days.length > 0) {
            <div class="chart-wrap">
              <h4>{{ 'news.patch.stability.timeline' | translate }}</h4>
              <div class="chart" role="img" [attr.aria-label]="'news.patch.stability.timelineAria' | translate:{ days: v.days.length }">
                @for (d of v.days; track d.date) {
                  <span class="col" [class.early]="isEarlyDay(v, d)" [class.weak]="dayPct(d) < stabilMin" [class.hotfix]="d.hotfixes.length > 0"
                        [scTooltip]="dayTitle(d)" scTooltipTier="label">
                    <span class="col-bar" [style.height.%]="dayPct(d)"></span>
                    @if (d.hotfixes.length > 0) { <span class="tick" aria-hidden="true"></span> }
                  </span>
                }
              </div>
              <ul class="sc-sr-only">
                @for (d of v.days; track d.date) { <li>{{ dayTitle(d) }}</li> }
              </ul>
              <div class="chart-axis" aria-hidden="true">
                <span>{{ v.days[0]?.date }}</span>
                <span>{{ v.days[v.days.length - 1]?.date }}</span>
              </div>
              <p class="muted">{{ 'stability.long.hatched' | translate: { n: threshold } }}</p>
            </div>
          }
        }
      </div>

      @if (!v.insufficient && !v.historical) {
        <div class="tickets">
          <h4>{{ 'news.patch.stability.tickets.title' | translate }} <span class="tk-hint">{{ 'stability.long.ticketsHint' | translate }}</span></h4>
          @if (v.tickets.length === 0) {
            <p class="muted">{{ 'news.patch.stability.tickets.empty' | translate }}</p>
          } @else {
            <ul class="tk-list">
              @for (t of v.tickets; track t.id) {
                <li>
                  <a class="ticket" [href]="issueUrl + t.id" target="_blank" rel="noopener noreferrer">
                    <span class="tk-id">{{ t.id }}</span>
                    <span class="tk-votes">{{ 'stability.long.mentions' | translate: { count: t.votes } }}</span>
                    <span class="tk-text">{{ t.excerpt }}</span>
                  </a>
                </li>
              }
            </ul>
          }
        </div>
      }

      @if (votable() && !blind()) {
        <sc-community-verdict [line]="v.line" [stability]="v.stability" />
      }
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; gap: 14px; }
    p, h4 { margin: 0; }
    h4 { font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .muted { color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); }
    .calc { display: flex; flex-direction: column; gap: 14px; transition: filter 0.2s ease; }
    .calc.blind { filter: blur(9px); user-select: none; pointer-events: none; }

    .head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 14px; --c: var(--sc-success); color: var(--c); }
    .head[data-word='wackelig'], .head[data-word='instabil'] { --c: var(--sc-warning); }
    .hw { font-family: var(--sc-font-display); font-size: 1.7rem; font-weight: 700; line-height: 1; }
    .hp { font-size: 1.7rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
    .hc { color: var(--sc-fg-1); font-size: max(0.84rem, var(--sc-fs-floor)); }
    .hc i { font-style: normal; color: var(--c); }

    .scale { display: flex; flex-direction: column; gap: 6px; }
    .track { position: relative; display: flex; gap: 2px; height: 12px; }
    .band { flex: 1 1 0; min-width: 0; border-radius: 3px; }
    .band[data-word='instabil'] { background: var(--sc-warning); }
    .band[data-word='wackelig'] { background: color-mix(in srgb, var(--sc-warning) 40%, transparent); }
    .band[data-word='stabil'] { background: var(--sc-success); }
    .mark {
      position: absolute; top: -5px; width: 4px; height: 22px; margin-left: -2px; border-radius: 2px;
      background: var(--sc-fg-0); box-shadow: 0 0 0 2px var(--sc-bg-0);
    }
    .ghost { position: absolute; top: -5px; height: 22px; width: 0; margin-left: -1px; border-left: 2px dashed var(--sc-fg-1); }
    .ghost::before { content: ; position: absolute; inset: 0 -8px; }
    .bounds { display: flex; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .bounds span { flex: 1 1 0; }
    .bounds span:nth-child(2) { text-align: center; }
    .bounds span:nth-child(3) { text-align: right; }
    .ghost-note { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .ghost-note i { display: inline-block; width: 0; height: 0.9em; margin-right: 6px; vertical-align: -2px; border-left: 2px dashed var(--sc-fg-1); }

    .sum { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: max(0.84rem, var(--sc-fs-floor)); }
    .sum li { display: grid; grid-template-columns: minmax(0, 1fr) 90px 3.2rem; align-items: center; gap: 10px; min-height: 28px; color: var(--sc-fg-1); }
    .sum .start, .sum .total { grid-template-columns: minmax(0, 1fr) 3.2rem; color: var(--sc-fg-0); }
    .sum .total { border-top: 1px solid var(--sc-border); padding-top: 6px; font-weight: 700; }
    .sum b { text-align: right; font-variant-numeric: tabular-nums; }
    .sum .ded b { color: var(--sc-warning); }
    .sum small { display: block; color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .bar { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--sc-fg-2) 20%, transparent); overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--sc-warning); }

    .basis { display: flex; flex-direction: column; gap: 2px; font-size: max(0.82rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }

    .chart-wrap { display: flex; flex-direction: column; gap: 6px; }
    .chart { display: flex; align-items: flex-end; gap: 2px; height: 72px; padding: 0 2px 6px; border-bottom: 1px solid var(--sc-border); }
    .col { position: relative; flex: 1 1 0; min-width: 3px; max-width: 18px; display: flex; align-items: flex-end; height: 100%; --bar: var(--sc-accent); }
    .col.weak { --bar: var(--sc-warning); }
    .col-bar { width: 100%; border-radius: 2px 2px 0 0; background: color-mix(in srgb, var(--bar) 75%, transparent); }
    .col.early .col-bar {
      background: repeating-linear-gradient(135deg, var(--bar) 0 2px, transparent 2px 5px);
      outline: 1px dashed color-mix(in srgb, var(--bar) 70%, transparent);
    }
    .col:focus-visible { outline: 2px solid var(--sc-accent); }
    .tick { position: absolute; left: 50%; bottom: -6px; width: 2px; height: 6px; background: var(--sc-fg-1); transform: translateX(-50%); }
    .chart-axis { display: flex; justify-content: space-between; gap: 8px; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .tickets { display: flex; flex-direction: column; gap: 6px; }
    .tk-hint { text-transform: none; letter-spacing: 0; font-weight: 400; margin-left: 6px; }
    .tk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .ticket {
      display: grid; grid-template-columns: auto auto 1fr; gap: 10px; align-items: baseline;
      min-height: var(--sc-tap-min); padding: 4px 6px; border-radius: 6px;
      color: inherit; text-decoration: none; font-size: max(0.8rem, var(--sc-fs-floor));
    }
    .ticket:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .ticket:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .tk-id { color: var(--sc-accent); font-weight: 700; }
    .tk-votes { color: var(--sc-fg-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .tk-text { color: var(--sc-fg-1); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    @media (max-width: 560px) {
      .sum li { grid-template-columns: minmax(0, 1fr) 56px 2.8rem; }
      .ticket { grid-template-columns: auto 1fr; }
      .tk-text { grid-column: 1 / -1; white-space: normal; }
      .bounds { font-size: max(0.66rem, var(--sc-fs-floor)); }
    }
    @media (prefers-reduced-motion: reduce) { .calc { transition: none; } }
  `],
})
export class StabilityLongComponent {
  private readonly t = inject(TranslateService);
  private readonly locale = inject(LocaleService);
  private readonly votes = inject(PatchStabilityVotesService);

  readonly verdict = input<StabilityVerdict | null>(null);
  /** True for the LIVE line: the community may judge it and its correction applies. */
  readonly live = input(false);
  /** The nearest older patch with a number, for the comparison and the ghost tick. */
  readonly previous = input<{ line: string; percent: number } | null>(null);

  readonly keys = DEDUCTION_KEYS;
  readonly threshold = EARLY_DAYS;
  readonly stabilMin = STABIL_MIN;
  readonly wackeligMin = WACKELIG_MIN;
  readonly issueUrl = ISSUE_URL;
  readonly min = Math.min;

  /** Community judging applies to a LIVE line with a number. */
  readonly votable = computed(() => this.live() && !!this.verdict() && !this.verdict()?.insufficient);
  readonly blind = computed(() => this.votable() && this.votes.line() === this.verdict()?.line && this.votes.blind());

  private readonly ensure = effect(() => {
    const v = this.verdict();
    if (this.votable() && v) untracked(() => this.votes.ensure(v.line));
  });

  private readonly correction = computed(() => {
    const v = this.verdict();
    if (!this.votable() || !v || v.stability === null || this.votes.line() !== v.line) return null;
    return this.votes.correctionFor(v.stability);
  });
  readonly shown = computed(() => {
    const s = this.verdict()?.stability ?? null;
    return s === null ? 0 : Math.min(100, Math.max(0, Math.round(s + (this.correction()?.correction ?? 0))));
  });
  readonly word = computed(() => stabilityWord(this.shown()) ?? 'wackelig');
  readonly deductions = computed(() => {
    const v = this.verdict();
    return v && v.stability !== null ? componentDeductions(v.components, v.stability) : { community: null, service: null, cig: null };
  });
  readonly communityRow = computed(() => {
    const c = this.correction();
    if (!c) return null;
    const text = c.state === 'too-few' ? '–' : c.correction === 0 ? '±0' : (c.correction > 0 ? '+' : '−') + Math.abs(c.correction);
    return { votes: c.votes, text };
  });

  readonly previousPct = computed(() => this.previous()?.percent ?? null);
  readonly prevLabel = computed(() => this.previous()?.line ?? '');
  /** "▼ 14 Punkte schwächer als 4.3.1 (73 %)" parts; null without a previous patch. */
  readonly compare = computed(() => {
    const p = this.previous();
    if (!p) return null;
    const diff = this.shown() - Math.round(p.percent);
    const trend = stabilityTrend(this.shown(), p.percent);
    const key = Math.abs(diff) < TREND_THRESHOLD ? 'stability.tip.same' : diff > 0 ? 'stability.tip.better' : 'stability.tip.worse';
    return { glyph: trend ? TREND_GLYPH[trend] : '', key, params: { d: Math.abs(diff), prev: p.line, p: Math.round(p.percent) } };
  });

  readonly day = computed(() => Math.max(1, Math.ceil(this.verdict()?.daysLive ?? 0)));

  asOf(): string {
    const d = this.verdict()?.days.at(-1)?.date;
    if (!d) return '';
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), { day: 'numeric', month: 'short' }).format(Date.parse(d + 'T12:00:00Z'));
    } catch {
      return d;
    }
  }

  /** "412 Forenantworten in 2 Threads · 3 … · 38 Known Issues (CIG) · 87 Community-Stimmen" — only what exists. */
  sources(): string {
    const v = this.verdict();
    if (!v) return '';
    const parts: string[] = [];
    if (v.replies != null) parts.push(this.t.instant('stability.long.src.replies', { n: v.replies, threads: v.threads ?? 1 }));
    if (v.outageMin7d != null) parts.push(this.t.instant('stability.long.src.outage', { n: Math.round(v.outageMin7d) }));
    if (v.kbOpen !== null) parts.push(this.t.instant('stability.long.src.kb', { n: v.kbOpen }));
    const votes = this.correction()?.votes ?? null;
    if (votes !== null) parts.push(this.t.instant('stability.long.src.votes', { n: votes }));
    return parts.join(' · ');
  }

  isEarlyDay(v: StabilityVerdict, d: StabilityDay): boolean {
    return (Date.parse(d.date + 'T00:00:00Z') - Date.parse(v.liveAt)) / DAY_MS < EARLY_DAYS;
  }

  dayPct(d: StabilityDay): number {
    return stabilityPercent(d.score) ?? 0;
  }

  /** The column's tooltip — also the only readable place of a hotfix build number. */
  dayTitle(d: StabilityDay): string {
    const base = this.t.instant('stability.long.dayTitle', {
      date: d.date,
      word: this.t.instant('stability.word.' + (stabilityWord(this.dayPct(d)) ?? 'wackelig')),
      score: this.dayPct(d),
      velocity: Math.round(d.velocity),
    });
    const hotfixes = d.hotfixes.map((h) => this.t.instant('news.patch.stability.hotfixMark', { build: h.build || '—', date: h.date })).join(' · ');
    return hotfixes ? `${base} · ${hotfixes}` : base;
  }

}
