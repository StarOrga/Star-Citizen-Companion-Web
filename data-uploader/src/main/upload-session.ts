/**
 * Main-process owner of the durable upload job + its pause signal.
 *
 * Division of labour: the **renderer** sequences the three upload stages
 * (bundle → catalog → skins, see `doUploadAfterAuth`), while **main** owns the
 * things that must outlive it — the on-disk cursor and the pause/cancel signal.
 * A renderer reload, a window close, or a hard `taskkill` therefore cannot lose
 * upload progress: the job file under `userData` is the single source of truth,
 * and the next launch simply reads it back and continues.
 *
 * The store is deliberately single-job: one machine uploads one extract at a
 * time, and keeping a history would only invite resuming a job whose out_dir
 * was already cleaned up.
 */

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import log from 'electron-log';
import {
  UploadJobStore,
  createJob,
  isResumable,
  describeResume,
  type TextIO,
  type UploadJobState,
  type JobNat,
} from '../lib/upload-job.js';
import {
  catalogHooks,
  skinHooks,
  type CatalogHookSet,
  type SkinHookSet,
} from '../lib/upload-hooks.js';
import { createPauseControl, type PauseControl, type RunSignal } from '../lib/pause-control.js';

const JOB_FILE = 'upload-job.json';

let _store: UploadJobStore | null = null;
let _control: PauseControl | null = null;

function store(): UploadJobStore {
  if (_store) return _store;
  const path = join(app.getPath('userData'), JOB_FILE);
  const io: TextIO = {
    read: () => (existsSync(path) ? readFileSync(path, 'utf-8') : null),
    write: (text) => writeFileSync(path, text, { encoding: 'utf-8', mode: 0o600 }),
    remove: () => {
      if (existsSync(path)) rmSync(path, { force: true });
    },
  };
  _store = new UploadJobStore(io);
  return _store;
}

/** The live pause control for the current run (created on demand). */
export function control(): PauseControl {
  if (!_control) _control = createPauseControl('running');
  return _control;
}

export interface JobView {
  state: UploadJobState | null;
  resumable: boolean;
  signal: RunSignal;
  /** Short human summary of where a resume would pick up. */
  resumeHint: string | null;
}

export function view(): JobView {
  const state = store().load();
  return {
    state,
    resumable: isResumable(state),
    signal: control().state(),
    resumeHint: state && isResumable(state) ? describeResume(state) : null,
  };
}

/**
 * Start a job for `outDir`, or adopt the stored one when it targets the same
 * extract. Adopting is what makes "close the app, reopen, continue" work; a
 * different out_dir means the operator moved on, so the old job is dropped.
 */
export function begin(outDir: string, nat: JobNat): UploadJobState {
  const existing = store().load();
  if (existing && existing.outDir === outDir && isResumable(existing)) {
    log.info(`[upload-job] resuming ${existing.jobId} at ${describeResume(existing)}`);
    _control = createPauseControl('running');
    return store().save({ ...existing, status: 'running', error: null })!;
  }
  const fresh = createJob(randomUUID(), outDir, nat, Date.now());
  _control = createPauseControl('running');
  log.info(`[upload-job] new job ${fresh.jobId} for ${outDir}`);
  return store().save(fresh);
}

export function get(): UploadJobState | null {
  return store().load();
}

export function update(fn: (s: UploadJobState) => UploadJobState): UploadJobState | null {
  return store().update(fn);
}

/** Resume wiring for the catalog stage, bound to this job + pause signal. */
export function hooksForCatalog(): CatalogHookSet {
  return catalogHooks(store(), control());
}

/** Resume wiring for the skin stage. */
export function hooksForSkins(): SkinHookSet {
  return skinHooks(store(), control());
}

export function pause(): JobView {
  control().pause();
  update((s) => ({ ...s, status: 'paused' }));
  log.info('[upload-job] pause requested');
  return view();
}

/** Clear the pause signal so the renderer can re-drive the stages. */
export function resume(): JobView {
  _control = createPauseControl('running');
  update((s) => ({ ...s, status: 'running', error: null }));
  log.info('[upload-job] resume requested');
  return view();
}

/** Abandon the job entirely — the operator does not want it continued. */
export function cancel(): JobView {
  control().cancel();
  store().clear();
  log.info('[upload-job] cancelled + job state cleared');
  return { state: null, resumable: false, signal: 'cancelled', resumeHint: null };
}

/** Mark the whole run finished and drop the state file. */
export function finish(): void {
  store().clear();
  log.info('[upload-job] finished — job state cleared');
}

/** Record a hard failure so the next launch can offer a retry. */
export function fail(error: string): void {
  update((s) => ({ ...s, status: 'error', error }));
}
