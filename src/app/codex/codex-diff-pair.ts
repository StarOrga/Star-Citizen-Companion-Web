import { CodexBuild } from './codex.types';

/** How many recent LIVE builds the diff looks through for a build of an older patch. */
export const DIFF_LOOKBACK = 6;

/**
 * The pair "what is new in this patch" compares: the newest LIVE build and,
 * as the baseline, the newest build of an OLDER patch. A rebuild of the same
 * patch (hotfix, re-extraction) is not the baseline: diffed against itself the
 * patch would have nothing new (4.10.2 build 12913470 against 12881860, both
 * 4.10.2 and identical, emptied the Codex landing's list). Only when every
 * retained build is of the same patch does the previous build stand in.
 * Fewer than two builds → null.
 */
export function diffPair(builds: readonly CodexBuild[]): [CodexBuild, CodexBuild] | null {
  if (builds.length < 2) return null;
  const [current] = builds;
  const older = builds.find((b) => b.patchVersion !== current.patchVersion);
  return [current, older ?? builds[1]];
}
