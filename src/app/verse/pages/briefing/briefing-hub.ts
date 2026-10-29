import type { PatchLineGroup } from '../../../news/patch-notes';
import { channelStability } from '../../../news/patch-stability';
import type { ChannelBuildSample, StabilityVerdict } from '../../../news/patch-stability';
import { chipFromVerdict, type StabilityChipData } from '../../../news/stability-chip.component';
import type { VerseChannelBuild, VerseChannelInfo, VerseDigestItem } from '../../data/verse.models';

/** News rows in the hub's accordion: one open, the rest as slim rows. */
export const HUB_NEWS = 4;
/** Gallery candidates: the newest as the feature, six more as the mosaic below it, the rest are spares for pictures that fail to load. */
export const HUB_GALLERY = 14;
/** The fixed channel slots under the LIVE feature, top to bottom. */
export const HUB_CHANNELS = ['hotfix', 'ptu', 'evocati'] as const;
export type HubChannelKind = 'live' | (typeof HUB_CHANNELS)[number];

export interface HubChannel {
  readonly kind: HubChannelKind;
  /** Null: nothing running in this channel right now (the quiet slot). */
  readonly version: string | null;
  readonly line: string | null;
  /** The stability chip's data; null for a quiet slot and for Evocati (no chip, it would never change). */
  readonly chip: StabilityChipData | null;
  /** Whole days since the version entered the channel; null when unknown ("–"). */
  readonly sinceDays: number | null;
  /** PTU / Evocati wave of the newest notes; null when they name none. */
  readonly wave: number | null;
}

/** `4.3.1` → `4.3`. */
export function lineOf(version: string): string {
  const m = /^(\d+)\.(\d+)/.exec(version.trim());
  return m ? `${m[1]}.${m[2]}` : version.trim();
}

function segs(line: string): number[] {
  return line.split('.').map((s) => Number.parseInt(s, 10) || 0);
}

function cmp(a: string, b: string): number {
  const x = segs(a);
  const y = segs(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The newest known line below `line`; without one, the minor counted down (4.4 → 4.3). */
export function previousLine(line: string, known: readonly string[]): string | null {
  const below = known.filter((l) => cmp(l, line) < 0).sort((a, b) => cmp(b, a));
  if (below[0]) return below[0];
  const [maj, min] = segs(line);
  return min ? `${maj}.${min - 1}` : null;
}

const CHANNEL_SUFFIX: Readonly<Record<HubChannelKind, string>> = { live: '', hotfix: ' Hotfix', ptu: ' PTU', evocati: ' Evocati' };
const DAY_MS = 86_400_000;

type ChannelInfoMap = Readonly<Record<string, VerseChannelInfo>> | null | undefined;

function sample(b: VerseChannelBuild, toIso: string, fromIso = b.threadFirstAt): ChannelBuildSample {
  return { replies: b.replies, ticketShare: b.ticketShare, ticketVoteShare: b.ticketVoteShare, fromIso, toIso };
}

const EMPTY = { chip: null, sinceDays: null, wave: null } as const;

/** Chip of a test-channel build against the previous build of the SAME channel; PTU is provisional by nature. */
function channelChip(kind: HubChannelKind, line: string, cur: ReturnType<typeof channelStability>, prev: ReturnType<typeof channelStability>, prevLabel: string | null): StabilityChipData {
  return { line, percent: cur?.stability ?? null, early: kind === 'ptu', finished: false, previous: prev?.stability ?? null, previousLabel: prev ? prevLabel : null };
}

/** Whole days between an ISO instant and now; null for a missing / unparsable one. */
export function daysSince(iso: string | null | undefined, now: number): number | null {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY_MS)) : null;
}

/**
 * One channel from the digest's `patch.channels` (live / hotfix / ptu /
 * evocati) and `patch.channelInfo`. LIVE is measured by the stability sampler;
 * Hotfix / PTU / Evocati carry the raw numbers of their running build in
 * `channelInfo` (Spectrum threads) and compare with the PREVIOUS BUILD OF THE
 * SAME CHANNEL. Without `channelInfo` for a channel (older digest) the row keeps
 * the grid with "–": a hotfix against the LIVE build, PTU / Evocati against the
 * previous line's PTU / Evocati.
 */
export function hubChannel(
  kind: HubChannelKind,
  channels: Readonly<Record<string, string>> | null | undefined,
  known: readonly string[],
  verdictFor: (line: string) => StabilityVerdict | null,
  channelInfo?: ChannelInfoMap,
  now: number = Date.now(),
): HubChannel {
  const info = kind === 'live' ? undefined : channelInfo?.[kind];
  const version = info?.version?.trim() || channels?.[kind]?.trim() || null;
  if (!version) return { kind, version: null, line: null, ...EMPTY };
  const line = lineOf(version);
  if (kind === 'live') {
    const prev = previousLine(line, known);
    const pv = prev ? verdictFor(prev) : null;
    const p = pv && !pv.insufficient ? pv.stability : null;
    return { kind, version, line, chip: chipFromVerdict(verdictFor(line), { previous: p, previousLabel: p === null ? null : prev }), sinceDays: null, wave: null };
  }
  // Evocati never changes within a build: no chip at all.
  const noChip = kind === 'evocati';
  if (info) {
    const toIso = new Date(now).toISOString();
    const p = info.previous;
    const chip = noChip ? null : channelChip(
      kind,
      line,
      channelStability(sample(info, toIso)),
      p ? channelStability(sample(p, p.endedAt ?? toIso)) : null,
      p ? p.version + CHANNEL_SUFFIX[kind] : null,
    );
    return { kind, version, line, chip, sinceDays: daysSince(info.startedAt, now), wave: kind === 'hotfix' ? null : info.wave };
  }
  return { kind, version, line, chip: noChip ? null : channelChip(kind, line, null, null, null), sinceDays: null, wave: null };
}

/** The three fixed slots under the LIVE feature — always three rows, quiet when a channel is not running. */
export function hubChannels(
  channels: Readonly<Record<string, string>> | null | undefined,
  known: readonly string[],
  verdictFor: (line: string) => StabilityVerdict | null,
  channelInfo?: ChannelInfoMap,
  now: number = Date.now(),
): HubChannel[] {
  return HUB_CHANNELS.map((k) => hubChannel(k, channels, known, verdictFor, channelInfo, now));
}

/**
 * The Patches feature image: the RSI header of the LIVE patch's notes; most
 * hotfixes carry none, so the previous patch's image stands in.
 */
export function patchImage(groups: readonly PatchLineGroup[]): string | null {
  const live = groups.findIndex((g) => g.isCurrentLive);
  for (const g of groups.slice(Math.max(live, 0))) {
    for (const e of g.entries) if (e.item.thumbnail) return e.item.thumbnail;
  }
  return null;
}

/** Gallery previews: digest gallery items that carry an image, rank order (newest feature first). */
export function hubGallery(items: readonly VerseDigestItem[], max = HUB_GALLERY): VerseDigestItem[] {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => a.rank - b.rank)
    .filter((i) => i.kind === 'gallery' && !!i.image && !seen.has(i.key) && (seen.add(i.key), true))
    .slice(0, max);
}

/** The full LIVE version where the digest knows it ("4.3.1"), else the line. */
export function kickerVersion(channels: Readonly<Record<string, string>> | null | undefined, line: string | null): string | null {
  return channels?.['live'] || line;
}

/** Shortens the holo's body to two calm lines at a word boundary. */
export function holoBody(text: string | null | undefined, max = 110): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:–-]+$/, '')} …`;
}
