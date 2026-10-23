import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { map } from 'rxjs';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import type { VersePoint } from '../data/verse.models';
import {
  StarSlot,
  StarTaskView,
  SunState,
  constellationEdges,
  nextLead,
  starSlots,
} from './starmap.model';

/** Entry timeline (s): sky → lit lines draw → lit stars ignite → next pushes → dormant cores. */
const T_LINES = 0.5;
const LINES_SPAN = 0.8;
const T_IGNITE_GAP = 0.28;

/** Task links that lead back to this page carry no link in the card (the track is right below). */
const SELF_LINK = '/verse/explorer';

/** Locale date of an ISO timestamp / `YYYY-MM-DD`. */
export function formatDay(value: string | null, lang: string, withWeekday = false): string {
  if (!value) return '';
  const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(lang || 'de', {
    weekday: withWeekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    timeZone: value.length === 10 ? 'UTC' : undefined,
  }).format(d);
}

/**
 * The dome sky of one patch: 7 stars without any ring (dormant core · next
 * pushing outward · lit with glow and spikes), the outline lines, the dashed
 * lead to the suggested star and the sun top right. Every star is a button; a
 * click opens its card next to it. Plays the entry sequence on every open;
 * reduced motion shows the final state.
 */
@Component({
  selector: 'sc-star-dome',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, ScTooltipDirective, ScDialogDirective],
  template: `
    <div class="fig">
      <div class="plane">
        <svg class="lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          @for (e of edges(); track $index) {
            @if (e.lit) {
              <path class="ln on" pathLength="1" [attr.d]="'M' + e.from.x + ' ' + e.from.y + 'L' + e.to.x + ' ' + e.to.y"
                    [style.--d]="(lineDelay(e.drawOrder)) + 's'" />
            } @else {
              <path class="ln off" [attr.d]="'M' + e.from.x + ' ' + e.from.y + 'L' + e.to.x + ' ' + e.to.y" [style.--d]="(tLate()) + 's'" />
            }
          }
          @if (lead(); as l) {
            <path class="ln nx" [attr.d]="'M' + l.from.x + ' ' + l.from.y + 'L' + l.to.x + ' ' + l.to.y" [style.--d]="(tNext()) + 's'" />
          }
        </svg>
        @for (s of slots(); track s.index) {
          <button type="button" class="star" [class]="'star ' + s.state" [style.left.%]="s.x" [style.top.%]="s.y"
                  [style.--d]="(starDelay(s)) + 's'" [attr.aria-pressed]="selected() === s.index"
                  [attr.aria-label]="starAria(s) | translate: { task: (taskTitle(s) | translate), n: s.rank + 1 }"
                  (click)="toggle(s)">
            <span class="ent">
              <svg class="sv" viewBox="-14 -14 28 28" aria-hidden="true" focusable="false">
                @switch (s.state) {
                  @case ('done') {
                    <g class="st done"><circle class="h" r="8" /><path class="spk" d="M0-10L0.45 0 0 10-0.45 0zM-10 0L0 0.45 10 0 0-0.45z" /><circle class="c" r="1.6" /></g>
                  }
                  @case ('next') {
                    <g class="st next"><circle class="bl" r="3.4" /><path class="spk" d="M0-9L0.4 0 0 9-0.4 0zM-9 0L0 0.4 9 0 0-0.4z" /><circle class="c" r="1.5" /></g>
                  }
                  @default {
                    <g class="st open"><circle class="ig" r="2.2" /><circle class="c" r="1.1" /></g>
                  }
                }
              </svg>
            </span>
          </button>
        }
        @if (card(); as c) {
          <div class="card" role="dialog" scDialog [scDialogModal]="false" (scDialogEscape)="close()"
               [attr.aria-label]="taskTitle(c) | translate"
               [class.flip]="c.x > 55" [style.left.%]="c.x > 55 ? null : c.x" [style.right.%]="c.x > 55 ? 100 - c.x : null"
               [style.top.%]="c.y">
            <button type="button" class="x" [attr.aria-label]="'starmap.card.close' | translate"
                    [scTooltip]="'starmap.card.close' | translate" scTooltipTier="label" (click)="close()">×</button>
            <small>{{ cardEyebrow(c) | translate: { n: c.rank + 1 } }}</small>
            <b>{{ taskTitle(c) | translate }}</b>
            @if (c.state === 'done') {
              <p>{{ 'starmap.card.doneOn' | translate: { date: doneDate(c.task) } }}</p>
            } @else if (c.task) {
              <p>{{ 'starmap.task.' + c.task.i18nKey + '.how' | translate }}</p>
              @if (c.task.locked) {
                <p class="muted">{{ lockedKey(c.task) | translate }}</p>
              } @else if (c.task.link !== selfLink && c.task.key !== 'comet') {
                <a class="go" [routerLink]="c.task.link">{{ 'starmap.task.' + c.task.i18nKey + '.link' | translate }} ›</a>
              } @else {
                <p class="muted">{{ 'starmap.card.here' | translate }}</p>
              }
            } @else {
              <p>{{ 'starmap.card.empty' | translate }}</p>
            }
          </div>
        }
      </div>
      <span class="sun-sky" tabindex="0" role="img" [class]="'sun-sky ' + sun()"
            [attr.aria-label]="'starmap.sun.' + sun() + '.aria' | translate"
            [scTooltip]="'starmap.sun.' + sun() + '.tip' | translate: { patch: sunLine() }">
        <span class="sun" [class]="'sun s-' + sun()"><i></i></span>
        @if (sun() === 'hit') { <span class="comet s-hit" aria-hidden="true"></span> }
      </span>
    </div>
  `,
  styles: [
    `
      :host { display: block; position: relative; }
      .fig { position: relative; height: 100%; aspect-ratio: 1; max-width: 100%; margin: 0 auto; }
      .plane { position: absolute; inset: 6%; }
      .lines { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      .ln { fill: none; vector-effect: non-scaling-stroke; stroke-linecap: round; }
      .ln.on { stroke: color-mix(in srgb, var(--sc-accent) 70%, #fff); stroke-width: 1.2; opacity: 0.75;
        stroke-dasharray: 1; stroke-dashoffset: 1; animation: sd-draw 0.4s ease-in-out var(--d) both; }
      .ln.off { stroke: color-mix(in srgb, var(--sc-accent) 22%, transparent); stroke-width: 1; animation: sd-in 0.6s ease-out var(--d) both; }
      .ln.nx { stroke: color-mix(in srgb, var(--sc-accent) 75%, transparent); stroke-width: 1.2; stroke-dasharray: 4 5;
        animation: sd-in 0.6s ease-out var(--d) both; }
      .star { position: absolute; width: 9%; aspect-ratio: 1; translate: -50% -50%; border: 0; padding: 0; margin: 0;
        background: none; border-radius: 50%; cursor: pointer; z-index: 2; }
      .star::before { content: ''; position: absolute; inset: -38%; border-radius: 50%; pointer-events: none; opacity: 0;
        transition: opacity 0.35s ease;
        background: radial-gradient(circle, color-mix(in srgb, var(--sc-accent) 30%, #fff 10%) 0, color-mix(in srgb, var(--sc-accent) 12%, transparent) 36%, transparent 66%); }
      .star[aria-pressed='true']::before { opacity: 0.7; }
      .star:hover::before, .star:focus-visible::before { opacity: 1; }
      .star:focus-visible { outline: none; }
      .star:focus-visible .sv { outline: 1px dashed color-mix(in srgb, var(--sc-accent) 60%, transparent); outline-offset: 2px; border-radius: 50%; }
      .ent { position: absolute; inset: 0; display: block; }
      .sv { display: block; width: 100%; height: 100%; overflow: visible;
        transition: transform 0.35s cubic-bezier(0.2, 0.7, 0.2, 1), filter 0.35s ease; }
      .star:hover .sv, .star:focus-visible .sv { transform: scale(1.25);
        filter: brightness(1.4) drop-shadow(0 0 4px color-mix(in srgb, var(--sc-accent) 60%, #fff)); }
      .star.done .ent { animation: sd-ignite 0.7s ease-out var(--d) both; }
      .star.next .ent, .star.open .ent { animation: sd-in 0.6s ease-out var(--d) both; }
      /* done: soft core, glow, fine spikes, breathing very gently */
      .st.done .h { fill: color-mix(in srgb, var(--sc-accent) 55%, #fff); opacity: 0.32; filter: blur(2.4px);
        transform-box: fill-box; transform-origin: center; animation: sd-breathe 5s ease-in-out infinite; }
      .st.done .spk { fill: #fff; opacity: 0.7; }
      .st.done .c { fill: #fff; filter: drop-shadow(0 0 1.5px #fff); }
      /* next: the core pushes outward but is not out yet */
      .st.next .bl { fill: color-mix(in srgb, var(--sc-accent) 60%, #fff); opacity: 0.3; filter: blur(1.4px);
        transform-box: fill-box; transform-origin: center; animation: sd-bloom 2.4s ease-in-out var(--d) infinite; }
      .st.next .spk { fill: color-mix(in srgb, var(--sc-accent) 50%, #fff); opacity: 0.25; transform-box: fill-box; transform-origin: center;
        animation: sd-spk 2.4s ease-in-out var(--d) infinite; }
      .st.next .c { fill: color-mix(in srgb, var(--sc-accent) 35%, #fff); }
      /* open: a dormant inner core */
      .st.open .ig { fill: color-mix(in srgb, var(--sc-accent) 40%, transparent); opacity: 0.35; filter: blur(1px); }
      .st.open .c { fill: color-mix(in srgb, var(--sc-fg-1) 70%, transparent); }
      @keyframes sd-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes sd-draw { to { stroke-dashoffset: 0; } }
      @keyframes sd-ignite { 0% { opacity: 0; transform: scale(0.4); filter: brightness(2.4); }
        40% { opacity: 1; transform: scale(1.3); filter: brightness(2.4) drop-shadow(0 0 6px #fff); }
        100% { opacity: 1; transform: none; filter: none; } }
      @keyframes sd-breathe { 0%, 100% { opacity: 0.28; transform: scale(0.94); } 50% { opacity: 0.42; transform: scale(1.04); } }
      @keyframes sd-bloom { 0%, 100% { opacity: 0.18; transform: scale(0.8); } 60% { opacity: 0.5; transform: scale(1.5); } }
      @keyframes sd-spk { 0%, 100% { opacity: 0.12; transform: scale(0.75); } 60% { opacity: 0.45; transform: scale(1); } }
      .card { position: absolute; z-index: 4; width: min(280px, 70vw); margin: 0 0 0 4.5%; padding: var(--sc-pad-2) var(--sc-pad-2) var(--sc-pad-2);
        translate: 0 -50%; border-radius: 12px; box-sizing: border-box; outline: none;
        background: color-mix(in srgb, var(--sc-bg-0) 90%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 50%, transparent);
        backdrop-filter: blur(10px); box-shadow: 0 16px 40px rgb(0 0 0 / 50%), 0 0 30px color-mix(in srgb, var(--sc-accent) 10%, transparent);
        animation: sd-in 0.25s ease-out both; }
      .card.flip { margin: 0 4.5% 0 0; }
      .card small { display: block; padding-right: 28px; font: 0.66rem var(--sc-font-display); letter-spacing: 0.2em; text-transform: uppercase; color: var(--sc-accent); }
      .card b { display: block; font-size: 1.05rem; font-weight: 600; margin: 6px 0 4px; color: var(--sc-fg-0); }
      .card p { margin: 0 0 var(--sc-gap-2); font-size: 0.82rem; line-height: 1.45; color: var(--sc-fg-1); }
      .card p:last-child { margin-bottom: 0; }
      .muted { color: var(--sc-fg-2) !important; }
      .x { position: absolute; right: 8px; top: 8px; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--sc-border);
        background: none; color: var(--sc-fg-2); font: 0.9rem/1 inherit; cursor: pointer; padding: 0; }
      .x:hover, .x:focus-visible { color: var(--sc-fg-0); border-color: var(--sc-accent); outline: none; }
      .go { display: inline-flex; align-items: center; min-height: 36px; padding: 0 var(--sc-pad-2); border-radius: 4px; background: var(--sc-accent);
        color: var(--sc-bg-0); font: 0.75rem var(--sc-font-display); letter-spacing: 0.14em; text-transform: uppercase; text-decoration: none; }
      .go:focus-visible { outline: 2px solid var(--sc-fg-0); outline-offset: 2px; }
      /* the sun lives in the sky top right of the constellation, no frame */
      .sun-sky { position: absolute; z-index: 3; left: 96%; top: 4%; width: 56px; height: 56px; translate: -50% -50%;
        display: grid; place-items: center; border-radius: 50%; cursor: help; outline: none; animation: sd-in 0.8s ease-out 0.3s both; }
      .sun-sky:focus-visible .sun > i { outline: 1px dashed var(--sc-accent); outline-offset: 6px; }
      .sun { --k: 1.7; --fl: 0px; position: relative; display: inline-block; width: calc(var(--k) * 16px); height: calc(var(--k) * 16px); opacity: 0.5; }
      .sun > i { position: absolute; left: 50%; top: 50%; width: calc(var(--k) * 6px); height: calc(var(--k) * 6px); translate: -50% -50%;
        border-radius: 50%; background: var(--sc-fg-2); box-shadow: 0 0 calc(var(--k) * 6px) calc(var(--k) * 1px) color-mix(in srgb, var(--sc-fg-2) 30%, transparent); }
      .sun::before { content: ''; position: absolute; left: 50%; top: 50%; width: calc(var(--k) * var(--fl)); height: 1px; translate: -50% -50%;
        opacity: 0.8; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sc-warning) 70%, #fff) 50%, transparent); }
      .sun.s-tipped { --fl: 46px; opacity: 1; }
      .sun.s-tipped > i { background: radial-gradient(circle, #fff3dc 0 35%, var(--sc-warning) 100%);
        box-shadow: 0 0 calc(var(--k) * 8px) calc(var(--k) * 2px) color-mix(in srgb, var(--sc-warning) 55%, transparent),
          0 0 calc(var(--k) * 24px) calc(var(--k) * 8px) color-mix(in srgb, var(--sc-warning) 18%, transparent);
        animation: sd-breathe-sun 4s ease-in-out infinite; }
      .sun.s-hit { --fl: 140px; opacity: 1; }
      .sun.s-hit::before { height: 2px; }
      .sun.s-hit > i { width: calc(var(--k) * 8px); height: calc(var(--k) * 8px); background: #fff;
        box-shadow: 0 0 calc(var(--k) * 10px) calc(var(--k) * 4px) #fff,
          0 0 calc(var(--k) * 30px) calc(var(--k) * 12px) color-mix(in srgb, var(--sc-warning) 55%, transparent),
          0 0 calc(var(--k) * 70px) calc(var(--k) * 28px) color-mix(in srgb, var(--sc-warning) 16%, transparent); }
      @keyframes sd-breathe-sun { 0%, 100% { filter: brightness(0.9); } 50% { filter: brightness(1.15); } }
      .comet { position: absolute; right: 70%; top: 72%; width: 46px; height: 10px; transform: rotate(-28deg); pointer-events: none; }
      .comet::before { content: ''; position: absolute; left: 0; right: 4px; top: 3px; height: 4px; clip-path: polygon(0 50%, 100% 0, 100% 100%);
        transform-origin: right center; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sc-accent) 40%, transparent) 45%, #eaf9ff);
        animation: sd-tail 2.8s ease-in-out infinite; }
      .comet::after { content: ''; position: absolute; right: 0; top: 1px; width: 8px; height: 8px; border-radius: 50%;
        background: radial-gradient(circle, #fff 0 25%, color-mix(in srgb, var(--sc-accent) 70%, #fff) 40%, transparent 72%);
        box-shadow: 0 0 8px color-mix(in srgb, var(--sc-accent) 70%, #fff); }
      @keyframes sd-tail { 0%, 100% { transform: scaleX(0.82); opacity: 0.8; } 50% { transform: scaleX(1.12); opacity: 1; } }
      @media (pointer: coarse) { .star { min-width: 44px; min-height: 44px; } }
      @media (max-width: 640px) {
        .card { position: absolute; left: 4% !important; right: 4% !important; width: auto; margin: 0; translate: 0 18px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .ln, .ent, .sun-sky, .card, .st .h, .st .bl, .st .spk, .sun > i, .comet::before { animation: none !important; }
        .ln.on { stroke-dashoffset: 0; }
        .sv { transition: none; }
      }
    `,
  ],
})
export class StarDomeComponent {
  readonly points = input<readonly VersePoint[] | null | undefined>(null);
  readonly tasks = input.required<readonly StarTaskView[]>();
  readonly next = input<StarTaskView | null>(null);
  readonly sun = input<SunState>('faded');
  /** The patch line the sun waits for (tooltip). */
  readonly sunLine = input('');
  /** Changes when the patch changes: closes the card. */
  readonly patchLine = input('');

  readonly selfLink = SELF_LINK;
  private readonly t = inject(TranslateService);
  private readonly lang = toSignal(this.t.onLangChange.pipe(map((e) => e.lang)), {
    initialValue: this.t.getCurrentLang() || 'de',
  });

  readonly slots = computed(() => starSlots(this.points(), this.tasks(), this.next()));
  readonly edges = computed(() => constellationEdges(this.slots()));
  readonly lead = computed(() => nextLead(this.slots()));
  readonly selected = signal<number | null>(null);
  readonly card = computed(() => this.slots().find((s) => s.index === this.selected()) ?? null);

  private readonly litCount = computed(() => this.slots().filter((s) => s.state === 'done').length);
  private readonly litLines = computed(() => this.edges().filter((e) => e.lit).length);
  private readonly tIgnite = computed(() => T_LINES + (this.litLines() ? LINES_SPAN : 0.2));
  readonly tNext = computed(() => this.tIgnite() + this.litCount() * T_IGNITE_GAP + 0.25);
  readonly tLate = computed(() => this.tNext() + 0.35);

  constructor() {
    effect(() => {
      this.patchLine();
      this.selected.set(null);
    });
  }

  lineDelay(order: number): number {
    const n = Math.max(1, this.litLines());
    return +(T_LINES + (order * (LINES_SPAN - 0.4)) / n).toFixed(3);
  }

  starDelay(s: StarSlot): number {
    if (s.state === 'done') return +(this.tIgnite() + s.rank * T_IGNITE_GAP).toFixed(3);
    if (s.state === 'next') return +this.tNext().toFixed(3);
    return +(this.tLate() + (s.rank - this.litCount()) * 0.06).toFixed(3);
  }

  toggle(s: StarSlot): void {
    this.selected.set(this.selected() === s.index ? null : s.index);
  }

  close(): void {
    this.selected.set(null);
  }

  taskTitle(s: StarSlot): string {
    return s.task ? `starmap.task.${s.task.i18nKey}.title` : 'starmap.card.emptyTitle';
  }

  starAria(s: StarSlot): string {
    return `starmap.star.${s.state}`;
  }

  cardEyebrow(s: StarSlot): string {
    if (s.state === 'done') return 'starmap.card.eyebrowDone';
    if (s.state === 'next') return 'starmap.card.eyebrowNext';
    return s.task?.locked ? 'starmap.card.eyebrowLocked' : 'starmap.card.eyebrowOpen';
  }

  lockedKey(task: StarTaskView): string {
    return task.key === 'comet' ? 'starmap.card.lockedComet' : 'starmap.card.lockedGuess';
  }

  doneDate(task: StarTaskView | null): string {
    return formatDay(task?.doneAt ?? null, this.lang());
  }
}
