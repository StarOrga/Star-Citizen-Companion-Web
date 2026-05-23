/**
 * Game-Discovery — 3-stage cascade per concept § D.
 *
 * Stage 1: RSI-Launcher-Config (`%APPDATA%/rsilauncher/*.json`)
 * Stage 2: Filesystem-Scan of common install roots
 * Stage 3: Manual folder pick (input from UI)
 *
 * Returns `DiscoveredChannel[]` — UI defaults all to ticked, user can deselect.
 */

import { promises as fs } from 'node:fs';
import { join, sep } from 'node:path';
import { homedir, platform } from 'node:os';

export type ChannelTag = 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW';
export const CHANNELS: readonly ChannelTag[] = ['LIVE', 'PTU', 'EPTU', 'TECH-PREVIEW'];

export interface DiscoveredChannel {
  channel: ChannelTag;
  installPath: string;
  dataP4kPath: string;
  version: string | null;
  sizeBytes: number;
  source: 'rsi-launcher' | 'fs-scan' | 'manual';
}

const COMMON_INSTALL_ROOTS = [
  'C:\\Program Files\\Roberts Space Industries\\StarCitizen',
  'C:\\StarCitizen',
  'D:\\Program Files\\Roberts Space Industries\\StarCitizen',
  'D:\\StarCitizen',
  'D:\\Games\\Roberts Space Industries\\StarCitizen',
  'E:\\Program Files\\Roberts Space Industries\\StarCitizen',
  'E:\\StarCitizen',
];

/** Stage 1 — read RSI Launcher's JSON manifests. */
export async function discoverViaLauncher(): Promise<DiscoveredChannel[]> {
  if (platform() !== 'win32') return [];
  const launcherDir = process.env['APPDATA']
    ? join(process.env['APPDATA'], 'rsilauncher')
    : join(homedir(), 'AppData', 'Roaming', 'rsilauncher');

  let entries: string[];
  try {
    entries = await fs.readdir(launcherDir);
  } catch {
    return [];
  }

  const found: DiscoveredChannel[] = [];
  for (const file of entries.filter((n) => n.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(join(launcherDir, file), 'utf-8');
      const data: unknown = JSON.parse(raw);
      for (const inst of extractLauncherInstalls(data)) {
        const ch = await probeChannel(inst.installPath, 'rsi-launcher');
        if (ch) found.push(ch);
      }
    } catch {
      /* skip malformed */
    }
  }
  return dedupe(found);
}

interface LauncherInstall {
  installPath: string;
  channel?: string;
}

function extractLauncherInstalls(data: unknown): LauncherInstall[] {
  const out: LauncherInstall[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const ip = obj['installPath'] ?? obj['install_path'] ?? obj['gameInstallPath'];
    if (typeof ip === 'string' && ip.length > 0) {
      out.push({
        installPath: ip,
        channel: typeof obj['channel'] === 'string' ? obj['channel'] : undefined,
      });
    }
    for (const v of Object.values(obj)) {
      if (typeof v === 'object') visit(v);
    }
  };
  visit(data);
  return out;
}

/** Stage 2 — scan common install roots for Channel-subdirs containing Data.p4k. */
export async function discoverViaFsScan(
  roots: readonly string[] = COMMON_INSTALL_ROOTS,
): Promise<DiscoveredChannel[]> {
  const found: DiscoveredChannel[] = [];
  for (const root of roots) {
    let entries: { name: string; isDirectory(): boolean }[];
    try {
      entries = (await fs.readdir(root, { withFileTypes: true })) as unknown as {
        name: string;
        isDirectory(): boolean;
      }[];
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const candidate = ent.name.toUpperCase().replace('_', '-') as ChannelTag;
      if (!CHANNELS.includes(candidate)) continue;
      const channelDir = join(root, ent.name);
      const ch = await probeChannel(channelDir, 'fs-scan');
      if (ch) found.push(ch);
    }
  }
  return dedupe(found);
}

/** Stage 3 — UI hands us a user-picked folder, we probe it as-is. */
export async function discoverManual(folderPath: string): Promise<DiscoveredChannel | null> {
  return probeChannel(folderPath, 'manual');
}

/** Run all 3 stages — cascade: launcher → fs-scan if empty → optional manual. */
export async function discoverAll(opts: { manualPath?: string } = {}): Promise<DiscoveredChannel[]> {
  let found = await discoverViaLauncher();
  if (found.length === 0) {
    found = await discoverViaFsScan();
  }
  if (opts.manualPath) {
    const m = await discoverManual(opts.manualPath);
    if (m && !found.some((c) => c.dataP4kPath === m.dataP4kPath)) {
      found.push(m);
    }
  }
  return found;
}

async function probeChannel(
  channelDir: string,
  source: DiscoveredChannel['source'],
): Promise<DiscoveredChannel | null> {
  const dataP4k = join(channelDir, 'Data.p4k');
  let stat;
  try {
    stat = await fs.stat(dataP4k);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size < 1024 * 1024) return null;
  return {
    channel: inferChannelFromPath(channelDir),
    installPath: channelDir,
    dataP4kPath: dataP4k,
    version: await readVersionFile(channelDir),
    sizeBytes: stat.size,
    source,
  };
}

function inferChannelFromPath(p: string): ChannelTag {
  const lastPart = (p.split(sep).pop() ?? '').toUpperCase().replace('_', '-') as ChannelTag;
  return CHANNELS.includes(lastPart) ? lastPart : 'LIVE';
}

async function readVersionFile(channelDir: string): Promise<string | null> {
  for (const candidate of ['build_manifest.id', 'f_win_game_client_release_version.txt']) {
    try {
      const raw = await fs.readFile(join(channelDir, candidate), 'utf-8');
      const m = raw.match(/\d+\.\d+(\.\d+)+/);
      if (m) return m[0];
    } catch {
      /* skip */
    }
  }
  return null;
}

function dedupe(channels: DiscoveredChannel[]): DiscoveredChannel[] {
  const seen = new Set<string>();
  return channels.filter((c) => {
    if (seen.has(c.dataP4kPath)) return false;
    seen.add(c.dataP4kPath);
    return true;
  });
}
