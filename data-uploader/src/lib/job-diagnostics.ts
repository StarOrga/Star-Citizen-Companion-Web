/**
 * Warnings + errors a native job (P4K extraction / skin export) wrote into
 * its log stream, collected per job and reported ONCE when the job ends.
 *
 * WHY
 *   The run view shows every `[warn]` / `[err]` line the sidecar emits, and
 *   the operator reads them — but nobody else ever did. A crash reached the
 *   dashboard, an abort reached the dashboard, a run that *finished* with
 *   twelve warnings about unreadable records reached nobody. The admin
 *   telemetry page now lists these runs, with the lines, and turns one into
 *   a feedback topic with the log attached.
 *
 * WIRE
 *   Rides the signed `crash` batch under its own `errorType` — exactly like
 *   extraction aborts — so the ingest function needs no change. The lines go
 *   in `stack` (the one free-text field long enough; the server clamps it at
 *   8000 chars), the counts and the run context in `extra`. The admin read
 *   RPC splits this bucket out of the crash aggregates
 *   (`telemetry_uploader_diagnostics` migration).
 *
 * PRIVACY
 *   The sidecar prints paths. An install path can carry the operator's user
 *   name (`C:\Users\<name>\…`), which is the one thing in a log line that is
 *   personal, so the home segment is masked before anything leaves the
 *   machine. Everything else in a line is about the archive, not the person.
 *
 * Pure: no Electron, no clock of its own — unit-testable like `telemetry.ts`.
 */

import type { CrashInput } from './telemetry.js';

/** Server-side bucket (`telemetry_events.error_type`) for log diagnostics. */
export const JOB_DIAGNOSTICS_ERROR_TYPE = 'job-diagnostics';

/** Server-side `error_name` — the label the dashboard shows. */
export const JOB_DIAGNOSTICS_NAME = 'JobDiagnostics';

/** Only these two levels are worth a telemetry row; info is noise. */
export type DiagnosticLevel = 'warn' | 'error';

export interface DiagnosticLine {
  level: DiagnosticLevel;
  message: string;
  /** Milliseconds since the job started — a relative clock is all a reader needs. */
  atMs: number;
}

/** The subset of a sidecar event this collector looks at. */
export interface DiagnosticEvent {
  type: string;
  level?: string;
  message?: string;
}

/**
 * Hard cap on lines kept per job. A pathological run can print a warning per
 * record — tens of thousands — and the row would be clamped to 8000 chars
 * anyway. Past the cap the collector counts instead of keeping.
 */
export const MAX_DIAGNOSTIC_LINES = 400;

/** What `error_stack` may carry — mirrors the ingest function's clamp. */
const MAX_TRANSCRIPT_CHARS = 8000;

/** Per-line ceiling: one runaway line must not eat the whole transcript. */
const MAX_LINE_CHARS = 400;

export interface JobDiagnostics {
  lines: DiagnosticLine[];
  /** Lines that arrived after `MAX_DIAGNOSTIC_LINES` — counted, not kept. */
  dropped: number;
}

export function newJobDiagnostics(): JobDiagnostics {
  return { lines: [], dropped: 0 };
}

/**
 * Map a sidecar event onto a diagnostic level, or null for everything that is
 * not a warning or an error (progress, phases, info logs, the final result).
 */
export function diagnosticLevelOf(ev: DiagnosticEvent): DiagnosticLevel | null {
  if (ev.type === 'warning') return 'warn';
  if (ev.type === 'error') return 'error';
  if (ev.type === 'log') {
    if (ev.level === 'warn') return 'warn';
    if (ev.level === 'error') return 'error';
  }
  return null;
}

/**
 * Feed one sidecar event into the collector. Cheap for the ~99 % of events
 * that are not diagnostics, so it can sit on the hot event path.
 */
export function collectDiagnostic(diag: JobDiagnostics, ev: DiagnosticEvent, atMs: number): void {
  const level = diagnosticLevelOf(ev);
  if (!level) return;
  if (diag.lines.length >= MAX_DIAGNOSTIC_LINES) {
    diag.dropped += 1;
    return;
  }
  diag.lines.push({
    level,
    message: redactHome(String(ev.message ?? '')).slice(0, MAX_LINE_CHARS),
    atMs: Math.max(0, Math.round(atMs)),
  });
}

/**
 * Mask the user's home directory in a path. Matches the Windows profile
 * folder and the macOS / Linux home root; the user name is replaced, the rest
 * of the path (which says WHAT went wrong) stays readable.
 */
export function redactHome(text: string): string {
  return text
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s]+/g, '$1<user>')
    .replace(/(\/(?:Users|home)\/)[^/\s]+/g, '$1<user>');
}

/** How the job ended — the reader wants to know whether the warnings mattered. */
export type JobOutcome = 'ok' | 'failed' | 'cancelled' | 'quit';

export interface JobDiagnosticsContext {
  /** 'extract' | 'skin' — which sidecar. */
  kind: string;
  /** Internal run id — correlates with the abort row and the log file. */
  jobId: string;
  outcome: JobOutcome;
  /** Last phase the sidecar reported. */
  phase?: string | null;
  /** Last percentage the sidecar reported (0..100). */
  pct?: number | null;
  /** Run duration at the time of the report. */
  elapsedMs?: number | null;
  /** Game channel + patch the extraction was for (LIVE 4.2.1 …). */
  channel?: string | null;
  patchVersion?: string | null;
}

function fmtOffset(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Render the collected lines as the transcript the row carries. Keeps the
 * HEAD and the TAIL when the whole thing does not fit: the first warnings say
 * where trouble started, the last ones say how it ended, and the middle of a
 * long run is usually the same line repeated.
 */
export function formatTranscript(diag: JobDiagnostics, max = MAX_TRANSCRIPT_CHARS): string {
  const rendered = diag.lines.map(
    (l) => `+${fmtOffset(l.atMs)} [${l.level === 'error' ? 'err' : 'warn'}] ${l.message}`,
  );
  if (diag.dropped > 0) rendered.push(`… ${diag.dropped} more line(s) not kept …`);
  const full = rendered.join('\n');
  if (full.length <= max) return full;

  const head: string[] = [];
  const tail: string[] = [];
  let budget = max - 40; // room for the omission marker
  let i = 0;
  let j = rendered.length - 1;
  // Alternate head/tail so both ends get roughly half of the budget.
  while (i <= j) {
    const fromHead = head.length <= tail.length;
    const line = fromHead ? rendered[i] : rendered[j];
    if (line.length + 1 > budget) break;
    budget -= line.length + 1;
    if (fromHead) {
      head.push(line);
      i += 1;
    } else {
      tail.unshift(line);
      j -= 1;
    }
  }
  const omitted = j - i + 1;
  return [...head, `… ${omitted} line(s) omitted …`, ...tail].join('\n');
}

/**
 * Build the crash-wire event for a finished job, or null when the job logged
 * nothing worth reporting — a clean run must not produce a row.
 */
export function buildJobDiagnostics(
  diag: JobDiagnostics,
  ctx: JobDiagnosticsContext,
): CrashInput | null {
  const total = diag.lines.length + diag.dropped;
  if (total === 0) return null;
  const warnings = diag.lines.filter((l) => l.level === 'warn').length;
  const errors = diag.lines.filter((l) => l.level === 'error').length;
  return {
    errorType: JOB_DIAGNOSTICS_ERROR_TYPE,
    name: JOB_DIAGNOSTICS_NAME,
    message:
      `${ctx.kind} finished (${ctx.outcome}) with ${warnings} warning(s), ${errors} error(s)` +
      (diag.dropped > 0 ? ` (+${diag.dropped} not kept)` : ''),
    stack: formatTranscript(diag),
    extra: {
      kind: ctx.kind,
      jobId: ctx.jobId,
      outcome: ctx.outcome,
      warnings,
      errors,
      dropped: diag.dropped,
      phase: ctx.phase ?? null,
      pct: typeof ctx.pct === 'number' && Number.isFinite(ctx.pct) ? Math.round(ctx.pct) : null,
      elapsedMs:
        typeof ctx.elapsedMs === 'number' && Number.isFinite(ctx.elapsedMs)
          ? Math.max(0, Math.round(ctx.elapsedMs))
          : null,
      channel: ctx.channel ?? null,
      patchVersion: ctx.patchVersion ?? null,
    },
  };
}
