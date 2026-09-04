import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  UploadJobStore,
  createJob,
  nextStage,
  isResumable,
  bundleNeedsRetry,
  sentFor,
  describeResume,
  resumeSummary,
  rehydrateResult,
  MANIFEST_FILE,
  type ExtractIO,
  type TextIO,
  type UploadJobState,
} from '../src/lib/upload-job.js';

function fakeIO(): TextIO & { peek: () => string | null } {
  let data: string | null = null;
  return {
    read: () => data,
    write: (t) => {
      data = t;
    },
    remove: () => {
      data = null;
    },
    peek: () => data,
  };
}

const NAT = { channel: 'LIVE', patchVersion: '4.0.0', buildNumber: '9999' };
const job = (): UploadJobState => createJob('job-1', 'C:/out/live', NAT, 1000);

/**
 * The resume-after-restart contract. The renderer's extraction result lives only
 * in memory, so a resume in a fresh process must rebuild it from the job file +
 * the extract's manifest — or say clearly that the extract is gone.
 */
describe('rehydrateResult', () => {
  const OUT = 'C:/out/live';
  const MANIFEST = join(OUT, MANIFEST_FILE);
  const manifestText = JSON.stringify({
    channel: 'LIVE',
    patch_version: '4.0.0',
    schema_version: 2,
    quality_score: 97.5,
    entity_counts: { ships: 3, weapons: 12, bogus: 'x' },
    tool_version: '0.25.0',
  });
  const disk = (files: Record<string, string>, dirs: string[] = [OUT]): ExtractIO => ({
    exists: (p) => dirs.includes(p) || p in files,
    readText: (p) => files[p] ?? null,
  });
  const paused = (): UploadJobState => {
    const s = job();
    s.status = 'paused';
    s.bundle = { status: 'done', bundleId: 'b-1', attempted: true };
    s.catalog.status = 'running';
    return s;
  };

  it('rebuilds the extraction result from the job + manifest after a restart', () => {
    const r = rehydrateResult(paused(), disk({ [MANIFEST]: manifestText }));
    expect(r).toEqual({
      ok: true,
      result: {
        channel: 'LIVE',
        patch_version: '4.0.0',
        build_number: '9999',
        schema_version: 2,
        quality_score: 97.5,
        entity_counts: { ships: 3, weapons: 12 },
        manifest_path: MANIFEST,
        output_dir: OUT,
        tool_version: '0.25.0',
      },
    });
  });

  it('reports a missing extract dir instead of pretending to resume', () => {
    const r = rehydrateResult(paused(), disk({}, []));
    expect(r).toEqual({ ok: false, error: 'out_dir_missing' });
  });

  it('reports a missing or corrupt manifest', () => {
    expect(rehydrateResult(paused(), disk({}))).toEqual({ ok: false, error: 'manifest_missing' });
    expect(rehydrateResult(paused(), disk({ [MANIFEST]: '{not json' }))).toEqual({
      ok: false,
      error: 'manifest_missing',
    });
  });

  it('has nothing to rebuild without a resumable job', () => {
    expect(rehydrateResult(null, disk({ [MANIFEST]: manifestText }))).toEqual({
      ok: false,
      error: 'no_job',
    });
    const done = job();
    done.status = 'done';
    expect(rehydrateResult(done, disk({ [MANIFEST]: manifestText }))).toEqual({
      ok: false,
      error: 'no_job',
    });
  });

  it('tolerates a manifest with the numeric fields missing', () => {
    const r = rehydrateResult(paused(), disk({ [MANIFEST]: '{}' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.schema_version).toBe(0);
      expect(r.result.quality_score).toBe(0);
      expect(r.result.entity_counts).toEqual({});
      expect(r.result.tool_version).toBe('');
    }
  });
});

describe('nextStage', () => {
  it('walks bundle → catalog → skins → null in order', () => {
    const s = job();
    expect(nextStage(s)).toBe('bundle');
    s.bundle.status = 'done';
    expect(nextStage(s)).toBe('catalog');
    s.catalog.status = 'done';
    expect(nextStage(s)).toBe('skins');
    s.skins.status = 'done';
    expect(nextStage(s)).toBeNull();
  });

  it('re-enters a stage that was only half-done', () => {
    const s = job();
    s.bundle.status = 'done';
    s.catalog.status = 'running';
    expect(nextStage(s)).toBe('catalog');
  });
});

describe('isResumable', () => {
  it('resumes a job left `running` — that is the killed-mid-upload case', () => {
    // A clean pause writes 'paused' and a clean finish writes 'done', so a
    // stored 'running' job can only mean the process died before it could
    // write a terminal status. That job MUST be offered for resume.
    const s = job();
    s.status = 'running';
    expect(isResumable(s)).toBe(true);
  });

  it('resumes a paused job', () => {
    const s = { ...job(), status: 'paused' as const };
    expect(isResumable(s)).toBe(true);
  });

  it('does not resume a finished job', () => {
    const s = job();
    s.status = 'done';
    expect(isResumable(s)).toBe(false);
  });

  it('does not resume a job whose stages are all complete', () => {
    const s = job();
    s.bundle.status = 'done';
    s.catalog.status = 'done';
    s.skins.status = 'done';
    expect(isResumable(s)).toBe(false);
  });

  it('handles a missing job', () => {
    expect(isResumable(null)).toBe(false);
  });
});

describe('bundleNeedsRetry', () => {
  it('flags a POST that was issued but never confirmed', () => {
    const s = job();
    s.bundle = { status: 'running', attempted: true };
    expect(bundleNeedsRetry(s)).toBe(true);
  });

  it('does not flag a confirmed bundle', () => {
    const s = job();
    s.bundle = { status: 'done', attempted: true, bundleId: 'b1' };
    expect(bundleNeedsRetry(s)).toBe(false);
  });

  it('does not flag a bundle that was never attempted', () => {
    expect(bundleNeedsRetry(job())).toBe(false);
  });
});

describe('sentFor', () => {
  it('reports 0 for a phase never started', () => {
    expect(sentFor(job(), 'codex_ships')).toBe(0);
  });

  it('reports the cursor for the phase in flight', () => {
    const s = job();
    s.catalog.cursor = { phase: 'codex_ships', sent: 1500 };
    expect(sentFor(s, 'codex_ships')).toBe(1500);
  });

  it('ignores a cursor belonging to a different phase', () => {
    const s = job();
    s.catalog.cursor = { phase: 'codex_items', sent: 500 };
    expect(sentFor(s, 'codex_ships')).toBe(0);
  });

  it('reports Infinity for a completed phase so it is skipped entirely', () => {
    const s = job();
    s.catalog.donePhases = ['codex_ships'];
    expect(sentFor(s, 'codex_ships')).toBe(Number.POSITIVE_INFINITY);
  });

  it('prefers done over a stale cursor for the same phase', () => {
    const s = job();
    s.catalog.donePhases = ['codex_ships'];
    s.catalog.cursor = { phase: 'codex_ships', sent: 10 };
    expect(sentFor(s, 'codex_ships')).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('describeResume', () => {
  it('describes a mid-phase catalog resume', () => {
    const s = job();
    s.bundle.status = 'done';
    s.catalog.cursor = { phase: 'codex_locale_strings', sent: 4000 };
    expect(describeResume(s)).toBe('catalog:codex_locale_strings@4000');
  });

  it('describes a partial skin resume', () => {
    const s = job();
    s.bundle.status = 'done';
    s.catalog.status = 'done';
    s.skins.doneShips = ['aurora', 'gladius'];
    expect(describeResume(s)).toBe('skins:2 ships done');
  });

  it('describes a complete job', () => {
    const s = job();
    s.bundle.status = 'done';
    s.catalog.status = 'done';
    s.skins.status = 'done';
    expect(describeResume(s)).toBe('complete');
  });
});

describe('resumeSummary', () => {
  it('a fresh job resumes at the bundle stage (macro 1 / 3)', () => {
    const sum = resumeSummary(job());
    expect(sum.activeStage).toBe('bundle');
    expect(sum.macroStep).toBe(1);
    expect(sum.macroTotal).toBe(3);
    expect(sum.stages.map((s) => s.state)).toEqual(['active', 'pending', 'pending']);
    expect(sum.catalog).toBeUndefined();
    expect(sum.skinsDone).toBeUndefined();
  });

  it('maps a mid-phase catalog cursor to its human step number', () => {
    const s = job();
    s.bundle.status = 'done';
    s.catalog.status = 'running';
    s.catalog.cursor = { phase: 'codex_ships', sent: 1200 };
    const sum = resumeSummary(s);
    expect(sum.activeStage).toBe('catalog');
    expect(sum.macroStep).toBe(2);
    expect(sum.stages.map((s) => s.state)).toEqual(['done', 'active', 'pending']);
    // codex_ships is the 3rd of the 15 publish phases — the SAME number the live
    // bar shows, so banner and bar agree.
    expect(sum.catalog).toEqual({ step: 3, total: 15, phase: 'codex_ships' });
  });

  it('falls back to the next unsent phase when catalog has no live cursor', () => {
    const s = job();
    s.bundle.status = 'done';
    s.catalog.status = 'running';
    s.catalog.donePhases = ['codex_manufacturers', 'codex_ships'];
    s.catalog.cursor = null;
    const sum = resumeSummary(s);
    // codex_weapons is next after the two done phases — step 4 of 15.
    expect(sum.catalog).toEqual({ step: 4, total: 15, phase: 'codex_weapons' });
  });

  it('reports committed ships for a skin-stage resume (macro 3 / 3)', () => {
    const s = job();
    s.bundle.status = 'done';
    s.catalog.status = 'done';
    s.skins.doneShips = ['aurora', 'gladius'];
    const sum = resumeSummary(s);
    expect(sum.activeStage).toBe('skins');
    expect(sum.macroStep).toBe(3);
    expect(sum.stages.map((s) => s.state)).toEqual(['done', 'done', 'active']);
    expect(sum.skinsDone).toBe(2);
  });

  it('reports no active stage for a fully-complete job', () => {
    const s = job();
    s.bundle.status = 'done';
    s.catalog.status = 'done';
    s.skins.status = 'done';
    const sum = resumeSummary(s);
    expect(sum.activeStage).toBeNull();
    expect(sum.macroStep).toBeNull();
    expect(sum.stages.map((s) => s.state)).toEqual(['done', 'done', 'done']);
  });
});

describe('UploadJobStore', () => {
  it('returns null when nothing is stored', () => {
    expect(new UploadJobStore(fakeIO()).load()).toBeNull();
  });

  it('round-trips a job', () => {
    const store = new UploadJobStore(fakeIO(), () => 2000);
    store.save(job());
    const back = store.load();
    expect(back?.jobId).toBe('job-1');
    expect(back?.outDir).toBe('C:/out/live');
    expect(back?.nat).toEqual(NAT);
  });

  it('stamps updatedAt on every save', () => {
    const store = new UploadJobStore(fakeIO(), () => 5555);
    expect(store.save(job()).updatedAt).toBe(5555);
  });

  it('preserves catalog cursors + done phases across a reload (the kill case)', () => {
    const io = fakeIO();
    const s = job();
    s.catalog = {
      status: 'running',
      buildId: 'build-7',
      donePhases: ['codex_ships', 'codex_weapons'],
      cursor: { phase: 'codex_items', sent: 2000 },
    };
    new UploadJobStore(io).save(s);
    // A fresh store === a fresh process reading the file after a kill.
    const reloaded = new UploadJobStore(io).load();
    expect(reloaded?.catalog.buildId).toBe('build-7');
    expect(reloaded?.catalog.donePhases).toEqual(['codex_ships', 'codex_weapons']);
    expect(reloaded?.catalog.cursor).toEqual({ phase: 'codex_items', sent: 2000 });
    expect(isResumable(reloaded)).toBe(true);
  });

  it('preserves committed ships across a reload', () => {
    const io = fakeIO();
    const s = job();
    s.skins = { status: 'running', doneShips: ['aurora'] };
    new UploadJobStore(io).save(s);
    expect(new UploadJobStore(io).load()?.skins.doneShips).toEqual(['aurora']);
  });

  it('updates via read-modify-write', () => {
    const store = new UploadJobStore(fakeIO());
    store.save(job());
    store.update((s) => ({ ...s, bundle: { status: 'done', bundleId: 'b9' } }));
    expect(store.load()?.bundle).toEqual({ status: 'done', bundleId: 'b9' });
  });

  it('update is a no-op when no job exists', () => {
    const store = new UploadJobStore(fakeIO());
    expect(store.update((s) => s)).toBeNull();
  });

  it('drops a job written by an incompatible schema', () => {
    // Cursors from an older layout may mean something different; resuming on
    // them could corrupt a build, so the job is discarded instead.
    const io = fakeIO();
    io.write(JSON.stringify({ ...job(), v: 999 }));
    expect(new UploadJobStore(io).load()).toBeNull();
  });

  it('drops a job missing its out_dir — there is nothing to resume against', () => {
    const io = fakeIO();
    io.write(JSON.stringify({ ...job(), outDir: undefined }));
    expect(new UploadJobStore(io).load()).toBeNull();
  });

  it('falls back to null on corrupt JSON', () => {
    const io = fakeIO();
    io.write('{half-written');
    expect(new UploadJobStore(io).load()).toBeNull();
  });

  it('tolerates a truncated job object (partial write before a kill)', () => {
    const io = fakeIO();
    io.write(JSON.stringify({ v: 1, jobId: 'j', outDir: 'C:/out', nat: NAT }));
    const s = new UploadJobStore(io).load();
    expect(s?.catalog.donePhases).toEqual([]);
    expect(s?.skins.doneShips).toEqual([]);
    expect(nextStage(s!)).toBe('bundle');
  });

  it('clears stored state', () => {
    const io = fakeIO();
    const store = new UploadJobStore(io);
    store.save(job());
    store.clear();
    expect(io.peek()).toBeNull();
    expect(store.load()).toBeNull();
  });

  it('never throws when persistence fails', () => {
    // A read-only profile must degrade resume, not break an upload in flight.
    const io: TextIO = {
      read: () => null,
      write: () => {
        throw new Error('EACCES');
      },
      remove: () => {
        throw new Error('EACCES');
      },
    };
    const store = new UploadJobStore(io);
    expect(() => store.save(job())).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });
});
