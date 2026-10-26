import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';

/** The steps of the tour: `[data-tour]` marks the real element a step lights up. */
export const STARMAP_TOUR_STEPS = ['stage', 'count', 'tracks', 'series', 'more'] as const;
export type StarmapTourStep = (typeof STARMAP_TOUR_STEPS)[number];

interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Inline tutorial of the star map and its Logbuch (shell beta; implement.md §12):
 * first three bullets, then a step-by-step walk that rings the REAL elements of the
 * panel (`[data-tour]`). Non-modal `[scDialog]` card - focus moves in, Tab stays on
 * the card, Escape closes and hands focus back to the help button.
 */
@Component({
  selector: 'sc-starmap-tour',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe, ScDialogDirective],
  template: `
    @if (step() >= 0 && box(); as b) {
      <i class="ring" aria-hidden="true"
         [style.top.px]="b.top" [style.left.px]="b.left" [style.width.px]="b.width" [style.height.px]="b.height"></i>
    }
    <section class="card" role="dialog" scDialog [scDialogModal]="false" [scDialogReturnFocus]="returnTo()"
             (scDialogEscape)="closed.emit()" [attr.aria-label]="'starmap.tour.title' | translate">
      @if (step() < 0) {
        <h2>{{ 'starmap.tour.title' | translate }}</h2>
        <ul class="points">
          <li>{{ 'starmap.tour.p1' | translate }}</li>
          <li>{{ 'starmap.tour.p2' | translate }}</li>
          <li>{{ 'starmap.tour.p3' | translate }}</li>
        </ul>
        <div class="row">
          <button type="button" class="btn" (click)="go(0)">{{ 'starmap.tour.start' | translate }}</button>
          <button type="button" class="btn ghost" (click)="closed.emit()">{{ 'starmap.tour.close' | translate }}</button>
        </div>
      } @else {
        <p class="count">{{ 'starmap.tour.progress' | translate: { n: step() + 1, total: steps().length } }}</p>
        <h2>{{ 'starmap.tour.step.' + current() + '.title' | translate }}</h2>
        <p class="text" role="status">{{ 'starmap.tour.step.' + current() + '.text' | translate }}</p>
        <div class="row">
          <button type="button" class="btn ghost" [disabled]="step() === 0" (click)="go(step() - 1)">{{ 'starmap.tour.back' | translate }}</button>
          @if (step() < steps().length - 1) {
            <button type="button" class="btn" (click)="go(step() + 1)">{{ 'starmap.tour.next' | translate }}</button>
          } @else {
            <button type="button" class="btn" (click)="closed.emit()">{{ 'starmap.tour.done' | translate }}</button>
          }
          <button type="button" class="btn ghost" (click)="closed.emit()">{{ 'starmap.tour.close' | translate }}</button>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host { position: absolute; inset: 0; z-index: 20; pointer-events: none; }
      .ring { position: absolute; box-sizing: border-box; border-radius: 12px; pointer-events: none;
        border: 2px solid var(--sc-accent); box-shadow: 0 0 0 9999px color-mix(in srgb, var(--sc-bg-0) 62%, transparent), 0 0 24px color-mix(in srgb, var(--sc-accent) 45%, transparent);
        transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease; }
      .card { position: absolute; pointer-events: auto; right: var(--sc-space-3, 12px); bottom: var(--sc-space-3, 12px); width: min(380px, calc(100% - 24px));
        box-sizing: border-box; padding: var(--sc-pad-3); border-radius: 12px; outline: none; max-height: 70dvh; overflow-y: auto;
        background: color-mix(in srgb, var(--sc-bg-0) 96%, transparent); border: 1px solid var(--sc-accent); backdrop-filter: blur(10px);
        box-shadow: 0 16px 40px rgb(0 0 0 / 50%); animation: tour-in 0.2s ease-out both; }
      h2 { margin: 0 0 var(--sc-gap-2); font: 600 1rem var(--sc-font-display); color: var(--sc-fg-0); }
      .points { margin: 0 0 var(--sc-gap-3); padding-left: 1.1rem; display: grid; gap: var(--sc-gap-2); color: var(--sc-fg-1); font-size: 0.9rem; }
      .text { margin: 0 0 var(--sc-gap-3); color: var(--sc-fg-1); font-size: 0.9rem; }
      .count { margin: 0 0 4px; color: var(--sc-fg-2); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
      .row { display: flex; gap: 6px; flex-wrap: wrap; }
      .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 0 12px; border-radius: 8px;
        border: 1px solid var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-fg-0); font: 0.8rem inherit; cursor: pointer; }
      .btn.ghost { background: transparent; border-color: var(--sc-border); color: var(--sc-fg-1); }
      .btn:hover:not(:disabled), .btn:focus-visible { border-color: var(--sc-accent); color: var(--sc-fg-0); outline: none; }
      .btn:focus-visible { box-shadow: 0 0 0 2px var(--sc-accent); }
      .btn:disabled { opacity: 0.45; cursor: default; }
      @media (pointer: coarse) { .btn { min-height: 44px; min-width: 44px; } }
      @keyframes tour-in { from { opacity: 0; } to { opacity: 1; } }
      @media (max-width: 900px), (max-height: 700px) {
        .card { position: fixed; inset: auto 8px var(--sc-float-bottom, 8px) 8px; width: auto; }
      }
      @media (prefers-reduced-motion: reduce) { .card { animation: none; } .ring { transition: none; } }
    `,
  ],
})
export class StarmapTourComponent {
  private readonly destroyRef = inject(DestroyRef);

  /** The panel the `[data-tour]` elements live in; the ring is positioned inside it. */
  readonly root = input.required<HTMLElement>();
  /** The help button, focus returns there on close. */
  readonly returnTo = input<HTMLElement | null>(null);
  readonly closed = output<void>();

  /** -1 = the three bullets, then the index into `steps()`. */
  readonly step = signal(-1);
  private readonly tick = signal(0);
  readonly box = signal<Box | null>(null);

  /** Only the steps whose element is on the panel right now (a locked track is skipped). */
  readonly steps = computed<readonly StarmapTourStep[]>(() => {
    this.tick();
    const root = this.root();
    return STARMAP_TOUR_STEPS.filter((s) => !!root.querySelector(`[data-tour="${s}"]`));
  });
  readonly current = computed(() => this.steps()[this.step()] ?? 'stage');

  constructor() {
    effect(() => {
      const i = this.step();
      this.tick();
      if (i < 0) {
        this.box.set(null);
        return;
      }
      const el = this.target(this.current());
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      this.measure(el);
    });
    afterNextRender(() => {
      const root = this.root();
      const redo = () => this.tick.update((n) => n + 1);
      const ro = new ResizeObserver(redo);
      ro.observe(root);
      window.addEventListener('resize', redo);
      this.destroyRef.onDestroy(() => {
        ro.disconnect();
        window.removeEventListener('resize', redo);
      });
    });
  }

  go(i: number): void {
    this.step.set(Math.max(0, Math.min(this.steps().length - 1, i)));
  }

  private target(step: StarmapTourStep): HTMLElement | null {
    return this.root().querySelector<HTMLElement>(`[data-tour="${step}"]`);
  }

  private measure(el: HTMLElement): void {
    const root = this.root().getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const pad = 6;
    this.box.set({ top: r.top - root.top - pad, left: r.left - root.left - pad, width: r.width + 2 * pad, height: r.height + 2 * pad });
  }
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
