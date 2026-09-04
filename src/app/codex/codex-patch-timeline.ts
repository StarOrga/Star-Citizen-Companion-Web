import { comparePatchVersion } from './codex-format';
import { CodexBuild } from './codex.types';

/**
 * One selectable patch in the Codex patch switch (admin feedback 463872dd,
 * refined by f68c6c6b).
 *
 * The list is a UNION of three things the app already knows:
 *   · `codex_builds` (LIVE)            — patches we actually extracted data for
 *   · `p4k_bundles_public_stats`       — every patch anybody ever uploaded a
 *                                        bundle for, including ones that never
 *                                        produced a catalog build
 *   · RSI's published patch lines      — from the Verse-News feed the shell
 *                                        already holds (see mergePublishedPatches)
 *
 * That union is what makes the "has data / has no data" marking honest: a patch
 * that only exists as a bundle — or that RSI shipped before anybody uploaded it —
 * is listed (so the reader sees a newer patch exists) but can never be selected,
 * because switching to it would show an empty archive.
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
}

/**
 * How many patches the switch shows at most — "nur 3 Patches dadrin maximal
 * anzeigen, also die letzten drei" (admin feedback f68c6c6b). A hard cap, not a
 * page size: there is no "load older" any more, because a time machine that
 * scrolls is a browser, not a switch.
 */
export const PATCH_SWITCH_MAX = 3;

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
    });
  }

  return [...byPatch.values()].sort((a, b) => comparePatchVersion(b.patchVersion, a.patchVersion));
}

/**
 * Add the patches RSI has already shipped but nobody uploaded data for.
 *
 * `publishedPatches` comes from the Verse-News patch notes the shell already
 * holds in memory (the header's status chip fetches that feed on every route),
 * so this costs no request and adds no new external dependency.
 *
 * Only versions strictly NEWER than everything we know are added — the admin
 * asked for "falls es aktuellere Patches gibt", not for a complete RSI history,
 * and a gap in the middle of our own archive is not something a data upload can
 * fix. Comparison is numeric and tolerant, so the published line `4.10` and our
 * build `4.10.0` are the same patch and never both appear.
 *
 * An empty timeline stays empty: with no build of our own there is nothing to
 * be newer than, and a list of unreachable patches would be a dead control.
 */
export function mergePublishedPatches(
  entries: readonly PatchTimelineEntry[],
  publishedPatches: readonly string[],
): PatchTimelineEntry[] {
  const known = [...entries];
  if (known.length === 0) return known;
  const newest = known[0].patchVersion;

  for (const raw of publishedPatches) {
    const patch = (raw ?? '').trim();
    if (!patch) continue;
    if (comparePatchVersion(patch, newest) <= 0) continue;
    if (known.some((e) => comparePatchVersion(e.patchVersion, patch) === 0)) continue;
    known.push({
      patchVersion: patch,
      build: null,
      hasData: false,
      recordCount: null,
      extractedAt: null,
    });
  }

  return known.sort((a, b) => comparePatchVersion(b.patchVersion, a.patchVersion));
}

/**
 * The newest {@link PATCH_SWITCH_MAX} patches — the whole list the switch ever
 * shows (admin feedback f68c6c6b).
 *
 * One guarantee on top of the plain slice: if the cap would leave nothing
 * selectable — every visible patch data-less because our archive fell three
 * patches behind — the oldest visible row makes way for the newest patch we do
 * hold data for. A switch you cannot switch with is a dead control.
 */
export function latestPatches(
  entries: readonly PatchTimelineEntry[],
  max: number = PATCH_SWITCH_MAX,
): PatchTimelineEntry[] {
  const cap = Math.max(1, Math.floor(max));
  const visible = entries.slice(0, cap);
  if (visible.some((e) => e.hasData)) return visible;
  const firstWithData = entries.find((e) => e.hasData);
  if (!firstWithData) return visible;
  return [...visible.slice(0, cap - 1), firstWithData];
}
