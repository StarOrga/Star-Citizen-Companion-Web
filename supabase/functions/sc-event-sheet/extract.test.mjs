// Extraction pipeline against recorded events: source text in, model JSON in, expected sheet out.
// Runs under `node --test` (npm run test:functions). Fixtures: ./fixtures/*.json, see fixtures/README.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  EVENT_SHEET_FIELD_KEYS, approveField, isForbiddenGear, prereqGear, publicSheet, setByAdmin,
} from '../_shared/event-sheet.ts';
import {
  MAX_LINKS_PER_EVENT, SHEET_TOOL_SCHEMA, buildPrompt, bundleSources, excerptAround, extractMeta, hashText, mergeSheets,
  nameStem, parseModelAnswer, CORS, preflight, parseWikiExtract, pickEvents, sanityCheck, selectSources, sheetFromModel,
} from './_extract.ts';
// Static JSON imports: the Deno parity run (edge-functions-deploy.yml) grants no --allow-read.
import fx_day_of_the_vara_2956 from './fixtures/day-of-the-vara-2956.json' with { type: 'json' };
import fx_discovery_month_2956 from './fixtures/discovery-month-2956.json' with { type: 'json' };
import fx_foundation_festival_2026 from './fixtures/foundation-festival-2026.json' with { type: 'json' };
import fx_iae_2956 from './fixtures/iae-2956.json' with { type: 'json' };
import fx_invictus_2956 from './fixtures/invictus-2956.json' with { type: 'json' };
import fx_luminalia_2955 from './fixtures/luminalia-2955.json' with { type: 'json' };
import fx_orison_relief_support_2956 from './fixtures/orison-relief-support-2956.json' with { type: 'json' };

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = [
  ['day-of-the-vara-2956.json', fx_day_of_the_vara_2956],
  ['discovery-month-2956.json', fx_discovery_month_2956],
  ['foundation-festival-2026.json', fx_foundation_festival_2026],
  ['iae-2956.json', fx_iae_2956],
  ['invictus-2956.json', fx_invictus_2956],
  ['luminalia-2955.json', fx_luminalia_2955],
  ['orison-relief-support-2956.json', fx_orison_relief_support_2956],
].map(([file, fx]) => ({ file, ...fx }));
// Source checks read files: skipped where the runtime denies read access (Deno without --allow-read).
const noRead = typeof Deno !== 'undefined' && (await Deno.permissions.query({ name: 'read', path: here })).state !== 'granted';

const FORBIDDEN_WORDS = /patch|alpha|game-?package|package|edition|account/;
const walkGear = (node) => prereqGear(node ?? null);

test('every fixture file on disk is in the static import list', { skip: noRead }, () => {
  const onDisk = readdirSync(join(here, 'fixtures')).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(fixtures.map((f) => f.file).sort(), onDisk);
});

test('the seven recorded events are all present', () => {
  assert.deepEqual(fixtures.map((f) => f.event.id).sort(), ['dm-2956', 'dotv-2956', 'ff-2956', 'iae-2956', 'inv-2956', 'lum-2955', 'orison-2956']);
});

for (const fx of fixtures) {
  test(`${fx.file}: model JSON becomes the expected sheet`, () => {
    const { sheet } = sheetFromModel(fx.llm, fx.event);
    const pub = publicSheet(sheet);
    for (const [k, v] of Object.entries(fx.expect.public)) {
      assert.deepEqual(pub.fields[k].value, v, `public ${k}`);
    }
    const pending = EVENT_SHEET_FIELD_KEYS.filter((k) => sheet.fields[k].value !== null && sheet.fields[k].review === 'pending').sort();
    assert.deepEqual(pending, [...fx.expect.pending].sort(), 'pending fields');
    // Gate: whatever is pending is unknown publicly but kept in the draft.
    for (const k of pending) {
      assert.equal(pub.fields[k].value, null);
      assert.notEqual(sheet.fields[k].value, null);
      assert.ok(sheet.fields[k].confidence < 0.8);
    }
    if (fx.expect.progressModel) assert.equal(sheet.fields.progress.value.model, fx.expect.progressModel);
    if (fx.expect.draftEnd) assert.equal(sheet.fields.end.value, fx.expect.draftEnd);
    if (fx.expect.prereqGear) assert.deepEqual(walkGear(sheet.fields.prerequisites.value), fx.expect.prereqGear);
    if (fx.expect.trackThresholds) {
      for (const [id, at] of Object.entries(fx.expect.trackThresholds)) {
        const track = sheet.fields.progress.value.tracks.find((t) => t.id === id);
        assert.deepEqual(track.tiers.map((t) => t.at), at, `track ${id}`);
      }
    }
    for (const [id, ch] of Object.entries(fx.expect.channels ?? {})) {
      assert.equal(sheet.fields.rewards.value.find((r) => r.id === id).channel, ch, `channel ${id}`);
    }
    for (const [id, kind] of Object.entries(fx.expect.timing ?? {})) {
      assert.equal(sheet.fields.rewards.value.find((r) => r.id === id).timing.kind, kind, `timing ${id}`);
    }
  });

  test(`${fx.file}: prerequisites never contain a patch or a game package`, () => {
    const { sheet } = sheetFromModel(fx.llm, fx.event);
    for (const g of walkGear(sheet.fields.prerequisites.value)) {
      assert.ok(!isForbiddenGear(g) && !FORBIDDEN_WORDS.test(g), g);
    }
  });

  test(`${fx.file}: sources and prompt carry the recorded text`, () => {
    const items = fx.sources;
    const bundle = bundleSources(items);
    assert.ok(bundle.includes(items[0].text.slice(0, 40)));
    const prompt = buildPrompt(fx.event, bundle);
    assert.ok(prompt.includes(fx.event.name));
    assert.match(prompt, /NEVER the patch/);
    assert.match(prompt, /never invent/i);
  });
}

test('rewards: channel is per reward, pledge is never a default', () => {
  const dm = fixtures.find((f) => f.event.id === 'dm-2956');
  const { sheet } = sheetFromModel(dm.llm, dm.event);
  const channels = new Set(sheet.fields.rewards.value.map((r) => r.channel));
  assert.deepEqual([...channels].sort(), ['ingame', 'pledge']);
  const mask = sheetFromModel(fixtures.find((f) => f.event.id === 'dotv-2956').llm).sheet.fields.rewards.value.find((r) => r.id === 'vanduul-mask');
  assert.equal(mask.channel, 'unknown');
  assert.equal(mask.timing.kind, 'after-end');
  // missing channel / timing in the model answer stays unknown instead of becoming a guess
  const bare = sheetFromModel({ fields: { rewards: { value: [{ name: 'Mystery crate' }], confidence: 0.9, source: 'official' } } });
  assert.equal(bare.sheet.fields.rewards.value[0].channel, 'unknown');
  assert.equal(bare.sheet.fields.rewards.value[0].timing.kind, 'unknown');
});

test('open ids survive: unknown venue, area kind, progress model and gear are kept', () => {
  const { sheet } = sheetFromModel({ fields: {
    venues: { value: ['Verse', 'Bar Citizen', 'VR Lounge'], confidence: 0.9, source: 'official' },
    area: { value: { kind: 'Orbit Ring', systems: ['Pyro'], places: [] }, confidence: 0.9, source: 'official' },
    progress: { value: { model: 'Raid Boss', tracks: [] }, confidence: 0.9, source: 'official' },
    prerequisites: { value: { op: 'or', items: [{ gear: 'Racing Ship' }, { gear: 'Beta Edition' }] }, confidence: 0.9, source: 'official' },
  } });
  assert.deepEqual(sheet.fields.venues.value, ['verse', 'bar-citizen', 'vr-lounge']);
  assert.equal(sheet.fields.area.value.kind, 'orbit-ring');
  assert.equal(sheet.fields.progress.value.model, 'raid-boss');
  assert.deepEqual(sheet.fields.prerequisites.value, { gear: 'racing-ship', label: null });
});

test('Arena Commander venue without an area stays public with area unknown', () => {
  const { sheet } = sheetFromModel({ fields: {
    venues: { value: ['arena-commander'], confidence: 0.95, source: 'official' },
    area: { value: null, confidence: 0, source: 'ai' },
  } });
  const pub = publicSheet(sheet);
  assert.deepEqual(pub.fields.venues.value, ['arena-commander']);
  assert.equal(pub.fields.area.value, null);
});

test('Stanton area with an any-of set of places keeps every place', () => {
  const dm = fixtures.find((f) => f.event.id === 'dm-2956');
  const area = publicSheet(sheetFromModel(dm.llm, dm.event).sheet).fields.area.value;
  assert.equal(area.kind, 'system');
  assert.deepEqual(area.systems, ['stanton']);
  assert.deepEqual(area.places, ['hurston', 'arccorp', 'microtech']);
});

test('contradictory end: unknown with low confidence, never public', () => {
  const dm = fixtures.find((f) => f.event.id === 'dm-2956');
  const { sheet } = sheetFromModel(dm.llm, dm.event);
  assert.equal(publicSheet(sheet).fields.end.value, null);
  assert.ok(sheet.fields.end.confidence <= 0.4);
  // model said "unknown" outright
  const none = sheetFromModel({ fields: { end: { value: null, confidence: 0, source: 'ai' } } });
  assert.equal(none.sheet.fields.end.value, null);
});

test('sanity: end before start, a confirmed calendar mismatch and a missing source all drop confidence', () => {
  const ev = { id: 'x', series: 'x', name: 'X', start_date: '2026-10-21', end_date: '2026-11-09', date_status: 'confirmed', source_comm_link_id: null };
  const swapped = sheetFromModel({ fields: {
    start: { value: '2026-11-09', confidence: 0.95, source: 'official' }, end: { value: '2026-10-21', confidence: 0.95, source: 'official' },
  } });
  assert.ok(swapped.sheet.fields.end.confidence <= 0.2);
  assert.equal(swapped.sheet.fields.end.review, 'pending');
  // last year's dates copied: far from the confirmed calendar row
  const stale = sheetFromModel({ fields: { start: { value: '2025-10-01', confidence: 0.95, source: 'official' }, end: { value: '2025-11-03', confidence: 0.95, source: 'official' } } }, ev);
  assert.equal(stale.sheet.fields.start.review, 'pending');
  assert.equal(stale.sheet.fields.end.review, 'pending');
  assert.ok(stale.issues.some((i) => i.includes('calendar')));
  // no named source: capped at 0.6
  const anon = sanityCheck({ schema: 1, fields: { ...sheetFromModel({}).sheet.fields, venues: { value: ['verse'], confidence: 0.99, source: 'unknown', review: 'auto' } } }, null);
  assert.equal(anon.sheet.fields.venues.confidence, 0.6);
});

test('the model cannot pre-approve its own fields', () => {
  const { sheet } = sheetFromModel({ fields: { venues: { value: ['verse'], confidence: 0.2, source: 'official', review: 'approved' } } });
  assert.equal(sheet.fields.venues.review, 'pending');
});

test('garbage model answers become an all-unknown sheet', () => {
  for (const raw of [null, 'text', 42, [], {}, { fields: 'x' }, { fields: { venues: 'verse', end: { value: 'soon', confidence: 1 } } }]) {
    const { sheet } = sheetFromModel(raw);
    for (const k of EVENT_SHEET_FIELD_KEYS) assert.equal(sheet.fields[k].value, null, `${JSON.stringify(raw)} ${k}`);
  }
});

test('parseModelAnswer reads a tool_use block, plain JSON text and fenced JSON', () => {
  assert.deepEqual(parseModelAnswer([{ type: 'tool_use', input: { fields: {} } }]), { fields: {} });
  assert.deepEqual(parseModelAnswer([{ type: 'text', text: '```json\n{"fields":{"end":null}}\n```' }]), { fields: { end: null } });
  assert.equal(parseModelAnswer([{ type: 'text', text: 'sorry' }]), null);
  assert.equal(parseModelAnswer(undefined), null);
});

test('tool schema covers exactly the sheet fields', () => {
  assert.deepEqual(Object.keys(SHEET_TOOL_SCHEMA.properties.fields.properties).sort(), [...EVENT_SHEET_FIELD_KEYS].sort());
});

test('mergeSheets: admin decisions stay, unknown never wipes, low confidence never displaces a released value', () => {
  const stored = sheetFromModel({ fields: {
    venues: { value: ['verse'], confidence: 0.95, source: 'official' },
    end: { value: '2026-11-09', confidence: 0.9, source: 'official' },
    start: { value: '2026-10-21', confidence: 0.9, source: 'official' },
    area: { value: { kind: 'system', systems: ['stanton'], places: [] }, confidence: 0.9, source: 'official' },
  } }).sheet;
  const edited = setByAdmin(approveField(stored, 'start'), 'venues', ['arena-commander']);
  const fresh = sheetFromModel({ fields: {
    venues: { value: ['verse'], confidence: 0.99, source: 'official' },     // would overwrite the admin edit
    start: { value: '2026-10-22', confidence: 0.99, source: 'official' },   // would overwrite the approval
    end: { value: '2026-11-12', confidence: 0.92, source: 'official' },     // official extension: wins
    area: { value: { kind: 'places', systems: ['stanton'], places: ['a'] }, confidence: 0.5, source: 'wiki' }, // weak: must not displace
    tasks: { value: [{ label: 'New task' }], confidence: 0.9, source: 'official' },
  } }).sheet;
  const merged = mergeSheets(edited, fresh);
  assert.deepEqual(merged.fields.venues.value, ['arena-commander']);
  assert.equal(merged.fields.venues.review, 'edited');
  assert.equal(merged.fields.start.value, '2026-10-21');
  assert.equal(merged.fields.start.review, 'approved');
  assert.equal(merged.fields.end.value, '2026-11-12');
  assert.equal(merged.fields.area.value.kind, 'system');
  assert.equal(merged.fields.tasks.value[0].label, 'New task');
  // an unknown fresh value keeps the stored one
  const wipe = mergeSheets(stored, sheetFromModel({}).sheet);
  assert.equal(wipe.fields.end.value, '2026-11-09');
  // a rejected reading stays rejected while the machine repeats it, but a different reading comes back as pending/auto
  const rejected = { ...stored, fields: { ...stored.fields, end: { ...stored.fields.end, review: 'rejected' } } };
  assert.equal(mergeSheets(rejected, sheetFromModel({ fields: { end: { value: '2026-11-09', confidence: 0.9, source: 'official' } } }).sheet).fields.end.review, 'rejected');
  assert.equal(mergeSheets(rejected, sheetFromModel({ fields: { end: { value: '2026-11-15', confidence: 0.9, source: 'official' } } }).sheet).fields.end.value, '2026-11-15');
  assert.equal(mergeSheets(null, fresh), fresh);
});

const link = (id, title, publishedAt, body) => ({ id, title, url: `https://robertsspaceindustries.com/en/comm-link/transmission/${id}-x`, publishedAt, body });

test('selectSources: source post first, titled posts in the window, mentions only as excerpts, capped', () => {
  const ev = fixtures.find((f) => f.event.id === 'dm-2956').event;
  const links = [
    link(21334, 'Alpha 4.10.2 RSI Discovery Month', '2026-10-09T13:00:00Z', 'announcement body'),
    link(21350, 'FAQ: RSI Discovery Month', '2026-10-10T10:00:00Z', 'faq body'),
    link(21300, 'RSI Discovery Month 2025 recap', '2025-01-01T00:00:00Z', 'old'),
    link(21360, 'This Week in Star Citizen', '2026-10-15T10:00:00Z', `${'filler '.repeat(500)}RSI Discovery Month ends soon.${' filler'.repeat(500)}`),
    link(21361, 'Unrelated post', '2026-10-15T10:00:00Z', 'nothing here'),
  ];
  const src = selectSources(ev, links);
  assert.deepEqual(src.map((s) => s.url.match(/transmission\/(\d+)/)[1]), ['21334', '21350', '21360']);
  assert.ok(src[2].text.length < 2000 && src[2].text.includes('RSI Discovery Month ends soon'));
  const many = Array.from({ length: 10 }, (_, i) => link(100 + i, `RSI Discovery Month part ${i}`, '2026-10-12T00:00:00Z', 'x'));
  assert.equal(selectSources(ev, many).length, MAX_LINKS_PER_EVENT);
});

test('nameStem / excerptAround / hashText', () => {
  assert.equal(nameStem('Intergalactic Aerospace Expo 2956'), 'Intergalactic Aerospace Expo');
  assert.equal(excerptAround('abc', 'zz'), '');
  assert.equal(excerptAround('x'.repeat(5000), 'IAE'), '');
  assert.ok(excerptAround(`${'a'.repeat(3000)} IAE starts ${'b'.repeat(3000)}`, 'iae', 50).includes('IAE starts'));
  assert.equal(hashText('abc'), hashText('abc'));
  assert.notEqual(hashText('abc'), hashText('abd'));
});

test('RSI pages that only return meta tags still give usable text; wiki misses give nothing', () => {
  const html = '<html><head><meta property="og:title" content="Day of the Vara 2956"><meta property="og:description" content="Survive &amp; claim the mask"><meta name="description" content="Survive &amp; claim the mask"></head><body><div id="app"></div></body></html>';
  assert.equal(extractMeta(html), 'Day of the Vara 2956\nSurvive & claim the mask');
  assert.equal(extractMeta('<html></html>'), '');
  assert.equal(parseWikiExtract({ query: { pages: { '-1': { missing: '' } } } }), '');
  assert.equal(parseWikiExtract({ query: { pages: { 7: { extract: ' Hello ' } } } }), 'Hello');
  assert.equal(parseWikiExtract(null), '');
});

test('pickEvents: new and running events first, hidden/cancelled/old skipped, capped', () => {
  const now = new Date('2026-11-08T12:00:00Z');
  const e = (id, start, end, extra = {}) => ({ id, series: id, name: id, start_date: start, end_date: end, date_status: 'confirmed', status: 'scheduled', source_comm_link_id: null, ...extra });
  const events = [
    e('running-fresh', '2026-10-21', '2026-11-09'), e('running-stale', '2026-10-09', '2026-11-30'),
    e('upcoming', '2026-11-13', '2026-11-27'), e('far', '2027-02-01', '2027-02-10'), e('ended-long', '2026-05-14', '2026-05-27'),
    e('hidden', '2026-11-01', '2026-11-20', { hidden: true }), e('cancelled', '2026-11-01', '2026-11-20', { status: 'cancelled' }),
    e('just-ended', '2026-10-25', '2026-11-06'),
  ];
  const state = new Map([
    ['running-fresh', { lastAiAt: '2026-11-08T08:00:00Z', lastHash: 'a' }],      // 4 h ago: not due
    ['running-stale', { lastAiAt: '2026-11-07T01:00:00Z', lastHash: 'a' }],      // > 20 h: due
    ['upcoming', { lastAiAt: '2026-11-07T01:00:00Z', lastHash: 'a' }],           // < 3 days: not due
    ['just-ended', { lastAiAt: '2026-11-05T00:00:00Z', lastHash: 'a' }],         // last pass was before the end: one more
  ]);
  const ids = pickEvents(events, state, new Map(), now).map((x) => x.id);
  assert.deepEqual(ids, ['running-stale', 'just-ended']);
  // a newer related comm-link makes a fresh running event due again
  const withLink = pickEvents(events, state, new Map([['running-fresh', '2026-11-08T10:00:00Z']]), now).map((x) => x.id);
  assert.ok(withLink.includes('running-fresh'));
  // never-run events lead
  assert.equal(pickEvents(events, new Map(), new Map(), now)[0].id, 'running-fresh');
  assert.ok(pickEvents(events, new Map(), new Map(), now).length <= 10);
});

test('index.ts imports the shared sheet module and holds no key or write path other than the RPC', { skip: noRead }, () => {
  const src = readFileSync(join(here, 'index.ts'), 'utf8');
  assert.match(src, /from '\.\.\/_shared\/event-sheet\.ts'/);
  assert.match(src, /sc_event_sheet_apply/);
  assert.doesNotMatch(src, /tool_choice:\s*\{\s*type:\s*'(tool|any)'/, 'forced tool_choice is a 400 on the current models');
  assert.doesNotMatch(src, /\.from\('sc_events'\)\s*\.(update|insert|upsert)/);
  assert.doesNotMatch(src, /sk-ant-/);
});

test('a conflicting community claim (replaced PTU track) does not win over the personal track', () => {
  const orison = fixtures.find((f) => f.event.id === 'orison-2956');
  const stored = sheetFromModel(orison.llm, orison.event).sheet;
  assert.equal(stored.fields.progress.review, 'auto');
  const stale = sheetFromModel({ fields: { progress: { value: { model: 'community', tracks: [
    { id: 'community', label: 'Community', unit: 'points', tiers: [{ at: 288000, label: 'Goal', rewardIds: [] }, { at: 72000, label: 'Half', rewardIds: [] }] },
  ] }, confidence: 0.4, source: 'wiki' } } }, orison.event).sheet;
  assert.equal(stale.fields.progress.review, 'pending');
  const merged = mergeSheets(stored, stale);
  assert.equal(merged.fields.progress.value.model, 'tiers');
  assert.deepEqual(merged.fields.progress.value.tracks.map((x) => x.id), ['relief']);
  assert.equal(publicSheet(merged).fields.progress.value.model, 'tiers');
});

test('a CORS preflight is answered, so the admin re-extract works from the browser', async () => {
  const res = preflight('OPTIONS');
  assert.ok(res);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('access-control-allow-headers'), /authorization/);
  assert.match(res.headers.get('access-control-allow-headers'), /x-client-info/);
  assert.equal(preflight('POST'), null);
  assert.equal(CORS['Access-Control-Allow-Origin'], '*');
});
