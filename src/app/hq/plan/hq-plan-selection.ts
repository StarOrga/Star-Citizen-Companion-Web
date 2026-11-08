import type { StepKind } from '../../shared/step/sc-step.component';
import { STEP_KINDS } from '../../shared/step/sc-step.component';
import type { HqActivity, HqSetKind } from '../data/hq-db.types';
import type { MapNeed, MapPlace } from './map/hq-map.types';
import {
  MOODS_OFF,
  MoodPair,
  MoodSide,
  MoodState,
  estimateMinutes,
  MOODS_AVAILABLE,
  matchesMoods,
  moodsActive,
  parseMoods,
  toggleMood,
} from './hq-moods';

/**
 * The selection model of Planen (plan §4.5, D23/D24/D27/D28) - pure and unit-tested.
 *
 * There is NO mode toggle: "Top 3" is the default, a mood click is "Nach Lust", any manual change
 * is "Gezielt" (`origin`). `visibleNeeds` drives the list AND the map: what is not selected is gone
 * from both. Filters (step kinds, places, moods) exist for the "Was" view only.
 */

export const PLAN_SELECTION_KEY = 'sc.hq.plan.selection';
export const TOP_SETS = 3;
/** An Einsatz this close counts as "soon" for the Top 3 ranking. */
export const SOON_MS = 48 * 3600 * 1000;

export type SelectionOrigin = 'top3' | 'mood' | 'custom';

/** A need = a wanted line of Nachschub as the plan sees it. */
export interface PlanNeed {
  id: string;
  label: string;
  kind: StepKind;
  /** Pieces, or portions when `amount` is set. */
  qty: number;
  /** Exact SCU of a material line (shown instead of the count), else absent/null. */
  amount?: number | null;
  /** "liegt bereit" = done. */
  status: 'open' | 'done';
  /** Set key `ship:<id>` / `fps:<id>`, null for a loose line. */
  setKey: string | null;
  setName: string | null;
  className: string | null;
  place: MapPlace | null;
  activity: HqActivity | null;
  crew: number;
  /** The user marked it as wanted (drives the ring fraction). */
  wanted: boolean;
}

/** A set the user takes along: ship loadout or FPS set. */
export interface PlanSet {
  key: string;
  kind: HqSetKind;
  id: string;
  name: string;
  favorite: boolean;
}

export interface PlanSelection {
  readonly steps: ReadonlySet<StepKind>;
  readonly places: ReadonlySet<string>;
  readonly sets: ReadonlySet<string>;
  readonly moods: MoodState;
  readonly supplyIds: ReadonlySet<string>;
  readonly origin: SelectionOrigin;
}

/** Context the ranking needs. */
export interface PlanContext {
  needs: readonly PlanNeed[];
  sets: readonly PlanSet[];
  /** Set keys of Einsaetze that start soon (see {@link soonSetKeys}). */
  soonSets?: ReadonlySet<string>;
}

// ---- derived numbers ----------------------------------------------------------------------

/**
 * Ring fraction of a set (D28): how many of its Nachschub lines the user marked wanted. Never
 * derived from the catalog - a set without lines is 0.
 */
export function setFraction(setKey: string, needs: readonly PlanNeed[]): number {
  const own = needs.filter((n) => n.setKey === setKey);
  return own.length === 0 ? 0 : own.filter((n) => n.wanted).length / own.length;
}

/** Reachability hint under a ring: all / some / none of the wanted open lines have a place. */
export function setReach(setKey: string, needs: readonly PlanNeed[]): 'full' | 'partial' | null {
  const open = needs.filter((n) => n.setKey === setKey && n.wanted && n.status === 'open');
  if (open.length === 0) return null;
  const placed = open.filter((n) => n.place !== null).length;
  return placed === open.length ? 'full' : placed > 0 ? 'partial' : null;
}

/** Set keys of the Einsaetze due within {@link SOON_MS} (via the supply each step belongs to). */
export function soonSetKeys(
  einsaetze: readonly { plannedAt: string | null; status: string; steps: readonly { supplyId: string | null }[] }[],
  needs: readonly PlanNeed[],
  now = Date.now(),
): Set<string> {
  const setOf = new Map(needs.map((n) => [n.id, n.setKey] as const));
  const out = new Set<string>();
  for (const e of einsaetze) {
    if (e.status !== 'planned' && e.status !== 'active') continue;
    const at = e.plannedAt ? Date.parse(e.plannedAt) : NaN;
    if (e.status === 'planned' && !(Number.isFinite(at) && at - now <= SOON_MS)) continue;
    for (const s of e.steps) {
      const k = s.supplyId ? setOf.get(s.supplyId) : null;
      if (k) out.add(k);
    }
  }
  return out;
}

/**
 * The (up to) three set keys that matter most now: favourite set > Einsatz soon > a gap (wanted
 * lines still open); stable tiebreak by name. Sets without an open wanted line are not ranked.
 */
export function top3(ctx: PlanContext): string[] {
  const gap = (key: string) => ctx.needs.filter((n) => n.setKey === key && n.wanted && n.status === 'open').length;
  return ctx.sets
    .filter((s) => gap(s.key) > 0)
    .map((s) => ({ s, fav: s.favorite ? 1 : 0, soon: ctx.soonSets?.has(s.key) ? 1 : 0, gap: gap(s.key) }))
    .sort((a, b) => b.fav - a.fav || b.soon - a.soon || b.gap - a.gap || a.s.name.localeCompare(b.s.name))
    .slice(0, TOP_SETS)
    .map((r) => r.s.key);
}

/** Wanted open line ids of the given sets (or, when there are none, of loose lines). */
function needIdsOf(needs: readonly PlanNeed[], setKeys: ReadonlySet<string>): Set<string> {
  return new Set(needs.filter((n) => n.wanted && n.status === 'open' && n.setKey !== null && setKeys.has(n.setKey)).map((n) => n.id));
}

export function top3Selection(ctx: PlanContext): PlanSelection {
  const keys = top3(ctx);
  const sets = new Set(keys);
  let supplyIds = needIdsOf(ctx.needs, sets);
  if (keys.length === 0) {
    supplyIds = new Set(ctx.needs.filter((n) => n.wanted && n.status === 'open').slice(0, 12).map((n) => n.id));
  }
  return { steps: new Set(), places: new Set(), sets, moods: MOODS_OFF, supplyIds, origin: 'top3' };
}

// ---- default on open (D24) ------------------------------------------------------------------

interface Stored {
  changed: boolean;
  steps: StepKind[];
  places: string[];
  sets: string[];
  moods: MoodState;
  supplyIds: string[];
  origin: SelectionOrigin;
}

/**
 * Default on open (D24): the last selection of this tab session; Top 3 only when nothing was
 * changed in it (nothing stored - a reload / new tab starts with an empty sessionStorage).
 */
export function initialSelection(session: Pick<Storage, 'getItem'> | null, ctx: PlanContext): PlanSelection {
  const stored = readStored(session);
  if (!stored || !stored.changed) return top3Selection(ctx);
  return {
    steps: new Set(stored.steps),
    places: new Set(stored.places),
    sets: new Set(stored.sets),
    moods: stored.moods,
    supplyIds: new Set(stored.supplyIds),
    origin: stored.origin,
  };
}

/** Persist after a user change (never for the untouched Top 3 default). */
export function saveSelection(session: Pick<Storage, 'setItem'> | null, sel: PlanSelection): void {
  if (!session) return;
  const stored: Stored = {
    changed: true,
    steps: [...sel.steps],
    places: [...sel.places],
    sets: [...sel.sets],
    moods: sel.moods,
    supplyIds: [...sel.supplyIds],
    origin: sel.origin,
  };
  try {
    session.setItem(PLAN_SELECTION_KEY, JSON.stringify(stored));
  } catch {
    /* storage full / blocked: the selection just does not survive navigation */
  }
}

function readStored(session: Pick<Storage, 'getItem'> | null): Stored | null {
  if (!session) return null;
  try {
    const raw = session.getItem(PLAN_SELECTION_KEY);
    const o: unknown = raw ? JSON.parse(raw) : null;
    if (!o || typeof o !== 'object') return null;
    const r = o as Record<string, unknown>;
    const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const origin = r['origin'] === 'mood' || r['origin'] === 'custom' ? r['origin'] : 'top3';
    return {
      changed: r['changed'] === true,
      steps: strs(r['steps']).filter((k): k is StepKind => (STEP_KINDS as readonly string[]).includes(k)),
      places: strs(r['places']),
      sets: strs(r['sets']),
      moods: parseMoods(r['moods']),
      supplyIds: strs(r['supplyIds']),
      origin,
    };
  } catch {
    return null;
  }
}

// ---- transitions ----------------------------------------------------------------------------

function flip<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * A mood click = "Nach Lust": the whole pool of wanted open lines is selected and the moods
 * filter it; manual filters reset. All moods off again returns to the Top 3 default.
 */
export function applyMood(sel: PlanSelection, pair: MoodPair, side: MoodSide, ctx: PlanContext): PlanSelection {
  const moods = toggleMood(sel.moods, pair, side);
  if (!moodsActive(moods)) return top3Selection(ctx);
  return {
    steps: new Set(),
    places: new Set(),
    sets: new Set(),
    moods,
    supplyIds: new Set(ctx.needs.filter((n) => n.wanted && n.status === 'open').map((n) => n.id)),
    origin: 'mood',
  };
}

/** Any manual change = "Gezielt". */
export function toggleStepKind(sel: PlanSelection, kind: StepKind): PlanSelection {
  return { ...sel, steps: flip(sel.steps, kind), origin: 'custom' };
}

export function togglePlace(sel: PlanSelection, placeId: string): PlanSelection {
  return { ...sel, places: flip(sel.places, placeId), origin: 'custom' };
}

export function setPlaces(sel: PlanSelection, placeIds: Iterable<string>): PlanSelection {
  return { ...sel, places: new Set(placeIds), origin: 'custom' };
}

export function toggleNeed(sel: PlanSelection, id: string): PlanSelection {
  return { ...sel, supplyIds: flip(sel.supplyIds, id), origin: 'custom' };
}

/** Clicking a set selects (or deselects) all its wanted open needs. */
export function toggleSet(sel: PlanSelection, setKey: string, needs: readonly PlanNeed[]): PlanSelection {
  const ids = needIdsOf(needs, new Set([setKey]));
  const sets = flip(sel.sets, setKey);
  const supplyIds = new Set(sel.supplyIds);
  for (const id of ids) {
    if (sets.has(setKey)) supplyIds.add(id);
    else supplyIds.delete(id);
  }
  return { ...sel, sets, supplyIds, origin: 'custom' };
}

/** Selected fraction of a set's wanted open needs (what the user picked of it right now). */
export function selectedFraction(sel: PlanSelection, setKey: string, needs: readonly PlanNeed[]): number {
  const ids = [...needIdsOf(needs, new Set([setKey]))];
  return ids.length === 0 ? 0 : ids.filter((id) => sel.supplyIds.has(id)).length / ids.length;
}

// ---- what is shown --------------------------------------------------------------------------

/** Inside the step / place / mood filters (D27), selected or not. */
export function passesFilters(sel: PlanSelection, n: PlanNeed, moodsOn: boolean = MOODS_AVAILABLE): boolean {
  if (sel.steps.size > 0 && !sel.steps.has(n.kind)) return false;
  if (sel.places.size > 0 && !(n.place && sel.places.has(n.place.id))) return false;
  // Moods need codex data (mission activity, crew size) that PlanNeed does not carry yet: until then they filter nothing.
  if (!moodsOn) return true;
  return matchesMoods({ kind: n.kind, activity: n.activity, minutes: estimateMinutes(n.kind), crew: n.crew }, sel.moods);
}

/** The needs the selection lets through: selected AND inside the filters. Drives list and map. */
export function visibleNeeds(sel: PlanSelection, needs: readonly PlanNeed[], moodsOn: boolean = MOODS_AVAILABLE): PlanNeed[] {
  return needs.filter((n) => sel.supplyIds.has(n.id) && passesFilters(sel, n, moodsOn));
}

export function toMapNeed(n: PlanNeed): MapNeed {
  return {
    id: n.id,
    label: n.label,
    kind: n.kind,
    qty: n.qty,
    status: n.status,
    colorKey: n.setKey ?? 'note',
    place: n.place,
  };
}

/** The quiet label of the current state (not a control): Top 3 / Nach Lust / Eigene Auswahl. */
export function selectionState(sel: PlanSelection): { key: 'top3' | 'mood' | 'custom'; moods: MoodState } {
  return { key: sel.origin, moods: sel.moods };
}

/** Forget the stored selection (the user is back on the untouched Top 3 default). */
export function clearSelection(session: Pick<Storage, 'removeItem'> | null): void {
  try {
    session?.removeItem(PLAN_SELECTION_KEY);
  } catch {
    /* ignore */
  }
}
