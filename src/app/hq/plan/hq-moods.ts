import type { StepKind } from '../../shared/step/sc-step.component';
import type { HqActivity } from '../data/hq-db.types';

/**
 * Mood presets of Planen (concept D25): three binary toggle pairs, each a 3-way switch
 * (off · left · right). Presets combine - AND across pairs. The mapping from a mood to a filter
 * on a need is data-driven (the tables below), so a rule changes in one place.
 *
 *  - Friedlich ↔ Kampf        a combat need is a mission of a combat activity
 *  - Schnell ↔ Zeitintensiv   estimated minutes < 30 / >= 30 (fixed cost per step kind + travel)
 *  - Solo ↔ Gruppe            crew of the needed ship <= 1 / >= 2 (from the Codex; unknown = 1)
 */
export const MOOD_PAIRS = ['danger', 'time', 'crew'] as const;
export type MoodPair = (typeof MOOD_PAIRS)[number];
export type MoodSide = 'left' | 'right';
/** `null` = the pair is off. */
export type MoodState = Readonly<Record<MoodPair, MoodSide | null>>;

export const MOODS_OFF: MoodState = { danger: null, time: null, crew: null };

/** i18n key suffix (`hq.mood.<id>`) of both sides of a pair. */
export const MOOD_IDS: Readonly<Record<MoodPair, readonly [string, string]>> = {
  danger: ['peaceful', 'combat'],
  time: ['quick', 'long'],
  crew: ['solo', 'group'],
};

/** The "Schnell" limit in minutes. */
export const QUICK_MINUTES = 30;

/** Fixed time cost per step kind in minutes (without travel), documented estimate. */
export const STEP_MINUTES: Readonly<Record<StepKind, number>> = {
  buy: 10,
  pickup: 10,
  craft: 15,
  refine: 20,
  transport: 25,
  mission: 40,
  mine: 45,
};

/** Activities (D19) that mean combat. */
export const COMBAT_ACTIVITIES: ReadonlySet<HqActivity> = new Set<HqActivity>(['kopfgeld', 'bunker', 'piraterie']);

/** What the mood rules read from a need. */
export interface MoodSubject {
  kind: StepKind;
  activity: HqActivity | null;
  /** Estimated minutes, see {@link estimateMinutes}. */
  minutes: number;
  /** Crew of the ship the step needs; 1 when unknown. */
  crew: number;
}

/** Fixed per-kind cost plus travel minutes (0 when the distance is unknown). */
export function estimateMinutes(kind: StepKind, travelMinutes = 0): number {
  return STEP_MINUTES[kind] + Math.max(0, travelMinutes);
}

function isCombat(s: MoodSubject): boolean {
  return s.kind === 'mission' && (s.activity === null || COMBAT_ACTIVITIES.has(s.activity));
}

const RULES: Readonly<Record<MoodPair, readonly [(s: MoodSubject) => boolean, (s: MoodSubject) => boolean]>> = {
  danger: [(s) => !isCombat(s), (s) => isCombat(s)],
  time: [(s) => s.minutes < QUICK_MINUTES, (s) => s.minutes >= QUICK_MINUTES],
  crew: [(s) => s.crew <= 1, (s) => s.crew >= 2],
};

/** Click on one side of a pair: sets it, a second click on the active side switches the pair off. */
export function toggleMood(state: MoodState, pair: MoodPair, side: MoodSide): MoodState {
  return { ...state, [pair]: state[pair] === side ? null : side };
}

export function moodsActive(state: MoodState): boolean {
  return MOOD_PAIRS.some((p) => state[p] !== null);
}

/** i18n keys of the active moods in pair order (`hq.mood.peaceful` ...). */
export function activeMoodKeys(state: MoodState): string[] {
  return MOOD_PAIRS.flatMap((p) => (state[p] ? [`hq.mood.${MOOD_IDS[p][state[p] === 'left' ? 0 : 1]}`] : []));
}

/** AND across the pairs that are on; all pairs off matches everything. */
export function matchesMoods(subject: MoodSubject, state: MoodState): boolean {
  return MOOD_PAIRS.every((p) => {
    const side = state[p];
    return side === null || RULES[p][side === 'left' ? 0 : 1](subject);
  });
}

export function parseMoods(raw: unknown): MoodState {
  if (!raw || typeof raw !== 'object') return MOODS_OFF;
  const o = raw as Record<string, unknown>;
  const side = (v: unknown): MoodSide | null => (v === 'left' || v === 'right' ? v : null);
  return { danger: side(o['danger']), time: side(o['time']), crew: side(o['crew']) };
}
