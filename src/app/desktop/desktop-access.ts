/**
 * Pure rules behind the desktop-app download menu (admin feedback 924bf1d8).
 *
 * Two questions live here, both unit-tested and free of Angular/Supabase:
 *   1. MAY a given role download a product at all (and which ring — stable)?
 *   2. IS this account's desktop app still "connected"?
 *
 * Both are UI-side answers. The authoritative gate is server-side:
 * `desktop_release_for_channel` / `starscape_release_for_channel` are SECURITY
 * DEFINER and clamp the requested ring down to the caller's tier, so asking for
 * `alpha` as a viewer answers with the stable row — never with alpha metadata.
 */

/** The two desktop products the website hands out. */
export type DesktopProduct = 'uploader' | 'starscape';

/** Release rings, mirrored 1:1 by `desktop_channels.channel`. */
export type ReleaseRing = 'alpha' | 'beta' | 'stable';

/**
 * The ONE ring the website hands out. Every download surface offers stable and
 * nothing else; beta and alpha are picked INSIDE each app (Starscape tray menu,
 * Data Uploader connection bar, SCC App settings) after the user signs in with
 * their Verse Companion account, because only the signed-in role says whether a
 * pre-release ring is reachable at all. Handing out a pre-release build here
 * would pin an install to a ring before anybody knows the account behind it.
 */
export const DOWNLOAD_RING: ReleaseRing = 'stable';

/**
 * Roles that may download each product at all.
 *
 * uploader — admin + collaborator. The Data Uploader writes the Codex; someone
 *   who may not upload has no business downloading it, so the whole control is
 *   not rendered for them.
 * starscape — everybody. The wallpaper app is a read-only consumer with public
 *   binaries.
 */
const MAY_DOWNLOAD: Record<DesktopProduct, readonly string[]> = {
  uploader: ['admin', 'collaborator'],
  starscape: ['admin', 'collaborator', 'viewer', 'anon'],
};

/** Rings this role may download for this product (empty = render nothing). */
export function ringsForRole(
  product: DesktopProduct,
  role: string | null | undefined,
): readonly ReleaseRing[] {
  return MAY_DOWNLOAD[product].includes(role ?? 'anon') ? [DOWNLOAD_RING] : [];
}

/**
 * Is the download control for this product a RESTRICTED surface — i.e. does a
 * plain, signed-in viewer get nothing at all from it?
 *
 * This is the app's "red box" test (admin feedback b8b31f24). The hot accent is
 * reserved for surfaces a normal user never reaches; painting a control red that
 * every visitor may use tells them "this is not for you" about something that
 * plainly is. The Data Uploader answers true, Starscape false.
 */
export function isRestrictedProduct(product: DesktopProduct): boolean {
  return ringsForRole(product, 'viewer').length === 0;
}

/** "Connected" means the desktop app checked in inside this window. */
export const DESKTOP_CONNECTION_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const DESKTOP_CONNECTION_WINDOW_MS = DESKTOP_CONNECTION_WINDOW_DAYS * DAY_MS;

/**
 * `connected` — checked in within the last 30 days (inclusive of the boundary).
 * `expired`   — it did check in once, but longer ago than that.
 * `never`     — no check-in on record (or an unparseable timestamp).
 */
export type ConnectionState = 'connected' | 'expired' | 'never';

/** Millisecond timestamp of a check-in, or null when there is none / it is junk. */
export function lastSeenMs(lastSeen: string | Date | null | undefined): number | null {
  if (lastSeen == null || lastSeen === '') return null;
  const ms = lastSeen instanceof Date ? lastSeen.getTime() : Date.parse(lastSeen);
  return Number.isNaN(ms) ? null : ms;
}

export function connectionState(
  lastSeen: string | Date | null | undefined,
  now: number = Date.now(),
): ConnectionState {
  const ms = lastSeenMs(lastSeen);
  if (ms == null) return 'never';
  // A future timestamp (client clock skew) counts as connected, never expired.
  return now - ms <= DESKTOP_CONNECTION_WINDOW_MS ? 'connected' : 'expired';
}

/** Whole days since the check-in (0 = today), or null when there is none. */
export function daysSinceSeen(
  lastSeen: string | Date | null | undefined,
  now: number = Date.now(),
): number | null {
  const ms = lastSeenMs(lastSeen);
  if (ms == null) return null;
  return Math.max(0, Math.floor((now - ms) / DAY_MS));
}
