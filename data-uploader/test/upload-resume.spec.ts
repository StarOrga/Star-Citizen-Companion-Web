/**
 * End-to-end resume contract for the catalog stage.
 *
 * Unit-testing the store and the pause control separately proves neither of the
 * things that actually matter: that a *killed* upload picks up where it left
 * off, and that it neither re-sends everything nor silently skips rows. So this
 * drives the REAL `uploadCatalog` against a stubbed server + a real job store,
 * kills it mid-phase, throws the in-memory state away, and resumes from disk —
 * the same code path the app takes after a `taskkill`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UploadJobStore, createJob, type TextIO } from '../src/lib/upload-job.js';
import { catalogHooks } from '../src/lib/upload-hooks.js';
import { createPauseControl, isInterrupt } from '../src/lib/pause-control.js';
import { uploadCatalog } from '../src/main/catalog-bridge.js';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Persists to a plain string, exactly like the real file does across a kill. */
function diskIO(): TextIO & { peek: () => string | null } {
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

let outDir: string;

/** A minimal but viable extract: enough ships/manufacturers to finalize. */
function makeOutDir(shipCount: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-resume-'));
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      channel: 'LIVE',
      patch_version: '4.0.0',
      build_number: '9999',
      schema_version: 1,
      entity_counts: {},
    }),
  );
  mkdirSync(join(dir, 'manufacturers'));
  writeFileSync(join(dir, 'manufacturers', 'aegs.json'), JSON.stringify({ className: 'AEGS', name: 'Aegis' }));
  mkdirSync(join(dir, 'ships'));
  for (let i = 0; i < shipCount; i++) {
    writeFileSync(
      join(dir, 'ships', `ship${i}.json`),
      JSON.stringify({ className: `SHIP_${i}`, name: `Ship ${i}`, manufacturer: 'AEGS' }),
    );
  }
  return dir;
}

interface Sent {
  op: string;
  table?: string;
  rows: number;
}

/** Stub server: records every op, hands back a stable build id. */
function stubFetch(sent: Sent[], onPost?: (s: Sent) => void): void {
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { op: string; table?: string; rows?: unknown[] };
    const rec: Sent = { op: body.op, table: body.table, rows: body.rows?.length ?? 0 };
    sent.push(rec);
    onPost?.(rec);
    return {
      ok: true,
      status: 200,
      json: async () => ({ build_id: 'build-fixed-1' }),
    };
  });
}

beforeEach(() => {
  outDir = makeOutDir(3);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(outDir, { recursive: true, force: true });
});

describe('catalog upload — resume after a kill', () => {
  it('completes in one run when never interrupted', async () => {
    const sent: Sent[] = [];
    stubFetch(sent);
    const io = diskIO();
    const store = new UploadJobStore(io);
    store.save(createJob('j1', outDir, { channel: 'LIVE', patchVersion: '4.0.0', buildNumber: '9999' }, 1));

    const res = await uploadCatalog('token', outDir, () => {}, catalogHooks(store, createPauseControl()));

    expect(res.ok).toBe(true);
    expect(res.buildId).toBe('build-fixed-1');
    expect(sent.some((s) => s.op === 'init')).toBe(true);
    expect(sent.some((s) => s.op === 'finalize')).toBe(true);
    expect(res.counts?.['ships']).toBe(3);
  });

  it('resumes from disk after a kill: reuses the build, skips sent phases, still finalizes', async () => {
    // --- run 1: die right after the ships phase --------------------------
    const sent1: Sent[] = [];
    const control = createPauseControl();
    stubFetch(sent1, (s) => {
      // Pause as soon as ships have gone out — mid-run, before the later phases.
      if (s.table === 'codex_ships') control.pause();
    });
    const io = diskIO();
    const store1 = new UploadJobStore(io);
    store1.save(createJob('j1', outDir, { channel: 'LIVE', patchVersion: '4.0.0', buildNumber: '9999' }, 1));

    await expect(
      uploadCatalog('token', outDir, () => {}, catalogHooks(store1, control)),
    ).rejects.toSatisfy(isInterrupt);

    const afterKill = store1.load();
    expect(afterKill?.catalog.buildId).toBe('build-fixed-1');
    expect(afterKill?.catalog.donePhases).toContain('codex_ships');
    const shipsSentRun1 = sent1.filter((s) => s.table === 'codex_ships').length;
    expect(shipsSentRun1).toBeGreaterThan(0);

    // --- run 2: a brand-new process reading only the file ------------------
    const sent2: Sent[] = [];
    stubFetch(sent2);
    const store2 = new UploadJobStore(io); // fresh instance === fresh process
    const res = await uploadCatalog('token', outDir, () => {}, catalogHooks(store2, createPauseControl()));

    expect(res.ok).toBe(true);
    // Reused the existing build row rather than orphaning the uploaded rows.
    expect(res.buildId).toBe('build-fixed-1');
    expect(sent2.some((s) => s.op === 'init')).toBe(false);
    // Did not re-send a phase that already landed…
    expect(sent2.filter((s) => s.table === 'codex_ships')).toHaveLength(0);
    // …but still finalized, and still counted the skipped phase's rows. If the
    // skipped phase reported 0, hasViableCatalog() would refuse to finalize a
    // build that was in fact fully uploaded.
    expect(res.counts?.['ships']).toBe(3);
    expect(sent2.some((s) => s.op === 'finalize')).toBe(true);
  });

  it('does not re-issue clear_ports when resuming mid-ports', async () => {
    // clear_ports wipes the build's port rows. Re-issuing it on a resume would
    // delete exactly the rows the interrupted run already paid to upload.
    const io = diskIO();
    const store = new UploadJobStore(io);
    const seed = createJob('j1', outDir, { channel: 'LIVE', patchVersion: '4.0.0', buildNumber: '9999' }, 1);
    // A ports cursor is only reachable once every earlier phase has landed —
    // seeding it without them would be a state the app can never produce (and
    // would wrongly clear the cursor as those phases "completed" again).
    seed.catalog = {
      status: 'running',
      buildId: 'build-fixed-1',
      donePhases: [
        'codex_manufacturers',
        'codex_ships',
        'codex_weapons',
        'codex_components',
        'codex_items',
        'codex_ammunition',
        'codex_blueprints',
        'codex_blueprint_ingredients',
        'codex_entity_strings',
      ],
      cursor: { phase: 'codex_item_ports', sent: 1 },
    };
    store.save(seed);

    const sent: Sent[] = [];
    stubFetch(sent);
    await uploadCatalog('token', outDir, () => {}, catalogHooks(store, createPauseControl()));

    expect(sent.some((s) => s.op === 'clear_ports')).toBe(false);
  });

  it('issues clear_ports on a clean (non-resumed) run', async () => {
    // The guard above must not disable the clear for a normal run — otherwise a
    // re-upload would stack duplicate port rows.
    const io = diskIO();
    const store = new UploadJobStore(io);
    store.save(createJob('j1', outDir, { channel: 'LIVE', patchVersion: '4.0.0', buildNumber: '9999' }, 1));

    const sent: Sent[] = [];
    stubFetch(sent);
    await uploadCatalog('token', outDir, () => {}, catalogHooks(store, createPauseControl()));

    expect(sent.some((s) => s.op === 'clear_ports')).toBe(true);
  });

  it('surfaces a real server failure as an error, not as a pause', async () => {
    const store = new UploadJobStore(diskIO());
    store.save(createJob('j1', outDir, { channel: 'LIVE', patchVersion: '4.0.0', buildNumber: '9999' }, 1));
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    }));

    const res = await uploadCatalog('token', outDir, () => {}, catalogHooks(store, createPauseControl()));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('500');
  });
});
