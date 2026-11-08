import type { HqPageId } from '../hq-routes';

/**
 * The desktop app's four states on the HQ pages (concept 20261108-2135-hq-bestand, round 1, "Klare Reiter"):
 * - `missing`  — never reported anything for this account and this browser never saw it answer: download it.
 * - `off`      — it reported before (or answered a launch here), but no life sign for 3 min: start it.
 * - `ready`    — a fresh life sign, the game is not running: it waits for Star Citizen.
 * - `tracking` — a fresh life sign and the game runs: it reads along.
 * Each state has its own shape on screen (dashed ring, grey ring, green ring, filled glowing dot), not only a colour.
 */
export type HqAppStatus = 'missing' | 'off' | 'ready' | 'tracking';

export interface HqAppSignals {
  /** The app ever reported a live state or an event for this account. */
  readonly everConnected: boolean;
  /** This browser has seen the app answer a launch or report live (`SccAppLauncherService.remembered`). */
  readonly remembered: boolean;
  /** A fresh life sign (presence or newest event, at most 3 min old), or the game is live. */
  readonly connected: boolean;
  /** The game runs right now (`isGameLive`). */
  readonly gameLive: boolean;
}

/** Derives the one state every HQ surface shows (chip, Start tile, Jetzt connect block). */
export function hqAppStatus(s: HqAppSignals): HqAppStatus {
  if (s.gameLive) return 'tracking';
  if (s.connected) return 'ready';
  if (s.everConnected || s.remembered) return 'off';
  return 'missing';
}

/** The action a state offers: download the installer, start the app, or nothing (it already runs). */
export function hqAppAction(status: HqAppStatus): 'download' | 'launch' | null {
  if (status === 'missing') return 'download';
  if (status === 'off') return 'launch';
  return null;
}

/**
 * Show the status chip on every HQ page (Start included), also before the app was ever connected; only a device that
 * cannot install a desktop app at all (phone, tablet) never sees it, and nothing shows before the live data loaded
 * (a "missing" that turns into "tracking" a moment later would be a lie).
 */
export function appStatusVisible(page: HqPageId | null, canInstall: boolean, liveSettled: boolean): boolean {
  return page !== null && canInstall && liveSettled;
}

/** localStorage key: the pages on which the reader closed the expanded "Aussicht" while the app was missing. */
export const AUSSICHT_SEEN_KEY = 'sc.hq.appAussicht.seen';

/** Pages whose Aussicht was dismissed, read leniently (junk or blocked storage = none). */
export function readAussichtSeen(raw: string | null): ReadonlySet<HqPageId> {
  if (!raw) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? (v.filter((p) => typeof p === 'string') as HqPageId[]) : []);
  } catch {
    return new Set();
  }
}

/** The Aussicht opens by itself only while the app is missing, and only on a page where it was not dismissed yet. */
export function aussichtAutoOpen(status: HqAppStatus, page: HqPageId | null, seen: ReadonlySet<HqPageId>): boolean {
  return status === 'missing' && page !== null && !seen.has(page);
}
