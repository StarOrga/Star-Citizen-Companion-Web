// Per-isolate memo for the assembled news feed.
//
// Without it every request — every page load of every signed-in user, every
// return to a tab — crawled all five upstreams (Comm-Link API, YouTube, Spectrum,
// patch notes, status page), waited for the slowest of them, ran the image-cache
// DB lookup and then queued the deferred decode/DB work (wallpaper capture, image
// warm-up, video retention) on top. Concurrent and back-to-back requests now share
// one build while it is fresh, and the deferred work runs once per build instead
// of once per request.
//
// A build that came back unusable (every upstream failed) is not kept, so the next
// request tries again instead of serving an empty feed for the whole TTL.

export interface FeedMemo<T> {
  /** The memoised value, building it (once, shared by concurrent callers) when stale. */
  get(build: () => Promise<T>): Promise<{ value: T; fresh: boolean }>;
}

export function createFeedMemo<T>(
  ttlMs: number,
  isUsable: (value: T) => boolean,
  now: () => number = Date.now,
): FeedMemo<T> {
  let entry: { at: number; promise: Promise<T> } | null = null;

  return {
    async get(build) {
      const current = entry;
      if (current && now() - current.at < ttlMs) {
        return { value: await current.promise, fresh: false };
      }
      const promise = build();
      const mine = { at: now(), promise };
      entry = mine;
      try {
        const value = await promise;
        if (!isUsable(value) && entry === mine) entry = null;
        return { value, fresh: true };
      } catch (err) {
        if (entry === mine) entry = null;
        throw err;
      }
    },
  };
}
