import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input } from '@angular/core';

/** The text for the first `shown` names, then "+N" for the rest. */
export function eventNamesText(names: readonly string[], shown: number): string {
  const rest = names.length - shown;
  const head = names.slice(0, shown).join(', ');
  return rest > 0 ? (head ? `${head} +${rest}` : `+${rest}`) : head;
}

/**
 * One line of event names: as many FULL names as the available width holds, then "+N". Never wraps,
 * never ellipsises, never clips a name - names drop from the end until the line fits. The width is
 * measured (ResizeObserver), so it holds at every viewport.
 */
@Component({
  selector: 'sc-hq-event-names',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  styles: [':host { display: block; min-width: 0; overflow: hidden; white-space: nowrap; }'],
})
export class HqEventNamesComponent {
  readonly names = input.required<readonly string[]>();
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private ready = false;

  constructor() {
    // Resolved here: afterNextRender runs outside the injection context (NG0203).
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      this.ready = true;
      this.fit();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => this.fit());
      ro.observe(this.el);
      destroy.onDestroy(() => ro.disconnect());
    });
    effect(() => {
      this.names();
      if (this.ready) this.fit();
    });
  }

  private fit(): void {
    const names = this.names();
    let shown = names.length;
    this.el.textContent = eventNamesText(names, shown);
    while (shown > 0 && this.el.scrollWidth > this.el.clientWidth) {
      shown -= 1;
      this.el.textContent = eventNamesText(names, shown);
    }
  }
}
