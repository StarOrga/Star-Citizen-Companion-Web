import { Injectable } from '@angular/core';
import { logError } from './log';

/**
 * One shared scroll tick for every scroll-linked reader in the app.
 *
 * A single passive capture listener on `window` (outside the Angular zone) marks the
 * subscribers a scroll concerns and requests ONE animation frame; in that frame every
 * due subscriber's `read` runs first, then every `write` — so seventeen readers cost one
 * layout per frame instead of one forced layout per reader and event.
 *
 * - default: only the page's own scroll (window / document / scrolling element);
 * - `anyTarget`: every scroll, inner scroll boxes included (the old capture listeners);
 * - `target`: only scrolls of that one element (an inner panel, a strip).
 *
 * A bare function counts as a `write` (it may read too; it runs after all pure reads).
 */
export interface ScrollTickTask {
  /** Layout reads only (rects, scrollY, computed style). */
  read?: () => void;
  /** Style / signal writes; runs after every subscriber's read in the same frame. */
  write?: () => void;
}

export interface ScrollTickOptions {
  anyTarget?: boolean;
  target?: EventTarget;
}

interface Entry {
  task: ScrollTickTask;
  any: boolean;
  target: EventTarget | null;
  due: boolean;
}

const entries = new Set<Entry>();
let frame = 0;
let attached = false;

/** Runs `fn` in the root zone when zone.js is loaded, so the listener and the frame never trigger change detection. */
function outsideZone<T>(fn: () => T): T {
  const root = (globalThis as { Zone?: { root?: { run<R>(f: () => R): R } } }).Zone?.root;
  return root ? root.run(fn) : fn();
}

function isPage(t: EventTarget | null): boolean {
  return t === document || t === window || t === document.documentElement || t === document.scrollingElement || t === document.body;
}

function call(fn: (() => void) | undefined): void {
  if (!fn) return;
  try {
    fn();
  } catch (err) {
    logError('scroll-tick', 'subscriber failed', err);
  }
}

function flush(): void {
  frame = 0;
  const due: Entry[] = [];
  for (const e of entries) {
    if (!e.due) continue;
    e.due = false;
    due.push(e);
  }
  for (const e of due) call(e.task.read);
  for (const e of due) call(e.task.write);
}

function onEvent(ev: Event): void {
  const page = isPage(ev.target);
  let hit = false;
  for (const e of entries) {
    if (e.target ? e.target === ev.target : e.any || page) {
      e.due = true;
      hit = true;
    }
  }
  if (hit && !frame) frame = requestAnimationFrame(flush);
}

function attach(): void {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  outsideZone(() => window.addEventListener('scroll', onEvent, { capture: true, passive: true }));
}

function detach(): void {
  if (!attached || entries.size) return;
  attached = false;
  window.removeEventListener('scroll', onEvent, { capture: true });
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

/** Subscribes to the shared tick; returns the unsubscribe function. */
export function onScrollTick(task: ScrollTickTask | (() => void), opts: ScrollTickOptions = {}): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const entry: Entry = {
    task: typeof task === 'function' ? { write: task } : task,
    any: !!opts.anyTarget,
    target: opts.target ?? null,
    due: false,
  };
  entries.add(entry);
  attach();
  return () => {
    entries.delete(entry);
    detach();
  };
}

/** Test hook: runs the pending frame now (specs dispatch a scroll and assert in the same turn). */
export function flushScrollTick(): void {
  if (frame) cancelAnimationFrame(frame);
  flush();
}

/** Number of live subscribers (specs, diagnostics). */
export function scrollTickSize(): number {
  return entries.size;
}

/** DI face of the shared tick for components that prefer injection. */
@Injectable({ providedIn: 'root' })
export class ScrollTickService {
  subscribe(task: ScrollTickTask | (() => void), opts?: ScrollTickOptions): () => void {
    return onScrollTick(task, opts);
  }
}
