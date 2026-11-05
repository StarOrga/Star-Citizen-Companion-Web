import type { VerseDigestItem } from '../../data/verse.models';

/** Hard limit of an AI teaser title; the edge function enforces the same number. */
export const TEASER_MAX = 44;

export type HeroChannel = 'live' | 'ptu' | 'evocati' | 'hotfix';

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
    version = isVersion(channels?.['live'], a) ? channels!['live'] : a;
  } else if (type === 'build' && a && b) {
    channel = a === 'eptu' ? 'evocati' : a === 'hotfix' ? 'hotfix' : 'ptu';
    version = b;
  } else if (type === 'plan' && a) {
    channel = 'planned';
    version = a;
  } else return null;
  const row = teasers[version];
  const teaser = (lang === 'de' ? row?.de : row?.en)?.trim() || null;
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
