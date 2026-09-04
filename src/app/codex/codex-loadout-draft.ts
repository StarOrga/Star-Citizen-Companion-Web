// Pure functions behind the codex ship-detail write path (PR B / 06-fallen.md
// Falle 1, 3, 4, 5). No Angular, no Supabase — everything here is unit-testable
// without a TestBed, and `codex-detail.component.ts` is a thin caller so its
// own file stays small (it sits at ~18kb of inline styles already).
//
// The model (03-rules.md §2.4): `Map<slotPath, className | null>` for the
// slots the user changed. `null` means "emptied", which is distinct from
// "absent" (= unchanged). Assigning the stock class again DELETES the entry —
// a "changed" badge that survives a revert would be a lie.

import { ConfigLoadoutEntry } from '../hangar/hangar.types';

/** `null` = the slot was explicitly emptied; absent = untouched. */
export type DraftValue = string | null;
export type DraftMap = ReadonlyMap<string, DraftValue>;

export const EMPTY_DRAFT: DraftMap = new Map();

/** `topPort` or `topPort.childPort` — the dotted raw-path key (03-rules §2.1). */
export function draftKey(topPort: string, childPort?: string | null): string {
  return childPort ? `${topPort}.${childPort}` : topPort;
}

/** A dotted path's own top-level segment (the joinable `codex_item_ports` port). */
export function topSegment(path: string): string {
  const i = path.indexOf('.');
  return i < 0 ? path : path.slice(0, i);
}

export function isNestedPath(path: string): boolean {
  return path.includes('.');
}

/**
 * Set one path in the draft. Assigning back the STOCK class deletes the entry
 * (03-rules §2.4 — a revert must actually revert, not just paint the same
 * value). `null` (emptied) is a real, storable value distinct from deletion —
 * it is only deleted when the stock value ITSELF is null (an already-empty
 * slot "emptied" again is still unchanged).
 */
export function setDraftValue(draft: DraftMap, path: string, value: DraftValue, stock: DraftValue): DraftMap {
  const next = new Map(draft);
  if (value === stock) next.delete(path);
  else next.set(path, value);
  return next;
}

/** Apply the same value to every path a grouped row covers (04-rules-v2 §11.3). */
export function setDraftValueForPaths(
  draft: DraftMap,
  paths: readonly string[],
  value: DraftValue,
  stockOf: (path: string) => DraftValue,
): DraftMap {
  let next: DraftMap = draft;
  for (const path of paths) next = setDraftValue(next, path, value, stockOf(path));
  return next;
}

/** Delete draft entries for the given paths outright (the row's revert action). */
export function deleteDraftPaths(draft: DraftMap, paths: readonly string[]): DraftMap {
  const next = new Map(draft);
  for (const path of paths) next.delete(path);
  return next;
}

export function changedCount(draft: DraftMap): number {
  return draft.size;
}

/** One entry ready to be written into a `hangar_ship_configs.loadout` row. */
export interface SaveableEntry {
  portName: string;
  className: string;
  kind: string;
}

/**
 * R2: only TOP-LEVEL, non-emptied entries whose path is itself a joinable
 * `codex_item_ports.port_name` may ever be persisted. A nested `mount.gun`
 * path or an emptied top-level slot has nowhere to live in the current schema
 * and stays draft-only (06-fallen.md Falle 1, "nur oberste Ebene").
 */
export function selectSaveableEntries(
  draft: DraftMap,
  joinablePorts: ReadonlySet<string>,
  kindOf: (className: string) => string,
): SaveableEntry[] {
  const out: SaveableEntry[] = [];
  for (const [path, value] of draft) {
    if (isNestedPath(path) || value === null) continue;
    if (!joinablePorts.has(path)) continue;
    out.push({ portName: path, className: value, kind: kindOf(value) });
  }
  return out;
}

/**
 * R1: never write a from-scratch array. `touchedTopPorts` is every top-level,
 * joinable path the draft currently mentions (saveable AND emptied/reverted) —
 * anything the user touched this session that is no longer a saveable
 * className must be REMOVED from the stored config, not left behind as a
 * stale override. Everything else in the existing config (rows written by the
 * hangar editor, or by an earlier codex session against a different port) is
 * preserved untouched.
 */
export function mergeSavedLoadout(
  existing: readonly ConfigLoadoutEntry[],
  saveable: readonly SaveableEntry[],
  touchedTopPorts: ReadonlySet<string>,
): ConfigLoadoutEntry[] {
  const kept = existing.filter((e) => !touchedTopPorts.has(e.portName));
  return [...kept, ...saveable.map((e) => ({ portName: e.portName, className: e.className, kind: e.kind }))];
}

/** Every top-level, joinable path the draft currently mentions (see above). */
export function touchedTopPorts(draft: DraftMap, joinablePorts: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const path of draft.keys()) {
    if (!isNestedPath(path) && joinablePorts.has(path)) out.add(path);
  }
  return out;
}

// ── R6: epoch-guarded hydration merge ───────────────────────────────────────
//
// Draft-swapped classes need an async stat hydration (Falle 2). Two swaps can
// race; a slower, older response must never clobber a newer one — and unlike
// the page's initial load (a single wholesale replace), a swap's hydration
// must MERGE, so an in-flight OTHER class's payload is never dropped either.

export interface HydrationEpoch {
  counter: number;
  /** className → the epoch of the most recent request that asked for it. */
  latest: Map<string, number>;
}

export function newHydrationEpoch(): HydrationEpoch {
  return { counter: 0, latest: new Map() };
}

/** Start a hydration request for these classes; returns the epoch to tag it with. */
export function beginHydration(state: HydrationEpoch, classNames: readonly string[]): number {
  const epoch = ++state.counter;
  for (const c of classNames) state.latest.set(c, epoch);
  return epoch;
}

/**
 * Of the classes a request resolved, only the ones still at THIS epoch are
 * safe to merge in — a class re-requested by a later swap has moved on, and a
 * response for the OLD request must not overwrite whatever the later one
 * eventually resolves to.
 */
export function acceptedClassNames(
  state: HydrationEpoch,
  classNames: readonly string[],
  epoch: number,
): string[] {
  return classNames.filter((c) => state.latest.get(c) === epoch);
}

/** Merge only the allowed keys of `incoming` into `base` — never a wholesale replace. */
export function mergeMapInto<T>(
  base: ReadonlyMap<string, T>,
  incoming: ReadonlyMap<string, T>,
  allowedKeys: readonly string[],
): Map<string, T> {
  const out = new Map(base);
  for (const key of allowedKeys) {
    if (incoming.has(key)) out.set(key, incoming.get(key) as T);
  }
  return out;
}

// ── R9: URL / localStorage draft mirror ─────────────────────────────────────
//
// `v1.<buildId>.<path>~<class>,<path>~<class>,...` — versioned so a future
// format change never mis-parses an old link, and build-scoped so a class name
// that does not exist in the CURRENT build renders as "not in this build"
// instead of silently falling back to stock (03-rules §7.3 adapted: the
// prototype's UUIDs do not exist in this app, className is the identity).

const DRAFT_PARAM_VERSION = 'v1';
const LOCALSTORAGE_DRAFT_KEY = 'scc-codex-loadout:v1';

export interface DecodedDraft {
  version: string;
  buildId: string;
  entries: [string, DraftValue][];
}

/** `null` when the draft is empty — an empty param would just be noise in the URL. */
export function encodeDraftParam(buildId: string, draft: DraftMap): string | null {
  if (draft.size === 0) return null;
  const blob = [...draft.entries()]
    .map(([path, value]) => `${encodeURIComponent(path)}~${value === null ? '' : encodeURIComponent(value)}`)
    .join(',');
  return `${DRAFT_PARAM_VERSION}.${encodeURIComponent(buildId)}.${blob}`;
}

/** Tolerant parse — a malformed or foreign-version param yields `null`, never a throw. */
export function decodeDraftParam(raw: string | null | undefined): DecodedDraft | null {
  if (!raw) return null;
  const m = /^([^.]+)\.([^.]+)\.(.*)$/.exec(raw);
  if (!m) return null;
  const [, version, encodedBuildId, blob] = m;
  if (version !== DRAFT_PARAM_VERSION) return null;
  const buildId = safeDecode(encodedBuildId);
  if (!buildId) return null;
  const entries: [string, DraftValue][] = [];
  for (const seg of blob.split(',')) {
    if (!seg) continue;
    const i = seg.indexOf('~');
    if (i < 0) continue;
    const path = safeDecode(seg.slice(0, i));
    if (!path) continue;
    const raw2 = seg.slice(i + 1);
    entries.push([path, raw2 === '' ? null : safeDecode(raw2)]);
  }
  return { version, buildId, entries };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
}

export interface LocalStorageDraft {
  shipClassName: string;
  buildId: string;
  entries: [string, DraftValue][];
}

export function serializeLocalDraft(shipClassName: string, buildId: string, draft: DraftMap): string {
  const payload: LocalStorageDraft = { shipClassName, buildId, entries: [...draft.entries()] };
  return JSON.stringify(payload);
}

export function parseLocalDraft(raw: string | null | undefined): LocalStorageDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LocalStorageDraft>;
    if (typeof v.shipClassName !== 'string' || typeof v.buildId !== 'string' || !Array.isArray(v.entries)) {
      return null;
    }
    return { shipClassName: v.shipClassName, buildId: v.buildId, entries: v.entries };
  } catch {
    return null;
  }
}

export const LOCAL_DRAFT_STORAGE_KEY = LOCALSTORAGE_DRAFT_KEY;

// ── power-dock draft state (MASTER §8, D §5) ─────────────────────────────────
// Cut groups / flight mode / dock position are DRAFT-ONLY: they ride in their
// own URL param (`pw`) and their own localStorage key, never in
// `hangar_ship_configs.loadout`. A separate param (rather than a v2 of the
// loadout param) is what keeps every already-shared `?loadout=v1…` link
// decodable — `decodeDraftParam` is untouched.

const POWER_PARAM_VERSION = 'p1';

/** Separator inside the `pw` param's group list — see {@link encodePowerParam}. */
export const POWER_GROUP_SEPARATOR = '-';
// R10 — TWO storage scopes, because the two halves of the dock state have
// different lifetimes:
//   * where the dock sits is a PER-USER preference and must survive a ship
//     switch → `scc-codex-dock-pos:v1:<userId|anon>`;
//   * which groups are cut / which mode + preset are PER-SHIP and must NOT
//     leak from a Nomad onto an Idris → `scc-codex-power:v1:<shipClassName>`.
// One shared key made the dock jump back to `center` whenever another ship was
// opened, and carried a "weapons cut" over to a ship with different hardware.
const LOCALSTORAGE_POWER_KEY = 'scc-codex-power:v1';
const LOCALSTORAGE_DOCK_POS_KEY = 'scc-codex-dock-pos:v1';

/** Per-ship key for cut groups / flight mode / preset. */
export function powerStorageKey(shipClassName: string): string {
  return `${LOCALSTORAGE_POWER_KEY}:${shipClassName}`;
}

/** Per-user key for the dock position (`anon` when nobody is signed in). */
export function dockPositionStorageKey(userId: string | null | undefined): string {
  const id = (userId ?? '').trim();
  return `${LOCALSTORAGE_DOCK_POS_KEY}:${id === '' ? 'anon' : id}`;
}

export function serializeDockPosition(dock: PowerDraftState['dock']): string {
  return dock;
}

/** Tolerant read — anything but the three known positions yields `null`. */
export function parseDockPosition(raw: string | null | undefined): PowerDraftState['dock'] | null {
  const v = (raw ?? '').trim();
  return v === 'left' || v === 'center' || v === 'right' ? v : null;
}

export interface PowerDraftState {
  /** cut group keys (see codex-power.ts `PowerGroup`) — order irrelevant. */
  cutGroups: readonly string[];
  mode: 'scm' | 'nav';
  preset: 'auto' | 'stealth';
  dock: 'left' | 'center' | 'right';
}

export const DEFAULT_POWER_DRAFT: PowerDraftState = {
  cutGroups: [],
  mode: 'scm',
  preset: 'auto',
  dock: 'center',
};

function isDefaultPower(s: PowerDraftState): boolean {
  return (
    s.cutGroups.length === 0 &&
    s.mode === DEFAULT_POWER_DRAFT.mode &&
    s.preset === DEFAULT_POWER_DRAFT.preset &&
    s.dock === DEFAULT_POWER_DRAFT.dock
  );
}

/** `null` for the default state — no point putting noise in the URL. */
export function encodePowerParam(state: PowerDraftState): string | null {
  if (isDefaultPower(state)) return null;
  // `-` is a safe separator: every PowerGroup key is `[a-z]+` (asserted by a
  // spec against POWER_GROUP_ORDER), so a hyphen can never occur INSIDE a key
  // and the round-trip needs no escaping. The URL format is unchanged.
  const groups = [...state.cutGroups].map((g) => encodeURIComponent(g)).join(POWER_GROUP_SEPARATOR);
  return `${POWER_PARAM_VERSION}.${state.mode}.${state.preset}.${state.dock}.${groups}`;
}

/** Tolerant parse — malformed or foreign-version input yields `null`, never a throw. */
export function decodePowerParam(raw: string | null | undefined): PowerDraftState | null {
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length < 4 || parts[0] !== POWER_PARAM_VERSION) return null;
  const [, mode, preset, dock, groups = ''] = parts;
  if (mode !== 'scm' && mode !== 'nav') return null;
  if (preset !== 'auto' && preset !== 'stealth') return null;
  if (dock !== 'left' && dock !== 'center' && dock !== 'right') return null;
  return {
    mode,
    preset,
    dock,
    cutGroups: groups
      .split(POWER_GROUP_SEPARATOR)
      .map((g) => safeDecode(g))
      .filter((g) => g !== ''),
  };
}

export interface LocalStoragePowerDraft extends PowerDraftState {
  shipClassName: string;
}

export function serializeLocalPowerDraft(shipClassName: string, state: PowerDraftState): string {
  return JSON.stringify({ shipClassName, ...state } satisfies LocalStoragePowerDraft);
}

export function parseLocalPowerDraft(raw: string | null | undefined): LocalStoragePowerDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LocalStoragePowerDraft>;
    if (typeof v.shipClassName !== 'string') return null;
    const decoded = decodePowerParam(
      `${POWER_PARAM_VERSION}.${v.mode ?? 'scm'}.${v.preset ?? 'auto'}.${v.dock ?? 'center'}.` +
        (Array.isArray(v.cutGroups) ? v.cutGroups.join(POWER_GROUP_SEPARATOR) : ''),
    );
    return decoded ? { shipClassName: v.shipClassName, ...decoded } : null;
  } catch {
    return null;
  }
}

export const LOCAL_POWER_STORAGE_KEY = LOCALSTORAGE_POWER_KEY;

/**
 * Restore a draft from a decoded source (URL or localStorage) against the
 * CURRENT build and resolvable class set. A className the current build no
 * longer resolves renders visibly (R9) rather than silently falling back to
 * stock — the caller marks those paths, it does not drop them.
 */
export interface RestoredDraft {
  draft: DraftMap;
  /** Paths whose class does not resolve in the current build (R9). */
  unresolvable: string[];
  /** True when the source's buildId does not match the current build. */
  buildMismatch: boolean;
}

export function restoreDraft(
  decoded: DecodedDraft,
  currentBuildId: string,
  classResolves: (className: string) => boolean,
): RestoredDraft {
  const buildMismatch = decoded.buildId !== currentBuildId;
  const draft = new Map<string, DraftValue>();
  const unresolvable: string[] = [];
  for (const [path, value] of decoded.entries) {
    draft.set(path, value);
    if (value !== null && !classResolves(value)) unresolvable.push(path);
  }
  return { draft, unresolvable, buildMismatch };
}
