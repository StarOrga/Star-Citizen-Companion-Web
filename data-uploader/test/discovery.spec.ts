import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverAll,
  discoverManual,
  discoverViaDriveScan,
  discoverViaFsScan,
  discoverViaLauncher,
  discoverViaWindows,
  extractWindowsPaths,
  setRememberedInstall,
} from '../src/lib/discovery.js';

/** A channel folder with a Data.p4k big enough for the 1 MB floor. */
async function makeChannel(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'Data.p4k'), Buffer.alloc(2 * 1024 * 1024));
  return dir;
}

const BS = '\\';
/** JSON-escaped like the launcher log (`C:\\Program Files\\…`). */
const jsonEscaped = (p: string): string => p.split(BS).join(BS + BS);

afterEach(() => setRememberedInstall(null));

describe('discovery — manual', () => {
  it('returns null for an empty folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sc-disc-'));
    const result = await discoverManual(dir);
    expect(result).toBeNull();
  });

  it('detects a folder containing a Data.p4k-like file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sc-disc-live-'));
    const liveDir = await makeChannel(join(dir, 'LIVE'));
    const result = await discoverManual(liveDir);
    expect(result).not.toBeNull();
    expect(result?.channel).toBe('LIVE');
    expect(result?.source).toBe('manual');
    expect(result?.sizeBytes).toBe(2 * 1024 * 1024);
  });

  it('accepts the library folder, the StarCitizen folder, Bin64 and the Data.p4k itself', async () => {
    const lib = await mkdtemp(join(tmpdir(), 'sc-disc-lib-'));
    const live = await makeChannel(join(lib, 'StarCitizen', 'LIVE'));
    await makeChannel(join(lib, 'StarCitizen', 'PTU'));
    await mkdir(join(live, 'Bin64'), { recursive: true });
    for (const pick of [lib, join(lib, 'StarCitizen'), join(live, 'Bin64'), join(live, 'Data.p4k')]) {
      const result = await discoverManual(pick);
      expect(result?.installPath, pick).toBe(live);
    }
  });
});

describe('discovery — fs scan', () => {
  it('returns an empty array for non-existent roots', async () => {
    const result = await discoverViaFsScan(['Z:\\nonexistent\\garbage']);
    expect(result).toEqual([]);
  });

  it('finds channels under a synthetic install root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc-sc-'));
    for (const channel of ['LIVE', 'PTU']) await makeChannel(join(root, channel));
    const result = await discoverViaFsScan([root]);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.channel).sort()).toEqual(['LIVE', 'PTU']);
  });

  it('drive scan finds a library in an arbitrary top-level folder', async () => {
    const drive = await mkdtemp(join(tmpdir(), 'sc-drive-'));
    const live = await makeChannel(join(drive, 'MeineSpiele', 'StarCitizen', 'LIVE'));
    const result = await discoverViaDriveScan([drive]);
    expect(result.map((c) => c.installPath)).toEqual([live]);
    expect(result[0]?.source).toBe('fs-scan');
  });
});

describe('discovery — RSI launcher log', () => {
  // Hints are Windows paths (drive letter) — the synthetic install must be one too.
  it.skipIf(process.platform !== 'win32')('finds a game the launcher installed somewhere else than the launcher', async () => {
    const lib = await mkdtemp(join(tmpdir(), 'sc-lib-'));
    const live = await makeChannel(join(lib, 'StarCitizen', 'LIVE'));
    const launcher = await mkdtemp(join(tmpdir(), 'rsilauncher-'));
    await mkdir(join(launcher, 'logs'));
    const line = (msg: string): string =>
      `{ "t":"2026-10-12 16:27:23.403", "[main][info] ": "${msg}"  },`;
    await writeFile(
      join(launcher, 'logs', 'log.log'),
      [
        line('[Launcher] started from Q:\\\\Program Files\\\\Roberts Space Industries\\\\RSI Launcher'),
        line(
          `[Pipeline] Installing Star Citizen LIVE 4.10.2-live.1 at ${jsonEscaped(join(lib, 'StarCitizen'))} (type: update, forceDP: false)`,
        ),
        line(
          `[DiskSpaceCheckPhase] Checking available disk space for (SC LIVE) at ${jsonEscaped(live)} — required: 1 bytes`,
        ),
      ].join('\n'),
    );
    // The launcher's store is encrypted — must be skipped, not crash.
    await writeFile(join(launcher, 'launcher store.json'), Buffer.from([0x35, 0x0a, 0xff, 0x00, 0x5a]));
    const result = await discoverViaLauncher(launcher);
    expect(result.map((c) => c.installPath)).toEqual([live]);
    expect(result[0]?.source).toBe('rsi-launcher');
  });

  it('extracts and trims paths from log lines', () => {
    const text =
      '"Installing at C:\\\\Games\\\\StarCitizen (type: update)" ' +
      '"validate D:\\\\RSI\\\\StarCitizen,D:\\\\RSI\\\\StarCitizen\\\\PTU" ' +
      '"Launching from (E:\\\\X\\\\StarCitizen\\\\LIVE)" "C:\\\\Windows\\\\System32"';
    expect(extractWindowsPaths(text)).toEqual([
      'C:\\Games\\StarCitizen',
      'D:\\RSI\\StarCitizen',
      'D:\\RSI\\StarCitizen\\PTU',
      'E:\\X\\StarCitizen\\LIVE',
    ]);
  });

  it('keeps "Program Files (x86)" intact', () => {
    expect(
      extractWindowsPaths('C:\\Program Files (x86)\\Roberts Space Industries\\StarCitizen\\LIVE'),
    ).toEqual(['C:\\Program Files (x86)\\Roberts Space Industries\\StarCitizen\\LIVE']);
  });
});

describe('discovery — Windows traces', () => {
  it.skipIf(process.platform !== 'win32')('resolves a StarCitizen.exe path from reg query output to its channel', async () => {
    const lib = await mkdtemp(join(tmpdir(), 'sc-reg-'));
    const live = await makeChannel(join(lib, 'StarCitizen', 'LIVE'));
    await mkdir(join(live, 'Bin64'));
    const exe = join(live, 'Bin64', 'StarCitizen.exe');
    const result = await discoverViaWindows(async (args) =>
      args[0]?.includes('GameConfigStore')
        ? `\r\nHKEY_CURRENT_USER\\System\\GameConfigStore\\Children\\abc\r\n    MatchedExeFullPath    REG_SZ    ${exe}\r\n`
        : '',
    );
    expect(result.map((c) => c.installPath)).toEqual([live]);
    expect(result[0]?.source).toBe('windows');
  });
});

// discoverAll also runs the real launcher/registry stages of the machine the tests run on.
describe('discovery — remembered install', { timeout: 30_000 }, () => {
  it('lists the remembered install first, marked as saved', async () => {
    const lib = await mkdtemp(join(tmpdir(), 'sc-saved-'));
    const live = await makeChannel(join(lib, 'StarCitizen', 'LIVE'));
    const result = await discoverAll({ rememberedPath: live });
    expect(result[0]?.installPath).toBe(live);
    expect(result[0]?.source).toBe('saved');
  });

  it('uses the install seeded via setRememberedInstall', async () => {
    const lib = await mkdtemp(join(tmpdir(), 'sc-seed-'));
    const ptu = await makeChannel(join(lib, 'StarCitizen', 'PTU'));
    setRememberedInstall(ptu);
    const result = await discoverAll();
    expect(result[0]?.installPath).toBe(ptu);
    expect(result[0]?.source).toBe('saved');
  });

  it('never preselects a sibling in place of a remembered channel that is gone', async () => {
    const lib = await mkdtemp(join(tmpdir(), 'sc-sib-'));
    const live = join(lib, 'StarCitizen', 'LIVE');
    const ptu = await makeChannel(join(lib, 'StarCitizen', 'PTU'));
    const result = await discoverAll({ rememberedPath: live });
    const sibling = result.find((c) => c.installPath === ptu);
    expect(sibling?.source).toBe('manual');
    expect(result.some((c) => c.source === 'saved')).toBe(false);
  });

  it('falls back to the automatic search when the remembered Data.p4k is gone', async () => {
    const lib = await mkdtemp(join(tmpdir(), 'sc-gone-'));
    const live = await makeChannel(join(lib, 'StarCitizen', 'LIVE'));
    await rm(join(live, 'Data.p4k'));
    const result = await discoverAll({ rememberedPath: live });
    expect(result.some((c) => c.source === 'saved')).toBe(false);
  });
});
