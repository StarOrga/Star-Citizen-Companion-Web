/**
 * Give a dev run (`npm run dev`, unpackaged) its own userData directory.
 *
 * The installed app and a dev run share the same app name, so they shared
 * `%APPDATA%/<name>` — and `app.requestSingleInstanceLock()` is keyed on that
 * directory. With the installed uploader sitting in the tray, `npm run dev`
 * lost the lock and quit before showing a window (#632). A dev run now uses
 * `<userData>-dev`: its own lock, settings, session and job file, so it can
 * neither be blocked by nor scribble over the installed app.
 *
 * MUST be the first import of `main/index.ts`: bundled modules evaluate in
 * import order, and everything that reads `app.getPath('userData')` (settings,
 * session, upload job, electron-log's file path, the lock) has to see the
 * redirected path. Nothing here may import another app module.
 */
import { app } from 'electron';

export const DEV_USER_DATA_SUFFIX = '-dev';

/**
 * The userData path a run should switch to, or null to keep `current`.
 * Packaged builds keep theirs; an already-suffixed path is left alone so a
 * second evaluation cannot produce `…-dev-dev`.
 */
export function devUserDataPath(current: string, isPackaged: boolean): string | null {
  if (isPackaged || !current) return null;
  if (current.endsWith(DEV_USER_DATA_SUFFIX)) return null;
  return current + DEV_USER_DATA_SUFFIX;
}

const next = devUserDataPath(app.getPath('userData'), app.isPackaged);
if (next) app.setPath('userData', next);
