/**
 * Game-Discovery — finds every Star Citizen install (and its `Data.p4k`).
 *
 * The RSI Launcher and the game do not have to live in the same place: the
 * launcher installs into `<library>\StarCitizen\<CHANNEL>\`, and the library
 * folder is free to pick (`D:\Games`, `E:\Spiele\RSI`, …). The launcher keeps
 * that choice in an ENCRYPTED `launcher store.json`, so reading the launcher's
 * JSON finds nothing — the sources below are the ones that carry the path in
 * clear text:
 *
 * Stage 0: the folder the operator picked or chose before (`settings.json`,
 *          survives uploader updates); falls through when it no longer holds
 *          a `Data.p4k`.
 * Stage 1: RSI Launcher log (`%APPDATA%\rsilauncher\logs\*.log`) — every
 *          install/update/verify logs `…\StarCitizen\LIVE`. Plain `*.json` in
 *          the launcher dir are still read for older launcher builds.
 * Stage 2: Windows' own traces of `StarCitizen.exe` (GameConfigStore /
 *          Game Bar, Compatibility Assistant, MuiCache) — covers a game that
 *          was moved or launched without this launcher's log.
 * Stage 3: only when 0–2 found nothing: every fixed drive, common install
 *          paths plus one level of top-level folders.
 * Stage 4: manual folder pick — any level is accepted (library folder,
 *          `StarCitizen`, `LIVE`, `Bin64`, or the `Data.p4k` itself).
 *
 * Every hint is expanded the same way (`expandHint`): the path and its
 * ancestors are probed as a channel folder, a `StarCitizen` folder and a
 * library folder, so a log line, an exe path or a picked folder all land on
 * the channel folders that really hold a `Data.p4k`.
 */

import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename, dirname, join, parse } from 'node:path';
import { homedir, platform } from 'node:os';

export type ChannelTag = 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW';
export const CHANNELS: readonly ChannelTag[] = ['LIVE', 'PTU', 'EPTU', 'TECH-PREVIEW'];

export interface DiscoveredChannel {
  channel: ChannelTag;
  installPath: string;
  dataP4kPath: string;
  version: string | null;
  /**
   * Game build number (`RequestedP4ChangeNum` of `build_manifest.id`) — with
   * `version` the "same patch + build" key subtheme skipping compares on.
   * Null/absent when the manifest does not carry it.
   */
  buildNumber?: string | null;
  sizeBytes: number;
  source: 'saved' | 'rsi-launcher' | 'windows' | 'fs-scan' | 'manual';
}

type Source = DiscoveredChannel['source'];

/** Install paths below a drive root the launcher (or a hand install) commonly uses. */
const COMMON_RELATIVE_ROOTS = [
  'Program Files\\Roberts Space Industries\\StarCitizen',
  'Program Files (x86)\\Roberts Space Industries\\StarCitizen',
  'Roberts Space Industries\\StarCitizen',
  'StarCitizen',
  'Star Citizen',
  'Games\\Roberts Space Industries\\StarCitizen',
  'Games\\StarCitizen',
  'Spiele\\Roberts Space Industries\\StarCitizen',
  'Spiele\\StarCitizen',
];

/** Top-level folders never worth a look during the drive scan. */
const SKIP_TOP_LEVEL = new Set([
  'windows',
  '$recycle.bin',
  'system volume information',
  'recovery',
  'perflogs',
  'programdata',
  'users',
  '$windows.~ws',
  '$windows.~bt',
  'msocache',
  'config.msi',
]);

/** Hints mentioning neither are noise (other apps' paths in the same logs). */
const SC_HINT = /starcitizen|star citizen|roberts space industries/i;

/** How many hints per source get expanded — the launcher log repeats itself thousands of times. */
const MAX_HINTS = 40;

// ---------------------------------------------------------------------------
// Probing

function pathKey(p: string): string {
  // Windows paths are case-insensitive; the trailing separator is cosmetic.
  return p.replace(/[\\/]+$/, '').toLowerCase();
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function listDirs(p: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(p, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function channelOfName(name: string): ChannelTag | null {
  const tag = name.toUpperCase().replace(/[_ ]/g, '-') as ChannelTag;
  return CHANNELS.includes(tag) ? tag : null;
}

async function probeChannel(channelDir: string, source: Source): Promise<DiscoveredChannel | null> {
  const dataP4k = join(channelDir, 'Data.p4k');
  let stat;
  try {
    stat = await fs.stat(dataP4k);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size < 1024 * 1024) return null;
  const ids = await readVersionFile(channelDir);
  return {
    channel: inferChannelFromPath(channelDir),
    installPath: channelDir,
    dataP4kPath: dataP4k,
    version: ids.version,
    buildNumber: ids.buildNumber,
    sizeBytes: stat.size,
    source,
  };
}

/** Channel folders (`LIVE`, `PTU`, …) directly below `root` that hold a Data.p4k. */
async function probeChannelsBelow(root: string, source: Source): Promise<DiscoveredChannel[]> {
  const found: DiscoveredChannel[] = [];
  for (const name of await listDirs(root)) {
    if (!channelOfName(name)) continue;
    const ch = await probeChannel(join(root, name), source);
    if (ch) found.push(ch);
  }
  return found;
}

/**
 * Probe one folder at every level it could be: a channel folder, a
 * `StarCitizen` folder, or a launcher library folder (`<lib>\StarCitizen\*`).
 */
async function probeAnyLevel(dir: string, source: Source): Promise<DiscoveredChannel[]> {
  const self = await probeChannel(dir, source);
  if (self) return [self];
  const below = await probeChannelsBelow(dir, source);
  if (below.length > 0) return below;
  for (const name of ['StarCitizen', 'Star Citizen']) {
    const lib = await probeChannelsBelow(join(dir, name), source);
    if (lib.length > 0) return lib;
  }
  return [];
}

/**
 * The folder a hint points into, then its ancestors up to the drive root —
 * each probed at every level. Stops at the first folder that yields installs,
 * so an exe path (`…\LIVE\Bin64\StarCitizen.exe`) resolves to its own channel
 * and never climbs on to the whole drive.
 */
export async function expandHint(hint: string, source: Source): Promise<DiscoveredChannel[]> {
  let dir = hint.trim().replace(/[\\/]+$/, '');
  if (!dir) return [];
  if (/\.(p4k|exe|log|id|txt)$/i.test(dir) || !(await isDir(dir))) dir = dirname(dir);
  const root = parse(dir).root;
  for (let i = 0; i < 8 && dir; i++) {
    if (await isDir(dir)) {
      const found = await probeAnyLevel(dir, source);
      if (found.length > 0) return found;
    }
    if (pathKey(dir) === pathKey(root)) break;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return [];
}

async function expandHints(hints: readonly string[], source: Source): Promise<DiscoveredChannel[]> {
  const seen = new Set<string>();
  const found: DiscoveredChannel[] = [];
  for (const hint of hints) {
    const key = pathKey(hint);
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > MAX_HINTS) break;
    found.push(...(await expandHint(hint, source)));
  }
  return dedupe(found);
}

// ---------------------------------------------------------------------------
// Hint extraction

/**
 * Windows paths in free text (logs, JSON, `reg query` output). JSON-escaped
 * backslashes are unescaped first; a path ends at a quote, comma, line break
 * or one of the launcher's trailing notes (` (type: …)`, ` — required: …`).
 * Only paths that look like Star Citizen are kept.
 */
export function extractWindowsPaths(text: string): string[] {
  const plain = text.replace(/\\\\/g, '\\');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of plain.matchAll(/[A-Za-z]:\\[^"'<>|*?\r\n,]*/g)) {
    let p = m[0]
      .replace(/\s{2,}.*$/, '') // `reg query`: value name, then 4 spaces + type + data
      .replace(/\s+(\((?:type|statistics|force)\b|—).*$/i, '')
      // A file name ends the path: `…\StarCitizen_Launcher.exe -envtag PUB …`, `…\loginData.json for LIVE`.
      .replace(/(\.[A-Za-z0-9]{2,4})\s.*$/, '$1')
      .replace(/\s+$/, '')
      .replace(/[\\.]+$/, '');
    // `… from (C:\…\LIVE)` — drop a closing parenthesis the path never opened.
    if (!p.includes('(')) p = p.replace(/\)+$/, '');
    if (!SC_HINT.test(p)) continue;
    // Keep the path up to the last segment that names the game, so a
    // launcher-internal path (`…\RSI Launcher\resources\app.asar\…`) still
    // yields its library folder.
    const segs = p.split('\\');
    const lastSc = segs.reduce((acc, s, i) => (SC_HINT.test(s) ? i : acc), -1);
    const keepUntil = /^(starcitizen|star citizen)$/i.test(segs[lastSc] ?? '')
      ? Math.min(segs.length, lastSc + 3) // keep `\LIVE\Bin64` below the game folder
      : lastSc + 1;
    p = segs.slice(0, Math.max(keepUntil, 1)).join('\\');
    const key = pathKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function launcherDir(): string {
  return process.env['APPDATA']
    ? join(process.env['APPDATA'], 'rsilauncher')
    : join(homedir(), 'AppData', 'Roaming', 'rsilauncher');
}

/**
 * Newest first: the most recent install/update line names where the game is
 * NOW — an old log line may point at a folder the game was moved away from.
 */
function newestFirst(paths: string[]): string[] {
  return [...paths].reverse();
}

/** Text files of the launcher that carry install paths in clear text. */
async function readLauncherTexts(dir: string): Promise<string[]> {
  const texts: string[] = [];
  const read = async (p: string, maxBytes: number): Promise<void> => {
    try {
      const stat = await fs.stat(p);
      if (!stat.isFile()) return;
      const fh = await fs.open(p, 'r');
      try {
        // The log grows to megabytes; its tail holds the latest installs.
        const len = Math.min(stat.size, maxBytes);
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, stat.size - len);
        texts.push(buf.toString('utf-8'));
      } finally {
        await fh.close();
      }
    } catch {
      /* unreadable — skip */
    }
  };
  for (const name of await listFiles(join(dir, 'logs'))) {
    if (/\.log(\.\d+)?$/i.test(name)) await read(join(dir, 'logs', name), 4 * 1024 * 1024);
  }
  for (const name of await listFiles(dir)) {
    if (name.toLowerCase().endsWith('.json')) await read(join(dir, name), 1024 * 1024);
  }
  for (const name of await listFiles(join(dir, 'Local Storage', 'leveldb'))) {
    if (/\.(log|ldb)$/i.test(name)) await read(join(dir, 'Local Storage', 'leveldb', name), 1024 * 1024);
  }
  return texts;
}

async function listFiles(p: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(p, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Install paths named in the launcher's clear-text files (log first, newest first). */
export async function launcherHints(dir: string = launcherDir()): Promise<string[]> {
  const hints: string[] = [];
  for (const text of await readLauncherTexts(dir)) {
    hints.push(...newestFirst(extractWindowsPaths(text)));
    // Older launcher builds kept `installPath` / `libraryFolder` in plain JSON.
    for (const m of text.matchAll(/"(?:installPath|install_path|gameInstallPath|libraryFolder|library_folder)"\s*:\s*"([^"]+)"/g)) {
      hints.push(m[1]!.replace(/\\\\/g, '\\'));
    }
  }
  return hints;
}

/** Stage 1 — the RSI Launcher's own records. */
export async function discoverViaLauncher(dir?: string): Promise<DiscoveredChannel[]> {
  if (platform() !== 'win32' && dir === undefined) return [];
  return expandHints(await launcherHints(dir), 'rsi-launcher');
}

/**
 * Registry keys where Windows records the full path of executables that ran.
 * The two value-name stores are filtered by `reg` itself (`/f … /v`): dumped
 * whole, the Compatibility Assistant's binary data alone takes ~5 s.
 */
const REGISTRY_TRACES: readonly string[][] = [
  ['HKCU\\System\\GameConfigStore\\Children', '/s', '/v', 'MatchedExeFullPath'],
  ['HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Compatibility Assistant\\Store', '/f', 'StarCitizen', '/v'],
  ['HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache', '/f', 'StarCitizen', '/v'],
  ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s', '/f', 'Roberts Space Industries', '/d'],
];

function regQuery(args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', ...args],
      { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
      (_err, stdout) => resolve(typeof stdout === 'string' ? stdout : ''),
    );
  });
}

/** Stage 2 — Windows' traces of a Star Citizen exe that ran on this machine. */
export async function discoverViaWindows(
  query: (args: readonly string[]) => Promise<string> = regQuery,
): Promise<DiscoveredChannel[]> {
  if (platform() !== 'win32' && query === regQuery) return [];
  const outputs = await Promise.all(REGISTRY_TRACES.map((args) => query(args).catch(() => '')));
  const hints = outputs.flatMap((o) => extractWindowsPaths(o));
  return expandHints(hints, 'windows');
}

// ---------------------------------------------------------------------------
// Drive scan

/** Stage 3a — scan `StarCitizen` folders (channel dirs below each root). */
export async function discoverViaFsScan(roots: readonly string[]): Promise<DiscoveredChannel[]> {
  const found: DiscoveredChannel[] = [];
  for (const root of roots) found.push(...(await probeChannelsBelow(root, 'fs-scan')));
  return dedupe(found);
}

async function existingDrives(): Promise<string[]> {
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const checks = await Promise.all(
    letters.map(async (l) => ((await isDir(`${l}:\\`)) ? `${l}:\\` : null)),
  );
  return checks.filter((d): d is string => d !== null);
}

/**
 * Stage 3b — every drive: the common install paths, then each top-level folder
 * as a library folder (`X:\<any>\StarCitizen\LIVE`) and as a parent of one
 * (`X:\<any>\Roberts Space Industries\StarCitizen\LIVE`).
 */
export async function discoverViaDriveScan(drives?: readonly string[]): Promise<DiscoveredChannel[]> {
  if (platform() !== 'win32' && drives === undefined) return [];
  const list = drives ?? (await existingDrives());
  const perDrive = await Promise.all(
    list.map(async (drive) => {
      const roots = COMMON_RELATIVE_ROOTS.map((rel) => join(drive, rel));
      for (const top of await listDirs(drive)) {
        if (SKIP_TOP_LEVEL.has(top.toLowerCase()) || top.startsWith('$')) continue;
        roots.push(join(drive, top, 'StarCitizen'));
        roots.push(join(drive, top, 'Roberts Space Industries', 'StarCitizen'));
      }
      return discoverViaFsScan(roots);
    }),
  );
  return dedupe(perDrive.flat()).map((c) => ({ ...c, source: 'fs-scan' as const }));
}

// ---------------------------------------------------------------------------
// Entry points

/**
 * Stage 4 — a folder (or file) the operator picked. Any level works; with
 * several channels below it LIVE wins, then the order of `CHANNELS`.
 */
export async function discoverManual(folderPath: string): Promise<DiscoveredChannel | null> {
  return pickPreferred(await expandHint(folderPath, 'manual'));
}

/** Every channel the picked folder leads to — for remembering and listing. */
export async function discoverManualAll(folderPath: string): Promise<DiscoveredChannel[]> {
  return expandHint(folderPath, 'manual');
}

/**
 * The install the operator picked/chose before — main seeds it from
 * `settings.json` at launch and on every change, so every `discoverAll()`
 * caller (auto-run, cleanup, the Install step) probes it first.
 */
let rememberedInstall: string | null = null;

export function setRememberedInstall(path: string | null | undefined): void {
  rememberedInstall = path && path.trim() ? path : null;
}

export interface DiscoverOptions {
  /** Overrides the remembered install (`setRememberedInstall`) — probed first. */
  rememberedPath?: string | null;
  /** A folder picked this time. */
  manualPath?: string;
}

/**
 * All stages: remembered → launcher → Windows traces, the drive scan only when
 * those found nothing. The remembered install comes first in the result, so
 * callers that preselect `[0]` keep the operator's choice.
 */
export async function discoverAll(opts: DiscoverOptions = {}): Promise<DiscoveredChannel[]> {
  const safe = async (p: Promise<DiscoveredChannel[]>): Promise<DiscoveredChannel[]> => {
    try {
      return await p;
    } catch {
      return [];
    }
  };
  const rememberedPath = opts.rememberedPath !== undefined ? opts.rememberedPath : rememberedInstall;
  const remembered = rememberedPath ? await safe(expandHint(rememberedPath, 'saved')) : [];
  // A remembered channel folder lists only itself; its siblings (PTU next to
  // LIVE) still come from the other stages.
  const [launcher, windows] = await Promise.all([safe(discoverViaLauncher()), safe(discoverViaWindows())]);
  let found = [...sortRemembered(remembered, rememberedPath), ...launcher, ...windows];
  if (found.length === 0) found = await safe(discoverViaDriveScan());
  if (opts.manualPath) found.push(...(await safe(discoverManualAll(opts.manualPath))));
  return dedupe(found);
}

/** The exact remembered channel first, its siblings after. */
function sortRemembered(found: DiscoveredChannel[], remembered?: string | null): DiscoveredChannel[] {
  if (!remembered) return found;
  const key = pathKey(remembered);
  const exact = (c: DiscoveredChannel): boolean =>
    pathKey(c.installPath) === key || pathKey(c.dataP4kPath) === key;
  return [...found.filter(exact), ...found.filter((c) => !exact(c))];
}

function pickPreferred(found: DiscoveredChannel[]): DiscoveredChannel | null {
  if (found.length === 0) return null;
  return [...found].sort((a, b) => CHANNELS.indexOf(a.channel) - CHANNELS.indexOf(b.channel))[0]!;
}

function inferChannelFromPath(p: string): ChannelTag {
  return channelOfName(basename(p.replace(/[\\/]+$/, ''))) ?? 'LIVE';
}

async function readVersionFile(
  channelDir: string,
): Promise<{ version: string | null; buildNumber: string | null }> {
  for (const candidate of ['build_manifest.id', 'f_win_game_client_release_version.txt']) {
    try {
      const raw = await fs.readFile(join(channelDir, candidate), 'utf-8');
      const m = raw.match(/\d+\.\d+(\.\d+)+/);
      if (m) return { version: m[0], buildNumber: parseBuildNumber(raw) };
    } catch {
      /* skip */
    }
  }
  return { version: null, buildNumber: null };
}

/**
 * The build number of a `build_manifest.id` (`"RequestedP4ChangeNum": "9876543"`).
 * A plain-text version file carries none — null, never a guess.
 */
export function parseBuildNumber(raw: string): string | null {
  const m = raw.match(/"RequestedP4ChangeNum"\s*:\s*"?(\d+)"?/);
  return m?.[1] ?? null;
}

/** First occurrence wins (stage order = priority); paths compared case-insensitively. */
function dedupe(channels: DiscoveredChannel[]): DiscoveredChannel[] {
  const seen = new Set<string>();
  return channels.filter((c) => {
    const key = pathKey(c.dataP4kPath);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
