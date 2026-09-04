// Which comm-link series may contribute artwork to the Starscape gallery.
//
// The wallpaper capture takes the hero image of every comm-link / patch-notes
// article, and for almost every series that is exactly right. "Roadmap
// Roundup" is the exception: it is a recurring column that reuses the SAME
// header art issue after issue, so the gallery collected one picture over and
// over and the source filter offered a segment that showed the visitor what
// they had just been shown. The maintainer's verdict on it was unambiguous —
// "Roadmap Roundup als Filter hilft gar nicht, das ist ja häufig das gleiche
// Bild. Der kann generell raus, auch aus der Starscape App" (admin feedback
// 1f78e57f).
//
// This module is the WRITE half of that exclusion: a candidate from an
// excluded series is dropped before any network work, so the table stops
// collecting new ones.
//
// The READ half is SQL — `public.verse_wallpaper_series_visible(text)`, used
// by the `verse_wallpapers_public_read` RLS policy and by
// `starscape_top_wallpapers()` (see
// `20260903201500_verse_wallpapers_hide_roadmap_roundup.sql`). It has to live
// there rather than in a client, because the Starscape desktop app queries
// `verse_wallpapers` directly with the publishable key: a policy reaches it
// with no Rust release, an app-side filter would not. Already-stored rows are
// hidden by that policy, never deleted — dropping the predicate brings them
// straight back.
//
// Keep the two lists in step. They are matched the same way on both sides:
// trimmed, case-insensitive, exact series name.

/** Series whose artwork never belongs in the gallery, lower-cased. */
const EXCLUDED_SERIES: readonly string[] = ['roadmap roundup'];

/**
 * Whether artwork from this comm-link series belongs in the gallery.
 *
 * A missing series is NOT a reason to reject: most captured rows carry no
 * series at all (patch notes, articles the wiki API files under "None"), and
 * they are the bulk of the gallery.
 */
export function isWallpaperSeries(series: string | null | undefined): boolean {
  if (!series) return true;
  return !EXCLUDED_SERIES.includes(series.trim().toLowerCase());
}
