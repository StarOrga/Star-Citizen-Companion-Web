// node --test supabase/functions/ingest-catalog/_rebuild.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  CLONE_TABLES,
  isLegacyNatkeyConflict,
  isRebuildUnavailable,
  LOCALE_TABLE,
  MAX_CLONE_CALLS,
  prepareRebuild,
  refusedSwitchStatus,
} from './_rebuild.ts';

const P = '11111111-1111-4111-8111-111111111111';
const N = '22222222-2222-4222-8222-222222222222';

/** A fake server: every table has `rows` rows, copied `chunk` per call. */
function fakeDeps({ predecessor = P, touched = [], rows = 7, chunk = 2000 } = {}) {
  const calls = [];
  const done = new Set(touched);
  const left = new Map();
  return {
    calls,
    deps: {
      predecessor: async () => predecessor,
      touched: async () => new Set(done),
      clone: async (id, table) => {
        calls.push([id, table]);
        if (done.has(table)) return { copied: 0, done: true };
        const remaining = left.has(table) ? left.get(table) : rows;
        const copied = Math.min(chunk, remaining);
        left.set(table, remaining - copied);
        if (copied < chunk) done.add(table);
        return { copied, done: copied < chunk };
      },
    },
  };
}

describe('isLegacyNatkeyConflict', () => {
  it('recognises the pre-migration unique constraint on the coordinates', () => {
    assert.equal(isLegacyNatkeyConflict({ code: '23505', message: 'duplicate key value violates unique constraint "codex_builds_channel_patch_build_key"' }), true);
    assert.equal(isLegacyNatkeyConflict({ code: '23505', message: 'duplicate key value violates unique constraint "codex_builds_pkey"' }), false);
    assert.equal(isLegacyNatkeyConflict({ code: '42501', message: 'codex_builds_channel_patch_build_key' }), false);
  });
});

describe('prepareRebuild', () => {
  it('does nothing for the first upload of a game build', async () => {
    const { deps, calls } = fakeDeps({ predecessor: null });
    const plan = await prepareRebuild(deps, N);
    assert.deepEqual(plan, { predecessor: null, cloned: {}, copyLocaleFrom: null });
    assert.equal(calls.length, 0);
  });

  it('copies every table the run skipped, and only those', async () => {
    const { deps, calls } = fakeDeps({ touched: ['codex_ships_rows', 'codex_item_ports', LOCALE_TABLE] });
    const plan = await prepareRebuild(deps, N);
    const copied = calls.map(([, t]) => t);
    assert.ok(!copied.includes('codex_ships_rows'));
    assert.ok(!copied.includes('codex_item_ports'));
    assert.equal(copied.length, CLONE_TABLES.length - 2);
    assert.ok(calls.every(([id]) => id === N));
    assert.equal(plan.copyLocaleFrom, null, 'strings were uploaded');
    assert.equal(plan.cloned.codex_items_rows, 7);
  });

  it('loops a table in chunks until the server says done', async () => {
    const { deps, calls } = fakeDeps({ touched: CLONE_TABLES.filter((t) => t !== 'codex_items_rows'), rows: 20385, chunk: 2000 });
    const plan = await prepareRebuild(deps, N);
    assert.equal(plan.cloned.codex_items_rows, 20385);
    assert.equal(calls.length, 11);
  });

  it('gives up on a copy that never finishes instead of hanging the request', async () => {
    const deps = { predecessor: async () => P, touched: async () => new Set(), clone: async () => ({ copied: 1, done: false }) };
    await assert.rejects(() => prepareRebuild(deps, N), new RegExp(`${MAX_CLONE_CALLS} calls`));
  });

  it('asks for the predecessor locale strings when the run sent none', async () => {
    const { deps } = fakeDeps({ touched: CLONE_TABLES });
    const plan = await prepareRebuild(deps, N);
    assert.deepEqual(plan.cloned, {});
    assert.equal(plan.copyLocaleFrom, P);
  });

  it('a retried finalize copies nothing twice', async () => {
    const { deps, calls } = fakeDeps();
    await prepareRebuild(deps, N);
    const first = calls.length;
    await prepareRebuild(deps, N);
    assert.equal(calls.length, first);
  });
});

describe('CLONE_TABLES', () => {
  it('matches public.codex_clone_tables() in the migration', () => {
    const sql = readFileSync(new URL('../../migrations/20261114120000_codex_atomic_rebuild.sql', import.meta.url), 'utf8');
    const body = /function public\.codex_clone_tables\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/.exec(sql);
    assert.ok(body, 'codex_clone_tables() not found');
    const names = [...body[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(names, [...CLONE_TABLES]);
  });
});

describe('error classification', () => {
  it('a missing migration degrades instead of failing the upload', () => {
    assert.equal(isRebuildUnavailable({ code: 'PGRST202', message: 'Could not find the function public.codex_build_predecessor' }), true);
    assert.equal(isRebuildUnavailable({ code: '42703', message: 'column codex_builds.superseded_at does not exist' }), true);
    assert.equal(isRebuildUnavailable({ code: '42P01', message: 'relation "public.codex_build_touched" does not exist' }), true);
    assert.equal(isRebuildUnavailable({ code: '42703', message: 'column "foo" does not exist' }), false);
    assert.equal(isRebuildUnavailable({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
  });

  it('a refused switch is a 409 with the reason, never a retryable 500', () => {
    assert.deepEqual(refusedSwitchStatus({ message: 'codex_build_incomplete: items has 1 of 500 rows' }),
      { status: 409, code: 'codex_build_incomplete' });
    assert.deepEqual(refusedSwitchStatus({ message: 'codex_build_superseded: a was replaced by b' }),
      { status: 409, code: 'codex_build_superseded' });
    assert.deepEqual(refusedSwitchStatus({ message: 'duplicate key value violates unique constraint "codex_builds_natkey_published"' }),
      { status: 409, code: 'codex_build_superseded' });
    assert.equal(refusedSwitchStatus({ message: 'duplicate key value' }), null);
    assert.equal(refusedSwitchStatus(null), null);
  });
});
