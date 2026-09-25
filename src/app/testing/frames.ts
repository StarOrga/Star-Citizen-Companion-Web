/**
 * Frames on demand — for specs whose code under test waits for one of the
 * browser's rendering steps: `requestAnimationFrame`, or a `ResizeObserver`
 * report.
 *
 * A spec that waits for a REAL frame is at the mercy of the Karma page being
 * rendered at all, and it is not always: a hidden page renders nothing. That
 * is what took the patch board, the patch dossier and the feedback motion
 * down in full runs (2026-09-25) — a spec's Ctrl+click had opened a real tab
 * in front of Karma's, no frame arrived for the rest of the run, and every
 * frame-driven spec that happened to come later timed out, a different
 * handful per random-order run, while each file passed on its own.
 * (`new-tab-guard.spec.ts` now fails such a click where it happens.)
 *
 * What these specs need from the frame is only its MOMENT: layout itself is
 * synchronous (`getBoundingClientRect()` and friends lay the page out on
 * demand). So the spec plays the browser's part and says when the frame is.
 * Both helpers are jasmine spies, so they are undone with the spec's others;
 * install them before the code that asks for a frame runs.
 */

/** A spec-driven stand-in for the browser's animation-frame clock. */
export interface FrameClock {
  /**
   * Run one frame: every callback queued before this call, in order, with one
   * shared timestamp. A callback that asks for another frame gets the next
   * one, and a callback cancelled by an earlier one does not run — as in the
   * browser.
   */
  runFrame(): void;
}

/** Take over `requestAnimationFrame` / `cancelAnimationFrame` for the running spec. */
export function installFrameClock(): FrameClock {
  const queue = new Map<number, FrameRequestCallback>();
  let lastId = 0;
  spyOn(window, 'requestAnimationFrame').and.callFake((callback: FrameRequestCallback) => {
    queue.set(++lastId, callback);
    return lastId;
  });
  spyOn(window, 'cancelAnimationFrame').and.callFake((id: number) => {
    queue.delete(id);
  });
  return {
    runFrame() {
      const now = performance.now();
      for (const id of [...queue.keys()]) {
        const callback = queue.get(id);
        if (!callback) continue;
        queue.delete(id);
        callback(now);
      }
    },
  };
}

/** A spec-driven stand-in for the browser's `ResizeObserver` deliveries. */
export interface ResizeDriver {
  /** Every element some observer is watching right now. */
  observed(): Element[];
  /**
   * Deliver what the browser delivers after a layout: one call per observer,
   * with an entry for each element it watches, measured from the live layout.
   */
  notify(): void;
}

/** Take over `ResizeObserver` for the running spec. */
export function installResizeDriver(): ResizeDriver {
  const observers: DrivenResizeObserver[] = [];
  // A `function`, not an arrow: the spy is called with `new`.
  spyOn(window, 'ResizeObserver').and.callFake(function (callback: ResizeObserverCallback) {
    const observer = new DrivenResizeObserver(callback);
    observers.push(observer);
    return observer;
  });
  return {
    observed: () => observers.flatMap((o) => [...o.targets]),
    notify: () => {
      for (const o of observers) o.deliver();
    },
  };
}

class DrivenResizeObserver implements ResizeObserver {
  readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  deliver(): void {
    if (this.targets.size > 0) this.callback([...this.targets].map(measuredEntry), this);
  }
}

/** A `ResizeObserverEntry` for the element as it is laid out right now. */
function measuredEntry(target: Element): ResizeObserverEntry {
  const border = target.getBoundingClientRect();
  const style = getComputedStyle(target);
  const px = (value: string) => Number.parseFloat(value) || 0;
  const content = {
    inlineSize: border.width - px(style.paddingLeft) - px(style.paddingRight) - px(style.borderLeftWidth) - px(style.borderRightWidth),
    blockSize: border.height - px(style.paddingTop) - px(style.paddingBottom) - px(style.borderTopWidth) - px(style.borderBottomWidth),
  };
  return {
    target,
    contentRect: new DOMRectReadOnly(px(style.paddingLeft), px(style.paddingTop), content.inlineSize, content.blockSize),
    borderBoxSize: [{ inlineSize: border.width, blockSize: border.height }],
    contentBoxSize: [content],
    devicePixelContentBoxSize: [{ inlineSize: content.inlineSize * devicePixelRatio, blockSize: content.blockSize * devicePixelRatio }],
  };
}
