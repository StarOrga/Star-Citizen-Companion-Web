// Video retention window for Verse News (feedback e7082310).
//
// Videos are only worth keeping while they are current: "today, this week and
// this month" — everything older is dropped, because every video we keep also
// keeps a cached thumbnail in the `news-images` bucket, and that bucket is the
// project's scarcest online resource. Articles/comm-links are NOT covered here;
// their artwork is a separate concern.
//
// A ROLLING 31-day window, not the calendar month: on the 1st of a month a
// calendar cut would throw away everything published "this week", which is
// exactly what the request asks to keep. 31 days is the smallest window that
// always contains today + this week + the current calendar month.
//
// Mirrored client-side by VIDEO_RETENTION_DAYS / pruneExpiredVideos in
// src/app/news/news.service.ts (Deno code cannot be imported by the Angular
// build) — keep the two in sync.

export const VIDEO_RETENTION_DAYS = 31;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Epoch ms before which a video is considered expired. */
export function videoRetentionCutoff(now: number = Date.now()): number {
  return now - VIDEO_RETENTION_DAYS * DAY_MS;
}

/**
 * Whether a video published at `publishedAt` still belongs in the feed.
 *
 * A missing or unparseable date counts as EXPIRED: an undatable item can never
 * be proven to be inside the window, and — since the prune below selects by
 * date — keeping it would create a row nothing can ever clean up.
 */
export function isWithinVideoRetention(
  publishedAt: string | undefined,
  now: number = Date.now(),
): boolean {
  const t = Date.parse(publishedAt ?? '');
  return Number.isFinite(t) && t >= videoRetentionCutoff(now);
}
