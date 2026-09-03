import {
  PATCH_PAGE_SIZE,
  buildPatchTimeline,
  hasMorePatches,
  totalRecordCount,
  visiblePatchPage,
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
    const entries = buildPatchTimeline([build('4.2'), build('4.1')], ['4.3', '4.2'], '4.2');

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
    const entries = buildPatchTimeline([build('4.9'), build('4.10')], ['4.9', '4.8'], '4.10');

    expect(entries.map((e) => e.patchVersion)).toEqual(['4.10', '4.9', '4.8']);
  });

  it('flags exactly the live patch', () => {
    const entries = buildPatchTimeline([build('4.2'), build('4.1')], [], '4.2');

    expect(entries.filter((e) => e.isLive).map((e) => e.patchVersion)).toEqual(['4.2']);
  });

  it('keeps the FIRST (freshest) build when one patch was ingested twice', () => {
    const entries = buildPatchTimeline(
      [build('4.2', { id: 'fresh' }), build('4.2', { id: 'stale' })],
      [],
      '4.2',
    );

    expect(entries.length).toBe(1);
    expect(entries[0].build?.id).toBe('fresh');
  });

  it('pages five at a time and appends instead of replacing', () => {
    const patches = ['4.9', '4.8', '4.7', '4.6', '4.5', '4.4', '4.3'];
    const entries = buildPatchTimeline(patches.map((p) => build(p)), [], '4.9');

    expect(PATCH_PAGE_SIZE).toBe(5);
    expect(visiblePatchPage(entries, 1).map((e) => e.patchVersion)).toEqual([
      '4.9', '4.8', '4.7', '4.6', '4.5',
    ]);
    expect(visiblePatchPage(entries, 2).map((e) => e.patchVersion)).toEqual(patches);
    expect(hasMorePatches(entries, 1)).toBeTrue();
    expect(hasMorePatches(entries, 2)).toBeFalse();
  });

  it('treats a page below 1 as the first page', () => {
    const entries = buildPatchTimeline(['4.3', '4.2'].map((p) => build(p)), [], '4.3');

    expect(visiblePatchPage(entries, 0).length).toBe(2);
    expect(hasMorePatches(entries, 0)).toBeFalse();
  });

  it('sums entity counts, ignores the seeded breakdown and reports unknown as null', () => {
    expect(totalRecordCount({ ships: 3, items: 4, seeded: { ships: 99 } })).toBe(7);
    expect(totalRecordCount({})).toBeNull();
    expect(totalRecordCount(null)).toBeNull();
  });

  it('ignores blank patch versions from either source', () => {
    const entries = buildPatchTimeline([build('  ')], ['', '4.1'], null);

    expect(entries.map((e) => e.patchVersion)).toEqual(['4.1']);
    expect(entries[0].isLive).toBeFalse();
  });
});
