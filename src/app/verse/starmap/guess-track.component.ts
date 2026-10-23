import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseGuess, VerseGuessOption } from '../data/verse.models';
import { railCurve } from './starmap.model';
import { TRACK_STYLES } from './track-styles';

const RIM_K = 1.05;

/** Short token label: the name without its manufacturer ("RSI Zeus Mk II" → "Zeus Mk II"). */
export function shortShipName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : name;
}

/**
 * Sternbild erkennen: the 7 hull options as calm holographic tokens on the
 * scanner rail. One click is the one try (the ⓘ says so) — no popup, no second
 * click. A wrong guess calmly reveals the answer.
 */
@Component({
  selector: 'sc-guess-track',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ScTooltipDirective],
  host: { class: 'right' },
  template: `
    @let g = guess();
    <div class="head">
      <span class="kind">
        <svg class="scope" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3.2 13.6L16.4 7.4l1.7 3.5L4.9 17.1z" /><path d="M16.4 7.4l3-1.4 1.7 3.5-3 1.4" />
          <path d="M11.5 14.1L8 21.5M11.5 14.1L15 21.5M11.5 14.1v7.4" /><path class="g" d="M21.6 1.4v3.4M19.9 3.1h3.4" />
        </svg>
        {{ 'starmap.guess.kind' | translate }}
      </span>
      <b>{{ headKey() | translate: { name: answerName() } }}</b>
      <button type="button" class="info" [attr.aria-label]="'starmap.guess.ruleAria' | translate"
              [scTooltip]="'starmap.guess.rule' | translate">i</button>
      <span class="state">
        <i class="ring" [class.done]="g.state === 'correct'" [class.closed]="g.state === 'wrong'"></i>
        {{ 'starmap.guess.state.' + g.state | translate }}
      </span>
    </div>
    @if (loadError()) {
      <p class="err" role="alert">
        {{ loadError()! | translate }}
        <button type="button" class="retry" (click)="load()">{{ 'errors.retry' | translate }}</button>
      </p>
    } @else {
      <div class="rail" [style.--k]="rimK + 'px'" [style.--rim]="curve.height + 'px'" [attr.aria-busy]="options().length === 0">
        @for (o of options(); track o.className; let i = $index) {
          <button type="button" class="tok ship" [style.--i]="options().length - 1 - i"
                  [class.answer]="g.state !== 'open' && o.className === g.answerClass"
                  [class.mine]="o.className === g.guessedClass"
                  [class.dim]="g.state !== 'open' && o.className !== g.answerClass"
                  [disabled]="g.state !== 'open' || busy() || answered()"
                  [attr.aria-label]="'starmap.guess.optionAria' | translate: { name: o.name }"
                  [scTooltip]="o.name" scTooltipTier="label"
                  (click)="pick(o)">
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path d="M16 3L18.5 12L28 20L28 23L19 21L18 27L14 27L13 21L4 23L4 20L13.5 12Z" /></svg>
            <small>{{ short(o.name) }}</small>
          </button>
        } @empty {
          @for (i of placeholders; track i) { <span class="tok ship ghost" [style.--i]="6 - i" aria-hidden="true"></span> }
        }
        <svg class="curve" [attr.viewBox]="'0 0 100 ' + curve.height" preserveAspectRatio="none" [style.height.px]="curve.height" aria-hidden="true" focusable="false">
          <path [attr.d]="curve.d" vector-effect="non-scaling-stroke" />
        </svg>
      </div>
    }
    <div class="foot">
      <span>{{ footKey() | translate: { name: answerName() } }}</span>
      @if (error()) { <span class="err" role="alert">{{ error()! | translate }}</span> }
    </div>
  `,
  styles: [
    TRACK_STYLES,
    `
      .scope { width: 20px; height: 20px; fill: none; stroke: var(--sc-accent); stroke-width: 1.3; stroke-linejoin: round; stroke-linecap: round;
        filter: drop-shadow(0 0 3px color-mix(in srgb, var(--sc-accent) 45%, transparent)); }
      .scope .g { stroke: #eaf9ff; stroke-width: 1; }
      .tok.ship { height: 56px; border: 0; border-radius: 6px 6px 2px 2px; color: color-mix(in srgb, var(--sc-accent) 62%, #fff 10%);
        background: linear-gradient(0deg, color-mix(in srgb, var(--sc-accent) 13%, transparent), transparent 72%),
          repeating-linear-gradient(0deg, color-mix(in srgb, var(--sc-accent) 6%, transparent) 0 1px, transparent 1px 3px);
        box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--sc-accent) 45%, transparent); }
      .tok.ship svg { width: 24px; height: 24px; fill: currentColor; opacity: 0.75;
        filter: drop-shadow(0 0 3px color-mix(in srgb, var(--sc-accent) 55%, transparent));
        transition: transform 0.3s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.3s ease; }
      .tok.ship small { font-size: 0.58rem; letter-spacing: 0.02em; text-transform: none; color: var(--sc-fg-2);
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px; }
      .tok.ship:not(:disabled):hover, .tok.ship:focus-visible { color: #d9f4ff; background: linear-gradient(0deg, color-mix(in srgb, var(--sc-accent) 26%, transparent), transparent 80%),
          repeating-linear-gradient(0deg, color-mix(in srgb, var(--sc-accent) 9%, transparent) 0 1px, transparent 1px 3px); }
      .tok.ship:not(:disabled):hover svg, .tok.ship:focus-visible svg { opacity: 1; transform: scale(1.14); }
      .tok.ship.answer { color: #eaf9ff; box-shadow: inset 0 -2px 0 var(--sc-accent), 0 0 14px color-mix(in srgb, var(--sc-accent) 30%, transparent); }
      .tok.ship.answer svg { opacity: 1; }
      .tok.ship.answer small { color: var(--sc-fg-0); }
      .tok.ship.mine:not(.answer) small { text-decoration: underline dotted; text-underline-offset: 2px; }
      .tok.ship.ghost { opacity: 0.35; cursor: default; }
      @media (max-width: 760px) { .tok.ship { flex: 0 0 64px; } }
      @media (prefers-reduced-motion: reduce) { .tok.ship svg { transition: none; } }
    `,
  ],
})
export class GuessTrackComponent {
  readonly patchLine = input.required<string>();
  readonly guess = input.required<VerseGuess>();

  private readonly api = inject(VerseApiService);
  readonly rimK = RIM_K;
  readonly curve = railCurve(7, RIM_K, true);
  readonly placeholders = [0, 1, 2, 3, 4, 5, 6];
  readonly options = signal<readonly VerseGuessOption[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);
  /** The answer right after a guess, before the reloaded explorer state arrives. */
  private readonly answer = signal<string | null>(null);
  readonly short = shortShipName;

  readonly answered = computed(() => this.answer() !== null);
  readonly answerName = computed(() => this.guess().answerName ?? this.answer() ?? '');
  readonly headKey = computed(() => `starmap.guess.head.${this.guess().state}`);
  readonly footKey = computed(() => `starmap.guess.foot.${this.guess().state}`);

  constructor() {
    effect(() => {
      this.patchLine();
      const state = this.guess().state;
      this.answer.set(null);
      this.error.set(null);
      if (state !== 'unavailable') void this.load();
    });
  }

  async load(): Promise<void> {
    const line = this.patchLine();
    this.loadError.set(null);
    const r = await this.api.guessOptions(line);
    if (line !== this.patchLine()) return;
    if (r.ok) this.options.set(r.data.options);
    else this.loadError.set(r.errorKey);
  }

  async pick(o: VerseGuessOption): Promise<void> {
    if (this.guess().state !== 'open' || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const r = await this.api.submitGuess(this.patchLine(), o.className);
    this.busy.set(false);
    if (r.ok) this.answer.set(r.data.answerName);
    else this.error.set(r.errorKey);
  }
}
