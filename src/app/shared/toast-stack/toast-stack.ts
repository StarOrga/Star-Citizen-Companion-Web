import { Directive, ElementRef, Injectable, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';

/**
 * One toast stack (overlay sizes R8). The star toast, the undo toast and the
 * app notice each stay fixed at --sc-toast-bottom; a toast that appears while
 * another is up rides above it instead of covering it. Slots are ordered by
 * arrival: the oldest sits lowest, nearest the feedback launcher.
 */
@Injectable({ providedIn: 'root' })
export class ToastStackService {
  private readonly slots = signal<{ id: symbol; h: number }[]>([]);
  /** Gap between two stacked toasts. */
  static readonly GAP_PX = 8;

  add(id: symbol): void {
    this.slots.update((s) => [...s, { id, h: 0 }]);
  }
  remove(id: symbol): void {
    this.slots.update((s) => s.filter((x) => x.id !== id));
  }
  setHeight(id: symbol, h: number): void {
    this.slots.update((s) => (s.some((x) => x.id === id && x.h !== h) ? s.map((x) => (x.id === id ? { ...x, h } : x)) : s));
  }
  /** Pixels between --sc-toast-bottom and this toast's bottom edge. */
  offset(id: symbol) {
    return computed(() => {
      let sum = 0;
      for (const x of this.slots()) {
        if (x.id === id) return sum;
        sum += x.h + ToastStackService.GAP_PX;
      }
      return 0;
    });
  }
}

/** Put on a toast's root element; it publishes `--sc-toast-offset` there. */
@Directive({
  selector: '[scToastSlot]',
  host: { '[style.--sc-toast-offset]': 'offsetCss()' },
})
export class ToastSlotDirective implements OnInit, OnDestroy {
  private readonly stack = inject(ToastStackService);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly id = Symbol('toast');
  private ro?: ResizeObserver;
  private readonly offsetPx = this.stack.offset(this.id);
  protected readonly offsetCss = computed(() => `${this.offsetPx()}px`);

  ngOnInit(): void {
    this.stack.add(this.id);
    this.stack.setHeight(this.id, this.el.nativeElement.offsetHeight);
    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => this.stack.setHeight(this.id, this.el.nativeElement.offsetHeight));
      this.ro.observe(this.el.nativeElement);
    }
  }
  ngOnDestroy(): void {
    this.ro?.disconnect();
    this.stack.remove(this.id);
  }
}
