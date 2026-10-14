/**
 * Run duration estimate — "how much longer, and how long on another preset?"
 *
 * A run walks three steps (Codex · Silhouetten · 3D-Modelle). The estimate is
 *
 *   remaining of the running step   — measured: the step's rail percentage over
 *                                     time ({@link throughput}), once enough of
 *                                     it has been observed; before that the
 *                                     last finished run's duration of this step
 *   + every step still to come       — the last finished run's duration of it
 *
 * and it says which of the two it rests on. A step that never finished on this
 * PC has no number: the estimate then covers only the running step (or, idle,
 * nothing at all) — an honest gap beats an invented figure.
 *
 * Another preset's duration is the same estimate scaled by its worker count
 * through Amdahl's law: only part of a run parallelises (one P4K reader, the
 * uploads and the network do not), so twice the workers is never half the
 * time. {@link PARALLEL_SHARE} is a calibrated guess, and the UI says "ca.".
 *
 * Pure — no DOM, no storage — so the tests drive it with a fake clock.
 */

import { pruneSamples, throughput, type ThroughputSample } from './throughput.js';

export type RunStepKey = 'codex' | 'silhouettes' | 'models';
export const RUN_STEP_KEYS: readonly RunStepKey[] = ['codex', 'silhouettes', 'models'];

/** How long a step took on this PC, and with how many workers on average. */
export interface StepRecord {
  ms: number;
  workers: number;
}
export type StepHistory = Partial<Record<RunStepKey, StepRecord>>;

/** Share of a run's time that scales with the worker count. */
export const PARALLEL_SHARE = 0.6;
/** A step must run this long before its own pace counts. */
export const LIVE_MIN_ELAPSED_MS = 30_000;
/** …and have moved this many percent of its rail. */
export const LIVE_MIN_PCT = 2;
/** A step that ended below this percentage was skipped or cut short — not a duration. */
export const FINISHED_MIN_PCT = 95;
/** Rail-percentage samples are rated over this window. */
export const RATE_WINDOW_MS = 120_000;

/** Relative run time with `workers` workers (1 worker = 1). */
export function relativeTime(workers: number, p = PARALLEL_SHARE): number {
  const w = Math.max(1, workers);
  return 1 - p + p / w;
}

/** A duration measured with `fromWorkers`, projected onto `toWorkers`. */
export function scaleSeconds(seconds: number, fromWorkers: number, toWorkers: number): number {
  return (seconds * relativeTime(toWorkers)) / relativeTime(fromWorkers);
}

export interface RunningStep {
  step: RunStepKey;
  startedAt: number;
  /** 0–100 along the step's rail. */
  pct: number;
  samples: readonly ThroughputSample[];
}

export interface EstimateInput {
  now: number;
  /** The step a run is in right now, or null when nothing runs. */
  current: RunningStep | null;
  /** Steps still to come after `current` (idle: the whole planned run). */
  upcoming: readonly RunStepKey[];
  history: StepHistory;
  /** Workers under the limits in force now. */
  workers: number;
}

export interface RunEstimate {
  /** Seconds left (idle: a whole run) under `workers`. */
  seconds: number;
  /** 'run' = to the end of the run; 'step' = only the running step is known. */
  scope: 'run' | 'step';
  /** 'live' = the running step's own pace; 'last' = the last finished run. */
  basis: 'live' | 'last';
  /** No run going — the duration a whole run would take. */
  idle: boolean;
  workers: number;
}

/** Seconds left of the running step at its own pace, or null while too little is observed. */
export function liveRemaining(cur: RunningStep, now: number): number | null {
  if (now - cur.startedAt < LIVE_MIN_ELAPSED_MS || cur.pct < LIVE_MIN_PCT) return null;
  if (cur.pct >= 100) return 0;
  const rate = throughput(cur.samples, now, RATE_WINDOW_MS);
  if (rate === null || rate <= 0) return null;
  return (100 - cur.pct) / rate;
}

function fromHistory(h: StepHistory, step: RunStepKey, workers: number): number | null {
  const r = h[step];
  if (!r || !(r.ms > 0)) return null;
  return scaleSeconds(r.ms / 1000, r.workers, workers);
}

export function estimateRun(input: EstimateInput): RunEstimate | null {
  const { current, history, workers, now } = input;
  let seconds = 0;
  let basis: RunEstimate['basis'] = 'last';
  if (current) {
    const live = liveRemaining(current, now);
    if (live !== null) {
      seconds = live;
      basis = 'live';
    } else {
      const whole = fromHistory(history, current.step, workers);
      if (whole === null) return null;
      seconds = whole * (1 - Math.min(100, Math.max(0, current.pct)) / 100);
    }
  } else if (input.upcoming.length === 0) {
    return null;
  }
  let scope: RunEstimate['scope'] = 'run';
  let later = 0;
  for (const step of input.upcoming) {
    const s = fromHistory(history, step, workers);
    if (s === null) {
      scope = 'step';
      break;
    }
    later += s;
  }
  if (scope === 'run') seconds += later;
  else if (!current) return null;
  return { seconds: Math.max(1, Math.round(seconds)), scope, basis, idle: !current, workers };
}

/** The estimate under another worker count (a preset the operator might pick). */
export function estimateFor(est: RunEstimate, workers: number): number {
  return Math.max(1, Math.round(scaleSeconds(est.seconds, est.workers, workers)));
}

/** "< 1 min", "25 min", "1 h 10 min", "3 h" — hours rounded to 5 minutes. */
export function formatApprox(seconds: number): string {
  if (seconds < 60) return '< 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rounded = Math.round(minutes / 5) * 5;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

type Tracked = RunningStep & { samples: ThroughputSample[]; workerMs: number; lastT: number; lastWorkers: number };

/**
 * Follows a run's steps as their rail percentage moves and hands back each
 * step's duration once it finished.
 */
export class RunTracker {
  private cur: Tracked | null = null;

  reset(): void {
    this.cur = null;
  }

  /**
   * A rail-percentage update of `step`. Returns the record of the step that
   * just ended when the run moved on to another one.
   */
  note(step: RunStepKey, pct: number, now: number, workers: number): { step: RunStepKey; record: StepRecord } | null {
    let ended: { step: RunStepKey; record: StepRecord } | null = null;
    if (this.cur && this.cur.step !== step) ended = this.finish(now);
    if (!this.cur) {
      this.cur = { step, startedAt: now, pct: 0, samples: [{ t: now, current: 0 }], workerMs: 0, lastT: now, lastWorkers: workers };
    }
    const c = this.cur;
    c.workerMs += (now - c.lastT) * c.lastWorkers;
    c.lastT = now;
    c.lastWorkers = workers;
    // The rail only grows within a step; a repaint that mounts a fresh card
    // reports 0 for a moment — that is not progress lost.
    if (pct > c.pct) {
      c.pct = Math.min(100, pct);
      c.samples.push({ t: now, current: c.pct });
      pruneSamples(c.samples, now, RATE_WINDOW_MS);
    }
    return ended;
  }

  /** End the running step; its record when it got far enough to count. */
  finish(now: number): { step: RunStepKey; record: StepRecord } | null {
    const c = this.cur;
    this.cur = null;
    if (!c) return null;
    const ms = now - c.startedAt;
    if (c.pct < FINISHED_MIN_PCT || ms <= 0) return null;
    const workerMs = c.workerMs + (now - c.lastT) * c.lastWorkers;
    return { step: c.step, record: { ms, workers: Math.max(1, workerMs / ms) } };
  }

  running(): RunningStep | null {
    const c = this.cur;
    return c ? { step: c.step, startedAt: c.startedAt, pct: c.pct, samples: c.samples } : null;
  }
}

/** Read a stored history, dropping anything malformed. */
export function parseHistory(raw: unknown): StepHistory {
  const out: StepHistory = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of RUN_STEP_KEYS) {
    const r = (raw as Record<string, unknown>)[key] as Partial<StepRecord> | undefined;
    if (r && typeof r.ms === 'number' && Number.isFinite(r.ms) && r.ms > 0 && typeof r.workers === 'number' && r.workers >= 1) {
      out[key] = { ms: r.ms, workers: r.workers };
    }
  }
  return out;
}
