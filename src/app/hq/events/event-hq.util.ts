import { formatLocationName } from '../now/hq-live.util';
import type { Nachschub } from '../nachschub/nachschub.model';
import { isEventNachschub } from './event-nachschub';
import { endMs, isInEventArea, type OpenEvent, type PlaceReport, type ResolvedEnd } from './event-logic';
import type { EventReward, PrereqNode } from './event-sheet';

/*
 * Pure helpers of the HQ event surfaces (slot row, teaser, offer bar, prerequisites, drafts). No Angular, no I/O.
 */

// ------------------------------------------------------------------------------------------------ slot row (F1)

/**
 * The Planen row: the oldest planned Nachschub starts on the left, a finished one is gone (archived) and the others
 * move up, and exactly ONE free slot ("+") follows - none while all slots are taken.
 */
export function boardTiles<T extends Pick<Nachschub, 'id' | 'createdAt'>>(active: readonly T[], max: number): (T | null)[] {
  const ordered = [...active].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(0, max);
  return ordered.length < max ? [...ordered, null] : ordered;
}

// ------------------------------------------------------------------------------------------------ end (F8)

export interface EndView {
  readonly basis: ResolvedEnd['basis'];
  /** ISO date/instant, null = unknown. */
  readonly at: string | null;
  /** i18n key of the sentence; params carry `date`. */
  readonly key: string;
}

/** official -> "bis ...", estimate -> "spaetestens mit ... (geschaetzt)", unknown -> "Ende unbekannt". */
export function endView(end: ResolvedEnd): EndView {
  if (!end.at || end.basis === 'unknown') return { basis: 'unknown', at: null, key: 'hq.events.end.unknown' };
  return { basis: end.basis, at: end.at, key: end.basis === 'official' ? 'hq.events.end.official' : 'hq.events.end.estimate' };
}

export function formatEndDate(at: string, lang: string): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return at;
  return new Intl.DateTimeFormat(lang || 'de', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(t));
}

/** The open event that ends first and has a date at all (the Start marker names this one). */
export function nearestEndOf(open: readonly OpenEvent[]): OpenEvent | null {
  return open.find((o) => endMs(o.end) !== null) ?? open[0] ?? null;
}

// ------------------------------------------------------------------------------------------------ rewards of running events (F5)

/** Open events whose reward IS this wish (exact class name, never the base item - ev-a4). */
export function eventsRewarding(open: readonly OpenEvent[], className: string): readonly OpenEvent[] {
  const c = className.trim().toLowerCase();
  if (!c) return [];
  return open.filter((o) => (o.event.sheet?.fields.rewards.value ?? []).some((r) => (r.className ?? '').trim().toLowerCase() === c));
}

export const rewardsOf = (o: OpenEvent): readonly EventReward[] => o.event.sheet?.fields.rewards.value ?? [];

// ------------------------------------------------------------------------------------------------ ships vs items (F10)

const SHIP_PREFIXES = ['aegs', 'anvl', 'aopoa', 'argo', 'banu', 'cnou', 'crus', 'drak', 'espr', 'gama', 'grin', 'krig', 'kruger', 'misc', 'mirai', 'orig', 'rsi', 'tmbl', 'vncl', 'xian', 'xnaa'];

/** A class name that reads like a ship (manufacturer prefix); the claim dialog lets the reader flip it. */
export function looksLikeShip(className: string | null): boolean {
  const p = (className ?? '').trim().toLowerCase().split('_')[0];
  return SHIP_PREFIXES.includes(p);
}

// ------------------------------------------------------------------------------------------------ prerequisites (F13)

export type PrereqView =
  | { readonly kind: 'gear'; readonly gear: string; readonly label: string | null }
  | { readonly kind: 'group'; readonly op: 'and' | 'or'; readonly items: readonly PrereqView[] };

/** The AND / OR tree as the view renders it; a lone gear is a one-item `and` group so the row always reads the same. */
export function prereqView(node: PrereqNode | null): PrereqView | null {
  if (!node) return null;
  if ('gear' in node) return { kind: 'group', op: 'and', items: [{ kind: 'gear', gear: node.gear, label: node.label }] };
  const items = node.items.map((n): PrereqView => ('gear' in n ? { kind: 'gear', gear: n.gear, label: n.label } : prereqView(n)!));
  return { kind: 'group', op: node.op, items };
}

// ------------------------------------------------------------------------------------------------ event drafts (F5/F6)

export interface EventDraft {
  readonly role: 'event';
  readonly eventId: string;
  readonly label: string;
  /** {kind, systems, places, venues} stored on the step instead of a fixed place. */
  readonly area: Record<string, unknown> | null;
  readonly goods: readonly { name: string; qty: number }[];
}

/** One Einsatz per chosen event: a single event step (its area instead of a place) and the rewards it brings. */
export function eventDrafts(chosen: readonly { event: OpenEvent; rewards: readonly { name: string; qty: number }[] }[]): EventDraft[] {
  return chosen.map(({ event, rewards }) => {
    const f = event.event.sheet?.fields;
    const area = f?.area.value ?? null;
    const venues = f?.venues.value ?? [];
    return {
      role: 'event' as const,
      eventId: event.event.id,
      label: event.event.name,
      area: area || venues.length ? { kind: area?.kind ?? 'none', systems: area?.systems ?? [], places: area?.places ?? [], venues } : null,
      goods: rewards,
    };
  });
}

// ------------------------------------------------------------------------------------------------ Jetzt offer (F9)

export type PlaceReportKeyed = PlaceReport & { readonly key: string };

/** Reads the SCC-App place report from the live state (contract: location {system, place}, event {arenaCommander}). */
export function readPlaceReport(state: Record<string, unknown> | null): PlaceReportKeyed {
  const loc = state?.['location'];
  let system: string | null = null;
  let place: string | null = null;
  if (typeof loc === 'string') place = formatLocationName(loc);
  else if (loc && typeof loc === 'object') {
    const o = loc as Record<string, unknown>;
    system = typeof o['system'] === 'string' ? o['system'] : null;
    const p = typeof o['place'] === 'string' ? o['place'] : typeof o['name'] === 'string' ? o['name'] : null;
    place = p ? formatLocationName(p) : null;
  }
  const ev = state?.['event'];
  const arenaCommander = !!ev && typeof ev === 'object' && (ev as Record<string, unknown>)['arenaCommander'] === true;
  return { system, place, arenaCommander, key: `${system ?? ''}|${place ?? ''}|${arenaCommander ? 'ac' : ''}` };
}

export interface EventOffer {
  readonly nachschubId: string;
  readonly eventId: string;
  readonly arenaCommander: boolean;
}

/**
 * The offer for the reader's current place: the first active event Nachschub (not the one already in focus) whose
 * event area - or Arena Commander mode - contains the reported position. No live signal = no offer; "Nicht jetzt"
 * hides it while the position key stays the same (until the next place change).
 */
export function eventOffer(
  active: readonly Nachschub[],
  open: readonly OpenEvent[],
  report: PlaceReportKeyed | null,
  live: boolean,
  dismissedKey: string | null,
  focusedId: string | null,
): EventOffer | null {
  if (!live || !report || (!report.system && !report.place && !report.arenaCommander)) return null;
  if (dismissedKey !== null && dismissedKey === report.key) return null;
  for (const n of active) {
    if (!isEventNachschub(n) || !n.eventId || n.id === focusedId) continue;
    const o = open.find((x) => x.event.id === n.eventId);
    if (!o) continue;
    const f = o.event.sheet?.fields;
    if (isInEventArea(f?.venues.value ?? null, f?.area.value ?? null, report)) {
      return { nachschubId: n.id, eventId: n.eventId, arenaCommander: !!report.arenaCommander };
    }
  }
  return null;
}
