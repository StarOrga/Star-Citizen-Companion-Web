/**
 * How the main window comes up — kept pure so the idle-I/O guarantee is unit
 * testable without Electron.
 *
 * Why this exists: a BrowserWindow created with `show: false` and never shown
 * is NOT hidden as far as Chromium is concerned — the page reports
 * `document.visibilityState === 'visible'` and keeps producing frames. The
 * autostart launch (`--hidden`) never shows the window, so the infinite
 * `conn-pulse` animation on the connection dot repainted forever and the
 * renderer and GPU process exchanged frames over their IPC pipes. On Windows
 * those pipe transfers count toward `Win32_Process.WriteOperationCount` /
 * `WriteTransferCount` — the "~1,900 writes / 4 MB per 30 s while idle" of the
 * 0.35.1 field report. No file was written, but the wake-ups were real.
 *
 * An explicit `hide()` is what flips the page to `hidden` and stops the frames
 * (measured: ~120 → 0 writes per 30 s). `webPreferences.paintWhenInitiallyHidden:
 * false` was tried first and does NOT stop them on Electron 44. A window the
 * operator closed via X was never affected — that path already calls `hide()`.
 */

/** True for the unattended autostart launch that must stay in the tray. */
export function shouldStartHidden(argv: readonly string[], minimizeToTray: boolean): boolean {
  return argv.includes('--hidden') && minimizeToTray;
}

export interface InitialWindow {
  show(): void;
  hide(): void;
}

/**
 * `ready-to-show` handler: show the window, or — on the hidden start — hide it
 * for real so Chromium stops rendering a window nobody can see.
 */
export function settleInitialVisibility(win: InitialWindow, startHidden: boolean): void {
  if (startHidden) win.hide();
  else win.show();
}
