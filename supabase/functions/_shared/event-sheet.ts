/**
 * Event data sheet - the ONE schema for "what an event asks, gives and where it applies" (contract:
 * docs/contracts/event-sheet.md). Single source of truth for the web client (re-exported by
 * src/app/hq/events/event-sheet.ts) and the Deno edge functions. Pure: no imports, no runtime APIs, only
 * erasable TypeScript, so it also runs under `node --test` and Deno unchanged.
 *
 * Flexibility rule (owner): nothing here is locked to today's events. Ids such as venue, area kind, progress
 * model or gear are OPEN strings (normalised to a slug); the KNOWN_* lists are suggestions for the UI only.
 * Every field may be unknown (`value: null`).
 */

export const EVENT_SHEET_SCHEMA = 1;
/** A field below this confidence stays unknown in the public sheet and waits for admin review. */
export const SHEET_CONFIDENCE_MIN = 0.8;

export const KNOWN_VENUES = ['verse', 'arena-commander', 'star-marine', 'website', 'twitch', 'unknown'] as const;
export const KNOWN_AREA_KINDS = ['none', 'system', 'places', 'any'] as const;
export const KNOWN_PROGRESS_MODELS = ['none', 'once', 'tiers', 'daily', 'group', 'community'] as const;
export const KNOWN_GEAR = ['fps-combat-set', 'combat-ship', 'salvage-ship', 'cargo-ship', 'mining-ship', 'medical-ship', 'any-ship'] as const;

export type RewardChannel = 'pledge' | 'ingame' | 'both' | 'unknown';
export type RewardTimingKind = 'immediate' | 'after-end' | 'date' | 'unknown';
/** auto = machine value above the gate; pending = waits for admin; approved/edited = an admin confirmed / set it. */
export type FieldReview = 'auto' | 'pending' | 'approved' | 'edited' | 'rejected';

export interface SheetField<T> {
  /** null = unknown. */
  readonly value: T | null;
  /** 0..1. Admin-set values carry 1. */
  readonly confidence: number;
  /** Open: 'official' | 'comm-link' | 'spectrum' | 'wiki' | 'ai' | 'admin' | 'seed' | 'unknown' ... */
  readonly source: string;
  readonly review: FieldReview;
}

export interface EventArea {
  /** Open slug, see KNOWN_AREA_KINDS. */
  readonly kind: string;
  readonly systems: readonly string[];
  readonly places: readonly string[];
}

export interface EventTask {
  readonly id: string;
  readonly label: string;
  readonly trackId: string | null;
}

export interface ProgressTier {
  readonly at: number;
  readonly label: string;
  readonly rewardIds: readonly string[];
}

export interface ProgressTrack {
  readonly id: string;
  readonly label: string;
  readonly unit: string | null;
  /** Ascending by `at`. */
  readonly tiers: readonly ProgressTier[];
}

export interface EventProgress {
  /** Open slug, see KNOWN_PROGRESS_MODELS. */
  readonly model: string;
  readonly tracks: readonly ProgressTrack[];
}

export interface RewardTiming {
  readonly kind: RewardTimingKind;
  /** ISO date, only with kind 'date'. */
  readonly date: string | null;
}

export interface EventReward {
  readonly id: string;
  readonly name: string;
  /** Codex class name when the reward is a known item/ship; the exact variant for dedupe (C11). */
  readonly className: string | null;
  readonly variant: string | null;
  readonly channel: RewardChannel;
  readonly timing: RewardTiming;
  readonly trackId: string | null;
  readonly tier: number | null;
}

/** AND / OR group of gear. A leaf is one gear need. Never the patch or a game package. */
export type PrereqNode =
  | { readonly op: 'and' | 'or'; readonly items: readonly PrereqNode[] }
  | { readonly gear: string; readonly label: string | null };

export interface EventSheetFields {
  readonly venues: SheetField<readonly string[]>;
  readonly area: SheetField<EventArea>;
  readonly tasks: SheetField<readonly EventTask[]>;
  readonly progress: SheetField<EventProgress>;
  readonly rewards: SheetField<readonly EventReward[]>;
  readonly prerequisites: SheetField<PrereqNode>;
  /** ISO date (YYYY-MM-DD) or ISO instant. */
  readonly start: SheetField<string>;
  readonly end: SheetField<string>;
}
export type EventSheetFieldKey = keyof EventSheetFields;
export const EVENT_SHEET_FIELD_KEYS: readonly EventSheetFieldKey[] = [
  'venues', 'area', 'tasks', 'progress', 'rewards', 'prerequisites', 'start', 'end',
];

export interface EventSheet {
  readonly schema: number;
  readonly fields: EventSheetFields;
}

// ------------------------------------------------------------------------------------------------ helpers

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

export function unknownField<T>(): SheetField<T> {
  return { value: null, confidence: 0, source: 'unknown', review: 'auto' };
}

export function emptySheet(): EventSheet {
  return {
    schema: EVENT_SHEET_SCHEMA,
    fields: {
      venues: unknownField(), area: unknownField(), tasks: unknownField(), progress: unknownField(),
      rewards: unknownField(), prerequisites: unknownField(), start: unknownField(), end: unknownField(),
    },
  };
}

export function slug(raw: unknown, max = 64): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
}
function text(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, max) : '';
}
function textOrNull(raw: unknown, max: number): string | null {
  return text(raw, max) || null;
}
function slugList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw.slice(0, max)) {
    const s = slug(v);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
function isoDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return null;
  return Number.isFinite(Date.parse(s)) ? s : null;
}

/** Patch / game package / edition are obligatory or irrelevant: never a prerequisite (pin ev-flow, C4). */
const FORBIDDEN_GEAR = /(^|-)(patch|alpha|beta|live|ptu|game-?package|package|starter|squadron-?42|sq-?42|edition|account)(-|$)/;
export function isForbiddenGear(gear: string): boolean {
  return FORBIDDEN_GEAR.test(slug(gear));
}

// ------------------------------------------------------------------------------------------------ value normalisers

function normArea(raw: unknown): EventArea | null {
  if (!isRec(raw)) return null;
  const kind = slug(raw['kind']);
  if (!kind) return null;
  return { kind, systems: slugList(raw['systems'], 20), places: slugList(raw['places'], 80) };
}

function normTasks(raw: unknown): EventTask[] | null {
  if (!Array.isArray(raw)) return null;
  const out: EventTask[] = [];
  for (const [i, t] of raw.slice(0, 40).entries()) {
    if (!isRec(t)) continue;
    const label = text(t['label'], 200);
    if (!label) continue;
    out.push({ id: slug(t['id']) || `task-${i + 1}`, label, trackId: slug(t['trackId']) || null });
  }
  return out;
}

function normProgress(raw: unknown): EventProgress | null {
  if (!isRec(raw)) return null;
  const model = slug(raw['model']);
  if (!model) return null;
  const tracks: ProgressTrack[] = [];
  for (const [i, t] of (Array.isArray(raw['tracks']) ? (raw['tracks'] as unknown[]) : []).slice(0, 20).entries()) {
    if (!isRec(t)) continue;
    const tiers: ProgressTier[] = [];
    for (const x of (Array.isArray(t['tiers']) ? (t['tiers'] as unknown[]) : []).slice(0, 60)) {
      if (!isRec(x)) continue;
      const at = Number(x['at']);
      if (!Number.isFinite(at) || at < 0) continue;
      tiers.push({ at, label: text(x['label'], 120), rewardIds: slugList(x['rewardIds'], 20) });
    }
    tiers.sort((a, b) => a.at - b.at);
    tracks.push({ id: slug(t['id']) || `track-${i + 1}`, label: text(t['label'], 120), unit: textOrNull(t['unit'], 24), tiers });
  }
  return { model, tracks };
}

function normChannel(raw: unknown): RewardChannel {
  return raw === 'pledge' || raw === 'ingame' || raw === 'both' ? raw : 'unknown';
}
function normTiming(raw: unknown): RewardTiming {
  if (!isRec(raw)) return { kind: 'unknown', date: null };
  const date = isoDate(raw['date']);
  if (raw['kind'] === 'date' && date) return { kind: 'date', date };
  if (raw['kind'] === 'immediate' || raw['kind'] === 'after-end') return { kind: raw['kind'], date: null };
  return { kind: 'unknown', date: null };
}

function normRewards(raw: unknown): EventReward[] | null {
  if (!Array.isArray(raw)) return null;
  const out: EventReward[] = [];
  for (const [i, r] of raw.slice(0, 60).entries()) {
    if (!isRec(r)) continue;
    const name = text(r['name'], 160);
    if (!name) continue;
    const tier = Number(r['tier']);
    out.push({
      id: slug(r['id']) || `reward-${i + 1}`,
      name,
      className: textOrNull(r['className'], 200),
      variant: textOrNull(r['variant'], 200),
      channel: normChannel(r['channel']),
      timing: normTiming(r['timing']),
      trackId: slug(r['trackId']) || null,
      tier: r['tier'] != null && Number.isInteger(tier) && tier >= 0 ? tier : null,
    });
  }
  return out;
}

function normPrereq(raw: unknown, depth = 0): PrereqNode | null {
  if (!isRec(raw) || depth > 4) return null;
  if (typeof raw['gear'] === 'string') {
    const gear = slug(raw['gear']);
    if (!gear || isForbiddenGear(gear)) return null;
    return { gear, label: textOrNull(raw['label'], 80) };
  }
  const op = raw['op'] === 'or' ? 'or' : raw['op'] === 'and' ? 'and' : null;
  if (!op || !Array.isArray(raw['items'])) return null;
  const items = (raw['items'] as unknown[]).slice(0, 12).map((n) => normPrereq(n, depth + 1)).filter((n): n is PrereqNode => !!n);
  if (!items.length) return null;
  // A group of one is just its member.
  return items.length === 1 ? items[0] : { op, items };
}

const NORM: Record<EventSheetFieldKey, (raw: unknown) => unknown> = {
  venues: (r) => (Array.isArray(r) ? slugList(r, 12) : null),
  area: normArea,
  tasks: normTasks,
  progress: normProgress,
  rewards: normRewards,
  prerequisites: (r) => normPrereq(r),
  start: isoDate,
  end: isoDate,
};

const REVIEWS: readonly FieldReview[] = ['auto', 'pending', 'approved', 'edited', 'rejected'];

function normField(key: EventSheetFieldKey, raw: unknown): SheetField<unknown> {
  if (!isRec(raw)) return unknownField();
  const value = NORM[key](raw['value']);
  if (value === null || value === undefined) return unknownField();
  const c = Number(raw['confidence']);
  const review = REVIEWS.find((r) => r === raw['review']) ?? 'auto';
  return {
    value,
    confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0,
    source: slug(raw['source']) || 'unknown',
    review,
  };
}

/** Tolerant: never throws, unknown or malformed values become `unknown`. */
export function normalizeSheet(raw: unknown): EventSheet {
  if (!isRec(raw)) return emptySheet();
  const f = isRec(raw['fields']) ? raw['fields'] : {};
  const fields: Record<string, SheetField<unknown>> = {};
  for (const k of EVENT_SHEET_FIELD_KEYS) fields[k] = normField(k, f[k]);
  const schema = Number(raw['schema']);
  return { schema: Number.isInteger(schema) && schema > 0 ? schema : EVENT_SHEET_SCHEMA, fields: fields as unknown as EventSheetFields };
}

/** Normalises and lists what had to be thrown away (extraction tests, admin save). */
export function validateSheet(raw: unknown): { sheet: EventSheet; issues: string[] } {
  const sheet = normalizeSheet(raw);
  const issues: string[] = [];
  if (!isRec(raw) || !isRec(raw['fields'])) return { sheet, issues: ['sheet: no fields object'] };
  for (const k of EVENT_SHEET_FIELD_KEYS) {
    const rawField = raw['fields'][k];
    if (!isRec(rawField) || rawField['value'] == null) continue;
    if (sheet.fields[k].value === null) issues.push(`${k}: value rejected`);
    const c = Number(rawField['confidence']);
    if (!Number.isFinite(c) || c < 0 || c > 1) issues.push(`${k}: confidence out of range`);
  }
  return { sheet, issues };
}

// ------------------------------------------------------------------------------------------------ review gate

/** Fields whose value waits for an admin. */
export function pendingFields(sheet: EventSheet): EventSheetFieldKey[] {
  return EVENT_SHEET_FIELD_KEYS.filter((k) => sheet.fields[k].value !== null && sheet.fields[k].review === 'pending');
}

/** Extraction output: every machine value below the gate becomes `pending`; admin-touched ones stay as they are. */
export function gateSheet(sheet: EventSheet, min = SHEET_CONFIDENCE_MIN): EventSheet {
  const fields: Record<string, SheetField<unknown>> = { ...sheet.fields };
  for (const k of EVENT_SHEET_FIELD_KEYS) {
    const f = fields[k];
    if (f.value !== null && f.review === 'auto' && f.confidence < min) fields[k] = { ...f, review: 'pending' };
  }
  return { ...sheet, fields: fields as unknown as EventSheetFields };
}

/** What every reader gets: pending and rejected fields are unknown. (The SQL function sc_event_sheet_apply does the same.) */
export function publicSheet(sheet: EventSheet): EventSheet {
  const fields: Record<string, SheetField<unknown>> = { ...sheet.fields };
  for (const k of EVENT_SHEET_FIELD_KEYS) {
    if (fields[k].review === 'pending' || fields[k].review === 'rejected') fields[k] = unknownField();
  }
  return { ...sheet, fields: fields as unknown as EventSheetFields };
}

/** Admin sets a value by hand: confidence 1, review `edited`. An unusable value makes the field unknown. */
export function setByAdmin(sheet: EventSheet, key: EventSheetFieldKey, raw: unknown): EventSheet {
  const value = NORM[key](raw);
  const field: SheetField<unknown> = value == null ? unknownField() : { value, confidence: 1, source: 'admin', review: 'edited' };
  return { ...sheet, fields: { ...sheet.fields, [key]: field } as unknown as EventSheetFields };
}

export function approveField(sheet: EventSheet, key: EventSheetFieldKey): EventSheet {
  const f = sheet.fields[key];
  if (f.value === null) return sheet;
  return { ...sheet, fields: { ...sheet.fields, [key]: { ...f, review: 'approved' } } as unknown as EventSheetFields };
}

// ------------------------------------------------------------------------------------------------ reading helpers

/** Gear ids of a prerequisite tree flattened (for chips / tests). */
export function prereqGear(node: PrereqNode | null): string[] {
  if (!node) return [];
  if ('gear' in node) return [node.gear];
  return node.items.flatMap((n) => prereqGear(n));
}
