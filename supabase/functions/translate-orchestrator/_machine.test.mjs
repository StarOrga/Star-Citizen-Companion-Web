// node --test supabase/functions/translate-orchestrator/_machine.test.mjs
// State-machine transitions against in-memory fakes (no network, no real SDK).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advance, approve, cancel, startFull, tick, dryRun } from './_machine.ts';
import { buildShards, indexKey, shardKey } from '../ingest-catalog/_locale-shards.ts';
import { overlayKey, tmIndexKey } from './_io.ts';
import { sha256Hex } from './_diff.ts';

const NEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OLD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function putTable(files, build, lang, entries) {
  const { index, shards } = buildShards(build, lang, 'gen001', entries);
  files.set(indexKey(build, lang), index);
  for (const [name, s] of shards) files.set(shardKey(build, lang, 'gen001', name), s);
}

function world({ settings = {}, hasBase = true, llmMode = 'good', noKey = false, en, baseEn } = {}) {
  const files = new Map();
  const newEn = en ?? { ui_a_1: 'Open the door', ui_a_2: 'Close the door', ui_old: 'Unchanged text', pu_m_1: 'Kill ~mission(Target) at <EM1>Port</EM1>' };
  putTable(files, NEW, 'en', newEn);
  putTable(files, OLD, 'en', baseEn ?? { ui_old: 'Unchanged text', ui_a_2: 'Close a door' });
  const jobs = new Map();
  const ledger = [];
  const glossary = [];
  let clock = 1_000_000;
  let seq = 0;
  const db = {
    jobs, ledger, glossary,
    async listOpenJobs() { return [...jobs.values()].filter((j) => ['estimating', 'queued', 'submitted', 'validating', 'post_editing', 'publishing'].includes(j.status)).map((j) => ({ ...j })); },
    async getJob(id) { const j = jobs.get(id); return j ? { ...j } : null; },
    async cas(job, patch) {
      const cur = jobs.get(job.id);
      if (!cur || cur.status !== job.status || cur.updated_at !== job.updated_at) return null;
      const next = { ...cur, ...patch, updated_at: `t${++seq}` };
      jobs.set(job.id, next);
      return { ...next };
    },
    async insertJob(j) {
      const row = { id: `job${jobs.size + 1}`, spent_usd: 0, batch_ids: [], stats: {}, string_count: null, estimate_usd: null, error: null, created_at: 'c', updated_at: `t${++seq}`, approved_by: null, status: 'estimating', ...j };
      jobs.set(row.id, row);
      return { ...row };
    },
    async getSettings() { return { enabled: true, upload_cap_usd: 20, monthly_cap_usd: 190, lore_model: null, rest_model: null, ...settings }; },
    async getLanguage(lang) { return { lang, cig_folder: lang, approved: true }; },
    async listGlossary() { return glossary.map((g) => ({ ...g })); },
    async insertGlossary(_l, rows) { glossary.push(...rows.map((r, i) => ({ ...r, id: `g${glossary.length + i}` }))); },
    async resetRetranslate() {},
    async buildEstimateSum() { return 0; },
    async monthCommitted() { return ledger.reduce((a, r) => a + r.usd, 0); },
    async addLedger(jobId, month, usd) { ledger.push({ jobId, month, usd }); },
    async hasNewerPublished() { return false; },
  };
  const store = {
    async getJson(k) { return files.has(k) ? structuredClone(files.get(k)) : null; },
    async putJson(k, v) { files.set(k, structuredClone(v)); },
    async deleteKey(k) { files.delete(k); },
  };
  const batches = [];
  const llm = {
    batches,
    async createBatch(requests) { batches.push({ id: `b${batches.length}`, requests }); return { id: `b${batches.length - 1}` }; },
    async isEnded() { return true; },
    async cancel() {},
    async *results(id) {
      const b = batches.find((x) => x.id === id);
      for (const r of [...b.requests].reverse()) { // arbitrary order on purpose
        const msg = r.params.messages[0].content;
        if (r.custom_id === 'j0') {
          const n = JSON.parse(msg).length;
          yield { custom_id: 'j0', type: 'succeeded', text: JSON.stringify({ r: Array.from({ length: n }, () => ({ score: 9, back: 'x' })) }), stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 100 }, model: 'claude-opus-5-5' };
          continue;
        }
        const g = JSON.parse(msg.slice(msg.indexOf('{"g"'))).g;
        const flat = g.flatMap((x) => x.s);
        const isPost = r.custom_id.startsWith('p');
        const t = flat.map((s, i) => {
          const text = s[1];
          if (llmMode === 'badfirst' && !isPost && i === 0) return 'DE: dropped tokens';
          return `DE: ${text}`;
        });
        yield { custom_id: r.custom_id, type: 'succeeded', text: JSON.stringify({ t }), stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000 }, model: r.params.model };
      }
    },
  };
  const deps = { db, store, llm: noKey ? null : llm, now: () => new Date(clock += 1000), log() {} };
  return { deps, files, db, llm, jobs, ledger, newEn, NEW, OLD, hasBase };
}

async function newJob(w, over = {}) {
  return w.db.insertJob({ build_id: NEW, lang: 'de', mode: 'delta', base_build_id: OLD, ...over });
}
async function run(w, until, max = 30) {
  for (let i = 0; i < max; i++) {
    await tick(w.deps);
    const st = [...w.jobs.values()].map((j) => j.status);
    if (st.every((s) => until.includes(s))) return;
  }
  throw new Error(`stuck: ${[...w.jobs.values()].map((j) => j.status)}`);
}
const TERMINAL = ['published', 'failed', 'skipped', 'cancelled', 'awaiting_approval'];

describe('delta lifecycle', () => {
  it('estimating -> ... -> published; only new/changed keys are translated; ledger + TM + overlay written', async () => {
    const w = world();
    await newJob(w);
    await run(w, TERMINAL);
    const job = [...w.jobs.values()][0];
    assert.equal(job.status, 'published', job.error);
    // ui_old is unchanged back catalogue -> never sent.
    const sent = JSON.stringify(w.llm.batches.flatMap((b) => b.requests.map((r) => r.params.messages[0].content)));
    assert.ok(!sent.includes('Unchanged text'));
    assert.ok(sent.includes('Open the door') && sent.includes('Close the door'));
    const overlay = w.files.get(overlayKey('de', NEW));
    assert.deepEqual(Object.keys(overlay.entries).sort(), ['pu_m_1', 'ui_a_1', 'ui_a_2']);
    assert.equal(overlay.entries.ui_a_1.h, await sha256Hex('Open the door'));
    assert.match(overlay.entries.pu_m_1.t, /~mission\(Target\)/);
    assert.ok(w.files.has(overlayKey('de', 'latest')));
    assert.ok(w.files.has(tmIndexKey('de')));
    assert.ok(w.ledger.length >= 1 && w.ledger.every((r) => r.usd > 0));
    assert.ok(job.spent_usd > 0);
    assert.ok(job.estimate_usd > 0 && Number.isFinite(job.estimate_usd));
    assert.ok(job.stats.judge && job.stats.judge.mean === 9);
    // Work files are cleaned up after publishing.
    assert.ok(![...w.files.keys()].some((k) => k.startsWith('translation-work/')));
  });

  it('routes lore to opus and the rest to sonnet with the contract request shape', async () => {
    const w = world();
    await newJob(w);
    await run(w, TERMINAL);
    const reqs = w.llm.batches.flatMap((b) => b.requests).filter((r) => r.custom_id !== 'j0');
    const models = new Set(reqs.map((r) => r.params.model));
    assert.deepEqual([...models].sort(), ['claude-opus-5-5', 'claude-sonnet-5-5']);
    for (const r of reqs) {
      assert.ok(!('temperature' in r.params));
      assert.equal(r.params.system[0].cache_control.ttl, '1h');
    }
  });

  it('a failing item goes through one post-edit batch and still publishes', async () => {
    const w = world({ llmMode: 'badfirst' });
    await newJob(w);
    await run(w, TERMINAL);
    const job = [...w.jobs.values()][0];
    assert.equal(job.status, 'published', job.error);
    assert.ok(w.llm.batches.some((b) => b.requests.some((r) => r.custom_id.startsWith('p'))));
    assert.ok(w.ledger.length >= 2);
  });

  it('no base build -> skipped with an error key', async () => {
    const w = world();
    await newJob(w, { base_build_id: null });
    await run(w, TERMINAL);
    const job = [...w.jobs.values()][0];
    assert.equal(job.status, 'skipped');
    assert.equal(job.error, 'translate.no_base_build');
    assert.equal(w.llm.batches.length, 0);
  });

  it('base build whose shards are missing -> skipped', async () => {
    const w = world();
    w.files.delete(indexKey(OLD, 'en'));
    await newJob(w);
    await run(w, TERMINAL);
    assert.equal([...w.jobs.values()][0].error, 'translate.base_build_missing');
  });

  it('missing API key fails the job with a stable key, never calls a model', async () => {
    const w = world({ noKey: true });
    await newJob(w);
    await run(w, TERMINAL);
    const job = [...w.jobs.values()][0];
    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'translate.no_api_key');
  });

  it('disabled settings keep estimating jobs untouched', async () => {
    const w = world({ settings: { enabled: false } });
    await newJob(w);
    await tick(w.deps);
    assert.equal([...w.jobs.values()][0].status, 'estimating');
  });
});

describe('caps and approval', () => {
  it('estimate above upload cap parks the job; approve queues it; it then publishes', async () => {
    const w = world({ settings: { upload_cap_usd: 0.000001 } });
    await newJob(w);
    await run(w, TERMINAL);
    let job = [...w.jobs.values()][0];
    assert.equal(job.status, 'awaiting_approval');
    assert.equal(job.stats.hold, 'upload_cap');
    assert.equal(w.llm.batches.length, 0);
    await approve(w.deps, job.id, 'admin-1');
    await run(w, ['published', 'failed']);
    job = [...w.jobs.values()][0];
    assert.equal(job.status, 'published', job.error);
    assert.equal(job.approved_by, 'admin-1');
  });

  it('month ledger over the monthly cap parks the job', async () => {
    const w = world({ settings: { monthly_cap_usd: 5 } });
    w.ledger.push({ jobId: 'x', month: '2026-10-01', usd: 5 });
    await newJob(w);
    await run(w, TERMINAL);
    assert.equal([...w.jobs.values()][0].stats.hold, 'monthly_cap');
  });

  it('approve refuses jobs that are not awaiting approval; cancel works', async () => {
    const w = world();
    const j = await newJob(w);
    await assert.rejects(approve(w.deps, j.id, null), { key: 'translate.not_awaiting_approval' });
    const c = await cancel(w.deps, j.id);
    assert.equal(c.status, 'cancelled');
  });

  it('full mode ALWAYS awaits approval, even far below every cap', async () => {
    const w = world({ settings: { upload_cap_usd: 1e9, monthly_cap_usd: 1e9 } });
    const job = await startFull(w.deps, NEW, 'de');
    assert.equal(job.mode, 'full');
    assert.equal(job.status, 'awaiting_approval');
    assert.equal(job.stats.hold, 'full');
    await tick(w.deps);
    assert.equal([...w.jobs.values()][0].status, 'awaiting_approval');
    assert.equal(w.llm.batches.length, 0);
    // Full includes the back catalogue (ui_old) in its gap.
    const plan = w.files.get(`translation-work/${job.id}/plan.json`);
    assert.ok(JSON.stringify(plan.chunks).includes('Unchanged text'));
  });
});

describe('idempotency', () => {
  it('a racing second advance with a stale row creates no second batch', async () => {
    const w = world();
    await newJob(w);
    await tick(w.deps); // estimating -> queued
    const [queued] = await w.db.listOpenJobs();
    assert.equal(queued.status, 'queued');
    await Promise.all([advance(w.deps, queued), advance(w.deps, queued)]);
    const main = w.llm.batches.filter((b) => b.requests.some((r) => !r.custom_id.startsWith('j')));
    assert.equal(main.length, 1);
  });

  it('resumes a crash between claim and batch creation after the stale window', async () => {
    const w = world();
    const j = await newJob(w);
    await tick(w.deps); // queued
    const queued = await w.db.getJob(j.id);
    // simulate crash: claimed (submitted/submitting) but no batch created
    await w.db.cas(queued, { status: 'submitted', stats: { ...queued.stats, phase: 'submitting' } });
    await tick(w.deps);
    assert.equal(w.llm.batches.length, 0); // not stale yet
    for (let i = 0; i < 1000 && w.llm.batches.length === 0; i++) w.deps.now(); // advance the fake clock
    w.deps.now = (() => { const base = Date.now() + 3_600_000; return () => new Date(base); })();
    // updated_at strings in the fake are not dates; make it parseable
    const cur = w.jobs.get(j.id);
    cur.updated_at = new Date(0).toISOString();
    await tick(w.deps);
    assert.equal(w.llm.batches.length, 1);
  });

  it('dry-run estimate writes nothing', async () => {
    const w = world();
    const before = w.files.size;
    const e = await dryRun(w.deps, NEW, 'de', 'delta', OLD);
    assert.ok(e.string_count > 0 && e.estimate_usd > 0);
    assert.equal(w.files.size, before);
    assert.equal(w.llm.batches.length, 0);
  });
});
