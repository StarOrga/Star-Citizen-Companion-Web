// supabase/functions/patch-stability-sample/channels.ts
// Pure grouping of the Spectrum patch-notes thread list into Hotfix / PTU /
// Evocati "builds". No Deno APIs, no fetch — testable with `node --test`.
//
// A build is one version in one channel. The verse digest compares it with
// the previous build of the SAME channel. KB known issues exist for LIVE only,
// so nothing here counts them (see .claude/deep-knowledge/patch-stability.md).

import { patchLineOfTitle } from './parsers.ts';
import type { HotfixEvent, ThreadRow } from './parsers.ts';

export type ChannelKind = 'hotfix' | 'ptu' | 'evocati';

export interface ChannelBuild {
  channel: ChannelKind;
  /** Full version of the title: "4.10.3". */
  version: string;
  line: string;
  /** When the version entered the channel (ISO). PTU/Evocati: its first thread; hotfix: newest hotfix event. */
  startedAt: string;
  /** The first thread's creation — the base for reply velocity. */
  threadFirstAt: string;
  /** Wave of the NEWEST thread; null when it names none ("All Backers", "RC2"). */
  wave: number | null;
  threadCount: number;
  replies: number;
  votes: number;
  /** Newest thread of the build — the one whose top replies are measured. */
  newest: ThreadRow;
  running: boolean;
}

const ALPHA_VERSION = /\balpha\s+v?(\d{1,2}(?:\.\d{1,2}){1,2})(?![\d.])/i;

/** "Star Citizen Alpha 4.10.3 PTU …" → "4.10.3"; "" without a version. */
export function versionOfTitle(subject: string): string {
  return ALPHA_VERSION.exec(subject)?.[1] ?? '';
}

/** Numeric version compare: 4.10 > 4.9, 4.10.1 > 4.10. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const y = b.split('.').map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Wave number of a PTU/Evocati title: "[Wave 1]", "[Wave 3 PTU]", "Wave2".
 * "[All Waves]" and "[All Backers]" are not a wave; a build number later in
 * the title never counts.
 */
export function waveOfTitle(subject: string): number | null {
  const m = /\bwave\s*#?(\d{1,2})(?!\d)/i.exec(subject);
  return m ? Number(m[1]) : null;
}

/** Which channel a Spectrum patch-notes thread belongs to; null for LIVE notes and anything without a version. */
export function channelOfTitle(subject: string): ChannelKind | null {
  if (!versionOfTitle(subject)) return null;
  if (/\bLIVE\b/.test(subject)) return /Hotfix Central/i.test(subject) ? 'hotfix' : null;
  if (/\bevo\b|\bevocati\b|\betf\b/i.test(subject)) return 'evocati';
  if (/\bPTU\b/i.test(subject) && /Patch Notes/i.test(subject)) return 'ptu';
  return null;
}

/** The newest version any LIVE thread names ("4.10.2"), '' when none. */
export function liveVersionOf(rows: ThreadRow[]): string {
  let best = '';
  for (const r of rows) {
    if (!/\bLIVE\b/.test(r.subject)) continue;
    const v = versionOfTitle(r.subject);
    if (v && (!best || compareVersions(v, best) > 0)) best = v;
  }
  return best;
}

/** A hotfix counts as "running" for this long after its newest event. */
export const HOTFIX_RUNNING_DAYS = 14;

const iso = (sec: number) => new Date(sec * 1000).toISOString();

/**
 * Group the thread list into builds and flag the one running per channel:
 * PTU = the newest version above LIVE; Evocati = the newest version above LIVE
 * that no PTU has reached yet (an open PTU supersedes the NDA ring); hotfix =
 * the newest Hotfix Central thread while its latest event is younger than
 * {@link HOTFIX_RUNNING_DAYS}. `hotfixStartedAt` maps a Central thread id to
 * the ISO date of its newest event (read from its first post).
 */
export function groupChannelBuilds(
  rows: ThreadRow[],
  now: Date,
  hotfixStartedAt: ReadonlyMap<number, string> = new Map(),
): ChannelBuild[] {
  const live = liveVersionOf(rows);
  const byKey = new Map<string, ChannelBuild>();
  for (const row of rows) {
    const channel = channelOfTitle(row.subject);
    if (!channel) continue;
    const version = versionOfTitle(row.subject);
    const key = `${channel}:${version}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        channel, version, line: patchLineOfTitle(row.subject),
        startedAt: iso(row.time_created), threadFirstAt: iso(row.time_created),
        wave: waveOfTitle(row.subject), threadCount: 1,
        replies: row.replies_count, votes: Number(row.votes?.count) || 0,
        newest: row, running: false,
      });
      continue;
    }
    cur.threadCount++;
    cur.replies += row.replies_count;
    cur.votes += Number(row.votes?.count) || 0;
    if (row.time_created * 1000 < Date.parse(cur.threadFirstAt)) {
      cur.threadFirstAt = iso(row.time_created);
      cur.startedAt = cur.threadFirstAt;
    }
    if (row.time_created > cur.newest.time_created) {
      cur.newest = row;
      cur.wave = waveOfTitle(row.subject);
    }
  }
  const builds = [...byKey.values()];
  for (const b of builds) {
    if (b.channel === 'hotfix') b.startedAt = hotfixStartedAt.get(b.newest.id) ?? b.startedAt;
  }
  const newestOf = (channel: ChannelKind) =>
    builds.filter((b) => b.channel === channel).sort((a, b) => compareVersions(b.version, a.version))[0];
  const ptu = newestOf('ptu');
  const evo = newestOf('evocati');
  const hot = newestOf('hotfix');
  if (ptu && (!live || compareVersions(ptu.version, live) > 0)) ptu.running = true;
  if (evo && (!live || compareVersions(evo.version, live) > 0) && !(ptu && compareVersions(ptu.version, evo.version) >= 0)) evo.running = true;
  if (hot && now.getTime() - Date.parse(hot.startedAt) <= HOTFIX_RUNNING_DAYS * 86_400_000) hot.running = true;
  return builds;
}

/** Newest hotfix date of a Hotfix Central first post as ISO midnight UTC; null without events. */
export function newestHotfixDate(events: HotfixEvent[]): string | null {
  const dates = events.map((e) => e.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return dates.length ? `${dates[dates.length - 1]}T00:00:00.000Z` : null;
}
