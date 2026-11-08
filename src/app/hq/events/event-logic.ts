import type { EventArea, EventSheet, EventReward, ProgressTrack } from './event-sheet';

/*
 * Pure event rules: end chain (C5), open events (C7/F2/F8), per-user state, area matching.
 * No I/O, no Angular. Contract: docs/contracts/event-sheet.md.
 */

export type UserEventStatus = 'open' | 'done' | 'dismissed' | 'aborted';
export const USER_EVENT_STATUSES: readonly UserEventStatus[] = ['open', 'done', 'dismissed', 'aborted'];

export type ProgressSource = 'manual' | 'live';
export interface TrackProgress {
  readonly value: number;
  readonly source: ProgressSource;
  readonly updatedAt: string;
}
export interface ClaimedReward {
  readonly channel: 'pledge' | 'ingame' | 'both';
  readonly at: string;
  /** Put into Bestand (Hangar / Inventar). */
  readonly stored: boolean;
  readonly by: 'user' | 'live';
}

/** `user_event_state` as the client holds it. */
export interface UserEventState {
  readonly eventId: string;
  readonly status: UserEventStatus;
  readonly progress: Readonly<Record<string, TrackProgress>>;
  readonly claimed: Readonly<Record<string, ClaimedReward>>;
  readonly updatedAt: string;
}

/** The `sc_events` columns the rules need, plus its public sheet. */
export interface EventRow {
  readonly id: string;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly dateStatus: 'confirmed' | 'estimated';
  readonly status: 'scheduled' | 'cancelled';
  readonly hidden: boolean;
  readonly freeFly: boolean;
  readonly sheet: EventSheet | null;
}

// ------------------------------------------------------------------------------------------------ end chain (C5)

export type EndBasis = 'official' | 'estimate' | 'unknown';
export interface ResolvedEnd {
  /** ISO date/instant; null = „Ende unbekannt“. */
  readonly at: string | null;
  /** estimate = labelled „spaetestens mit … (geschaetzt)“ in the UI. */
  readonly basis: EndBasis;
  /** The event row's own end date while it is only estimated; closes the event once it lies well in the past. */
  readonly estimatedRowEnd?: string;
}

/**
 * Days an estimated row end may lie in the past before the event counts as over. Events often run until the next
 * patch, so the patch estimate stays the deadline meanwhile; without this cap the moving patch estimate kept every
 * past estimated event (Pirate Week in September) open forever.
 */
export const ESTIMATED_END_GRACE_DAYS = 14;

/**
 * Official end (public sheet end, else the event row's end date when confirmed) > estimated next patch (from
 * `computeNextPatch`, passed as ISO) > unknown. An extension simply changes the official end, so the chain moves with it.
 */
export function resolveEventEnd(event: Pick<EventRow, 'endDate' | 'dateStatus' | 'sheet'>, nextPatchIso: string | null): ResolvedEnd {
  const sheetEnd = event.sheet?.fields.end.value ?? null;
  if (sheetEnd) return { at: sheetEnd, basis: 'official' };
  if (event.dateStatus === 'confirmed' && event.endDate) return { at: event.endDate, basis: 'official' };
  const rowEnd = event.dateStatus === 'estimated' && event.endDate ? { estimatedRowEnd: event.endDate } : {};
  if (nextPatchIso && Number.isFinite(Date.parse(nextPatchIso))) return { at: nextPatchIso, basis: 'estimate', ...rowEnd };
  return { at: null, basis: 'unknown', ...rowEnd };
}

/** End instant in ms; a bare date means the end of that day (UTC). */
export function endMs(end: ResolvedEnd): number | null {
  if (!end.at) return null;
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(end.at);
  const t = Date.parse(bare ? `${end.at}T23:59:59Z` : end.at);
  return Number.isFinite(t) ? t : null;
}

/**
 * Over on an OFFICIAL end in the past. An estimate never closes an event by itself, except when the event row's own
 * estimated end lies more than {@link ESTIMATED_END_GRACE_DAYS} days in the past.
 */
export function isEventOver(end: ResolvedEnd, nowMs: number): boolean {
  const t = endMs(end);
  if (end.basis === 'official') return t !== null && t < nowMs;
  const row = end.estimatedRowEnd ? endMs({ at: end.estimatedRowEnd, basis: 'estimate' }) : null;
  return row !== null && row + ESTIMATED_END_GRACE_DAYS * 86_400_000 < nowMs;
}

export function hasStarted(event: Pick<EventRow, 'startDate' | 'sheet'>, nowMs: number): boolean {
  const start = event.sheet?.fields.start.value ?? event.startDate;
  const t = Date.parse(start);
  return !Number.isFinite(t) || t <= nowMs;
}

// ------------------------------------------------------------------------------------------------ open events (C7)

export interface OpenEvent {
  readonly event: EventRow;
  readonly end: ResolvedEnd;
  readonly state: UserEventStatus;
}

/**
 * Events that are running and neither done nor dismissed (aborted stays: it can be resumed). Drives the Start marker,
 * the „+“ teaser and the events offered in „Neuer Nachschub“. Sorted by nearest end, unknown end last.
 */
export function openEvents(
  events: readonly EventRow[],
  states: ReadonlyMap<string, Pick<UserEventState, 'status'>> | Readonly<Record<string, Pick<UserEventState, 'status'>>>,
  nextPatchIso: string | null,
  nowMs: number,
): readonly OpenEvent[] {
  const get = (id: string) => (states instanceof Map ? states.get(id) : (states as Record<string, Pick<UserEventState, 'status'>>)[id]);
  const out: OpenEvent[] = [];
  for (const event of events) {
    if (event.hidden || event.status === 'cancelled' || !hasStarted(event, nowMs)) continue;
    const status = get(event.id)?.status ?? 'open';
    if (status === 'done' || status === 'dismissed') continue;
    const end = resolveEventEnd(event, nextPatchIso);
    if (isEventOver(end, nowMs)) continue;
    out.push({ event, end, state: status });
  }
  return out.sort((a, b) => (endMs(a.end) ?? Infinity) - (endMs(b.end) ?? Infinity) || a.event.id.localeCompare(b.event.id));
}

/** The open event that ends first (the Start marker names it); null when none. */
export function nearestEnd(open: readonly OpenEvent[]): OpenEvent | null {
  return open[0] ?? null;
}

// ------------------------------------------------------------------------------------------------ user state

export function emptyState(eventId: string, at: string): UserEventState {
  return { eventId, status: 'open', progress: {}, claimed: {}, updatedAt: at };
}

/** Newest write per track wins (mirrors user_event_state_report). */
export function setProgress(state: UserEventState, trackId: string, value: number, source: ProgressSource, at: string): UserEventState {
  const v = Number.isFinite(value) ? Math.max(0, value) : 0;
  const cur = state.progress[trackId];
  if (cur && Date.parse(cur.updatedAt) > Date.parse(at)) return state;
  return { ...state, progress: { ...state.progress, [trackId]: { value: v, source, updatedAt: at } }, updatedAt: at };
}

/** Index of the highest reached tier (-1 = none). */
export function reachedTier(track: Pick<ProgressTrack, 'tiers'>, value: number): number {
  let idx = -1;
  track.tiers.forEach((t, i) => {
    if (value >= t.at) idx = i;
  });
  return idx;
}

/** Rewards unlocked by the current progress: tied to a track tier that is reached, or to no track (always earned). */
export function earnedRewards(sheet: EventSheet, progress: Readonly<Record<string, TrackProgress>>): readonly EventReward[] {
  const rewards = sheet.fields.rewards.value ?? [];
  const tracks = sheet.fields.progress.value?.tracks ?? [];
  return rewards.filter((r) => {
    if (!r.trackId) return true;
    const track = tracks.find((t) => t.id === r.trackId);
    if (!track) return false;
    const reached = reachedTier(track, progress[r.trackId]?.value ?? 0);
    if (r.tier !== null) return reached >= r.tier;
    return track.tiers.some((t, i) => i <= reached && t.rewardIds.includes(r.id));
  });
}

// ------------------------------------------------------------------------------------------------ area (F6/F9 helper)

export interface PlaceReport {
  readonly system?: string | null;
  readonly place?: string | null;
  /** SCC-App reports the Arena Commander mode. */
  readonly arenaCommander?: boolean;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Is the reported position inside the event? Arena Commander is a venue next to the area: it matches when the event
 * lists the venue, independent of the area. `none`/`unknown` areas never match a place. Open area kinds the code does
 * not know do not match either (never guess).
 */
export function isInEventArea(venues: readonly string[] | null, area: EventArea | null, at: PlaceReport): boolean {
  if (at.arenaCommander && (venues ?? []).includes('arena-commander')) return true;
  if (!area) return false;
  const system = norm(at.system);
  const place = norm(at.place);
  switch (area.kind) {
    case 'any':
      return !!(system || place);
    case 'system':
      return !!system && area.systems.includes(system);
    case 'places':
      return (!!place && area.places.includes(place)) || (!place && !!system && area.systems.includes(system) && !area.places.length);
    default:
      return false;
  }
}
