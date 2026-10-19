import {
  DestroyRef,
  Directive,
  ElementRef,
  NgZone,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';

/**
 * Marks a horizontally scrolling strip with where there is more to scroll, so
 * the global `.sc-scroll-hint` rule (styles.scss) can fade exactly those edges.
 * A hidden scrollbar alone gives a mouse user no cue that a strip scrolls
 * (audit AUD-160/220/281); a permanent fade lies at either end.
 *
 * Listener and observers live outside the Angular zone on purpose: a host
 * `(scroll)` listener would run a full app tick on every scroll event. The
 * signals only change at the ends of the scroll range (setting an equal value
 * notifies nobody), and a signal change schedules its own render.
 */
@Directive({
  selector: '[scScrollHint]',
  standalone: true,
  host: {
    class: 'sc-scroll-hint',
    '[attr.data-more-start]': 'moreStart() ? "" : null',
    '[attr.data-more-end]': 'moreEnd() ? "" : null',
  },
})
export class ScScrollHintDirective {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  readonly moreStart = signal(false);
  readonly moreEnd = signal(false);

  constructor() {
    afterNextRender(() => {
      this.measure();
      this.zone.runOutsideAngular(() => this.watch());
    });
  }

  /** Re-reads the scroll position; public so a host can force it. */
  measure(): void {
    const e = this.el.nativeElement;
    const x = Math.abs(e.scrollLeft); // RTL-safe: scrollLeft is <= 0 there
    const max = e.scrollWidth - e.clientWidth;
    this.moreStart.set(x > 1);
    this.moreEnd.set(max - x > 1);
  }

  private watch(): void {
    const host = this.el.nativeElement;
    const onScroll = () => this.measure();
    host.addEventListener('scroll', onScroll, { passive: true });
    this.destroyRef.onDestroy(() => host.removeEventListener('scroll', onScroll));

    // Without ResizeObserver (old engine, test stub): the first measure stands.
    if (typeof ResizeObserver !== 'function') return;
    // The box and its content can change size independently: observe both,
    // and pick up children that are added later.
    const ro = new ResizeObserver(() => this.measure());
    const observeChildren = () => {
      for (const child of Array.from(host.children)) ro.observe(child);
    };
    ro.observe(host);
    observeChildren();
    const mo = typeof MutationObserver === 'function'
      ? new MutationObserver(() => { observeChildren(); this.measure(); })
      : null;
    mo?.observe(host, { childList: true });
    this.destroyRef.onDestroy(() => { ro.disconnect(); mo?.disconnect(); });
  }
}
