import type { VerseChannelInfo, VerseDigestItem } from '../../data/verse.models';

/** Hard limit of an AI teaser title; the edge function enforces the same number. */
export const TEASER_MAX = 44;

/**
 * `eptu` is the label of the digest's `patch_versions` row of that name. Nothing
 * in the repo writes that row and the hub's own Evocati builds come from the
 * Spectrum thread titles (`channelInfo.evocati`), so `eptu` is NOT asserted to
 * be Evocati: it is shown as what it is, "EPTU".
 */
export type HeroChannel = 'live' | 'ptu' | 'evocati' | 'hotfix' | 'eptu';

/** "4.8.0-LIVE.1825000" -> "4.8.0": the version a reader knows, and the key of a teaser. */
export function cleanVersion(v: string): string {
  return /^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?/.exec(v.trim())?.[0] ?? v;
}

/** Stored teaser per full version ("4.10.3"), one string per UI language. */
export type PatchTeasers = Readonly<Record<string, { readonly de: string; readonly en: string }>>;

export interface PatchTitleParts {
  readonly channel: HeroChannel | 'planned';
  /** Full three-part version where known, else the patch line ("4.11"). */
  readonly version: string;
  /** The AI teaser in the UI language, null = the "Neues in …" fallback stands. */
  readonly teaser: string | null;
}

const isVersion = (v: string | undefined, line: string): v is string => !!v && (v === line || v.startsWith(`${line}.`));

/**
 * What a patch item in the hero is about: its channel and the most complete
 * version the digest knows. `patch:<line>` is the LIVE line (its full version
 * comes from `channels.live`), `build:<channel>:<version>` a test build
 * (`eptu` = Evocati), `plan:<line>` a roadmap entry. Null for anything else.
 */
export function patchTitleParts(
  item: Pick<VerseDigestItem, 'key' | 'kind' | 'title'>,
  channels: Readonly<Record<string, string>> | null | undefined,
  teasers: PatchTeasers,
  lang: string,
): PatchTitleParts | null {
  if (item.kind !== 'patch') return null;
  const [type, a, b] = item.key.split(':');
  let channel: PatchTitleParts['channel'];
  let version: string;
  if (type === 'patch' && a) {
    channel = 'live';
    version = isVersion(channels?.['live'], a) ? cleanVersion(channels!['live']) : a;
  } else if (type === 'build' && a && b) {
    channel = a === 'eptu' ? 'eptu' : a === 'evocati' ? 'evocati' : a === 'hotfix' ? 'hotfix' : 'ptu';
    version = cleanVersion(b);
  } else if (type === 'plan' && a) {
    channel = 'planned';
    version = a;
  } else return null;
  const row = teasers[version];
  // A hotfix runs on the LIVE version: the LIVE teaser would be repeated under another channel word.
  const teaser = channel === 'hotfix' ? null : (lang === 'de' ? row?.de : row?.en)?.trim() || null;
  return { channel, version, teaser: teaser && teaser.length <= TEASER_MAX ? teaser : null };
}

/** The roadmap's next release as a hero candidate; null when it is already running in a channel. */
export function plannedPatchItem(
  next: { readonly patchLine: string; readonly name: string } | null | undefined,
  channels: Readonly<Record<string, string>> | null | undefined,
): VerseDigestItem | null {
  const line = (next?.patchLine || next?.name || '').trim();
  if (!line) return null;
  const running = Object.values(channels ?? {}).some((v) => v === line || v.startsWith(`${line}.`));
  if (running) return null;
  return {
    key: `plan:${line}`, kind: 'patch', title: line, url: `/verse/patches?planned=${encodeURIComponent(line)}`,
    summary: null, image: null, at: null, pinned: false, score: 0, rank: Number.MAX_SAFE_INTEGER,
  };
}

/**
 * The running Hotfix / PTU / Evocati builds the digest documents on its patch
 * object (`channelInfo`, from `patch_channel_builds`) as hero candidates, so
 * the three test channels are covered without touching `verse_digest()`.
 * Skips builds the digest's own items already carry.
 */
export function channelBuildItems(
  info: Readonly<Record<string, VerseChannelInfo>> | null | undefined,
  have: ReadonlySet<string>,
): VerseDigestItem[] {
  const out: VerseDigestItem[] = [];
  for (const channel of ['evocati', 'ptu', 'hotfix'] as const) {
    const b = info?.[channel];
    if (!b?.version) continue;
    const key = `build:${channel}:${b.version}`;
    if (have.has(key)) continue;
    out.push({
      key, kind: 'patch', title: b.version, url: `/verse/patches?channel=${channel}`,
      summary: null, image: null, at: b.startedAt, pinned: false, score: 0, rank: Number.MAX_SAFE_INTEGER,
    });
  }
  return out;
}
