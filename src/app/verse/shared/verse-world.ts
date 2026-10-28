/**
 * The Verse subpages and their planets (concept 2026-10-28 §3/§4): every
 * subpage has the planet the hub shows for it — Crusader = News, ArcCorp =
 * Patches, microTech = Galerie, the constellation globe = Sternkarte.
 * Shared by the page head (emblem), the hub (flight sources), the flight
 * (`verse-flight.ts`) and the background scene (deep space per world).
 */
export type VerseWorld = 'news' | 'patches' | 'gallery' | 'starmap';

/** Where a URL stands in the Verse frame: the hub, one of the four subpages, or outside (null). */
export type VerseFrame = 'hub' | VerseWorld;

/** The one shared name: the hub's planet while the old page is captured, the head's emblem in the new one. */
export const VERSE_EMBLEM_TRANSITION_NAME = 'verse-emblem';

/** Attribute that marks a hub element as a flight source: `data-verse-fly="news"`. */
export const VERSE_FLY_ATTR = 'data-verse-fly';

const WORLD_BY_SEGMENT: Readonly<Record<string, VerseWorld>> = {
  news: 'news',
  patches: 'patches',
  gallery: 'gallery',
  explorer: 'starmap',
};

function pathOf(url: string): string {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * The frame of a URL. Only the page itself counts: a routed overlay or
 * detail below it (`/verse/news/:id`, `/verse/patches/4.3`,
 * `/verse/gallery/constellations`) is not a frame hop.
 */
export function verseFrameOf(url: string): VerseFrame | null {
  const parts = pathOf(url).split('/').filter(Boolean);
  if (parts[0] !== 'verse') return null;
  if (parts.length === 1) return 'hub';
  if (parts.length === 2) return WORLD_BY_SEGMENT[parts[1]] ?? null;
  return null;
}

/** The planet a URL lives under (subpage and anything below it), for the scene backdrop. */
export function verseWorldOf(url: string): VerseWorld | null {
  const parts = pathOf(url).split('/').filter(Boolean);
  return parts[0] === 'verse' && parts.length >= 2 ? (WORLD_BY_SEGMENT[parts[1]] ?? null) : null;
}

export type VerseFlightDirection = 'down' | 'up' | 'side';

/**
 * Which flight a hop plays: hub → subpage = `down` (the hub rolls up and
 * away), subpage → hub = `up` (the reverse), subpage → subpage = `side`.
 * Null when the hop is no frame hop (outside, same page, overlays).
 */
export function verseFlightOf(fromUrl: string | null, toUrl: string): VerseFlightDirection | null {
  if (!fromUrl) return null;
  const from = verseFrameOf(fromUrl);
  const to = verseFrameOf(toUrl);
  if (!from || !to || from === to) return null;
  if (from === 'hub') return 'down';
  if (to === 'hub') return 'up';
  return 'side';
}
