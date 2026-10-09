/**
 * Central keymap for the run-scoped shortcuts: Enter (primary action of the
 * active step), Space (pause/resume while uploading), Esc (close
 * sheet/popover/log-drawer, cancel a countdown — first handler that reports
 * "handled" wins) and ←/→ (chevrons, before a run starts). Ctrl+, (Settings)
 * and its own Esc-to-close are wired in `main.ts` directly (shipped in the
 * settings-taxonomy commit) — this module only owns what's new here.
 *
 * Every shortcut is also shown as a `<kbd>` badge on its own control (see
 * `dom.ts` callers) rather than through a separate help overlay.
 */

import { handleChevronKey } from './shell/chevrons.js';

export interface KeymapCtx {
  /** Primary action for the currently active step (Continue / Start / Open web app / …). Null when none applies. */
  onEnter: () => void;
  /** Pause/resume the active upload. No-op when nothing is uploading. */
  onSpace: () => void;
  /** Ctrl+L — toggle the log drawer. No-op when the Extract step isn't mounted. */
  onToggleLog: () => void;
  /** T — fold the resource dock (CPU / RAM / disk limits) open or closed. */
  onTempo: () => void;
  /** Ordered Esc handlers — first one that returns true "wins" and stops there. */
  escHandlers: Array<() => boolean>;
  /** True while focus is inside a text-like input, so Enter/Space don't hijack typing. */
  isTextInputFocused: () => boolean;
}

let installed = false;

export function installKeymap(ctx: KeymapCtx): void {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', (e) => {
    // Overlays (confirm, settings, options sheet) handle their own keys in the
    // capture phase and mark them handled. Without this check an Esc that just
    // closed "Lauf abbrechen?" fired the step's Esc again and reopened it, and
    // an Esc on the discard confirm navigated away behind it.
    if (e.defaultPrevented || overlayOpen()) return;
    if (e.key === 'Escape') {
      for (const handler of ctx.escHandlers) {
        if (handler()) {
          e.preventDefault();
          return;
        }
      }
      return;
    }
    if ((e.key === 'l' || e.key === 'L') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ctx.onToggleLog();
      return;
    }
    if (ctx.isTextInputFocused()) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (handleChevronKey(e.key)) e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      // Enter on a focused control activates THAT control (a scope pill, a
      // segment button) — it must not also fire the step's primary action,
      // which on Setup starts an hours-long run with the old choice.
      if (isActivatable(e.target)) return;
      ctx.onEnter();
      return;
    }
    if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      ctx.onTempo();
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      ctx.onSpace();
    }
  });
}

/** A modal surface is up — the step shortcuts underneath must stay quiet. */
function overlayOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/** Focus sits on something Enter already activates by itself. */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('button, a[href], [role="button"], [role="radio"], [role="option"], [role="switch"], [role="tab"]') !== null;
}
