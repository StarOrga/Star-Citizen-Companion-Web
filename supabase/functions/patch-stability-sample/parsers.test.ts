// supabase/functions/patch-stability-sample/parsers.test.ts
// Pure logic, no Deno APIs — runs under `node --test` and `deno test` alike:
//   node --test supabase/functions/patch-stability-sample/parsers.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLiveThreads,
  kbSnapshot,
  parseCigFixSentence,
  parseHotfixEvents,
  patchLineOfTitle,
  statusWindow,
  ticketIdsOf,
  topReplyMetrics,
} from './parsers.ts';

const block = (type: string, text: string) => ({ type, text, depth: 0, inlineStyleRanges: [], entityRanges: [] });
const container = (blocks: unknown[]) => [{ type: 'text', data: { blocks, entityMap: {} } }];

test('patchLineOfTitle: first two segments of the Alpha version', () => {
  assert.equal(patchLineOfTitle('Star Citizen Alpha 4.10 LIVE Release Notes'), '4.10');
  assert.equal(patchLineOfTitle('Star Citizen Alpha 4.7.2 LIVE - Hotfix Central [Updated 4.27.2026]'), '4.7');
  assert.equal(patchLineOfTitle('Star Citizen Alpha 4.1 LIVE 9650658 Release Notes'), '4.1');
  assert.equal(patchLineOfTitle('[All Backer PTU] Star Citizen Alpha 4.7 RC1 11506930 PTU Patch Notes'), '4.7');
  assert.equal(patchLineOfTitle('Something else'), '');
});

test('detectLiveThreads: RN + Hotfix Central per line, PTU/hotfix point releases ignored', () => {
  const rows = [
    { id: 568266, slug: 'hf410', subject: 'Star Citizen Alpha 4.10 LIVE - Hotfix Central  (Updated 9.3.2026)', time_created: 1787900000, replies_count: 271, votes: { count: 159 } },
    { id: 568009, slug: 'rn410', subject: 'Star Citizen Alpha 4.10 LIVE Release Notes', time_created: 1787820000, replies_count: 78, votes: { count: 89 } },
    { id: 1, slug: 'ptu', subject: '[Wave 1 PTU] Star Citizen Alpha 4.10 11429312 PTU Patch Notes', time_created: 1787000000, replies_count: 5, votes: { count: 1 } },
    { id: 542278, slug: 'hf47', subject: 'Star Citizen Alpha 4.7.2 LIVE - Hotfix Central [Updated 4.27.2026]', time_created: 1774500000, replies_count: 0, votes: { count: 1 } },
    { id: 542069, slug: 'rn47', subject: 'Star Citizen Alpha 4.7 LIVE Release Notes', time_created: 1774400000, replies_count: 180, votes: { count: 84 } },
    { id: 557337, slug: 'hf481', subject: 'Star Citizen Alpha 4.8.1 LIVE - Hotfix 11952564', time_created: 1780700000, replies_count: 765, votes: { count: 10 } },
    { id: 9, slug: 'old', subject: 'Star Citizen Alpha 3.24.1 9324446 LIVE Patch Notes', time_created: 1726200000, replies_count: 188, votes: { count: 2 } },
  ];
  const lines = detectLiveThreads(rows);
  assert.deepEqual(lines.map((l) => l.line), ['4.10', '4.7', '3.24']);
  assert.equal(lines[0].notes.id, 568009);
  assert.equal(lines[0].hotfix?.id, 568266);
  assert.equal(lines[1].hotfix?.id, 542278);
  assert.equal(lines[2].hotfix, null);
  assert.equal(lines[0].liveAt, new Date(1787820000 * 1000).toISOString());
});

test('parseHotfixEvents: ► dated blockquotes, M.D.YYYY → ISO, build number when present', () => {
  const blocks = container([
    block('header-one', 'Current 4.10 LIVE Status | 9.3.2026'),
    block('blockquote', '►9.3.2026: Client Hotfix 12572603 - Client side now on LIVE'),
    block('unordered-list-item', 'The HOTFIX channel is currently up with a client side crash fix'),
    block('blockquote', '► 8.28.2026: Hotfix 12545750 now on LIVE'),
    block('blockquote', '► 8.27.2026: Hotfix 12535871  is now on the HOTFIX channel and select shards on LIVE'),
    block('blockquote', 'Ships & Vehicles'),
  ]);
  const events = parseHotfixEvents(blocks);
  assert.deepEqual(events, [
    { date: '2026-09-03', build: '12572603', text: 'Client Hotfix 12572603 - Client side now on LIVE' },
    { date: '2026-08-28', build: '12545750', text: 'Hotfix 12545750 now on LIVE' },
    { date: '2026-08-27', build: '12535871', text: 'Hotfix 12535871 is now on the HOTFIX channel and select shards on LIVE' },
  ]);
});

test('parseCigFixSentence: both phrasings CIG has used', () => {
  assert.deepEqual(
    parseCigFixSentence('This release closes 479 bug fixes, with 101 of them originating from the issue council. This includes work to fix 47 crash and stability issues and 17 exploits.'),
    { fixes: 479, fromIssueCouncil: 101, crashFixes: 47, exploitFixes: 17 },
  );
  assert.deepEqual(
    parseCigFixSentence('Star Citizen Alpha 4.9 contains over 166 bug and crash fixes since 4.8 went live. 73 of which originated from the issue council.'),
    { fixes: 166, fromIssueCouncil: 73, crashFixes: null, exploitFixes: null },
  );
  assert.equal(parseCigFixSentence('no numbers here'), null);
});

test('ticketIdsOf: STARC ids inline and inside issue-council urls, de-duplicated', () => {
  assert.deepEqual(
    ticketIdsOf('#STARC-218134 and https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/STARC-214936#contribution:x and STARC-218134 again'),
    ['STARC-218134', 'STARC-214936'],
  );
  assert.deepEqual(ticketIdsOf('nothing'), []);
});

test('topReplyMetrics: share of ticket-bearing replies, vote share, top tickets by votes', () => {
  const reply = (votes: number, text: string, t = 1787900000) => ({
    votes: { count: votes }, time_created: t,
    content_blocks: container([block('unstyled', text)]),
  });
  const m = topReplyMetrics([
    reply(82, 'Thank you for the potential Linux fix'),
    reply(16, 'Fix distro centers https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/STARC-214936'),
    reply(13, 'Could you please fix #STARC-218134 Battaglia Story Mission 2'),
    reply(9, 'Med gun is still desynced. STARC-218272'),
  ]);
  assert.equal(m.count, 4);
  assert.equal(m.ticketShare, 0.75);
  assert.equal(m.ticketVoteShare, (16 + 13 + 9) / (82 + 16 + 13 + 9));
  assert.deepEqual(m.tickets.map((t) => t.id), ['STARC-214936', 'STARC-218134', 'STARC-218272']);
  assert.equal(m.tickets[0].votes, 16);
  assert.ok(m.tickets[0].excerpt.startsWith('Fix distro centers'));
  const empty = topReplyMetrics([]);
  assert.deepEqual(empty, { count: 0, ticketShare: 0, ticketVoteShare: 0, tickets: [] });
});

test('statusWindow: unplanned minutes inside the window, open incident flag, maintenance ignored', () => {
  const issues = [
    { is: 'issue', title: 'Live Deployment', createdAt: '2026-08-26 14:15:00 +0000 UTC', severity: 'maintenance', resolved: true, resolvedAt: '2026-08-26 18:30:00', affected: ['Persistent Universe'] },
    { is: 'issue', title: 'Live Services Disruption', createdAt: '2026-06-09 00:30:00 +0000 UTC', severity: 'degraded', resolved: true, resolvedAt: '2026-06-17 14:50:00', affected: ['Persistent Universe'] },
    { is: 'issue', title: 'Live Services Disruption', createdAt: '2026-06-17 17:30:00 +0000 UTC', severity: 'degraded', resolved: false, resolvedAt: '', affected: ['Persistent Universe'] },
    { is: 'page', title: 'not an issue', createdAt: '0001-01-01 00:00:00 +0000 UTC', severity: '', resolved: true, resolvedAt: '', affected: [] },
  ];
  const w = statusWindow(issues, '2026-06-01T00:00:00Z', '2026-06-18T00:00:00Z');
  // 2026-06-09 00:30 → 06-17 14:50 = 8 d 14 h 20 m = 12380 min; the open one counts until the window end: 06-17 17:30 → 06-18 00:00 = 390 min
  assert.equal(w.unplannedMinutes, 12380 + 390);
  assert.equal(w.unplannedCount, 2);
  assert.equal(w.openIncident, true);
  const later = statusWindow(issues, '2026-08-20T00:00:00Z', '2026-09-05T00:00:00Z');
  assert.equal(later.unplannedMinutes, 0);
  assert.equal(later.openIncident, false);
});

test('kbSnapshot: anchored entries per h1 section, null when the title names another patch', () => {
  const article = {
    title: 'Star Citizen Alpha 4.10 Known Issues',
    edited_at: '2026-09-01T19:04:24Z',
    body: '<p>intro</p><h1>Technical Issues</h1><h2 id="h_01A">Error 403</h2><h3 id="h_01B">Error 41013</h3><h1>Ship Issues</h1><h2 id="h_02A">Docked Ships</h2><h2>no anchor</h2>',
  };
  const snap = kbSnapshot(article, '4.10');
  assert.deepEqual(snap, {
    openTotal: 3,
    bySection: { 'Technical Issues': 2, 'Ship Issues': 1 },
    anchorIds: ['h_01A', 'h_01B', 'h_02A'],
    editedAt: '2026-09-01T19:04:24Z',
  });
  assert.equal(kbSnapshot(article, '4.9'), null);
});
