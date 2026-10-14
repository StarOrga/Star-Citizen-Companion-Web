/**
 * Glue between the run and the performance dock's duration figures.
 *
 * Feeds the step rail's percentage into a {@link RunTracker}, stores each
 * finished step's duration (per viewer, `localStorage`) and hands the dock a
 * fresh {@link estimateRun} on every rail move and every few seconds — the
 * live pace decays while nothing moves, so the figure must be re-read even
 * without events. The maths lives in `lib/run-estimate.ts`.
 */

import {
  RUN_STEP_KEYS,
  RunTracker,
  estimateRun,
  parseHistory,
  type RunStepKey,
  type StepHistory,
  type StepRecord,
} from '../lib/run-estimate.js';
import { dockWorkers, setRunEstimate } from './resource-dock.js';

const HISTORY_KEY = 'sc.runEstimate.steps';
const TICK_MS = 5000;
/** Rail events can come many times a second; the figure is re-read at most this often. */
const PUBLISH_MIN_MS = 1000;

const tracker = new RunTracker();
let planned: () => RunStepKey[] = () => [...RUN_STEP_KEYS];
let isRunning: () => boolean = () => false;
let timer: number | null = null;
/** Ticks in a row that saw no work going — a pause, a failure, an abort. */
let idleTicks = 0;
let lastPublish = 0;
let history: StepHistory | null = null;

function isRunStep(step: string): step is RunStepKey {
  return (RUN_STEP_KEYS as readonly string[]).includes(step);
}

function loadHistory(): StepHistory {
  if (history) return history;
  try {
    history = parseHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? 'null'));
  } catch {
    history = {};
  }
  return history;
}

function saveStep(ended: { step: RunStepKey; record: StepRecord } | null): void {
  if (!ended) return;
  history = { ...loadHistory(), [ended.step]: ended.record };
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* per-viewer convenience only */
  }
}

function publish(): void {
  lastPublish = Date.now();
  const workers = dockWorkers();
  if (workers === null) {
    setRunEstimate(null);
    return;
  }
  const current = isRunning() ? tracker.running() : null;
  const plan = planned();
  const upcoming = current
    ? plan.filter((s) => RUN_STEP_KEYS.indexOf(s) > RUN_STEP_KEYS.indexOf(current.step))
    : plan;
  setRunEstimate(estimateRun({ now: Date.now(), current, upcoming, history: loadHistory(), workers }));
}

/** Re-read the figure while a run goes; an idle uploader keeps no timer (README "Idle behaviour"). */
function startTicker(): void {
  idleTicks = 0;
  if (timer === null) timer = window.setInterval(tick, TICK_MS);
}

function stopTicker(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

function tick(): void {
  // A step that sat still for a pause would record the pause as its duration —
  // after two quiet ticks the step is dropped and starts over on resume.
  if (isRunning()) idleTicks = 0;
  else if (++idleTicks >= 2) {
    tracker.reset();
    stopTicker();
  }
  publish();
}

/**
 * Wire once, after the dock is up. `plan` lists the steps a run would walk
 * (skipped subthemes left out); `running` says whether work is going now.
 */
export function initRunEta(plan: () => RunStepKey[], running: () => boolean): void {
  planned = plan;
  isRunning = running;
  publish();
}

/** A run starts — nothing of an earlier one carries over. */
export function beginRunEta(): void {
  tracker.reset();
  startTicker();
  publish();
}

/** The step rail moved: `pct` of `step` (any other view is ignored). */
export function noteRunEta(step: string, pct: number): void {
  if (!isRunStep(step) || !isRunning()) return;
  const ended = tracker.note(step, pct, Date.now(), dockWorkers() ?? 1);
  saveStep(ended);
  startTicker();
  if (ended || Date.now() - lastPublish >= PUBLISH_MIN_MS) publish();
}

/** The run reached the Done step (`completed`) or went back to the start. */
export function endRunEta(completed: boolean): void {
  if (completed) saveStep(tracker.finish(Date.now()));
  else tracker.reset();
  stopTicker();
  publish();
}

/** The plan changed (a subtheme turned out current) — re-read the figure. */
export function refreshRunEta(): void {
  publish();
}
