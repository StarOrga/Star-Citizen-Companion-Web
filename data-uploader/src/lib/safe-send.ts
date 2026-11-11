/**
 * The one place the main process pushes events to a renderer.
 *
 * `webContents.send` on a renderer whose frame is gone (the render process
 * exited, the window is being torn down, a reload is mid-flight) does not
 * throw — Electron prints "Error sending from webContents: Render frame was
 * disposed before WebFrameMain could be accessed" as a process warning, once
 * per call. A running job pushes progress several times a second, so one dead
 * renderer flooded main.log with >1000 error lines in 25 minutes. Checking the
 * frame first keeps the log clean and lets the job carry on headless.
 */
export interface SendableContents {
  isDestroyed(): boolean;
  isCrashed?(): boolean;
  mainFrame?: { isDestroyed?(): boolean } | null;
  send(channel: string, ...args: unknown[]): void;
}

/** True when `wc` still has a live main frame to deliver to. */
export function canSend(wc: SendableContents | null | undefined): wc is SendableContents {
  if (!wc) return false;
  try {
    if (wc.isDestroyed()) return false;
    if (wc.isCrashed?.()) return false;
    const frame = wc.mainFrame;
    if (!frame) return false;
    if (frame.isDestroyed?.()) return false;
    return true;
  } catch {
    // Reading `mainFrame` itself throws once the frame is disposed.
    return false;
  }
}

/** Deliver `payload` on `channel` if the renderer can receive it; never throws. Returns whether it was sent. */
export function safeSend(
  wc: SendableContents | null | undefined,
  channel: string,
  ...args: unknown[]
): boolean {
  if (!canSend(wc)) return false;
  try {
    wc.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
}
