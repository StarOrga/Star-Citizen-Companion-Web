/**
 * Durable upload-job state — lets an upload resume after a pause OR after the
 * process is closed/killed mid-run.
 *
 * One upload run is three sequential stages against the server:
 *
 *   bundle  → one atomic POST to `ingest-bundle`
 *   catalog → init → ~14 phases of chunked upserts → finalize (`ingest-catalog`)
 *   skins   → per-ship sign → PUT assets → commit (`ingest-skins`)
 *
 * Catalog and skins are the long poles (hundreds of requests, potentially
 * GBs), so both are checkpointed at chunk / per-ship granularity. Every
 * checkpoint is flushed to disk *before* the network call it guards, so a hard
 * kill at any instant leaves a cursor that is at worst one unit behind reality —
 * never ahead of it. Re-sending one already-applied unit is harmless because
 * every server op here is an upsert (idempotent); skipping one would silently
 * corrupt the build, so lagging is the safe direction to round.
 *
 * Pure logic + injected I/O (mirrors `version-store` / `settings-store`) so the
 * whole resume model unit-tests without Electron or a network.
 */

export type StageStatus = 'pending' | 'running' | 'done';

export type JobStatus = 'running' | 'paused' | 'done' | 'error';

export interface JobNat {
  channel: string;
  patchVersion: string;
  buildNumber: string;
}

export interface BundleStage {
  status: StageStatus;
  /** Set once the server confirmed the bundle. */
  bundleId?: string | null;
  /**
   * True once a POST has been *issued* without a confirmed reply. A kill in
   * that window leaves us unable to know whether the row landed, so a resume
   * re-POSTs — see `bundleNeedsRetry`.
   */
  attempted?: boolean;
}

export interface CatalogStage {
  status: StageStatus;
  /** Server build row id, handed back by `init` — reused across resumes. */
  buildId?: string | null;
  /** Phases fully sent (`codex_ships`, …); skipped verbatim on resume. */
  donePhases: string[];
  /** Row offset already sent for the phase in flight, for mid-phase resume. */
  cursor?: { phase: string; sent: number } | null;
}

export interface SkinStage {
  status: StageStatus;
  /** Ship ids fully uploaded + committed. */
  doneShips: string[];
}

export interface UploadJobState {
  v: number;
  jobId: string;
  createdAt: number;
  updatedAt: number;
  status: JobStatus;
  /** Extractor output dir this job uploads — the job is meaningless without it. */
  outDir: string;
  nat: JobNat;
  bundle: BundleStage;
  catalog: CatalogStage;
  skins: SkinStage;
  error?: string | null;
}

/** Injectable text persistence (file-backed in production). */
export interface TextIO {
  read(): string | null;
  write(text: string): void;
  remove(): void;
}

export const SCHEMA_VERSION = 1;

export function createJob(
  jobId: string,
  outDir: string,
  nat: JobNat,
  now: number,
): UploadJobState {
  return {
    v: SCHEMA_VERSION,
    jobId,
    createdAt: now,
    updatedAt: now,
    status: 'running',
    outDir,
    nat,
    bundle: { status: 'pending' },
    catalog: { status: 'pending', donePhases: [], cursor: null },
    skins: { status: 'pending', doneShips: [] },
    error: null,
  };
}

/**
 * The stage a (re)start should enter, or null when everything is done.
 * Stages run strictly in order, so the first non-`done` one wins.
 */
export function nextStage(s: UploadJobState): 'bundle' | 'catalog' | 'skins' | null {
  if (s.bundle.status !== 'done') return 'bundle';
  if (s.catalog.status !== 'done') return 'catalog';
  if (s.skins.status !== 'done') return 'skins';
  return null;
}

/**
 * Whether a stored job can still be continued.
 *
 * `running` counts as resumable on purpose: a job only stays `running` on disk
 * if the process died before it could write a terminal status — that IS the
 * killed-mid-upload case this feature exists for. A clean pause writes
 * `paused`; a clean finish writes `done`.
 */
export function isResumable(s: UploadJobState | null): s is UploadJobState {
  if (!s) return false;
  if (s.status === 'done') return false;
  return nextStage(s) !== null;
}

/**
 * True when the bundle POST was issued but never confirmed — the one window
 * where we cannot know if the server applied it, so a resume must re-POST and
 * accept a possible `duplicate` reply (which the renderer already treats as a
 * known, non-fatal server code).
 */
export function bundleNeedsRetry(s: UploadJobState): boolean {
  return s.bundle.status !== 'done' && Boolean(s.bundle.attempted) && !s.bundle.bundleId;
}

/** Rows of `phase` already sent, for a mid-phase resume (0 when not in flight). */
export function sentFor(s: UploadJobState, phase: string): number {
  if (s.catalog.donePhases.includes(phase)) return Number.POSITIVE_INFINITY;
  return s.catalog.cursor?.phase === phase ? s.catalog.cursor.sent : 0;
}

/** A one-line, human-facing summary of what a resume would pick up. */
export function describeResume(s: UploadJobState): string {
  const stage = nextStage(s);
  if (!stage) return 'complete';
  if (stage === 'catalog' && s.catalog.cursor) {
    return `catalog:${s.catalog.cursor.phase}@${s.catalog.cursor.sent}`;
  }
  if (stage === 'skins' && s.skins.doneShips.length) {
    return `skins:${s.skins.doneShips.length} ships done`;
  }
  return stage;
}

export class UploadJobStore {
  constructor(
    private readonly io: TextIO,
    private readonly now: () => number = () => Date.now(),
  ) {}

  load(): UploadJobState | null {
    const raw = this.io.read();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<UploadJobState>;
      // A job from an older layout can't be resumed safely — its cursors may
      // mean something different. Dropping it costs one re-upload; honouring it
      // could corrupt a build.
      if (parsed.v !== SCHEMA_VERSION) return null;
      if (!parsed.jobId || !parsed.outDir || !parsed.nat) return null;
      return {
        v: SCHEMA_VERSION,
        jobId: parsed.jobId,
        createdAt: parsed.createdAt ?? 0,
        updatedAt: parsed.updatedAt ?? 0,
        status: parsed.status ?? 'running',
        outDir: parsed.outDir,
        nat: parsed.nat,
        bundle: parsed.bundle ?? { status: 'pending' },
        catalog: {
          status: parsed.catalog?.status ?? 'pending',
          buildId: parsed.catalog?.buildId ?? null,
          donePhases: parsed.catalog?.donePhases ?? [],
          cursor: parsed.catalog?.cursor ?? null,
        },
        skins: {
          status: parsed.skins?.status ?? 'pending',
          doneShips: parsed.skins?.doneShips ?? [],
        },
        error: parsed.error ?? null,
      };
    } catch {
      return null;
    }
  }

  save(state: UploadJobState): UploadJobState {
    const next: UploadJobState = { ...state, v: SCHEMA_VERSION, updatedAt: this.now() };
    try {
      this.io.write(JSON.stringify(next));
    } catch {
      // Best-effort: losing persistence degrades resume-after-kill, but must
      // never abort an upload that is otherwise succeeding.
    }
    return next;
  }

  /** Read-modify-write helper — the only way stages mutate the job. */
  update(fn: (s: UploadJobState) => UploadJobState): UploadJobState | null {
    const current = this.load();
    if (!current) return null;
    return this.save(fn(current));
  }

  clear(): void {
    try {
      this.io.remove();
    } catch {
      /* best-effort */
    }
  }
}
