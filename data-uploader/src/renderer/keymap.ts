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
    if (e.key === 'Escape') {
      for (const handler of ctx.escHandlers) {
        if (handler()) {
          e.preventDefault();
          return;
        }
      }
      return;
    }
    if (ctx.isTextInputFocused()) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (handleChevronKey(e.key)) e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      ctx.onEnter();
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      ctx.onSpace();
    }
  });
}
