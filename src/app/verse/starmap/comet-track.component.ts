import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseComet } from '../data/verse.models';
import { formatDay } from './star-dome.component';
import { addDays, cometDays, cometWindowStart, railCurve, todayYmd } from './starmap.model';
import { COMET_STYLES, TRACK_STYLES } from './track-styles';

/** Day tokens on the comet rail. */
export const COMET_DAYS = 12;
/** Px the rail sinks per token² towards the dome centre. */
const RIM_K = 0.32;

/**
 * Komet: tip the day a patch goes LIVE with one click on a day token. The
 * server takes one tip per patch and closes tips once LIVE or an official date
 * exists — after that the rail is read-only and says why.
 */
@Component({
  selector: 'sc-comet-track',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ScTooltipDirective],
  host: { class: 'left' },
  template: `
    @let c = comet();
    <div class="head">
      <span class="kind"><span class="comet" [class]="'comet s-' + c.state" aria-hidden="true"></span>{{ 'starmap.comet.kind' | translate }}</span>
      <b>{{ headKey() | translate: { patch: patchLine(), date: day(c.tippedDate, true) } }}</b>
      <button type="button" class="info" [attr.aria-label]="'starmap.comet.ruleAria' | translate"
              [scTooltip]="'starmap.comet.rule' | translate: { patch: patchLine() }">i</button>
      <span class="state" [class.tip]="c.state === 'tipped'">
        <i class="ring" [class.half]="c.state === 'tipped'" [class.done]="c.state === 'hit'" [class.closed]="c.state === 'miss' || (c.state === 'none' && c.locked)"></i>
        {{ 'starmap.comet.state.' + stateKey() | translate }}
      </span>
    </div>
    <div class="rail" [style.--k.px]="rimK" [style.--rim.px]="curve.height">
      @if (interactive()) {
        <button type="button" class="tok nav" [disabled]="!canBack()" (click)="shift(-7)"
                [attr.aria-label]="'starmap.comet.earlier' | translate" [scTooltip]="'starmap.comet.earlier' | translate" scTooltipTier="label"
                [style.--i]="0">‹</button>
      }
      @for (d of days(); track d.ymd; let i = $index) {
        <button type="button" class="tok" [class.win]="d.win" [class.on]="d.on" [style.--i]="interactive() ? i + 1 : i"
                [disabled]="!interactive() || busy() || d.ymd <= today" [attr.aria-pressed]="d.on"
                [attr.aria-label]="'starmap.comet.dayAria' | translate: { date: day(d.ymd, true) }"
                (click)="tip(d.ymd)">
          @if (d.on) { <span class="comet fall" [class]="'comet fall s-' + c.state" aria-hidden="true"></span> }
          <small>{{ weekday(d.ymd) }}</small>{{ dayNum(d.ymd) }}
        </button>
      }
      @if (interactive()) {
        <button type="button" class="tok nav" (click)="shift(7)" [style.--i]="days().length + 1"
                [attr.aria-label]="'starmap.comet.later' | translate" [scTooltip]="'starmap.comet.later' | translate" scTooltipTier="label">›</button>
      }
      <svg class="curve" viewBox="0 0 100 {{ curve.height }}" preserveAspectRatio="none" [style.height.px]="curve.height" aria-hidden="true" focusable="false">
        <path [attr.d]="curve.d" vector-effect="non-scaling-stroke" />
      </svg>
    </div>
    <div class="foot">
      <span><span class="sun" aria-hidden="true"><i></i></span><span><b>{{ 'starmap.comet.reward' | translate }}</b>
        @if (c.tippedDate && c.state === 'tipped') { · {{ 'starmap.comet.window' | translate: { patch: patchLine(), from: day(addDays(c.tippedDate, -2)), to: day(addDays(c.tippedDate, 2)) } }} }
      </span></span>
      @if (c.locked && c.state === 'none') {
        <span class="muted">{{ 'starmap.comet.locked.' + (c.lockedReason ?? 'live') | translate: { date: day(c.announcedDate, true) } }}</span>
      }
      @if (error()) {
        <span class="err" role="alert">{{ error()! | translate }}</span>
      }
    </div>
  `,
  styles: [
    TRACK_STYLES,
    COMET_STYLES,
    `
      .tok.win { box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--sc-warning) 70%, transparent); }
      .tok.on { border-color: color-mix(in srgb, var(--sc-warning) 60%, #fff); color: var(--sc-fg-0);
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-warning) 24%, transparent), color-mix(in srgb, var(--sc-bg-1) 60%, transparent)); }
      .tok:disabled:not(.on) { color: var(--sc-fg-2); }
      .tok.nav { flex: 0 0 28px; font-size: 1rem; }
    `,
  ],
})
export class CometTrackComponent {
  /** The patch line the tip is for. */
  readonly patchLine = input.required<string>();
  readonly comet = input.required<VerseComet>();

  private readonly api = inject(VerseApiService);
  private readonly t = inject(TranslateService);
  private readonly lang = toSignal(this.t.onLangChange.pipe(map((e) => e.lang)), {
    initialValue: this.t.getCurrentLang() || 'de',
  });

  readonly today = todayYmd();
  readonly rimK = RIM_K;
  readonly addDays = addDays;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  private readonly start = signal(addDays(this.today, 1));
  readonly interactive = computed(() => this.comet().state === 'none' && !this.comet().locked);
  readonly days = computed(() => cometDays(this.start(), COMET_DAYS, this.comet().tippedDate));
  readonly canBack = computed(() => this.start() > addDays(this.today, 1));
  readonly curve = railCurve(COMET_DAYS + 2, RIM_K, false);

  readonly stateKey = computed(() => {
    const c = this.comet();
    return c.state === 'none' && c.locked ? 'locked' : c.state;
  });
  readonly headKey = computed(() => {
    const c = this.comet();
    if (c.state === 'none') return c.locked ? 'starmap.comet.head.closed' : 'starmap.comet.head.ask';
    return `starmap.comet.head.${c.state}`;
  });

  constructor() {
    effect(() => {
      const c = this.comet();
      this.patchLine();
      this.start.set(cometWindowStart(c.tippedDate ?? c.announcedDate, this.today, COMET_DAYS));
      this.error.set(null);
    });
  }

  shift(days: number): void {
    const next = addDays(this.start(), days);
    const min = addDays(this.today, 1);
    this.start.set(next < min ? min : next);
  }

  async tip(ymd: string): Promise<void> {
    if (!this.interactive() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const r = await this.api.submitPrediction(this.patchLine(), ymd);
    this.busy.set(false);
    if (!r.ok) this.error.set(r.errorKey);
  }

  day(ymd: string | null, weekday = false): string {
    return formatDay(ymd, this.lang(), weekday);
  }

  weekday(ymd: string): string {
    return new Intl.DateTimeFormat(this.lang() || 'de', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));
  }

  dayNum(ymd: string): number {
    return Number(ymd.slice(8, 10));
  }
}
