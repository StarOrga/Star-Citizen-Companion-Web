import { PatchLineGroup, compareVersionsDesc } from './patch-notes';
import { firstTestAt, liveReleaseAt } from './patch-stats';
import type { RoadmapPayload, RoadmapRelease } from './roadmap';

/**
 * The patch board's time stack (2026-09-04 rethink, iteration 4 / design Ⓚ).
 *
 * The board used to list every patch line as an equal accordion row, newest
 * first, with the roadmap's "next patch" living in a separate band above it —
 * which is how "4.10 · 4.11 · 4.9 · 4.8" ended up on one screen and the owner
 * asked why the patches were not in order. This module turns the lines into
 * ONE strictly monotonic stack in time direction:
 *
 *   next   — the build that comes after LIVE: a line already in a test ring
 *            (PTU / Evocati), or, failing that, the release RSI's roadmap
 *            names as "next" (no build yet);
 *   live   — the line you can play right now;
 *   last   — the line LIVE replaced, i.e. the newest one that is in no active
 *            status any more;
 *   older  — everything before that, folded away by default.
 *
 * Exactly the three cards the owner asked for open on arrival ("nur den
 * zukünftigen, den aktuellen und bis zum letzten Patch, der in keinem aktiven
 * Status ist"); the rest is reachable, never in the way.
 *
 * Pure: everything is derived from the grouped patch notes plus the roadmap
 * payload the board already holds. No new data source.
 */

export type StackStatus = 'next' | 'evocati' | 'ptu' | 'live' | 'superseded' | 'other';

export interface StackCard {
  /** Main patch line (`4.10`); '' for the unversioned bucket. */
  line: string;
  status: StackStatus;
  /** The grouped notes of this line — null for a roadmap-only "next". */
  group: PatchLineGroup | null;
  /** RSI's roadmap release for this line, when the payload carries one. */
  release: RoadmapRelease | null;
  /** When the line reached players (ms), or null while it has not. */
  liveAt: number | null;
  /** When the line first hit a test ring (ms), or null. */
  firstTestAt: number | null;
  /** For a superseded line: when the NEXT line went live and replaced it (ms). */
  supersededAt: number | null;
  hotfixCount: number;
  /** Newest hotfix thread of the line (ms), or null. */
  lastHotfixAt: number | null;
  /** Test-ring notes (build waves) of the line. */
  waveCount: number;
  noteCount: number;
  /** Roadmap items RSI lists for the line (0 without roadmap data). */
  plannedCount: number;
}

export interface PatchStack {
  next: StackCard | null;
  live: StackCard | null;
  last: StackCard | null;
  older: StackCard[];
}

function parsedTime(iso: string): number {
  return Date.parse(iso);
}

/** RSI's roadmap release for a patch line, if the payload names it. */
export function releaseFor(line: string, roadmap: RoadmapPayload | null): RoadmapRelease | null {
  if (!roadmap || !line) return null;
  if (roadmap.current?.patchLine === line) return roadmap.current;
  if (roadmap.next?.patchLine === line) return roadmap.next;
  return null;
}

function hotfixFacts(group: PatchLineGroup): { count: number; lastAt: number | null } {
  let count = 0;
  let lastAt: number | null = null;
  for (const entry of group.entries) {
    if (entry.facet !== 'hotfix') continue;
    count++;
    const t = parsedTime(entry.item.publishedAt);
    if (Number.isFinite(t) && (lastAt === null || t > lastAt)) lastAt = t;
  }
  return { count, lastAt };
}

/** Which test ring a not-yet-live line sits in: Evocati until a PTU note exists. */
function testStatus(group: PatchLineGroup): StackStatus {
  return group.entries.some((e) => e.facet === 'ptu') ? 'ptu' : 'evocati';
}

function cardOf(
  group: PatchLineGroup,
  status: StackStatus,
  roadmap: RoadmapPayload | null,
  supersededAt: number | null,
): StackCard {
  const hotfix = hotfixFacts(group);
  const release = releaseFor(group.line, roadmap);
  return {
    line: group.line,
    status,
    group,
    release,
    liveAt: liveReleaseAt(group),
    firstTestAt: firstTestAt(group),
    supersededAt,
    hotfixCount: hotfix.count,
    lastHotfixAt: hotfix.lastAt,
    waveCount: group.entries.filter((e) => e.facet === 'ptu' || e.facet === 'evocati').length,
    noteCount: group.entries.length,
    plannedCount: release?.cards.length ?? 0,
  };
}

/** A "next" card that exists only on the roadmap — no build has been posted yet. */
function plannedCard(release: RoadmapRelease): StackCard {
  return {
    line: release.patchLine,
    status: 'next',
    group: null,
    release,
    liveAt: null,
    firstTestAt: null,
    supersededAt: null,
    hotfixCount: 0,
    lastHotfixAt: null,
    waveCount: 0,
    noteCount: 0,
    plannedCount: release.cards.length,
  };
}

/**
 * Build the stack. `groups` is `groupPatchNotes()` output: newest line first,
 * exactly one group flagged `isCurrentLive`, the unversioned bucket (if any)
 * trailing with an empty `line`.
 */
export function buildPatchStack(
  groups: readonly PatchLineGroup[],
  roadmap: RoadmapPayload | null,
): PatchStack {
  const versioned = groups.filter((g) => g.line);
  const unversioned = groups.find((g) => !g.line) ?? null;
  const liveGroup = versioned.find((g) => g.isCurrentLive) ?? null;

  // Lines ABOVE live that have not shipped are the build(s) in testing. The
  // lowest of them is the immediate next release; anything higher is a
  // straggler we do not promote (the forecast module makes the same call).
  const ahead = versioned.filter(
    (g) => !g.hasLive && (liveGroup === null || compareVersionsDesc(g.segments, liveGroup.segments) < 0),
  );
  let next: StackCard | null = null;
  if (ahead.length > 0) {
    const lowest = ahead.reduce((acc, g) => (compareVersionsDesc(g.segments, acc.segments) > 0 ? g : acc));
    next = cardOf(lowest, testStatus(lowest), roadmap, null);
  } else if (roadmap?.next && roadmap.next.patchLine && roadmap.next.patchLine !== liveGroup?.line) {
    next = plannedCard(roadmap.next);
  }

  const live = liveGroup ? cardOf(liveGroup, 'live', roadmap, null) : null;

  // Everything that shipped before the live line, newest first. A line that
  // never reached LIVE and sits below the live one (a cancelled build, a feed
  // gap) is history too — it is superseded by definition.
  const history = versioned.filter(
    (g) => g !== liveGroup && !ahead.includes(g) && (liveGroup === null || compareVersionsDesc(g.segments, liveGroup.segments) > 0),
  );
  const cards: StackCard[] = [];
  let newerLiveAt: number | null = live?.liveAt ?? null;
  for (const g of history) {
    const card = cardOf(g, 'superseded', roadmap, newerLiveAt);
    cards.push(card);
    if (card.liveAt !== null) newerLiveAt = card.liveAt;
  }
  const last = cards.shift() ?? null;
  if (unversioned) cards.push(cardOf(unversioned, 'other', roadmap, null));

  return { next, live, last, older: cards };
}

/** Every card of the stack in display order (top = future). */
export function stackCards(stack: PatchStack): StackCard[] {
  return [stack.next, stack.live, stack.last, ...stack.older].filter((c): c is StackCard => c !== null);
}

/** The card for one line — what the dossier route resolves its `:line` against. */
export function stackCardFor(
  line: string,
  groups: readonly PatchLineGroup[],
  roadmap: RoadmapPayload | null,
): StackCard | null {
  return stackCards(buildPatchStack(groups, roadmap)).find((c) => c.line === line) ?? null;
}

/**
 * The previous LIVE line of a card — the left end of its cycle. Walks the
 * versioned groups below the card's line for the nearest one that shipped.
 */
export function previousLiveAt(card: StackCard, groups: readonly PatchLineGroup[]): number | null {
  const segments = card.group?.segments ?? card.line.split('.').map(Number);
  const below = groups
    .filter((g) => g.line && g.hasLive && compareVersionsDesc(g.segments, segments) > 0)
    .map((g) => liveReleaseAt(g))
    .filter((t): t is number => t !== null);
  return below.length ? Math.max(...below) : null;
}
