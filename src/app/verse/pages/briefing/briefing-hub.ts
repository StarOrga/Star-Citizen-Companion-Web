import type { PatchLineGroup } from '../../../news/patch-notes';
import { channelStability } from '../../../news/patch-stability';
import type { ChannelBuildSample, StabilityLevel, StabilityVerdict } from '../../../news/patch-stability';
import type { VerseChannelBuild, VerseChannelInfo, VerseDigestItem } from '../../data/verse.models';

/** News rows in the hub's accordion: one open, the rest as slim rows. */
export const HUB_NEWS = 4;
/** Gallery: the newest as the feature, six more as the mosaic below it. */
export const HUB_GALLERY = 7;
/** The fixed channel slots under the LIVE feature, top to bottom. */
export const HUB_CHANNELS = ['hotfix', 'ptu', 'evocati'] as const;
export type HubChannelKind = 'live' | (typeof HUB_CHANNELS)[number];

export type HubVerdict = 'stable' | 'shaky' | 'troubled';

/**
 * THE verdict thresholds — the one place that turns a stability score into
 * the chip's word. Deliberately isolated: a follow-up replaces this default
 * (stabil >= 75 %, wackelig 45–74 %, viele Probleme < 45 %) with a rolling
 * default from the last patches corrected by community votes.
 */
export function verdictWord(stability: number | null): HubVerdict | null {
  if (stability === null || !Number.isFinite(stability)) return null;
  if (stability >= 75) return 'stable';
  if (stability >= 45) return 'shaky';
  return 'troubled';
}

export type HubTrend = 'better' | 'worse' | 'same';

export interface HubStat {
  readonly value: number | null;
  readonly delta: number | null;
  readonly trend: HubTrend | null;
}

/** One channel row's grid: Stabilität + Bekannte Probleme, both against the channel's predecessor. */
export interface HubStats {
  readonly stability: HubStat;
  /** `value` = open known issues (KB count); `level` picks the word (1 kaum … 5 schwere). */
  readonly issues: HubStat & { readonly level: number | null };
  /** What the deltas compare against ("4.2", "4.3.1", "4.3 PTU"); null when there is no predecessor. */
  readonly vs: string | null;
}

export interface HubChannel {
  readonly kind: HubChannelKind;
  /** Null: nothing running in this channel right now (the quiet slot). */
  readonly version: string | null;
  readonly line: string | null;
  readonly stats: HubStats;
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

function usable(v: StabilityVerdict | null | undefined): StabilityVerdict | null {
  return v && !v.insufficient && v.stability !== null ? v : null;
}

function stat(cur: number | null, prev: number | null, higherIsBetter: boolean): HubStat {
  if (cur === null) return { value: null, delta: null, trend: null };
  if (prev === null) return { value: cur, delta: null, trend: null };
  const delta = Math.round(cur - prev);
  const trend: HubTrend = delta === 0 ? 'same' : (delta > 0) === higherIsBetter ? 'better' : 'worse';
  return { value: cur, delta, trend };
}

/** Stabilität + Bekannte Probleme of `cur` against `prev`; a missing value stays null ("–"). */
export function hubStats(cur: StabilityVerdict | null, prev: StabilityVerdict | null, vs: string | null): HubStats {
  const c = usable(cur);
  const p = usable(prev);
  const issues = stat(c?.kbOpen ?? null, p?.kbOpen ?? null, false);
  return {
    stability: stat(c ? Math.round(c.stability!) : null, p ? Math.round(p.stability!) : null, true),
    issues: { ...issues, level: c?.level ?? null },
    vs,
  };
}

const CHANNEL_SUFFIX: Readonly<Record<HubChannelKind, string>> = { live: '', hotfix: ' Hotfix', ptu: ' PTU', evocati: ' Evocati' };
const DAY_MS = 86_400_000;

type ChannelInfoMap = Readonly<Record<string, VerseChannelInfo>> | null | undefined;

function sample(b: VerseChannelBuild, toIso: string, fromIso = b.threadFirstAt): ChannelBuildSample {
  return { replies: b.replies, ticketShare: b.ticketShare, ticketVoteShare: b.ticketVoteShare, fromIso, toIso };
}

type Measured = { stability: number; level: StabilityLevel } | null;

/**
 * Stabilität + Bekannte Probleme of a test-channel build against its
 * predecessor. Only the community component is measured for these (see
 * `channelStability`), and the KB issue count exists for LIVE only: the word
 * comes from the build's level, the count and its delta stay "–".
 */
export function channelStats(cur: Measured, prev: Measured, vs: string | null): HubStats {
  return {
    stability: stat(cur?.stability ?? null, prev?.stability ?? null, true),
    issues: { value: null, delta: null, trend: null, level: cur?.level ?? null },
    vs,
  };
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
  if (!version) return { kind, version: null, line: null, stats: hubStats(null, null, null), sinceDays: null, wave: null };
  const line = lineOf(version);
  const prev = previousLine(line, known);
  if (kind === 'live') return { kind, version, line, stats: hubStats(verdictFor(line), prev ? verdictFor(prev) : null, prev), sinceDays: null, wave: null };
  if (info) {
    const toIso = new Date(now).toISOString();
    const p = info.previous;
    const stats = channelStats(
      channelStability(sample(info, toIso)),
      p ? channelStability(sample(p, p.endedAt ?? toIso)) : null,
      p ? p.version + CHANNEL_SUFFIX[kind] : null,
    );
    return { kind, version, line, stats, sinceDays: daysSince(info.startedAt, now), wave: kind === 'hotfix' ? null : info.wave };
  }
  const vs = kind === 'hotfix' ? (channels?.['live']?.trim() || prev) : prev ? prev + CHANNEL_SUFFIX[kind] : null;
  return { kind, version, line, stats: hubStats(null, null, vs), sinceDays: null, wave: null };
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

/** "▲ 8" / "▼ 29" for the stability, "+14" / "−3" for the known issues; "–" without a comparison. */
export function deltaText(s: HubStat, arrows: boolean): string {
  if (s.delta === null) return '–';
  if (s.delta === 0) return '±0';
  const n = Math.abs(s.delta);
  if (arrows) return `${s.delta > 0 ? '▲' : '▼'} ${n}`;
  return `${s.delta > 0 ? '+' : '−'}${n}`;
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
