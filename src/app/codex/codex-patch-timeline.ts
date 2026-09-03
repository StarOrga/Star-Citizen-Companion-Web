import { comparePatchVersion } from './codex-format';
import { CodexBuild } from './codex.types';

/**
 * One selectable patch in the Codex patch switch (admin feedback 463872dd).
 *
 * The list is a UNION of two things the app already knows:
 *   · `codex_builds` (LIVE)            — patches we actually extracted data for
 *   · `p4k_bundles_public_stats`       — every patch anybody ever uploaded a
 *                                        bundle for, including ones that never
 *                                        produced a catalog build
 *
 * That union is what makes the "has data / has no data" marking honest: a patch
 * that only exists as a bundle is listed (so the history is complete) but can
 * never be selected, because switching to it would show an empty archive.
 */
export interface PatchTimelineEntry {
  /** Patch string as uploaded, e.g. `4.2.1`. */
  patchVersion: string;
  /** The catalog build backing this patch, or null when we have no data for it. */
  build: CodexBuild | null;
  /** True exactly when a catalog build exists — the switchable rows. */
  hasData: boolean;
  /** Sum of the build's entity counts, or null when unknown / no data. */
  recordCount: number | null;
  /** When the build was extracted (ISO), or null. */
  extractedAt: string | null;
  /** The patch the CURRENT live build reflects — the one the page defaults to. */
  isLive: boolean;
}

/** How many patches the switch reveals per page ("die letzten 5 patches"). */
export const PATCH_PAGE_SIZE = 5;

/**
 * Total records in a build's `entity_counts`. `seeded` is a nested breakdown,
 * not a count of its own, so it never adds to the total. Returns null when the
 * map carries no numbers at all (an old build without counts) rather than 0 —
 * "unknown" and "empty" are different statements to make about an archive.
 */
export function totalRecordCount(counts: Record<string, unknown> | null | undefined): number | null {
  if (!counts) return null;
  let total = 0;
  let found = false;
  for (const [k, v] of Object.entries(counts)) {
    if (k === 'seeded') continue;
    if (typeof v === 'number') {
      total += v;
      found = true;
    }
  }
  return found ? total : null;
}

/**
 * Merge catalog builds and uploaded patch versions into one newest-first
 * timeline. Newest first by tolerant numeric comparison (`4.10` > `4.9`), never
 * lexically. Duplicate patch versions collapse onto the first build seen — the
 * caller passes builds newest-first, so that is the freshest re-ingest of that
 * patch.
 */
export function buildPatchTimeline(
  builds: readonly CodexBuild[],
  uploadedPatches: readonly string[],
  livePatch: string | null,
): PatchTimelineEntry[] {
  const byPatch = new Map<string, PatchTimelineEntry>();

  for (const b of builds) {
    const patch = (b.patchVersion ?? '').trim();
    if (!patch || byPatch.has(patch)) continue;
    byPatch.set(patch, {
      patchVersion: patch,
      build: b,
      hasData: true,
      recordCount: totalRecordCount(b.entityCounts),
      extractedAt: b.extractedAt ?? null,
      isLive: !!livePatch && patch === livePatch,
    });
  }

  for (const raw of uploadedPatches) {
    const patch = (raw ?? '').trim();
    if (!patch || byPatch.has(patch)) continue;
    byPatch.set(patch, {
      patchVersion: patch,
      build: null,
      hasData: false,
      recordCount: null,
      extractedAt: null,
      isLive: !!livePatch && patch === livePatch,
    });
  }

  return [...byPatch.values()].sort((a, b) => comparePatchVersion(b.patchVersion, a.patchVersion));
}

/**
 * The slice a given page count reveals: page 1 = the newest 5, page 2 = the
 * newest 10, … The switch appends rather than replacing, so "mehr laden" reads
 * as more history rather than as a different list.
 */
export function visiblePatchPage(
  entries: readonly PatchTimelineEntry[],
  page: number,
): PatchTimelineEntry[] {
  const pages = Math.max(1, Math.floor(page));
  return entries.slice(0, pages * PATCH_PAGE_SIZE);
}

/** Is there anything left to reveal after `page` pages? */
export function hasMorePatches(entries: readonly PatchTimelineEntry[], page: number): boolean {
  return entries.length > Math.max(1, Math.floor(page)) * PATCH_PAGE_SIZE;
}
