// node --test supabase/functions/patch-teaser/_sweep.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SWEEP_MAX, cleanVersion, liveVersionOfSlug, pickSweepTargets, versionOfNotesThread, wantedVersions } from './_sweep.ts';

const threads = [
  { slug: 'ptu-4-11-0', subject: 'Star Citizen Alpha 4.11.0 PTU.100 Patch Notes' },
  { slug: 'hotfix-4-10', subject: 'Star Citizen Alpha 4.10.3 LIVE Hotfix Central' },
  { slug: 'live-4-10-3', subject: 'Star Citizen Alpha 4.10.3 LIVE.200 Patch Notes' },
  { slug: 'live-4-10-3-old', subject: 'Star Citizen Alpha 4.10.3 LIVE.150 Patch Notes' },
  { slug: 'evo-4-12-0', subject: 'Star Citizen Alpha 4.12.0 Evocati Patch Notes' },
];
const none = new Set();

describe('versions', () => {
  it('cleans build strings and rejects junk', () => {
    assert.equal(cleanVersion('4.8.0-LIVE.1825000'), '4.8.0');
    assert.equal(cleanVersion('4.11'), '4.11');
    assert.equal(cleanVersion('x'), '');
    assert.equal(cleanVersion(null), '');
  });
  it('reads notes threads only, never Hotfix Central', () => {
    assert.equal(versionOfNotesThread(threads[0].subject), '4.11.0');
    assert.equal(versionOfNotesThread(threads[1].subject), '');
    assert.equal(versionOfNotesThread('Alpha 4.11.0 discussion'), '');
  });
  it('merges and de-duplicates wanted versions', () => {
    assert.deepEqual(wantedVersions(['4.10.3-LIVE.1', '4.11.0'], ['4.11.0', '', '4.12.0']), ['4.10.3', '4.11.0', '4.12.0']);
  });
});

describe('pickSweepTargets', () => {
  const wanted = ['4.10.3', '4.11.0', '4.12.0'];
  it('picks every wanted version that has a thread, newest thread wins', () => {
    const t = pickSweepTargets({ wanted, threads, have: none, recentlyTried: none });
    assert.deepEqual(t.map((x) => [x.version, x.slug]), [['4.10.3', 'live-4-10-3'], ['4.11.0', 'ptu-4-11-0'], ['4.12.0', 'evo-4-12-0']]);
  });
  it('skips versions that already have a row (idempotent)', () => {
    const t = pickSweepTargets({ wanted, threads, have: new Set(['4.10.3', '4.11.0']), recentlyTried: none });
    assert.deepEqual(t.map((x) => x.version), ['4.12.0']);
    assert.deepEqual(pickSweepTargets({ wanted, threads, have: new Set(wanted), recentlyTried: none }), []);
  });
  it('skips versions tried within the cooldown, so failures cannot burn tokens', () => {
    const t = pickSweepTargets({ wanted, threads, have: none, recentlyTried: new Set(['4.10.3', '4.12.0']) });
    assert.deepEqual(t.map((x) => x.version), ['4.11.0']);
  });
  it('skips versions without a notes thread', () => {
    assert.deepEqual(pickSweepTargets({ wanted: ['9.9.9'], threads, have: none, recentlyTried: none }), []);
  });
  it('caps one call', () => {
    const many = Array.from({ length: 8 }, (_, i) => `4.${20 + i}.0`);
    const th = many.map((v) => ({ slug: `s-${v}`, subject: `Alpha ${v} PTU Patch Notes` }));
    assert.equal(pickSweepTargets({ wanted: many, threads: th, have: none, recentlyTried: none }).length, SWEEP_MAX);
  });
});

describe('LIVE version (patch_versions is empty in production)', () => {
  it('reads it from the LIVE release-notes slug', () => {
    assert.equal(liveVersionOfSlug('star-citizen-alpha-4-10-2-live-release-notes'), '4.10.2');
    assert.equal(liveVersionOfSlug('star-citizen-alpha-4-9-live-release-notes'), '4.9');
    assert.equal(liveVersionOfSlug('whatever'), '');
  });
  it('sweeps the LIVE version using its known slug even when no thread of the list matches', () => {
    const slug = 'star-citizen-alpha-4-10-2-live-release-notes';
    const live = liveVersionOfSlug(slug);
    const wanted = wantedVersions([live], ['4.10.3']);
    const t = pickSweepTargets({ wanted, threads: [], have: new Set(['4.10.3']), recentlyTried: new Set(), knownSlugs: { [live]: slug } });
    assert.deepEqual(t, [{ version: '4.10.2', slug }]);
  });
});
