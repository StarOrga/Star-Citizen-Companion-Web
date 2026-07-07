/**
 * Pure helpers for turning a failed Python-sidecar launch into an actionable
 * message. Kept free of electron imports so they can be unit-tested — the
 * electron-dependent path resolution lives in main/python-bridge.ts.
 */

export type PythonSource = 'env' | 'packaged' | 'dev-path';

export const PACKAGED_PYTHON_MISSING =
  'Bundled Python not found (expected at resources/python/python.exe next to the app). ' +
  'The installation looks incomplete — usually an interrupted or partial auto-update. ' +
  'Please reinstall the Data Uploader from the download page and try again.';

/**
 * Proactive check: in a PACKAGED build, interpreter resolution falling through
 * to the dev-path (a bare `python` PATH lookup) can only mean the embedded
 * interpreter that ships in resources/python is missing. Returns a user-facing
 * message in that case, else null.
 *
 * (In a DEV build the dev-path fallback is expected — `python` may well be on
 * PATH — so we do NOT pre-empt it here; a genuine miss surfaces via the spawn
 * ENOENT handler instead.)
 */
export function packagedPythonMissing(source: PythonSource, isPackaged: boolean): string | null {
  return isPackaged && source === 'dev-path' ? PACKAGED_PYTHON_MISSING : null;
}

/**
 * Translate a spawn ENOENT into an actionable message. A packaged build that
 * ENOENTs has a corrupt/incomplete install; a dev build simply has no Python on
 * PATH.
 */
export function pythonSpawnEnoentMessage(interpreter: string, isPackaged: boolean): string {
  return isPackaged
    ? PACKAGED_PYTHON_MISSING
    : `No Python interpreter found — spawn '${interpreter}' failed (ENOENT). This is a ` +
        'development build without Python on PATH; run the packaged app, or install ' +
        'Python 3.10 and set SC_EXTRACT_PYTHON to its executable.';
}
