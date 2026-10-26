import type { VerseDigestItem } from '../../data/verse.models';

/**
 * "Für dich" — the one personal line in the hub's planet zone. It shows one
 * unread item and moves on only after the reader was away (tab hidden, window
 * unfocused, hub left or closed) for at least {@link FOR_YOU_AWAY_MS}; the
 * queue runs oldest first and wraps, so every unread item gets its turn —
 * none is ever skipped. Read state is the server's seen set; only the
 * position (which item, since when away) is per-viewer convenience in
 * localStorage.
 */
export const FOR_YOU_AWAY_MS = 30 * 60_000;

export interface ForYouState {
  /** Item on the line, null before the first pick. */
  readonly key: string | null;
  /** Its timestamp: where to continue once it has been read. */
  readonly at: string | null;
  /** When the reader left; null while they are here. */
  readonly awayAt: number | null;
}

export const EMPTY_FOR_YOU: ForYouState = { key: null, at: null, awayAt: null };

const time = (i: { at: string | null }): number => (i.at ? Date.parse(i.at) || 0 : 0);

/** Unread items, oldest first (stable for equal times), so newcomers queue at the end. */
export function forYouQueue(items: readonly VerseDigestItem[], seen: ReadonlySet<string>, exclude: ReadonlySet<string> = new Set()): VerseDigestItem[] {
  const unique = new Map<string, VerseDigestItem>();
  for (const it of items) if (!seen.has(it.key) && !unique.has(it.key)) unique.set(it.key, it);
  const all = [...unique.values()];
  const rest = all.filter((i) => !exclude.has(i.key));
  return (rest.length ? rest : all)
    .map((item, i) => ({ item, i }))
    .sort((a, b) => time(a.item) - time(b.item) || a.i - b.i)
    .map((x) => x.item);
}

/**
 * Which queue entry the line shows. Still unread and not away long enough:
 * the same one. Away ≥ 30 min: the next one (wrapping). Read or gone: the
 * first one after its place in the queue, else the start.
 */
export function pickForYou(queue: readonly VerseDigestItem[], state: ForYouState, now: number): number | null {
  if (!queue.length) return null;
  const idx = state.key ? queue.findIndex((i) => i.key === state.key) : -1;
  const away = state.awayAt !== null && now - state.awayAt >= FOR_YOU_AWAY_MS;
  if (idx >= 0) return away ? (idx + 1) % queue.length : idx;
  if (!state.key) return 0;
  const after = state.at ? Date.parse(state.at) || 0 : 0;
  const next = queue.findIndex((i) => time(i) > after);
  return next >= 0 ? next : 0;
}

export function forYouStorageKey(userId: string | null | undefined): string {
  return `sc.verse.forYou:${userId || 'anon'}`;
}

export function readForYou(key: string): ForYouState {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    if (!raw) return EMPTY_FOR_YOU;
    const v = JSON.parse(raw) as Partial<ForYouState>;
    return {
      key: typeof v.key === 'string' ? v.key : null,
      at: typeof v.at === 'string' ? v.at : null,
      awayAt: typeof v.awayAt === 'number' && Number.isFinite(v.awayAt) ? v.awayAt : null,
    };
  } catch {
    return EMPTY_FOR_YOU;
  }
}

export function writeForYou(key: string, state: ForYouState): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Private mode / quota: the line simply starts over next time.
  }
}
