// High-resolution YouTube thumbnails for Verse News.
//
// The channel's RSS feed only ever advertises `hqdefault.jpg`: 480×360, a 4:3
// frame with black bars baked in, so the actual 16:9 picture is 480×270. The
// stage paints that across a 21:9 hero, which upscales it 3–4× and reads as a
// blurry smear next to the comm-link artwork.
//
// `maxresdefault.jpg` (1280×720, full-bleed 16:9) exists for every HD upload —
// which is everything RSI publishes — but not for every video, and a missing one
// answers 404 *with a 120×90 grey placeholder body*, which an <img> happily
// renders. So the client cannot try-and-fall-back; the upgrade is verified here,
// once per crawl, with a HEAD request, and only a confirmed 200 replaces the
// feed's url. Anything else (404, timeout, network error) keeps hqdefault.

/** `https://i<n>.ytimg.com/vi/<id>/hqdefault.jpg` (the RSS form) → its maxres twin. */
export function maxresThumbnailUrl(url: string): string | null {
  const m = /^(https:\/\/i\d*\.ytimg\.com\/vi\/[\w-]+\/)(?:hq|mq|sd)?default\.jpg$/.exec(url);
  return m ? `${m[1]}maxresdefault.jpg` : null;
}

const PROBE_TIMEOUT_MS = 2500;

/**
 * The best thumbnail url that is known to exist: the maxres twin when a HEAD
 * request confirms it, the given url otherwise. Never throws.
 */
export async function upgradeYouTubeThumbnail(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const maxres = maxresThumbnailUrl(url);
  if (!maxres) return url;
  try {
    const res = await fetchFn(maxres, { method: 'HEAD', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.status === 200 ? maxres : url;
  } catch {
    return url;
  }
}
