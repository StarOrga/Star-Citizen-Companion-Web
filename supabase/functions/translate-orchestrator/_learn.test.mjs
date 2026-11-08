// node --test supabase/functions/translate-orchestrator/_learn.test.mjs
// Learning step, guarded arbiter, hysteresis, style stats and cards — pure parts plus two
// end-to-end runs against in-memory fakes (no network).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arbitrate, bothOrders, hardFailures, ruleVerdict, sameModuloPunct } from './_arbiter.ts';
import { applyAnsweredCards, compareCards, notesKey, reachOf, termCard, tmCard } from './_cards.ts';
import { sha256Hex } from './_diff.ts';
import { extractJudgeTerms } from './_glossary.ts';
import { assessCandidate, dntFromNames, findMisaligned, isShortTerm, mineCandidates, planGlossary, runLearning, termHit } from './_learn.ts';
import { releaseBudget, shouldReplace } from './_revise.ts';
import { styleBlock, styleStats } from './_style.ts';
import { buildShards, indexKey, shardKey } from '../ingest-catalog/_locale-shards.ts';
import { loadTm, saveTm, tmIndexKey } from './_io.ts';
import { buildFewShotIndex, buildSystem, pickSimilar, userMessage } from './_prompt.ts';

const ai = (t) => ({ t, o: 'ai' });
const com = (t) => ({ t, o: 'community', src: 'rjcncpt', lic: 'CC-BY-NC-SA-4.0' });

describe('ruleVerdict (B2 rules)', () => {
  const en = 'Deliver ~mission(Item) to <EM1>Port</EM1>';
  it('admin wins, CIG is guarded even though callers skip it', () => {
    assert.deepEqual(ruleVerdict({ en, incumbent: { t: 'x', o: 'admin' }, challenger: com('y') }), { winner: 'incumbent', reason: 'admin' });
    assert.equal(ruleVerdict({ en, incumbent: ai('x'), challenger: { t: 'y', o: 'admin' } }).winner, 'challenger');
    assert.equal(ruleVerdict({ en, incumbent: ai('x'), challenger: { t: 'y', o: 'cig' } }).reason, 'cig');
  });
  it('equal modulo whitespace/punctuation keeps the incumbent; case stays significant', () => {
    assert.ok(sameModuloPunct('Liefere es, jetzt!', 'Liefere  es jetzt'));
    assert.ok(!sameModuloPunct('LIEFERN', 'Liefern'));
    const v = ruleVerdict({ en: 'Deliver it now', incumbent: ai('Liefere es, jetzt!'), challenger: com('Liefere es jetzt') });
    assert.deepEqual(v, { winner: 'incumbent', reason: 'equal' });
  });
  it('a placeholder/QA failure loses', () => {
    const good = 'Liefere ~mission(Item) an <EM1>Port</EM1>';
    const bad = 'Liefere den Gegenstand an <EM1>Port</EM1>';
    assert.deepEqual(hardFailures(en, bad), ['tokens']);
    assert.equal(ruleVerdict({ en, incumbent: ai(bad), challenger: com(good) }).winner, 'challenger');
    assert.equal(ruleVerdict({ en, incumbent: ai(good), challenger: com(bad) }).winner, 'incumbent');
  });
  it('a glossary violation loses; an admin card decision is kept', () => {
    const glossary = [{ source_term: 'Quantum Drive', target_term: 'Quantenantrieb', category: 'term', origin: 'cig' }];
    const e = 'Your Quantum Drive is ready';
    const v = ruleVerdict({ en: e, incumbent: ai('Dein Quantenantrieb ist bereit'), challenger: com('Dein Quantum Drive ist bereit'), glossary });
    assert.deepEqual(v, { winner: 'incumbent', reason: 'glossary' });
    assert.equal(ruleVerdict({ en: e, incumbent: ai('A'), challenger: com('B'), decided: 'B' }).winner, 'challenger');
  });
  it('undecidable pairs go to the LLM', () => {
    assert.deepEqual(ruleVerdict({ en: 'Open the door', incumbent: ai('Öffne die Tür'), challenger: com('Tür öffnen') }), { winner: null, reason: 'llm' });
  });
});

describe('bothOrders (position bias guard)', () => {
  it('both orders agree with confidence -> that side', () => {
    const v = bothOrders({ w: 'B', c: 0.9 }, { w: 'A', c: 0.8 });
    assert.equal(v.outcome, 'challenger');
    assert.ok(v.winsForward && v.winsReverse);
    assert.equal(v.agreed, 'challenger');
  });
  it('the model followed the position (A both times) -> card with full doubt', () => {
    const v = bothOrders({ w: 'A', c: 0.9 }, { w: 'A', c: 0.9 });
    assert.equal(v.outcome, 'card');
    assert.equal(v.doubt, 1);
    assert.equal(v.agreed, null);
  });
  it('challenger wins both but unsure -> card; incumbent preferred or ties -> keep, no card', () => {
    assert.equal(bothOrders({ w: 'B', c: 0.5 }, { w: 'A', c: 0.9 }).outcome, 'card');
    assert.equal(bothOrders({ w: 'A', c: 0.4 }, { w: 'B', c: 0.4 }).outcome, 'incumbent');
    assert.equal(bothOrders({ w: 'tie', c: 0.9 }, { w: 'A', c: 0.9 }).outcome, 'incumbent');
    assert.equal(bothOrders(null, { w: 'A', c: 1 }).outcome, 'card');
  });
});

describe('shouldReplace (B3 hysteresis)', () => {
  const base = { winsForward: true, winsReverse: true, margin: 3, locked: false, isCig: false, changedThisRelease: 0, budgetPct: 2, langStrings: 1000 };
  it('needs both orders', () => {
    assert.equal(shouldReplace({ ...base, winsReverse: false }).reason, 'not_both_orders');
    assert.equal(shouldReplace(base).replace, true);
  });
  it('never moves CIG or locked/admin rows', () => {
    assert.equal(shouldReplace({ ...base, isCig: true }).reason, 'protected');
    assert.equal(shouldReplace({ ...base, locked: true }).reason, 'protected');
  });
  it('glossary rows need evidence(new) >= evidence(old) + margin', () => {
    assert.equal(shouldReplace({ ...base, evidenceNew: 7, evidenceOld: 5 }).reason, 'evidence');
    assert.equal(shouldReplace({ ...base, evidenceNew: 8, evidenceOld: 5 }).replace, true);
  });
  it('the per-release budget (2 % of strings) caps churn', () => {
    assert.equal(releaseBudget(2, 1000), 20);
    assert.equal(releaseBudget(2, 10), 1);
    assert.equal(releaseBudget(0, 1000), 0);
    assert.equal(shouldReplace({ ...base, changedThisRelease: 19 }).replace, true);
    assert.equal(shouldReplace({ ...base, changedThisRelease: 20 }).reason, 'budget');
  });
});

describe('style stats (C3)', () => {
  const pairs = [];
  for (let i = 0; i < 25; i++) {
    pairs.push({ key: `ui_x_${i}`, en: `Speed ${i}.5 at 40% now`, t: `TEMPO ${i},5 BEI 40 % JETZT` });
    pairs.push({ key: `pu_m_${i}`, en: 'Bring it to me, you know where', t: `Bring es mir, du weißt wo – „Sofort“ ${i}` });
  }
  const s = styleStats('de', pairs, ['cig']);
  it('counts address, decimal comma, percent spacing, quotes and upper-case UI', () => {
    assert.equal(s.address.informal, 25);
    assert.equal(s.address.ratio, 1);
    assert.equal(s.decimal.share, 1);
    assert.equal(s.percent.share, 1);
    assert.equal(s.quotes.dominant, '„“');
    assert.equal(s.upper.ui.share, 1);
    assert.equal(s.upper.pu.share, 0);
  });
  it('renders only clear preferences into the prompt', () => {
    const b = styleBlock(s);
    assert.match(b, /informally/);
    assert.match(b, /comma/);
    assert.match(b, /"40 %"/);
    assert.match(b, /"ui_"/);
    assert.equal(styleBlock(null), '');
    assert.equal(styleBlock(styleStats('de', pairs.slice(0, 4))), '');
  });
  it('buildSystem appends the learned style and admin notes after the static style', () => {
    const sys = buildSystem('de', [{ source_term: 'Hull', target_term: 'Rumpf', category: 'term', origin: 'mined' }], {
      style: s, notes: { general: ['Missionsgeber siezen nie'], byTerm: { Hull: 'immer Rumpf, nie Hülle' } },
    });
    assert.ok(sys.indexOf('Address the player informally ("du")') < sys.indexOf('Learned from'));
    assert.match(sys, /Missionsgeber siezen nie/);
    assert.match(sys, /"Hull": immer Rumpf/);
    assert.equal(buildSystem('de', []).includes('Learned from'), false);
  });
});

describe('mining + promotion (C1/C8)', () => {
  const lines = (n, t, o, en = 'Hull') => Array.from({ length: n }, (_, i) => ({ key: `ui_${o}_${t}_${i}`, en, t, o }));
  it('short terms only', () => {
    assert.ok(isShortTerm('Quantum Drive'));
    assert.ok(!isShortTerm('This is a very long sentence'));
    assert.ok(!isShortTerm('Kill %s'));
  });
  it('>= 5 occurrences and >= 90 % agreement promotes', () => {
    const c = mineCandidates([...lines(9, 'Rumpf', 'ai'), ...lines(1, 'Hülle', 'ai')]).get('hull');
    const a = assessCandidate(c, 5, 0.9);
    assert.equal(a.status, 'promote');
    assert.equal(a.target, 'Rumpf');
    assert.equal(a.evidence, 9);
    assert.equal(assessCandidate(mineCandidates(lines(4, 'Rumpf', 'ai')).get('hull'), 5, 0.9).status, 'weak');
  });
  it('contested without a clear majority -> ambiguous', () => {
    const c = mineCandidates([...lines(6, 'Rumpf', 'community'), ...lines(4, 'Hülle', 'ai')]).get('hull');
    const a = assessCandidate(c, 5, 0.9);
    assert.equal(a.status, 'ambiguous');
    assert.equal(a.runnerUp.text, 'Hülle');
  });
  it('CIG is authoritative: a hybrid community majority cannot outvote it', () => {
    const c = mineCandidates([...lines(5, 'Rumpf', 'cig'), ...lines(30, 'HULL', 'community')]).get('hull');
    const a = assessCandidate(c, 5, 0.9);
    assert.equal(a.pool, 'cig');
    assert.equal(a.status, 'promote');
    assert.equal(a.target, 'Rumpf');
    assert.equal(a.total, 35);
  });
  it('planGlossary never touches admin/cig/locked rows and needs the margin to challenge a mined row', () => {
    const cands = mineCandidates(lines(9, 'Rumpf', 'ai'));
    const s = { promote_min_evidence: 5, promote_min_agreement: 0.9, revise_margin: 3 };
    assert.equal(planGlossary(cands, [], s).promote[0].origin, 'mined');
    assert.equal(planGlossary(cands, [], s).promote[0].evidence, 9);
    for (const row of [
      { id: 'g1', source_term: 'Hull', target_term: 'Hülle', category: 'term', origin: 'admin' },
      { id: 'g1', source_term: 'Hull', target_term: 'Hülle', category: 'term', origin: 'cig' },
      { id: 'g1', source_term: 'Hull', target_term: 'Hülle', category: 'term', origin: 'ai', locked: true },
    ]) {
      const p = planGlossary(cands, [row], s);
      assert.equal(p.promote.length + p.revise.length + p.contested.length, 0);
    }
    const mined = { id: 'g1', source_term: 'Hull', target_term: 'Hülle', category: 'term', origin: 'mined', evidence: 7 };
    assert.equal(planGlossary(cands, [mined], s).revise.length, 0);
    assert.equal(planGlossary(cands, [{ ...mined, evidence: 6 }], s).revise.length, 1);
  });
});

describe('dnt from codex names (C2)', () => {
  it('kept verbatim in >= 90 % -> dnt row, else nothing', () => {
    const pairs = [];
    for (let i = 0; i < 10; i++) pairs.push({ en: `Fly the Drake Cutlass to Lorville ${i}`, t: `Flieg die Drake Cutlass nach ${i % 2 ? 'Lorville' : 'Lorstadt'} ${i}` });
    const rows = dntFromNames(['Drake Cutlass', 'Lorville', 'ab'], pairs, 5);
    assert.deepEqual(rows.map((r) => r.source_term), ['Drake Cutlass']);
    assert.equal(rows[0].category, 'dnt');
    assert.equal(rows[0].origin, 'mined');
    assert.equal(rows[0].evidence, 10);
  });
});

describe('B1 line detection', () => {
  const terms = [{ source_term: 'Quantum Drive', target_term: 'Quantenantrieb', category: 'term', origin: 'cig' },
    { source_term: 'Open', target_term: 'Offen', category: 'term', origin: 'cig' }];
  it('finds community/AI lines missing the CIG term; CIG/admin lines never', () => {
    const lines = [
      { key: 'a', h: 'h1', en: 'Spool the Quantum Drive', entry: com('Spule den Quantum Drive') },
      { key: 'b', h: 'h2', en: 'Spool the Quantum Drive now', entry: ai('Spule jetzt den Quantenantrieb') },
      { key: 'c', h: 'h3', en: 'Spool the Quantum Drive', entry: { t: 'Spule den QD', o: 'admin' } },
      { key: 'd', h: 'h4', en: 'Open the door', entry: ai('Tür auf') },
    ];
    const mis = findMisaligned(lines, terms);
    assert.deepEqual(mis.map((m) => m.key), ['a']);
    assert.deepEqual(mis[0].terms, [{ source: 'Quantum Drive', target: 'Quantenantrieb' }]);
  });
  it('a single-word term at a sentence start is no hit', () => {
    assert.equal(termHit('Open the door', 'Open'), false);
    assert.equal(termHit('Status: Open', 'Open'), false);
    assert.equal(termHit('Doors stay Open today', 'Open'), true);
  });
});

describe('judge term corrections (C5)', () => {
  it('keeps short terms that occur in the source', () => {
    const r = [{ score: 5, back: 'x', terms: [{ source: 'Hull', target: 'Rumpf' }, { source: 'Nope', target: 'x' }, { source: 'a b c d e', target: 'x' }] }, { score: 9, back: 'y' }];
    assert.deepEqual(extractJudgeTerms(r, ['The Hull is damaged', 'Fine']), [{ source: 'Hull', target: 'Rumpf' }]);
  });
});

describe('cards (D1)', () => {
  it('reach by key prefix and D2 order: spread, reach, kind, doubt, fresh; skipped last', () => {
    assert.ok(reachOf('ui_hud_x') > reachOf('item_NameX') && reachOf('item_NameX') > reachOf('pu_mission_desc'));
    const base = { spread: 1, reach: 1, kind: 'wording', doubt: 0.5, fresh: false, status: 'open' };
    const list = [
      { ...base, id: 'skipped', spread: 99, status: 'skipped' },
      { ...base, id: 'style', kind: 'style' },
      { ...base, id: 'meta', kind: 'meta' },
      { ...base, id: 'wide', spread: 5 },
      { ...base, id: 'visible', reach: 3 },
      { ...base, id: 'unsure', doubt: 0.9 },
      { ...base, id: 'fresh', fresh: true },
    ];
    assert.deepEqual(list.sort(compareCards).map((c) => c.id), ['wide', 'visible', 'meta', 'unsure', 'fresh', 'style', 'skipped']);
  });
  it('tm and term cards carry spread, reach, doubt, fresh, kind and a dedupe key', () => {
    const c = tmCard({ lang: 'de', key: 'ui_a', keys: ['ui_a', 'item_b'], h: 'abc', en: 'Open', a: ai('Öffnen'), b: com('Auf'), doubt: 1.4, fresh: true, why: 'x' });
    assert.equal(c.spread, 2);
    assert.equal(c.reach, 3);
    assert.equal(c.doubt, 1);
    assert.equal(c.kind, 'wording');
    assert.equal(c.dedupe_key, 'tm:abc');
    assert.equal(c.option_b.source, 'community:rjcncpt');
    const t = termCard({ lang: 'de', source_term: 'Hull', a: { text: 'Rumpf', source: 'mined', votes: 6 }, b: { text: 'Hülle', source: 'mined', votes: 4 }, spread: 10, sampleKeys: ['item_x'], doubt: 0.6, fresh: false, why: 'y' });
    assert.equal(t.kind, 'meta');
    assert.equal(t.dedupe_key, 'term:hull');
    assert.equal(t.reach, 2);
  });
});

// ── fakes ────────────────────────────────────────────────────────────────────

const BUILD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakeWorld({ en = {}, cig = {}, glossary = [], cards = [], settings = {}, judge } = {}) {
  const files = new Map();
  const put = (lang, entries) => {
    const { index, shards } = buildShards(BUILD, lang, 'gen001', entries);
    files.set(indexKey(BUILD, lang), index);
    for (const [name, s] of shards) files.set(shardKey(BUILD, lang, 'gen001', name), s);
  };
  put('en', en);
  if (Object.keys(cig).length) put('de', cig);
  const store = {
    async getJson(k) { return files.has(k) ? structuredClone(files.get(k)) : null; },
    async putJson(k, v) { files.set(k, structuredClone(v)); },
    async deleteKey(k) { files.delete(k); },
  };
  const ledger = [];
  const rows = glossary.map((g, i) => ({ id: `g${i}`, evidence: 0, ...g }));
  const cardRows = cards.map((c) => ({ ...c }));
  let style = null;
  const learn = {
    rows, cardRows, ledger,
    async getLearnSettings() { return { enabled: true, monthly_cap_usd: 190, arbiter_model: 'claude-haiku-5-5', web_research_cap_usd: 5, revise_margin: 3, revise_budget_pct: 2, promote_min_evidence: 5, promote_min_agreement: 0.9, ...settings }; },
    async currentBuildId() { return BUILD; },
    async codexNames() { return ['Drake Cutlass']; },
    async getStyle() { return style; },
    async setStyle(_l, s) { style = s; },
    get style() { return style; },
    async listGlossary() { return rows.map((r) => ({ ...r })); },
    async insertGlossary(_l, rs) { let n = 0; for (const r of rs) if (!rows.some((x) => x.source_term.toLowerCase() === r.source_term.toLowerCase())) { rows.push({ id: `g${rows.length}`, ...r }); n++; } return n; },
    async updateGlossary(id, patch) { Object.assign(rows.find((r) => r.id === id), patch); },
    async upsertAdminRule(_l, r) { const have = rows.find((x) => x.source_term.toLowerCase() === r.source_term.toLowerCase()); if (have) Object.assign(have, r, { origin: 'admin', needs_retranslate: true }); else rows.push({ id: `g${rows.length}`, ...r, origin: 'admin' }); },
    async insertCard(c) { if (cardRows.some((x) => x.dedupe_key === c.dedupe_key && x.status !== 'answered')) return false; cardRows.push({ id: `c${cardRows.length}`, status: 'open', ...c }); return true; },
    async listAnsweredUnapplied() { return cardRows.filter((c) => c.status === 'answered' && !c.context?.applied_at).map((c) => structuredClone(c)); },
    async listOpenCards(_l, kinds, limit) { return cardRows.filter((c) => c.status === 'open' && kinds.includes(c.kind)).slice(0, limit); },
    async updateCardContext(id, context) { cardRows.find((c) => c.id === id).context = context; },
    async addLearnLedger(month, usd) { ledger.push({ month, usd }); return true; },
    async hasLedgerCarrier() { return true; },
    async monthSpent() { return ledger.reduce((a, r) => a + r.usd, 0); },
    async listApprovedLangs() { return ['de']; },
  };
  const batches = [];
  const llm = {
    batches,
    judge: judge ?? (() => ({ w: 'tie', c: 0.5 })),
    async createBatch(requests) { batches.push({ id: `b${batches.length}`, requests }); return { id: `b${batches.length - 1}` }; },
    async isEnded() { return true; },
    async cancel() {},
    async *results(id) {
      const b = batches.find((x) => x.id === id);
      for (const r of b.requests) {
        if (r.custom_id.startsWith('w')) {
          assert.equal(r.params.tools[0].type, 'web_search_20250305');
          yield { custom_id: r.custom_id, type: 'succeeded', text: 'starcitizen.tools/de uses Panzerung', stop_reason: 'end_turn', usage: { input_tokens: 5000, output_tokens: 200, server_tool_use: { web_search_requests: 2 } }, model: r.params.model };
          continue;
        }
        const items = JSON.parse(r.params.messages[0].content);
        const order = r.custom_id[0];
        const rr = items.map((it) => llm.judge(it, order));
        yield { custom_id: r.custom_id, type: 'succeeded', text: JSON.stringify({ r: rr }), stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 }, model: r.params.model };
      }
    },
  };
  const db = {
    async getLanguage(lang) { return { lang, cig_folder: lang, approved: true }; },
    async monthCommitted() { return ledger.reduce((a, r) => a + r.usd, 0); },
  };
  const deps = { db, store, llm, learn, now: () => new Date('2026-11-08T12:00:00Z'), log() {} };
  return { deps, files, learn, llm, ledger, rows, cardRows };
}

describe('arbitrate (end to end, fake batch)', () => {
  it('rules decide what they can; the rest is judged in both orders; agreement writes the TM, position-following becomes a card', async () => {
    const w = fakeWorld();
    const hA = await sha256Hex('Open the door');
    const hB = await sha256Hex('Close the door');
    const hC = await sha256Hex('Kill %s');
    await saveTm(w.deps.store, 'de', { [hA]: ai('Öffne die Tür'), [hB]: ai('Schließe die Tür'), [hC]: ai('Töte') });
    // A: challenger better in both orders. B: the judge always says "A" (position bias) -> card.
    w.llm.judge = (it, order) => {
      if (it.en === 'Open the door') return { w: order === 'f' ? 'B' : 'A', c: 0.9, why: '' };
      return { w: 'A', c: 0.9, why: '' };
    };
    const conflicts = [
      { key: 'ui_open', h: hA, en: 'Open the door', incumbent: ai('Öffne die Tür'), challenger: com('Tür öffnen') },
      { key: 'ui_close', h: hB, en: 'Close the door', incumbent: ai('Schließe die Tür'), challenger: com('Tür schließen') },
      { key: 'ui_kill', h: hC, en: 'Kill %s', incumbent: ai('Töte'), challenger: com('Töte %s') }, // rule: incumbent lost tokens
    ];
    const first = await arbitrate(w.deps, 'de', conflicts);
    assert.equal(first.ruled, 1);
    assert.equal(first.submitted, 2);
    assert.equal(w.llm.batches[0].requests.length, 2); // forward + reverse
    const second = await arbitrate(w.deps, 'de', []);
    assert.equal(second.replaced, 1);
    assert.equal(second.cards, 1);
    const tm = await loadTm(w.deps.store, 'de');
    assert.equal(tm[hA].t, 'Tür öffnen');
    assert.equal(tm[hA].o, 'community');
    assert.equal(tm[hB].t, 'Schließe die Tür');
    assert.equal(tm[hC].t, 'Töte %s');
    assert.equal(w.cardRows[0].dedupe_key, `tm:${hB}`);
    assert.ok(w.ledger.length === 1 && w.ledger[0].usd > 0);
  });
  it('a capped month submits nothing', async () => {
    const w = fakeWorld({ settings: { monthly_cap_usd: 0 } });
    const h = await sha256Hex('Open the door');
    const s = await arbitrate(w.deps, 'de', [{ key: 'ui_open', h, en: 'Open the door', incumbent: ai('Öffne die Tür'), challenger: com('Tür öffnen') }]);
    assert.equal(s.blocked, 'monthly_cap');
    assert.equal(w.llm.batches.length, 0);
  });
});

describe('runLearning (end to end, fake batch)', () => {
  it('mines, promotes, learns style, writes dnt, sends contested terms to Haiku, resumes and creates a card only on disagreement', async () => {
    const en = {};
    const cig = {};
    for (let i = 0; i < 6; i++) { en[`item_hull_${i}`] = 'Hull'; cig[`item_hull_${i}`] = 'Rumpf'; }
    for (let i = 0; i < 6; i++) en[`ui_shield_${i}`] = 'Shield';
    for (let i = 0; i < 6; i++) en[`ui_armor_${i}`] = 'Armor';
    for (let i = 0; i < 6; i++) en[`pu_cut_${i}`] = `Fly the Drake Cutlass home ${i}`;
    const w = fakeWorld({ en, cig });
    const tm = {};
    const put = async (e, entry) => { tm[await sha256Hex(e)] = entry; };
    for (let i = 0; i < 6; i++) await put(`Fly the Drake Cutlass home ${i}`, ai(`Flieg die Drake Cutlass heim ${i}`));
    await put('Shield', ai('Schild'));
    await put('Armor', ai('Panzerung'));
    await saveTm(w.deps.store, 'de', tm);
    // Contested: "Armor" — 6 keys share one TM text, so add a second variant via judge votes.
    await w.deps.store.putJson('translation-work/learn-de/judge-terms.json', Array.from({ length: 4 }, () => ({ source: 'Armor', target: 'Rüstung' })));
    w.llm.judge = (it, order) => ({ w: order === 'f' ? 'A' : 'A', c: 0.9, why: '' }); // position-following -> card
    const s = await runLearning(w.deps, 'de', 'backfill');
    assert.equal(s.skipped, undefined);
    const by = Object.fromEntries(w.rows.map((r) => [r.source_term, r]));
    assert.equal(by.Hull.target_term, 'Rumpf');
    assert.equal(by.Hull.origin, 'mined');
    assert.equal(by.Shield.target_term, 'Schild');
    assert.equal(by['Drake Cutlass'].category, 'dnt');
    assert.ok(!by.Armor);
    assert.equal(s.haiku.submitted, 1);
    assert.ok(w.learn.style && w.learn.style.n > 0);
    // Next tick: the batch has ended -> disagreement -> exactly one meta card for "Armor".
    const again = await runLearning(w.deps, 'de', 'publish');
    assert.equal(again.haiku.cards, 1);
    assert.equal(w.cardRows.length, 1);
    assert.equal(w.cardRows[0].kind, 'meta');
    assert.equal(w.cardRows[0].dedupe_key, 'term:armor');
    // Idempotent: a third run creates no duplicate card or row.
    const n = w.rows.length;
    await runLearning(w.deps, 'de', 'sync');
    await runLearning(w.deps, 'de', 'sync');
    assert.equal(w.rows.length, n);
    assert.equal(w.cardRows.filter((c) => c.status === 'open').length, 1);
    // C7: the open meta card got web research attached, its spend booked under the web cap.
    assert.match(w.cardRows[0].context.research.text, /Panzerung/);
    const spend = w.files.get('translation-work/learn-spend/2026-11-01.json');
    assert.ok(spend.web > 0.02 && spend.web_reserved === 0);
    // Only the haiku batch asked about Armor; later runs did not re-ask it.
    const asked = w.llm.batches.flatMap((b) => b.requests).filter((r) => r.custom_id === 'f0' && r.params.model === 'claude-haiku-5-5');
    assert.equal(asked.length, 1);
  });

  it('web research never runs once the monthly web cap is reached', async () => {
    const w = fakeWorld({ en: { ui_a: 'Armor' }, cards: [{ ...termCard({ lang: 'de', source_term: 'Armor', a: { text: 'Panzerung', source: 'mined', votes: 6 }, b: { text: 'Rüstung', source: 'mined', votes: 4 }, spread: 6, sampleKeys: ['ui_a'], doubt: 1, fresh: false, why: 'y' }), id: 'c0', status: 'open' }], settings: { web_research_cap_usd: 1 } });
    await w.deps.store.putJson('translation-work/learn-spend/2026-11-01.json', { web: 0.99 });
    const s = await runLearning(w.deps, 'de', 'backfill');
    assert.ok(s.blocked.includes('web:cap'));
    assert.equal(w.llm.batches.length, 0);
  });

  it('applies answered cards: a|b -> TM winner, own -> admin TM entry, save_as_rule -> admin glossary row, note -> prompt hint', async () => {
    const h1 = await sha256Hex('Open the door');
    const h2 = await sha256Hex('Close the door');
    const cards = [
      { ...tmCard({ lang: 'de', key: 'ui_open', keys: ['ui_open'], h: h1, en: 'Open the door', a: ai('Öffne die Tür'), b: com('Tür öffnen'), doubt: 1, fresh: true, why: 'x' }), id: 'c0', status: 'answered', answer: 'b', note: 'UI-Befehle im Infinitiv' },
      { ...tmCard({ lang: 'de', key: 'ui_close', keys: ['ui_close'], h: h2, en: 'Close the door', a: ai('A'), b: com('B'), doubt: 1, fresh: true, why: 'x' }), id: 'c1', status: 'answered', answer: 'own', own_text: 'Tür schließen', save_as_rule: true },
      { ...termCard({ lang: 'de', source_term: 'Armor', a: { text: 'Panzerung', source: 'mined', votes: 6 }, b: { text: 'Rüstung', source: 'mined', votes: 4 }, spread: 6, sampleKeys: ['ui_armor_0'], doubt: 1, fresh: false, why: 'y' }), id: 'c2', status: 'answered', answer: 'a', note: 'Panzerung bei Schiffen' },
    ];
    const w = fakeWorld({ cards });
    const s = await applyAnsweredCards(w.deps, 'de');
    assert.deepEqual(s, { applied: 3, tm: 2, rules: 2, notes: 2 });
    const tm = await loadTm(w.deps.store, 'de');
    assert.deepEqual([tm[h1].t, tm[h1].o, tm[h1].src], ['Tür öffnen', 'community', 'rjcncpt']);
    assert.deepEqual([tm[h2].t, tm[h2].o], ['Tür schließen', 'admin']);
    const by = Object.fromEntries(w.rows.map((r) => [r.source_term, r]));
    assert.equal(by['Close the door'].origin, 'admin');
    assert.equal(by.Armor.target_term, 'Panzerung');
    const notes = w.files.get(notesKey('de'));
    assert.equal(notes.byKey.ui_open, 'UI-Befehle im Infinitiv');
    assert.equal(notes.byTerm.Armor, 'Panzerung bei Schiffen');
    assert.ok(w.cardRows.every((c) => c.context.applied_at));
    // Applied cards are not applied twice.
    assert.equal((await applyAnsweredCards(w.deps, 'de')).applied, 0);
    // The note reaches the prompt for that key.
    assert.match(userMessage({ items: [{ h: h1, key: 'ui_open', m: 'Open the door', toks: [] }] }, [], notes.byKey), /ui_open: UI-Befehle/);
  });
});

describe('few-shot over the whole TM (C4)', () => {
  it('one pair per English, best origin first; ties prefer admin > cig > community > ai', () => {
    const idx = buildFewShotIndex([
      { key: 'ui_x_1', en: 'Open door', t: 'KI', o: 'ai' },
      { key: 'ui_x_1', en: 'Open door', t: 'Admin', o: 'admin' },
      { key: 'ui_x_2', en: 'Open hatch', t: 'Community', o: 'community' },
      { key: 'ui_x_3', en: 'Open gate', t: 'CIG', o: 'cig' },
    ]);
    assert.equal(idx.all.length, 3);
    const picked = pickSimilar(idx, [{ h: '1', key: 'ui_x_9', m: 'Open', toks: [] }], 3);
    assert.deepEqual(picked.map((p) => p.t), ['Admin', 'CIG', 'Community']);
  });
});

void tmIndexKey;
