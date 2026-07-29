// Telling artwork apart from the other media a comm-link carries.
//
// The Comm-Link Wiki API's `images` include is really a MEDIA include: a post
// that embeds a clip lists `source.mp4` / `source.webm` next to `source.jpg`.
// Letting a clip through the image path hurt three ways:
//
//   1. the news card rendered it into an `<img src>` — a permanently broken
//      thumbnail whenever the clip happened to sort first;
//   2. it displaced real artwork from the per-item url cap;
//   3. worst — `imageIdentity()` collapses every asset of one media id onto a
//      single cache key, so the image cache picked the .mp4 as the download
//      sample for the whole group. Each `fetch-verse-news` request then
//      re-fetched hundreds of MB of video it could never decode, stored
//      nothing, recorded no failure, and did it all again next request. That
//      pushed the endpoint from ~2s to 15-20s, past the budget
//      `starscape-summary` allows it, which is why the Starscape wallpaper
//      rendered "No Verse News this week" with a perfectly healthy feed.
//
// Deny-list on purpose. RSI's signed `/i/<sha1>/…` proxy urls carry no file
// extension at all and are perfectly good images, so anything unrecognised has
// to stay in — the decoder downstream keys on magic bytes and rejects what it
// cannot read.

/** Extensions we know are never a still image, matched before any `?`/`#`. */
const NON_IMAGE_URL = /\.(mp4|webm|mov|m4v|avi|mkv|ogv|ogg|mp3|wav|pdf|zip)(?:[?#]|$)/i;

/** False only for urls whose extension proves they are not a still image. */
export function isImageUrl(url: string): boolean {
  return !NON_IMAGE_URL.test(url);
}
