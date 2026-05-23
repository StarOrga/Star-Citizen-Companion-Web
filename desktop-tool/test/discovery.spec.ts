import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverManual, discoverViaFsScan } from '../src/lib/discovery.js';

describe('discovery — manual', () => {
  it('returns null for an empty folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sc-disc-'));
    const result = await discoverManual(dir);
    expect(result).toBeNull();
  });

  it('detects a folder containing a Data.p4k-like file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sc-disc-live-'));
    const liveDir = join(dir, 'LIVE');
    await mkdir(liveDir, { recursive: true });
    // Write a 2 MB filler — probeChannel requires >= 1 MB
    await writeFile(join(liveDir, 'Data.p4k'), Buffer.alloc(2 * 1024 * 1024));
    const result = await discoverManual(liveDir);
    expect(result).not.toBeNull();
    expect(result?.channel).toBe('LIVE');
    expect(result?.source).toBe('manual');
    expect(result?.sizeBytes).toBe(2 * 1024 * 1024);
  });
});

describe('discovery — fs scan', () => {
  it('returns an empty array for non-existent roots', async () => {
    const result = await discoverViaFsScan(['Z:\\nonexistent\\garbage']);
    expect(result).toEqual([]);
  });

  it('finds channels under a synthetic install root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sc-sc-'));
    for (const channel of ['LIVE', 'PTU']) {
      const dir = join(root, channel);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'Data.p4k'), Buffer.alloc(2 * 1024 * 1024));
    }
    const result = await discoverViaFsScan([root]);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.channel).sort()).toEqual(['LIVE', 'PTU']);
  });
});
