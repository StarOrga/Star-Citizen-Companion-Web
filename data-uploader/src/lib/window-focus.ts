/**
 * Reliable window foregrounding — the post-OAuth "pull me back to front" move.
 *
 * After the loopback OAuth handoff, the user's default browser holds the OS
 * foreground. On Windows a background process is denied focus-stealing
 * (SPI_GETFOREGROUNDLOCKTIMEOUT), so a bare `BrowserWindow.focus()` only flashes
 * the taskbar button instead of raising the window — the operator is left in the
 * browser and has to alt-tab back manually. Momentarily pinning the window
 * topmost forces it to the front of the z-order (a window-style change the OS
 * honors WITHOUT foreground rights), then we drop the pin so it doesn't stay
 * stuck above every other window.
 *
 * Kept electron-free and injectable so the call sequence is unit-testable — the
 * real `BrowserWindow` is structurally a `RaisableWindow`.
 */

/** The slice of `Electron.BrowserWindow` this routine drives. */
export interface RaisableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  setAlwaysOnTop(flag: boolean): void;
}

/**
 * Bring `win` to the foreground, reliably, even from a background process.
 * No-ops on a missing or destroyed window. `show()` also un-hides a window that
 * was minimized to the tray, so a successful sign-in always lands the operator
 * back in the uploader.
 */
export function raiseWindow(win: RaisableWindow | null | undefined): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.setAlwaysOnTop(true);
  try {
    // show() raises + un-hides more reliably than focus() alone; focus() then
    // asks for keyboard focus on top of that.
    win.show();
    win.focus();
  } finally {
    // Always release the pin — never leave the window stuck topmost, even if
    // show()/focus() threw.
    win.setAlwaysOnTop(false);
  }
}
