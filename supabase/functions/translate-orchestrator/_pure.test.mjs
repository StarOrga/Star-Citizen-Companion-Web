// node --test supabase/functions/translate-orchestrator/_pure.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mask, unmask, maskedOutputOk, tokensOf } from './_mask.ts';
import { diffStrings, isCigValid, sha256Hex } from './_diff.ts';
import { buildChunks, toChunkItem, familyOf, isLoreKey } from './_chunk.ts';
import { estimateJob, maxTokensFor, usageCostUsd } from './_cost.ts';
import { qaCheck } from './_qa.ts';
import { buildSystem, requestParams, userMessage, pickSimilar, buildFewShotIndex } from './_prompt.ts';
import { deriveAiTerms, deriveCigLabels } from './_glossary.ts';

describe('_mask', () => {
  it('masks and restores every token kind', () => {
    const s = 'Deliver ~mission(Target|ucase) to <EM1>Bob</EM1> %s now\\n[x] <b>';
    const { m, toks } = mask(s);
    assert.ok(!/~mission|<EM1>|%s|\[x\]/.test(m));
    assert.equal(unmask(m, toks), s);
    assert.equal(toks.length, tokensOf(s).length);
  });
  it('checks the multiset and rejects CR/LF', () => {
    const { toks } = mask('a ~x(y) b %d');
    assert.ok(maskedOutputOk('⟦2⟧ a ⟦1⟧', toks));
    assert.ok(!maskedOutputOk('⟦1⟧ a', toks));
    assert.ok(!maskedOutputOk('⟦1⟧ ⟦1⟧ ⟦2⟧', toks));
    assert.ok(!maskedOutputOk('⟦1⟧ ⟦2⟧\n', toks));
  });
});

describe('_diff', () => {
  it('cig validity', () => {
    assert.ok(isCigValid('Hello', 'Hallo'));
    assert.ok(!isCigValid('Hello', 'Hello'));
    assert.ok(!isCigValid('Hello', '! Hello TRANSLATION NOT FOUND'));
    assert.ok(!isCigValid('Hello', undefined));
  });
  it('full mode: TM hit, cig-valid skipped, dedupe by text', async () => {
    const h = await sha256Hex('Known');
    const r = await diffStrings({
      mode: 'full',
      en: { a: 'Known', b: 'Done', c: 'New', d: 'New', e: '' },
      cig: { b: 'Fertig' },
      tm: { [h]: { t: 'Bekannt', o: 'ai' } },
    });
    assert.deepEqual(r.reused, { a: { h, t: 'Bekannt' } });
    assert.equal(r.todo.length, 1);
    assert.deepEqual(r.todo[0].keys, ['c', 'd']);
    assert.equal(r.counts.cig, 1);
    assert.equal(r.counts.blank, 1);
  });
  it('delta excludes unchanged untranslated keys, changed or new English re-enters', async () => {
    const r = await diffStrings({
      mode: 'delta',
      en: { old: 'Same text', changed: 'Now different', fresh: 'Brand new' },
      baseEn: { old: 'Same text', changed: 'Was different' },
      cig: {},
      tm: {},
    });
    assert.deepEqual(r.todo.map((t) => t.keys[0]).sort(), ['changed', 'fresh']);
    assert.equal(r.counts.unchanged, 1);
  });
  it('delta still reuses TM hits of unchanged keys for the overlay', async () => {
    const h = await sha256Hex('Same text');
    const r = await diffStrings({
      mode: 'delta', en: { old: 'Same text' }, baseEn: { old: 'Same text' }, cig: {}, tm: { [h]: { t: 'Gleich', o: 'ai' } },
    });
    assert.equal(r.reused.old.t, 'Gleich');
  });
  it('delta without base throws', async () => {
    await assert.rejects(diffStrings({ mode: 'delta', en: { a: 'x' }, cig: {}, tm: {} }));
  });
  it('forced terms bypass the TM', async () => {
    const h = await sha256Hex('Quantum Drive');
    const r = await diffStrings({
      mode: 'full', en: { a: 'Quantum Drive' }, cig: {}, tm: { [h]: { t: 'x', o: 'ai' } }, forceTerms: ['quantum'],
    });
    assert.equal(r.todo.length, 1);
  });
});

describe('_chunk', () => {
  const mk = (n, prefix) => Array.from({ length: n }, (_, i) => ({ h: `${prefix}${i}`, en: `Text ${i}`, keys: [`${prefix}_a_${String(i).padStart(4, '0')}`] }));
  it('routes lore to the lore model and caps strings per request', () => {
    const items = [...mk(150, 'item_Desc'), ...mk(30, 'pu')].map(toChunkItem);
    const keys = new Map(items.map((i) => [i.h, [i.key]]));
    const chunks = buildChunks(items, (it) => keys.get(it.h), { lang: 'de' });
    assert.ok(chunks.every((c) => c.items.length <= 100));
    assert.ok(chunks.filter((c) => c.model === 'claude-opus-5-5').every((c) => c.items.every((i) => isLoreKey(i.key))));
    assert.equal(chunks.reduce((a, c) => a + c.items.length, 0), 180);
    assert.deepEqual(chunks.map((c) => c.id), chunks.map((_, i) => `c${i}`));
  });
  it('splits by input tokens', () => {
    const big = Array.from({ length: 20 }, (_, i) => toChunkItem({ h: `h${i}`, en: 'x'.repeat(5000), keys: [`ui_k_${i}`] }));
    const chunks = buildChunks(big, (it) => [it.key], { lang: 'de', maxInputTokens: 10_000 });
    assert.ok(chunks.length > 5);
  });
  it('family prefix', () => assert.equal(familyOf('pu_m1_desc'), 'pu_m1_'));
});

describe('_cost', () => {
  it('real spend from usage incl. cache', () => {
    const usd = usageCostUsd('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 });
    assert.ok(Math.abs(usd - (2 + 10 + 0.2 + 4)) < 1e-9);
  });
  it('opus costs more than sonnet for the same chunk', () => {
    const c = { inputChars: 50_000, enChars: 40_000, strings: 100 };
    const s = estimateJob('de', [{ model: 'claude-sonnet-5-5', ...c }], 5000).usd;
    const o = estimateJob('de', [{ model: 'claude-opus-5-5', ...c }], 5000).usd;
    assert.ok(o > s * 2);
    assert.ok(maxTokensFor('de', { model: 'claude-sonnet-5-5', ...c }) >= 2048);
  });
});

describe('_qa', () => {
  const src = 'Open ~action(x) now';
  const { toks } = mask(src);
  it('passes a good translation and restores tokens', () => {
    const q = qaCheck(src, 'Öffne ⟦1⟧ jetzt', toks);
    assert.ok(q.ok);
    assert.equal(q.text, 'Öffne ~action(x) jetzt');
  });
  it('flags lost tokens, newline, long short strings, new URLs, glossary', () => {
    assert.ok(qaCheck(src, 'Öffne jetzt', toks).reasons.includes('tokens'));
    assert.ok(qaCheck(src, 'Öffne ⟦1⟧\njetzt', toks).reasons.includes('newline'));
    assert.ok(qaCheck('Ok', 'Okeydokey hier', []).reasons.includes('too_long'));
    assert.ok(qaCheck('Visit', 'Besuche http://evil.test', []).reasons.includes('url'));
    const g = [{ source_term: 'Item Type:', target_term: 'Gegenstand:', category: 'label', origin: 'cig' }];
    assert.ok(qaCheck('Item Type:', 'Gegenstandstyp:', [], g).reasons.includes('glossary:Item Type:'));
    assert.ok(qaCheck('Item Type:', 'Gegenstand:', [], g).ok);
  });
  it('ai glossary rows are advice only', () => {
    const g = [{ source_term: 'Scattergun', target_term: 'Schrotflinte', category: 'term', origin: 'ai' }];
    assert.ok(qaCheck('A Scattergun', 'Eine Flinte', [], g).ok);
  });
});

describe('_prompt', () => {
  it('request shape per model, no sampling params', () => {
    const s = requestParams('claude-sonnet-5-5', 4000, 'SYS', 'U');
    assert.deepEqual(s.thinking, { type: 'between_tools' });
    assert.equal(s.output_config.effort, 'low');
    assert.equal(s.system[0].cache_control.ttl, '1h');
    const o = requestParams('claude-opus-5-5', 4000, 'SYS', 'U');
    assert.equal(o.thinking, undefined);
    assert.equal(o.output_config.effort, 'medium');
    for (const p of [s, o]) assert.ok(!('temperature' in p) && !('top_p' in p));
    assert.deepEqual(s.output_config.format.schema.required, ['t']);
  });
  it('system prompt carries style and glossary, user message shares prefixes', () => {
    const sys = buildSystem('de', [{ source_term: 'HEI', target_term: 'FZI', category: 'label', origin: 'cig' }]);
    assert.match(sys, /du/);
    assert.match(sys, /HEI => FZI/);
    const items = ['ui_a_1', 'ui_a_2'].map((key, i) => ({ h: String(i), key, m: `t${i}`, toks: [] }));
    const msg = userMessage({ items });
    assert.equal(msg.match(/ui_a_/g).length, 1);
  });
  it('few-shot prefers the same key family', () => {
    const idx = buildFewShotIndex([
      { key: 'ui_x_1', en: 'Open door', t: 'Tür öffnen' },
      { key: 'item_y', en: 'Open door', t: 'zzz' },
    ]);
    const picked = pickSimilar(idx, [{ h: '1', key: 'ui_x_2', m: 'Open door', toks: [] }], 1);
    assert.equal(picked[0].key, 'ui_x_1');
  });
});

describe('_glossary', () => {
  it('derives CIG label pairs only from valid short pairs', () => {
    const rows = deriveCigLabels(
      { ui_a: 'Item Type:', ui_b: 'Same', ui_c: 'Unfinished', item_Name_x: 'Scattergun' },
      { ui_a: 'Gegenstand:', ui_b: 'Same', ui_c: '! Unfinished NOT FOUND', item_Name_x: 'Schrotflinte' },
    );
    assert.deepEqual(rows.map((r) => r.source_term).sort(), ['Item Type:', 'Scattergun']);
    assert.ok(rows.every((r) => r.category === 'label' && r.origin === 'cig'));
  });
  it('derives dnt terms kept verbatim', () => {
    const pairs = Array.from({ length: 6 }, (_, i) => ({ en: `go to the Port Olisar now ${i}`, t: `geh zur Port Olisar jetzt ${i}` }));
    assert.deepEqual(deriveAiTerms(pairs).map((r) => r.source_term), ['Port Olisar']);
  });
});
