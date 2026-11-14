// node --test supabase/functions/ingest-catalog/_rebuild.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  CLONE_TABLES,
  isRebuildUnavailable,
  LOCALE_TABLE,
  planInit,
  prepareRebuild,
  refusedSwitchStatus,
} from './_rebuild.ts';

const P = '11111111-1111-4111-8111-111111111111';
const N = '22222222-2222-4222-8222-222222222222';

function fakeDeps({ predecessor = P, touched = [] } = {}) {
  const calls = [];
  const done = new Set(touched);
  return {
    calls,
    deps: {
      predecessor: async () => predecessor,
      touched: async () => new Set(done),
      clone: async (id, table) => {
        calls.push([id, table]);
        done.add(table);
        return 7;
      },
    },
  };
}

describe('planInit', () => {
  it('creates a new row when the coordinates are only published', () => {
    assert.deepEqual(planInit([{ id: P, finalized_at: '2026-11-01T00:00:00Z' }]), { action: 'insert' });
  });
  it('creates a new row for a first upload', () => {
    assert.deepEqual(planInit([]), { action: 'insert' });
  });
  it('resumes an unfinished staging row instead of starting another', () => {
    assert.deepEqual(
      planInit([{ id: N, finalized_at: null }, { id: P, finalized_at: '2026-11-01T00:00:00Z' }]),
      { action: 'reuse', id: N },
    );
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
    assert.equal(refusedSwitchStatus({ message: 'duplicate key value' }), null);
    assert.equal(refusedSwitchStatus(null), null);
  });
});
