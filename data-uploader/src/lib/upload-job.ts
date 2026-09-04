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

import { join } from 'node:path';
import {
  CATALOG_PHASE_TOTAL,
  catalogPhaseIndex,
  nextCatalogPhase,
} from './catalog-phases.js';

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

/**
 * A one-line, TECHNICAL summary of what a resume would pick up — for logs and
 * telemetry only (`catalog:codex_ships@1200`). The renderer builds a human,
 * localized banner from `resumeSummary` instead; keep the two in sync in spirit
 * but never show this raw string to an operator.
 */
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

/** One macro stage of an upload run, tagged with where a resume stands. */
export interface StageProgress {
  stage: MacroStage;
  state: 'done' | 'active' | 'pending';
}

export type MacroStage = 'bundle' | 'catalog' | 'skins';

/**
 * Structured, localization-ready picture of where an interrupted upload would
 * resume — the data the renderer turns into a human banner and uses to seed the
 * progress card straight at the resume point (no rewind-from-zero flash).
 *
 * Deliberately machine-readable (numbers + enums, no prose): main computes it
 * from the durable job, IPC hands it to the renderer verbatim, and only the
 * renderer knows the operator's language.
 */
export interface ResumeSummary {
  /** All three macro stages, in execution order, each done / active / pending. */
  stages: StageProgress[];
  /** The stage a resume re-enters, or null when the job is already complete. */
  activeStage: MacroStage | null;
  /** 1-based macro position of the active stage (bundle = 1 … skins = 3). */
  macroStep: number | null;
  /** How many macro stages there are (always 3) — the "/ N" of the macro line. */
  macroTotal: number;
  /** Present when the active stage is `catalog`: where in the publish order it resumes. */
  catalog?: { step: number; total: number; phase: string };
  /** Present when the active stage is `skins`: how many ships already committed. */
  skinsDone?: number;
}

/** Macro stages in the exact order the renderer sequences them. */
export const MACRO_STAGES: MacroStage[] = ['bundle', 'catalog', 'skins'];

/**
 * Turn a durable job into the structured resume picture above. Pure: no I/O, so
 * both the main-process job view and the tests read the same result.
 */
export function resumeSummary(s: UploadJobState): ResumeSummary {
  const active = nextStage(s);
  const stages: StageProgress[] = MACRO_STAGES.map((stage) => ({
    stage,
    state: s[stage].status === 'done' ? 'done' : stage === active ? 'active' : 'pending',
  }));
  const summary: ResumeSummary = {
    stages,
    activeStage: active,
    macroStep: active ? MACRO_STAGES.indexOf(active) + 1 : null,
    macroTotal: MACRO_STAGES.length,
  };
  if (active === 'catalog') {
    // A live cursor is the exact resume point; without one (catalog is next but
    // no chunk was mid-flight) fall back to the first data phase not yet sent.
    const phase =
      s.catalog.cursor?.phase ?? nextCatalogPhase(s.catalog.donePhases) ?? 'codex_manufacturers';
    summary.catalog = {
      step: catalogPhaseIndex(phase) ?? 2,
      total: CATALOG_PHASE_TOTAL,
      phase,
    };
  }
  if (active === 'skins') {
    summary.skinsDone = s.skins.doneShips.length;
  }
  return summary;
}

/**
 * The extractor's result payload, in the shape the renderer's upload flow
 * consumes (`ExtractResultPayload`). The renderer only ever received it from a
 * finished extraction — which meant that after a restart it had none, and its
 * resume path silently did nothing. A resume therefore rebuilds it from the
 * durable job plus the extract's own `manifest.json`.
 */
export interface ResumeExtractResult {
  channel: string;
  patch_version: string;
  build_number: string;
  schema_version: number;
  quality_score: number;
  entity_counts: Record<string, number>;
  manifest_path: string;
  output_dir: string;
  tool_version: string;
}

/** Injectable read-only file access, so the rebuild unit-tests without a disk. */
export interface ExtractIO {
  exists(path: string): boolean;
  /** File text, or null when the file is missing or unreadable. */
  readText(path: string): string | null;
}

export type RehydrateResult =
  | { ok: true; result: ResumeExtractResult }
  | { ok: false; error: 'no_job' | 'out_dir_missing' | 'manifest_missing' };

export const MANIFEST_FILE = 'manifest.json';

/**
 * Rebuild the extraction result a resume needs from the stored job.
 *
 * The job carries what identifies the extract (out dir + channel/version); the
 * manifest the extractor wrote into that dir carries the rest (schema, quality
 * score, counts). A missing dir or manifest is reported as such rather than
 * papered over: the bundle stage would otherwise POST zeros, and the catalog
 * stage has nothing to read — the operator has to re-extract, and must be told.
 */
export function rehydrateResult(s: UploadJobState | null, io: ExtractIO): RehydrateResult {
  if (!isResumable(s)) return { ok: false, error: 'no_job' };
  if (!io.exists(s.outDir)) return { ok: false, error: 'out_dir_missing' };
  const manifestPath = join(s.outDir, MANIFEST_FILE);
  let manifest: Record<string, unknown> | null = null;
  const raw = io.readText(manifestPath);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') manifest = parsed as Record<string, unknown>;
    } catch {
      manifest = null;
    }
  }
  if (!manifest) return { ok: false, error: 'manifest_missing' };

  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const counts: Record<string, number> = {};
  if (manifest.entity_counts && typeof manifest.entity_counts === 'object') {
    for (const [k, v] of Object.entries(manifest.entity_counts as Record<string, unknown>)) {
      if (typeof v === 'number') counts[k] = v;
    }
  }
  return {
    ok: true,
    result: {
      channel: s.nat.channel,
      patch_version: s.nat.patchVersion,
      build_number: s.nat.buildNumber,
      schema_version: num(manifest.schema_version),
      quality_score: num(manifest.quality_score),
      entity_counts: counts,
      manifest_path: manifestPath,
      output_dir: s.outDir,
      tool_version: typeof manifest.tool_version === 'string' ? manifest.tool_version : '',
    },
  };
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
