// Sweep selection for patch-teaser: which versions get a model call this run.
// Pure, no Deno APIs (node --test runs it).

export interface Thread { slug: string; subject: string }
export interface Target { version: string; slug: string }

/** Tokens one open sweep call may spend: at most this many versions per call. */
export const SWEEP_MAX = 3;
/** A version whose attempt failed (or produced nothing) waits this long before the next try. */
export const RETRY_COOLDOWN_MS = 6 * 3600_000;

const ALPHA_VERSION = /\balpha\s+v?(\d{1,2}(?:\.\d{1,2}){1,2})(?![\d.])/i;

/** "4.8.0-LIVE.1825000" -> "4.8.0"; "" when no version leads the string. */
export function cleanVersion(v: unknown): string {
  return /^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?/.exec(String(v ?? '').trim())?.[0] ?? '';
}

/** "Star Citizen Alpha 4.10.3 PTU.123 Patch Notes" -> "4.10.3"; Hotfix Central and non-notes -> "". */
export function versionOfNotesThread(subject: string): string {
  if (!/Patch Notes/i.test(subject) || /Hotfix Central/i.test(subject)) return '';
  return ALPHA_VERSION.exec(subject)?.[1] ?? '';
}

/** Versions currently in a channel: the digest's channel map plus the running channel builds, cleaned and de-duplicated. */
export function wantedVersions(channelMap: readonly unknown[], runningBuilds: readonly unknown[]): string[] {
  return [...new Set([...channelMap, ...runningBuilds].map(cleanVersion).filter(Boolean))];
}

/**
 * The versions to generate for: wanted, no teaser row yet, not tried within the
 * cooldown, and with a patch-note thread (newest thread wins - `threads` is
 * newest first). Capped so an open call can never fan out.
 */
export function pickSweepTargets(args: {
  wanted: readonly string[];
  threads: readonly Thread[];
  have: ReadonlySet<string>;
  recentlyTried: ReadonlySet<string>;
  max?: number;
}): Target[] {
  const slugOf = new Map<string, string>();
  for (const t of args.threads) {
    const v = versionOfNotesThread(t.subject);
    if (v && t.slug && !slugOf.has(v)) slugOf.set(v, t.slug);
  }
  const out: Target[] = [];
  for (const version of args.wanted) {
    if (out.length >= (args.max ?? SWEEP_MAX)) break;
    if (args.have.has(version) || args.recentlyTried.has(version)) continue;
    const slug = slugOf.get(version);
    if (slug) out.push({ version, slug });
  }
  return out;
}
