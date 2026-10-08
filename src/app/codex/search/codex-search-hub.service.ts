import { Injectable, computed, signal } from '@angular/core';

/** What the hub needs from a mounted Codex search bar. */
export interface CodexSearchBarHandle {
  /** Bring the bar forward: expanded, focused; `seed` starts the search with that text. */
  activate(seed?: string): void;
}

/**
 * Routes Ctrl+K, "/", the header search button and type-to-search to the
 * Codex search bar when one is on screen. The bars register themselves (the
 * landing terminal, the slim bar above every other Codex page), so "is there
 * a bar" is the same question as "is this a Codex page" — without a URL
 * pattern that could drift from the routes. No bar → the caller falls back to
 * the Ctrl+K overlay.
 */
@Injectable({ providedIn: 'root' })
export class CodexSearchHub {
  private readonly bars = signal<readonly CodexSearchBarHandle[]>([]);

  /** True while a Codex search bar is mounted. */
  readonly hasBar = computed(() => this.bars().length > 0);

  /** Register a bar; the returned function unregisters it. The newest bar wins. */
  register(bar: CodexSearchBarHandle): () => void {
    this.bars.update((list) => [...list.filter((b) => b !== bar), bar]);
    return () => this.bars.update((list) => list.filter((b) => b !== bar));
  }

  /** Activate the newest bar. False when there is none (→ use the overlay). */
  activate(seed?: string): boolean {
    const list = this.bars();
    const bar = list[list.length - 1];
    if (!bar) return false;
    bar.activate(seed);
    return true;
  }
}

/** True for a key event aimed at something that takes text. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    !!target.closest('[contenteditable="true"], [contenteditable=""]')
  );
}

/**
 * A key that should start a Codex search when typed on the page itself: one
 * LETTER, no Ctrl/⌘/Alt chord, aimed at nothing editable, with no dialog open.
 * Letters only on purpose: digits are the pages' own hotkeys (the holodeck's
 * pin keys 1-9, variant choice), Space scrolls, punctuation is noise.
 */
export function isTypeToSearchKey(ev: KeyboardEvent): boolean {
  if (ev.defaultPrevented || ev.isComposing) return false;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
  if (ev.key.length !== 1 || !/^\p{L}$/u.test(ev.key)) return false;
  if (isEditableTarget(ev.target)) return false;
  const el = ev.target instanceof Element ? ev.target : null;
  if (el?.closest('[role="dialog"], [aria-modal="true"], .cdk-overlay-container')) return false;
  if (typeof document !== 'undefined' && document.querySelector('[role="dialog"], dialog[open], [aria-modal="true"]'))
    return false;
  return true;
}
