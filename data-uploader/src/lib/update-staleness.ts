/**
 * Is an already-staged update still the newest one? Pure, so the updater's
 * "always offer the latest" rule is unit-testable without electron-updater.
 *
 * Once a download is staged the updater used to stop checking, so a session
 * left open across two releases kept offering — and installing — the older
 * one. These helpers decide when a staged version has been overtaken.
 */
import { isNewerVersion } from './semver.js';

/** True when the feed's latest version is newer than the staged one. */
export function isStagedSuperseded(staged: string | null, latest: string | null): boolean {
  if (!staged || !latest) return false;
  return isNewerVersion(latest, staged);
}

/**
 * A feed offer while something is already staged: only a version newer than
 * the staged one is worth a new download — anything else keeps the staged one.
 */
export function shouldReplaceStaged(staged: string | null, offered: string): boolean {
  return !staged || isNewerVersion(offered, staged);
}
