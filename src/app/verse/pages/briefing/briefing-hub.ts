import type { PatchLineGroup } from '../../../news/patch-notes';
import type { StabilityVerdict } from '../../../news/patch-stability';
import type { VerseDigestItem } from '../../data/verse.models';

/** How long one gate's holo label stays on the planet before the next one takes over. */
export const GATE_LABEL_MS = 6500;

/** Patch lines in the hub's preview; fewer when the feed has fewer. */
export const HUB_PATCH_LINES = 3;
export const HUB_NEWS = 4;
export const HUB_GALLERY = 6;

export type HubPatchState = 'live' | 'ptu' | 'past';

export interface HubPatch {
  readonly line: string;
  readonly state: HubPatchState;
  readonly notes: number;
  readonly latestAt: string;
  /** Qualitative label (i18n key), null without stability data for the line. */
  readonly issuesKey: string | null;
  /** 0..100, shown small next to the label; null when there is no verdict yet. */
  readonly stability: number | null;
}

/**
 * Words before numbers: the stability level as "how many known problems".
 * A provisional verdict (too few samples) says so instead of guessing.
 */
export function issuesKey(v: StabilityVerdict | null): string | null {
  if (!v) return null;
  if (v.insufficient || v.level === null) return 'verse.hub.issues.early';
  return `verse.hub.issues.${v.level}`;
}

/** The newest patch lines (feed order) with their stability words; above the live line = still in testing. */
export function hubPatches(
  groups: readonly PatchLineGroup[],
  verdictFor: (line: string) => StabilityVerdict | null,
  max = HUB_PATCH_LINES,
): HubPatch[] {
  const lines = groups.filter((g) => g.line);
  const liveIdx = lines.findIndex((g) => g.isCurrentLive);
  return lines.slice(0, max).map((g, i): HubPatch => {
    const v = verdictFor(g.line);
    const state: HubPatchState = g.isCurrentLive ? 'live' : liveIdx < 0 || i < liveIdx ? 'ptu' : 'past';
    return {
      line: g.line,
      state,
      notes: g.entries.length,
      latestAt: g.latestAt,
      issuesKey: state === 'ptu' ? null : issuesKey(v),
      stability: state === 'ptu' || !v || v.insufficient ? null : v.stability,
    };
  });
}

/** Gallery previews: digest gallery items that carry an image, rank order. */
export function hubGallery(items: readonly VerseDigestItem[], max = HUB_GALLERY): VerseDigestItem[] {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => a.rank - b.rank)
    .filter((i) => i.kind === 'gallery' && !!i.image && !seen.has(i.key) && (seen.add(i.key), true))
    .slice(0, max);
}

/** The Verse kicker: "Live 4.3.1 · stabil 82 %" — the full LIVE version where the digest knows it. */
export function kickerVersion(channels: Readonly<Record<string, string>> | null | undefined, line: string | null): string | null {
  return channels?.['live'] || line;
}
