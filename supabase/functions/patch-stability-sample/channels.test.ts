// supabase/functions/patch-stability-sample/channels.test.ts
//   node --test supabase/functions/patch-stability-sample/channels.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  channelOfTitle,
  compareVersions,
  groupChannelBuilds,
  liveVersionOf,
  newestHotfixDate,
  versionOfTitle,
  waveOfTitle,
} from './channels.ts';

const NOW = new Date('2026-10-28T12:00:00Z');
const th = (id: number, subject: string, daysAgo: number, replies = 10) => ({
  id,
  slug: `s${id}`,
  subject,
  time_created: Math.floor(NOW.getTime() / 1000) - daysAgo * 86400,
  replies_count: replies,
});

test('waveOfTitle reads "Wave N", never a build number or "All Waves"', () => {
  assert.equal(waveOfTitle('[Wave 1] Star Citizen Alpha 4.10.3 PTU Patch Notes 12999338'), 1);
  assert.equal(waveOfTitle('[Wave 3 PTU] Star Citizen Alpha 4.10.2 PTU Patch Notes 12811422'), 3);
  assert.equal(waveOfTitle('[wave2] Star Citizen Alpha 4.11 PTU Patch Notes'), 2);
  assert.equal(waveOfTitle('[All Waves] Star Citizen Alpha 4.10 PTU Patch Notes 12479687'), null);
  assert.equal(waveOfTitle('[All Backers] Star Citizen Alpha 4.10.2 PTU Patch Notes 12852255'), null);
});

test('channelOfTitle / versionOfTitle: PTU, Evocati, Hotfix Central; LIVE notes and tech previews are none', () => {
  assert.equal(channelOfTitle('[Wave 1] Star Citizen Alpha 4.10.3 PTU Patch Notes 12999338'), 'ptu');
  assert.equal(channelOfTitle('[Evocati NDA] Star Citizen Alpha 4.10.2 PTU Patch Notes 12702947'), 'evocati');
  assert.equal(channelOfTitle('Star Citizen Alpha 4.10.2 LIVE - Hotfix Central  (Updated 10.17.2026)'), 'hotfix');
  assert.equal(channelOfTitle('Star Citizen Alpha 4.10.2 LIVE Release Notes'), null);
  assert.equal(channelOfTitle('[All Backer] TTK TTD Balance Test Tech-Preview #3'), null);
  assert.equal(versionOfTitle('Star Citizen Alpha 4.10.2 LIVE - Hotfix Central  (Updated 10.17.2026)'), '4.10.2');
  assert.ok(compareVersions('4.10', '4.9') > 0);
  assert.ok(compareVersions('4.10.1', '4.10') > 0);
});

test('groupChannelBuilds: start date, wave of the newest thread, running flags', () => {
  const rows = [
    th(1, '[Wave 1] Star Citizen Alpha 4.10.3 PTU Patch Notes 12999338', 5, 121),
    th(2, 'Star Citizen Alpha 4.10.2 LIVE Release Notes', 19),
    th(3, 'Star Citizen Alpha 4.10.2 LIVE - Hotfix Central  (Updated 10.17.2026)', 62, 339),
    th(4, '[All Backer] Star Citizen Alpha 4.10.2 PTU RC2 Patch Notes 12878398', 21, 106),
    th(5, '[Wave 3] Star Citizen Alpha 4.10.2 PTU Patch Notes 12839153', 27, 62),
    th(6, '[Wave 1] Star Citizen Alpha 4.10.2 PTU Patch Notes 12770507', 33, 214),
    th(7, '[Evocati NDA] Star Citizen Alpha 4.10.2 PTU Patch Notes 12702947', 37, 117),
  ];
  assert.equal(liveVersionOf(rows), '4.10.2');
  const started = newestHotfixDate([
    { date: '2026-10-17', build: '', text: '' },
    { date: '2026-10-09', build: '', text: '' },
  ]);
  const builds = groupChannelBuilds(rows, NOW, new Map([[3, started!]]));
  const get = (c: string, v: string) => builds.find((b) => b.channel === c && b.version === v)!;
  const ptu = get('ptu', '4.10.3');
  assert.equal(ptu.wave, 1);
  assert.equal(ptu.startedAt, '2026-10-23T12:00:00.000Z');
  assert.ok(ptu.running);
  const old = get('ptu', '4.10.2');
  assert.equal(old.threadCount, 3);
  assert.equal(old.replies, 106 + 62 + 214);
  assert.equal(old.wave, null, 'newest thread of 4.10.2 is "RC2", not a wave');
  assert.equal(old.startedAt, '2026-09-25T12:00:00.000Z', 'first PTU thread, not the Evocati one');
  assert.ok(!old.running);
  assert.ok(!get('evocati', '4.10.2').running, 'not above LIVE');
  const hot = get('hotfix', '4.10.2');
  assert.equal(hot.startedAt, '2026-10-17T00:00:00.000Z');
  assert.ok(hot.running);
});

test('groupChannelBuilds: Evocati runs only until a PTU reaches its version; a stale hotfix is quiet', () => {
  const evoOnly = [
    th(1, 'Star Citizen Alpha 4.11 LIVE Release Notes', 90),
    th(2, '[Evocati NDA] Star Citizen Alpha 4.12 PTU Patch Notes 13000000', 2),
    th(3, 'Star Citizen Alpha 4.11 LIVE - Hotfix Central', 80),
  ];
  const a = groupChannelBuilds(evoOnly, NOW, new Map([[3, '2026-08-01T00:00:00.000Z']]));
  assert.ok(a.find((b) => b.channel === 'evocati')!.running);
  assert.ok(!a.find((b) => b.channel === 'hotfix')!.running, 'last hotfix event 88 days ago');
  const withPtu = groupChannelBuilds([...evoOnly, th(4, '[Wave 1] Star Citizen Alpha 4.12 PTU Patch Notes 13000100', 1)], NOW);
  assert.ok(!withPtu.find((b) => b.channel === 'evocati')!.running);
  assert.ok(withPtu.find((b) => b.channel === 'ptu')!.running);
  assert.equal(newestHotfixDate([]), null);
});
