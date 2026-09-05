/**
 * The RSI roadmap, as the patch board sees it (feedback 961ab0a5: "in der
 * patch historie auch informationen über diesen und nächsten patch … aus der
 * roadmap seite von star citizen").
 *
 * Types mirror what `supabase/functions/rsi-roadmap/roadmap.ts` emits — keep
 * the two in step. The client NEVER talks to RSI: everything here arrived
 * through the edge function, which is also where the trimming and the
 * host-allowlisting of image urls happened.
 */

export type RoadmapStatus = 'released' | 'committed' | 'tentative' | 'unknown';

export interface RoadmapCard {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Longer explanation; '' when RSI wrote none or only repeated the teaser. */
  body: string;
  status: RoadmapStatus;
  /** Discipline: "Gameplay", "Ships and Vehicles", … '' when uncategorized. */
  category: string;
  thumbnail: string | null;
}

export interface RoadmapRelease {
  id: string;
  /** As RSI publishes it: `4.9`, `4.10`, `Star Citizen 1.0`. */
  name: string;
  /** RSI's scheduling note, usually a quarter (`Q3 2026`). */
  quarter: string;
  status: RoadmapStatus;
  /** Patch line (`4.10`) — the join key back to the patch-note history. */
  patchLine: string;
  cards: RoadmapCard[];
}

export interface RoadmapLater {
  name: string;
  quarter: string;
  status: RoadmapStatus;
}

export interface RoadmapPayload {
  current: RoadmapRelease | null;
  next: RoadmapRelease | null;
  later: RoadmapLater[];
  liveVersion: string;
  ptuVersion: string;
  boardUrl: string;
  updatedAt: string;
}

/** One discipline's worth of a release, in the order the panel renders them. */
export interface RoadmapCategoryGroup {
  category: string;
  cards: RoadmapCard[];
}

/**
 * Group a release's cards by discipline.
 *
 * A release holds a dozen or so unrelated things — a rifle, a mission, an
 * engine change — and reading them as one list tells you nothing about the
 * shape of the patch. Grouped, "this is a Ships & Vehicles patch with two
 * gameplay features" is visible at a glance.
 *
 * Alphabetical by discipline, with the uncategorized bucket last. RSI's own
 * category order is not carried on the card, and which order we pick matters
 * far less than that it is stable — the panel must not reshuffle itself
 * between two visits.
 */
export function groupCardsByCategory(cards: readonly RoadmapCard[]): RoadmapCategoryGroup[] {
  const byCategory = new Map<string, RoadmapCard[]>();
  for (const card of cards) {
    const bucket = byCategory.get(card.category);
    if (bucket) bucket.push(card);
    else byCategory.set(card.category, [card]);
  }
  return [...byCategory.entries()]
    .map(([category, list]) => ({ category, cards: list }))
    .sort((a, b) => {
      if (!a.category !== !b.category) return a.category ? -1 : 1;
      return a.category.localeCompare(b.category);
    });
}

/** How many cards of a release sit in each status — the panel's summary line. */
export function statusCounts(cards: readonly RoadmapCard[]): Map<RoadmapStatus, number> {
  const counts = new Map<RoadmapStatus, number>();
  for (const card of cards) counts.set(card.status, (counts.get(card.status) ?? 0) + 1);
  return counts;
}

/** Display order for status chips: what is done, then promised, then maybe. */
export const ROADMAP_STATUSES: readonly RoadmapStatus[] = ['released', 'committed', 'tentative', 'unknown'];

/**
 * Is there anything worth rendering?
 *
 * The band hides itself entirely when the answer is no — an outage at RSI, a
 * changed board shape or a cold cache must cost the reader a section, never an
 * error message they cannot act on.
 */
export function hasRoadmapContent(payload: RoadmapPayload | null): boolean {
  if (!payload) return false;
  return (payload.current?.cards.length ?? 0) > 0 || (payload.next?.cards.length ?? 0) > 0;
}

/**
 * Deep link to ONE roadmap card on RSI's Release View, which opens with the
 * card's own panel already expanded — e.g.
 * `…/roadmap/release-view/1544-Instancing`.
 *
 * The shape is `<card id>-<url slug>`, both of which the edge function already
 * carries verbatim from RSI (`id`, `url_slug`). Returns '' when either half is
 * missing, so a caller can fall back to the board link instead of building a
 * URL that 404s.
 */
export function roadmapCardUrl(card: Pick<RoadmapCard, 'id' | 'slug'>): string {
  if (!card.id || !card.slug || card.id === card.slug) return '';
  return `https://robertsspaceindustries.com/roadmap/release-view/${card.id}-${card.slug}`;
}
