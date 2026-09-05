/**
 * "Which part of the app is this feedback about?" — the area tag a sender puts
 * on a topic (admin feedback 835fec58).
 *
 * The ask was: *"Wenn ich das anklicke, dass du weißt, ich gebe das Feedback
 * für Codex ab! oder für Verse etc."* — so the reader of a topic no longer has
 * to infer the subject from the prose. The important half of that ask is the
 * word "weißt": the area is DERIVED from where the sender currently is
 * ({@link areaForUrl}) and only offered for correction, never demanded as an
 * extra form field before they may type.
 *
 * The vocabulary is deliberately short and mapped to the app's real top-level
 * sections rather than to features — a list that has to be re-cut on every
 * release is worse than no list. It is mirrored by the `admin_feedback.area`
 * CHECK constraint (migration 20260903120000); adding a value means touching
 * both, which is the point: the tag is a stable filter, not free text.
 */

/** Every area a topic can be tagged with, in the order the picker shows them. */
export const FEEDBACK_AREAS = [
  'news',
  'codex',
  'hangar',
  'starscape',
  'desktop',
  'settings',
  'admin',
  'other',
] as const;

export type FeedbackArea = (typeof FEEDBACK_AREAS)[number];

/** i18n key of an area's label — shared by the picker and every read surface. */
export function feedbackAreaLabelKey(area: FeedbackArea): string {
  return `feedbackArea.${area}`;
}

/**
 * Narrow an unknown value (a database column, a restored draft) to a known
 * area. Rows written before this feature carry `null`, and a value the client
 * does not know must render as nothing rather than as raw text — see
 * {@link asFeedbackArea}.
 */
export function isFeedbackArea(value: unknown): value is FeedbackArea {
  return typeof value === 'string' && (FEEDBACK_AREAS as readonly string[]).includes(value);
}

/** `null` for everything that is not a known area — the render-nothing case. */
export function asFeedbackArea(value: unknown): FeedbackArea | null {
  return isFeedbackArea(value) ? value : null;
}

/**
 * The area a URL belongs to — the auto-detection behind the pre-selection.
 *
 * Matches on the FIRST path segment only, so every sub-route travels with its
 * section (`/codex/blueprint/…` is Codex, `/admin/telemetry` is Admin) and a
 * new child route needs no change here. Anything unmapped (`/about`,
 * `/legal/…`, `/release-notes`, `/tools/…`) is honestly `other` rather than
 * being forced into the nearest section.
 *
 * Two groupings are not one-to-one with the router and are deliberate:
 * - `/hangar` is a subview of Codex in the navigation, but it is its own area
 *   to a sender ("my fleet" vs "the database").
 * - `/download`, `/uploader`, `/p4k` and `/desktop*` all land on `desktop`:
 *   from the sender's side these are one thing, the apps outside the website.
 */
export function areaForUrl(url: string): FeedbackArea {
  const path = (url ?? '').split(/[?#]/)[0].replace(/^\/+/, '').toLowerCase();
  const first = path.split('/')[0];
  switch (first) {
    case 'news':
      return 'news';
    case 'codex':
      return 'codex';
    case 'hangar':
      return 'hangar';
    case 'starscape':
      return 'starscape';
    case 'download':
    case 'uploader':
    case 'p4k':
    case 'desktop':
      return 'desktop';
    case 'settings':
      return 'settings';
    case 'admin':
      return 'admin';
    default:
      return 'other';
  }
}

/**
 * The inverse of {@link areaForUrl}: where "▸ Ansehen" on a delivered topic
 * takes the admin (concept 2026-09-04, Geliefert band). The section's root is
 * enough — the topic text says what to look at, the link only has to land in
 * the right part of the app. `other` has no home and yields `null`, so the
 * link is simply not drawn rather than sending anyone to the start page under
 * a false label.
 */
export function areaRoute(area: FeedbackArea | null | undefined): string | null {
  switch (area) {
    case 'news':
      return '/news';
    case 'codex':
      return '/codex';
    case 'hangar':
      return '/hangar';
    case 'starscape':
      return '/starscape';
    case 'desktop':
      return '/download';
    case 'settings':
      return '/settings';
    case 'admin':
      return '/admin';
    default:
      return null;
  }
}
