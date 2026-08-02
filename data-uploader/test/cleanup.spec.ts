import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const discoverAll = vi.fn(async () => [] as { installPath: string }[]);
vi.mock('../src/lib/discovery.js', () => ({
  discoverAll: () => discoverAll(),
}));

const { EXTRACTS_DIR_NAME, isSafeExtractTarget, purgeExtracts, purgeAllExtracts } = await import(
  '../src/main/cleanup.js'
);

/** An install root with `names` as extract dirs, each holding one file. */
async function makeInstall(names: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sc-cleanup-'));
  for (const name of names) {
    const dir = join(root, EXTRACTS_DIR_NAME, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'payload.json'), '{}');
  }
  return root;
}

const extractDirs = async (root: string): Promise<string[]> => {
  try {
    return (await readdir(join(root, EXTRACTS_DIR_NAME))).sort();
  } catch {
    return [];
  }
};

beforeEach(() => {
  discoverAll.mockReset();
  discoverAll.mockResolvedValue([]);
});

describe('isSafeExtractTarget', () => {
  it('accepts a child of the extracts dir', () => {
    expect(isSafeExtractTarget(join('C:', 'games', EXTRACTS_DIR_NAME, 'LIVE-4.2'))).toBe(true);
  });

  it('rejects the extracts root itself and anything above it', () => {
    expect(isSafeExtractTarget(join('C:', 'games', EXTRACTS_DIR_NAME))).toBe(false);
    expect(isSafeExtractTarget(join('C:', 'games'))).toBe(false);
    expect(isSafeExtractTarget('')).toBe(false);
  });
});

describe('purgeExtracts', () => {
  it('removes every extract dir, regardless of age or upload marker', async () => {
    const root = await makeInstall(['LIVE-4.2', 'PTU-4.3', 'skins-4.2']);
    const res = await purgeExtracts([root]);
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(3);
    expect(await extractDirs(root)).toEqual([]);
  });

  it('keeps the dirs a live job still owns', async () => {
    const root = await makeInstall(['LIVE-4.2', 'PTU-4.3']);
    const keep = join(root, EXTRACTS_DIR_NAME, 'PTU-4.3');
    const res = await purgeExtracts([root], [keep]);
    expect(res.removed).toBe(1);
    expect(res.kept).toBe(1);
    expect(await extractDirs(root)).toEqual(['PTU-4.3']);
  });

  it('matches the keep-list through separator and case differences', async () => {
    const root = await makeInstall(['LIVE-4.2']);
    // The renderer builds out dirs with forward slashes; on Windows the drive
    // letter case also varies between discovery and the renderer.
    const keep = `${root}/${EXTRACTS_DIR_NAME}/LIVE-4.2`.replace(/\\/g, '/');
    const res = await purgeExtracts([root], [keep]);
    expect(res.kept).toBe(1);
    expect(res.removed).toBe(0);
    expect(await extractDirs(root)).toEqual(['LIVE-4.2']);
  });

  it('never touches the extracts root itself', async () => {
    const root = await makeInstall(['LIVE-4.2']);
    await purgeExtracts([root]);
    const rootStat = await stat(join(root, EXTRACTS_DIR_NAME));
    expect(rootStat.isDirectory()).toBe(true);
  });

  it('ignores roots without an extracts folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc-cleanup-bare-'));
    const res = await purgeExtracts([root, join(root, 'nope')]);
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(0);
  });
});

describe('purgeAllExtracts', () => {
  it('sweeps discovered install roots', async () => {
    const root = await makeInstall(['LIVE-4.2']);
    discoverAll.mockResolvedValue([{ installPath: root }]);
    const res = await purgeAllExtracts();
    expect(res.removed).toBe(1);
    expect(await extractDirs(root)).toEqual([]);
  });

  it('still sweeps the caller-supplied root when discovery finds nothing', async () => {
    const root = await makeInstall(['LIVE-4.2']);
    discoverAll.mockResolvedValue([]);
    const res = await purgeAllExtracts([], [root]);
    expect(res.removed).toBe(1);
  });

  it('sweeps the caller-supplied root when discovery throws', async () => {
    const root = await makeInstall(['LIVE-4.2']);
    discoverAll.mockRejectedValue(new Error('discovery exploded'));
    const res = await purgeAllExtracts([], [root]);
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(1);
  });

  it('does not double-delete when a root is both discovered and supplied', async () => {
    const root = await makeInstall(['LIVE-4.2', 'PTU-4.3']);
    discoverAll.mockResolvedValue([{ installPath: root }]);
    const res = await purgeAllExtracts([], [root]);
    expect(res.removed).toBe(2);
  });

  it('reports a no-op when there is nothing to sweep', async () => {
    discoverAll.mockResolvedValue([]);
    const res = await purgeAllExtracts();
    expect(res).toEqual({ ok: true, removed: 0, kept: 0 });
  });
});
