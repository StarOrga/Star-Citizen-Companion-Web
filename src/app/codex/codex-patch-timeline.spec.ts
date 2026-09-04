import {
  PATCH_SWITCH_MAX,
  buildPatchTimeline,
  latestPatches,
  mergePublishedPatches,
  totalRecordCount,
} from './codex-patch-timeline';
import { CodexBuild } from './codex.types';

function build(patch: string, over: Partial<CodexBuild> = {}): CodexBuild {
  return {
    id: `build-${patch}`,
    channel: 'LIVE',
    patchVersion: patch,
    buildNumber: 'desktop',
    schemaVersion: 1,
    qualityScore: null,
    toolVersion: null,
    entityCounts: { ships: 10, items: 20 },
    isCurrent: false,
    extractedAt: '2026-08-02T20:29:00Z',
    ...over,
  };
}

describe('codex patch timeline', () => {
  it('marks patches WITH a catalog build as selectable and upload-only patches as data-less', () => {
    const entries = buildPatchTimeline([build('4.2'), build('4.1')], ['4.3', '4.2']);

    const byPatch = new Map(entries.map((e) => [e.patchVersion, e]));
    expect(byPatch.get('4.2')?.hasData).toBeTrue();
    expect(byPatch.get('4.2')?.build?.id).toBe('build-4.2');
    expect(byPatch.get('4.1')?.hasData).toBeTrue();
    // Uploaded, but never turned into a catalog build → listed, not switchable.
    expect(byPatch.get('4.3')?.hasData).toBeFalse();
    expect(byPatch.get('4.3')?.build).toBeNull();
    expect(byPatch.get('4.3')?.recordCount).toBeNull();
  });

  it('sorts newest first NUMERICALLY (4.10 above 4.9) and never duplicates a patch', () => {
    const entries = buildPatchTimeline([build('4.9'), build('4.10')], ['4.9', '4.8']);

    expect(entries.map((e) => e.patchVersion)).toEqual(['4.10', '4.9', '4.8']);
  });

  it('keeps the FIRST (freshest) build when one patch was ingested twice', () => {
    const entries = buildPatchTimeline(
      [build('4.2', { id: 'fresh' }), build('4.2', { id: 'stale' })],
      [],
    );

    expect(entries.length).toBe(1);
    expect(entries[0].build?.id).toBe('fresh');
  });

  it('shows the latest three patches and nothing older (f68c6c6b)', () => {
    const patches = ['4.9', '4.8', '4.7', '4.6', '4.5', '4.4', '4.3'];
    const entries = buildPatchTimeline(patches.map((p) => build(p)), []);

    expect(PATCH_SWITCH_MAX).toBe(3);
    expect(latestPatches(entries).map((e) => e.patchVersion)).toEqual(['4.9', '4.8', '4.7']);
    // Shorter than the cap → the whole list, no padding, no error.
    expect(latestPatches(entries.slice(0, 2)).map((e) => e.patchVersion)).toEqual(['4.9', '4.8']);
    expect(latestPatches([])).toEqual([]);
  });

  it('always keeps one selectable patch visible, even behind three data-less ones', () => {
    const entries = mergePublishedPatches(buildPatchTimeline([build('4.6')], []), [
      '4.9', '4.8', '4.7',
    ]);

    expect(entries.map((e) => e.patchVersion)).toEqual(['4.9', '4.8', '4.7', '4.6']);
    // A plain slice would show three inert rows and nothing to switch to.
    const visible = latestPatches(entries);
    expect(visible.map((e) => e.patchVersion)).toEqual(['4.9', '4.8', '4.6']);
    expect(visible.filter((e) => e.hasData).map((e) => e.patchVersion)).toEqual(['4.6']);
  });

  it('lists a published patch we hold no data for, and never duplicates one we do', () => {
    const entries = mergePublishedPatches(buildPatchTimeline([build('4.10')], ['4.9']), [
      '4.11', '4.10', '4.9', '4.8', '',
    ]);

    expect(entries.map((e) => e.patchVersion)).toEqual(['4.11', '4.10', '4.9']);
    // Shipped by RSI, never uploaded → visible, but not switchable.
    expect(entries[0].hasData).toBeFalse();
    expect(entries[0].build).toBeNull();
    // `4.10` is the same patch as our build `4.10` — merged, not doubled. And
    // older published lines are not our archive's business.
    expect(entries[1].hasData).toBeTrue();
  });

  it('treats a published point release as the line we already hold (4.10 === 4.10.0)', () => {
    const entries = mergePublishedPatches(buildPatchTimeline([build('4.10.0')], []), ['4.10']);

    expect(entries.map((e) => e.patchVersion)).toEqual(['4.10.0']);
  });

  it('adds nothing to an empty timeline — there would be nothing to switch to', () => {
    expect(mergePublishedPatches([], ['4.11', '4.10'])).toEqual([]);
  });

  it('sums entity counts, ignores the seeded breakdown and reports unknown as null', () => {
    expect(totalRecordCount({ ships: 3, items: 4, seeded: { ships: 99 } })).toBe(7);
    expect(totalRecordCount({})).toBeNull();
    expect(totalRecordCount(null)).toBeNull();
  });

  it('ignores blank patch versions from either source', () => {
    const entries = buildPatchTimeline([build('  ')], ['', '4.1']);

    expect(entries.map((e) => e.patchVersion)).toEqual(['4.1']);
  });
});
