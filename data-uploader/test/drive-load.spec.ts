import { describe, expect, it } from 'vitest';
import {
  driveLetter,
  driveLoads,
  driveSlots,
  parseSysDrives,
  pickPrimaryGpu,
  type SysDrive,
} from '../src/lib/drive-load.js';
import type { DiskKind } from '../src/lib/resource-limits.js';

const MB = 1024 * 1024;
const kinds: Record<string, DiskKind> = { C: 'ssd', D: 'nvme' };
const kindOf = (l: string): DiskKind => kinds[l] ?? 'unknown';

const twoDisks: SysDrive[] = [
  { instance: '0 C:', letters: ['C'], activePct: 12, responseMs: 0.4, readBps: 0.1 * MB, writeBps: 6 * MB, iops: 56 },
  { instance: '1 D: E:', letters: ['D', 'E'], activePct: 100, responseMs: 1.4, readBps: 29 * MB, writeBps: 0.4 * MB, iops: 650 },
];

describe('drive letters', () => {
  it('reads the letter of a Windows path only', () => {
    expect(driveLetter('d:\\Games\\StarCitizen\\LIVE')).toBe('D');
    expect(driveLetter('/home/x')).toBeNull();
    expect(driveLetter(42)).toBeNull();
  });
});

describe('drive slots', () => {
  it('is empty until an install is known', () => {
    expect(driveSlots(null, null, kindOf, null)).toEqual([]);
  });

  it('merges game and work into one "both" slot on the same letter', () => {
    expect(driveSlots('D', 'D', kindOf, null)).toEqual([{ letter: 'D', letters: ['D'], role: 'both', kind: 'nvme' }]);
    expect(driveSlots('D', null, kindOf, null)[0]!.role).toBe('both');
  });

  it('merges two letters that sit on one physical disk', () => {
    const s = driveSlots('D', 'E', kindOf, twoDisks);
    expect(s).toEqual([{ letter: 'D', letters: ['D', 'E'], role: 'both', kind: 'nvme' }]);
  });

  it('keeps two physical disks apart, game first', () => {
    const s = driveSlots('D', 'C', kindOf, twoDisks);
    expect(s.map((x) => [x.letter, x.role, x.kind])).toEqual([
      ['D', 'game', 'nvme'],
      ['C', 'work', 'ssd'],
    ]);
  });

  it('without monitor data, different letters count as different disks', () => {
    expect(driveSlots('D', 'E', kindOf, null).map((x) => x.role)).toEqual(['game', 'work']);
  });
});

describe('drive loads', () => {
  const run = { readBps: 27 * MB, writeBps: 3 * MB, iops: 600 };

  it('reports the whole-PC numbers of each disk in MB/s', () => {
    const [d, c] = driveLoads(driveSlots('D', 'C', kindOf, twoDisks), twoDisks, run);
    expect(d).toMatchObject({ activePct: 100, responseMs: 1.4, readMBs: 29, writeMBs: 0.4, iops: 650 });
    expect(c).toMatchObject({ activePct: 12, responseMs: 0.4, readMBs: 0.1, writeMBs: 6, iops: 56 });
  });

  it('two disks: run reads go to the game drive, writes to the work drive, ops split by bytes', () => {
    const [d, c] = driveLoads(driveSlots('D', 'C', kindOf, twoDisks), twoDisks, run);
    expect(d!.runAttribution).toBe('assumed');
    expect(d!.run).toEqual({ readMBs: 27, writeMBs: 0, iops: 540 });
    expect(c!.run).toEqual({ readMBs: 0, writeMBs: 3, iops: 56 }); // 60 attributed, capped at the disk's 56
    expect(d!.runSharePct).toBe(91.8);
    expect(c!.runSharePct).toBe(49.2);
  });

  it('one disk: all of the run lands on it', () => {
    const one: SysDrive[] = [{ instance: '0 C:', letters: ['C'], readBps: 40 * MB, writeBps: 10 * MB, iops: 900 }];
    const [c] = driveLoads(driveSlots('C', 'C', kindOf, one), one, run);
    expect(c!.role).toBe('both');
    expect(c!.runAttribution).toBe('all');
    expect(c!.run).toEqual({ readMBs: 27, writeMBs: 3, iops: 600 });
    expect(c!.runSharePct).toBe(60);
  });

  it('never books more to the run than the disk moved (file-cache hits)', () => {
    const quiet: SysDrive[] = [{ instance: '0 C:', letters: ['C'], readBps: 2 * MB, writeBps: 0, iops: 10 }];
    const [c] = driveLoads(driveSlots('C', null, kindOf, quiet), quiet, run);
    expect(c!.run).toEqual({ readMBs: 2, writeMBs: 0, iops: 10 });
    expect(c!.runSharePct).toBe(100);
  });

  it('nulls instead of zeros while the monitor has not reported', () => {
    const [c] = driveLoads(driveSlots('C', null, kindOf, null), null, run);
    expect(c).toMatchObject({ activePct: null, responseMs: null, readMBs: null, writeMBs: null, iops: null, runSharePct: null });
    expect(c!.run.readMBs).toBe(27);
  });

  it('a near-idle disk has no run share', () => {
    const idle: SysDrive[] = [{ instance: '0 C:', letters: ['C'], readBps: 1000, writeBps: 0, iops: 1 }];
    expect(driveLoads(driveSlots('C', null, kindOf, idle), idle, run)[0]!.runSharePct).toBeNull();
  });
});

describe('sysmon drives parsing', () => {
  it('drops malformed entries and fields', () => {
    expect(parseSysDrives(undefined)).toBeNull();
    expect(
      parseSysDrives([
        { instance: '0 C:', letters: ['c', 'ZZ', 3], readBps: 5, iops: -1, activePct: 'x' },
        { letters: ['D'] },
        null,
      ]),
    ).toEqual([
      { instance: '0 C:', letters: ['C'], activePct: undefined, responseMs: undefined, readBps: 5, writeBps: undefined, iops: undefined },
    ]);
  });
});

describe('primary GPU', () => {
  it('prefers a discrete GPU and skips virtual adapters', () => {
    expect(pickPrimaryGpu(['Intel(R) UHD Graphics 770', 'NVIDIA GeForce RTX 4070', ''])).toBe('NVIDIA GeForce RTX 4070');
    expect(pickPrimaryGpu(['Microsoft Basic Display Adapter', 'AMD Radeon(TM) Graphics'])).toBe('AMD Radeon(TM) Graphics');
    expect(pickPrimaryGpu(['Parsec Virtual Display Adapter', 'Microsoft Remote Display Adapter'])).toBeNull();
    expect(pickPrimaryGpu([])).toBeNull();
  });
});
