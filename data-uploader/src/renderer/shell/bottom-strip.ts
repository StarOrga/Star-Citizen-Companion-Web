/**
 * Bottom strip — status line + transient snackbars (throttle switch outcome,
 * autorun notices, …). Renders NOTHING (the strip collapses to zero height)
 * when it has no content, so it never competes with the stage above it.
 */

const AUTO_HIDE_MS = 4000;
let hideTimer: number | null = null;

function strip(): HTMLElement | null {
  return document.getElementById('bottom-strip');
}

function repaint(): void {
  const el = strip();
  if (!el) return;
  const hasContent = el.children.length > 0 && el.textContent?.trim() !== '';
  el.hidden = !hasContent;
}

/** Persistent status text (survives until replaced or cleared). */
export function setStatus(msg: string): void {
  const el = document.getElementById('status-line');
  if (el) el.textContent = msg;
  repaint();
}

/** One-off transient message; auto-clears after `AUTO_HIDE_MS`. */
export function showSnackbar(msg: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const el = strip();
  if (!el) return;
  let snack = document.getElementById('snackbar');
  if (!snack) {
    snack = document.createElement('span');
    snack.id = 'snackbar';
    el.insertBefore(snack, el.firstChild);
  }
  snack.className = `snackbar snackbar--${level}`;
  snack.textContent = msg;
  repaint();
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    snack?.remove();
    repaint();
  }, AUTO_HIDE_MS);
}
