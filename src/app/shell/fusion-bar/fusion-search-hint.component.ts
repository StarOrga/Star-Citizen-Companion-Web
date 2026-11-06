import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { WindowFocusService } from '../../core/window-focus.service';

/** One hint of the empty field: the line, and the example a click puts into the field (none for key hints). */
export interface SearchHint {
  t: string;
  q?: string;
}

/** A hint stays ~6 s (round 3 `q3-hints`). */
export const HINT_ROTATE_MS = 6000;

/**
 * The one-line, rotating hint at the bottom of the empty search (A7). Clicking
 * a hint with an example puts it into the field. It pauses while hovered or
 * focused and does not rotate at all under reduced motion.
 */
@Component({
  selector: 'sc-fusion-search-hint',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(pointerenter)': 'paused.set(true)',
    '(pointerleave)': 'paused.set(false)',
    '(focusin)': 'paused.set(true)',
    '(focusout)': 'paused.set(false)',
  },
  template: `
    @if (current(); as h) {
      <span class="lead" aria-hidden="true">{{ 'search.hint.lead' | translate }}</span>
      @if (h.q) {
        <button type="button" class="line" [attr.data-i]="index()" (click)="pick.emit(h.q!)"
                [attr.aria-label]="'search.hint.tryAria' | translate: { hint: h.t }">{{ h.t }}</button>
      } @else {
        <span class="line" [attr.data-i]="index()">{{ h.t }}</span>
      }
    }
  `,
  styles: [`
    :host {
      display: flex; align-items: center; gap: var(--sc-space-2); min-width: 0;
      padding: var(--sc-space-1) var(--sc-space-2); color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor));
    }
    .lead { flex: none; color: var(--sc-fg-2); }
    .line {
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      padding: 2px 6px; margin: 0; border: 0; border-radius: 6px; background: transparent;
      color: var(--sc-fg-1); font: inherit; text-align: left; animation: fsh-in 0.3s ease both;
    }
    button.line { cursor: pointer; }
    button.line:hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    button.line:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    @keyframes fsh-in { from { opacity: 0; transform: translateY(3px); } }
    @media (prefers-reduced-motion: reduce) { .line { animation: none; } }
    @media (pointer: coarse) { button.line { min-height: 44px; } }
  `],
})
export class FusionSearchHintComponent {
  readonly hints = input<readonly SearchHint[]>([]);
  readonly pick = output<string>();

  readonly paused = signal(false);
  private readonly tick = signal(Math.floor(Math.random() * 1000));
  readonly index = computed(() => {
    const n = this.hints().length;
    return n ? this.tick() % n : -1;
  });
  readonly current = computed<SearchHint | null>(() => this.hints()[this.index()] ?? null);

  constructor() {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const focus = inject(WindowFocusService);
    const timer = setInterval(() => {
      if (!this.paused() && focus.focused()) this.tick.update((t) => t + 1);
    }, HINT_ROTATE_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** For specs: the next hint now. */
  next(): void {
    this.tick.update((t) => t + 1);
  }
}
