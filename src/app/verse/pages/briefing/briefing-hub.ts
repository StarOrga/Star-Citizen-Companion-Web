import type { PatchLineGroup } from '../../../news/patch-notes';
import type { StabilityVerdict } from '../../../news/patch-stability';
import type { VerseDigestItem } from '../../data/verse.models';

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

const CHANNEL_SUFFIX: Readonly<Record<HubChannelKind, string>> = { live: '', hotfix: '', ptu: ' PTU', evocati: ' Evocati' };

/**
 * One channel from the digest's `patch.channels` (live / hotfix / ptu /
 * evocati). The sampler only measures lines that reached LIVE, so only the
 * LIVE channel carries numbers; the others keep the same grid with "–" until
 * there is data for them. Every channel compares with its own predecessor:
 * LIVE with the line before, a hotfix with the LIVE build, PTU / Evocati with
 * the previous line's PTU / Evocati.
 */
export function hubChannel(
  kind: HubChannelKind,
  channels: Readonly<Record<string, string>> | null | undefined,
  known: readonly string[],
  verdictFor: (line: string) => StabilityVerdict | null,
): HubChannel {
  const version = channels?.[kind]?.trim() || null;
  if (!version) return { kind, version: null, line: null, stats: hubStats(null, null, null) };
  const line = lineOf(version);
  const prev = previousLine(line, known);
  if (kind === 'live') return { kind, version, line, stats: hubStats(verdictFor(line), prev ? verdictFor(prev) : null, prev) };
  const vs = kind === 'hotfix' ? (channels?.['live']?.trim() || prev) : prev ? prev + CHANNEL_SUFFIX[kind] : null;
  return { kind, version, line, stats: hubStats(null, null, vs) };
}

/** The three fixed slots under the LIVE feature — always three rows, quiet when a channel is not running. */
export function hubChannels(
  channels: Readonly<Record<string, string>> | null | undefined,
  known: readonly string[],
  verdictFor: (line: string) => StabilityVerdict | null,
): HubChannel[] {
  return HUB_CHANNELS.map((k) => hubChannel(k, channels, known, verdictFor));
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
