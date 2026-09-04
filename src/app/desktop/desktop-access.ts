/**
 * Pure rules behind the desktop-app download menu (admin feedback 924bf1d8).
 *
 * Two questions live here, both unit-tested and free of Angular/Supabase:
 *   1. WHICH release rings may a given role even see per product?
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
 * Rings per product and role, SAFEST FIRST (stable is always the recommended
 * download and therefore the first button).
 *
 * uploader — admin: everything, collaborator: beta + stable, viewer/anon:
 *   NOTHING. The Data Uploader writes the Codex; someone who may not upload has
 *   no business downloading it, so the whole control is not rendered for them.
 * starscape — the wallpaper app is a read-only consumer with public binaries,
 *   so every visitor may take stable; the ring set widens with the role.
 */
const RINGS: Record<DesktopProduct, Record<string, readonly ReleaseRing[]>> = {
  uploader: {
    admin: ['stable', 'beta', 'alpha'],
    collaborator: ['stable', 'beta'],
    viewer: [],
    anon: [],
  },
  starscape: {
    admin: ['stable', 'beta', 'alpha'],
    collaborator: ['stable', 'beta'],
    viewer: ['stable'],
    anon: ['stable'],
  },
};

/** Rings this role may download for this product (empty = render nothing). */
export function ringsForRole(
  product: DesktopProduct,
  role: string | null | undefined,
): readonly ReleaseRing[] {
  const table = RINGS[product];
  return table[role ?? 'anon'] ?? table['anon'];
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

/**
 * Is this ring of this product offered to ADMINS ONLY?
 *
 * Derived from the same table rather than hard-coded, so widening a ring to
 * collaborators automatically stops marking it as admin-only. Today: `alpha`
 * for both products; `beta` is a collaborator ring and therefore not admin-only.
 */
export function isAdminOnlyRing(product: DesktopProduct, ring: ReleaseRing): boolean {
  const table = RINGS[product];
  return Object.entries(table).every(
    ([role, rings]) => role === 'admin' || !rings.includes(ring),
  );
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
