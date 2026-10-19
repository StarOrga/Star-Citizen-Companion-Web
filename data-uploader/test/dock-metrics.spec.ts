import { describe, it, expect } from 'vitest';
import {
  HISTORY_SIZE,
  History,
  Ring,
  bindingDiskLimit,
  defaultDiskMetric,
  ledSplit,
  boostLevels,
  dots,
  driveRunPct,
  padCell,
  splitBar,
} from '../src/lib/dock-metrics.js';

describe('Ring (60 s tooltip history)', () => {
  it('is empty until a value lands, and skips unmeasured values', () => {
    const r = new Ring();
    expect(r.avg()).toBeNull();
    expect(r.max()).toBeNull();
    r.push(null);
    r.push(undefined);
    r.push(Number.NaN);
    expect(r.count).toBe(0);
  });

  it('keeps only the last HISTORY_SIZE values', () => {
    const r = new Ring();
    for (let i = 1; i <= HISTORY_SIZE + 10; i++) r.push(i);
    expect(r.count).toBe(HISTORY_SIZE);
    expect(r.max()).toBe(HISTORY_SIZE + 10);
    // 11..70 → mean 40.5
    expect(r.avg()).toBeCloseTo(40.5, 6);
  });

  it('forgets an old peak once it scrolls out', () => {
    const r = new Ring(3);
    [100, 1, 2, 3].forEach((v) => r.push(v));
    expect(r.max()).toBe(3);
  });
});

describe('History', () => {
  it('addresses rings by id', () => {
    const h = new History();
    h.push('cpu.pc', 10);
    h.push('cpu.pc', 30);
    h.push('ram.used', 5);
    expect(h.avg('cpu.pc')).toBe(20);
    expect(h.max('ram.used')).toBe(5);
    expect(h.avg('missing')).toBeNull();
  });
});

describe('bar split', () => {
  it('splits the whole value into the run from 0 and other programs after it', () => {
    expect(splitBar(66, 41)).toEqual({ run: 41, others: 25 });
  });
  it('never lets the run exceed the whole, nor anything exceed 100', () => {
    expect(splitBar(30, 50)).toEqual({ run: 30, others: 0 });
    expect(splitBar(140, 20)).toEqual({ run: 20, others: 80 });
    expect(splitBar(-5, 3)).toEqual({ run: 0, others: 0 });
  });
  it('turns a drive byte share into a part of its active time', () => {
    expect(driveRunPct(100, 91)).toBe(91);
    expect(driveRunPct(50, 50)).toBe(25);
    expect(driveRunPct(null, 50)).toBe(0);
    expect(driveRunPct(80, null)).toBe(0);
  });
});

describe('bindingDiskLimit', () => {
  const limits = { readMBs: 400, writeMBs: 100, iops: 2000 };
  it('names the budget closest to its limit', () => {
    expect(bindingDiskLimit({ readMBs: 390, writeMBs: 5, iops: 300 }, limits)).toBe('readMBs');
    expect(bindingDiskLimit({ readMBs: 10, writeMBs: 99, iops: 300 }, limits)).toBe('writeMBs');
    expect(bindingDiskLimit({ readMBs: 10, writeMBs: 5, iops: 1990 }, limits)).toBe('iops');
  });
  it('falls back to read when nothing moves', () => {
    expect(bindingDiskLimit({ readMBs: 0, writeMBs: 0, iops: 0 }, limits)).toBe('readMBs');
  });
});

describe('boost levels', () => {
  it('match the agreed levels per resource (codex / silhouettes / 3D)', () => {
    expect(boostLevels('cpu')).toEqual([1, 3, 3]);
    expect(boostLevels('ram')).toEqual([3, 2, 2]);
    expect(boostLevels('game')).toEqual([3, 2, 2]);
    expect(boostLevels('work')).toEqual([1, 2, 3]);
  });
  it('a drive doing both jobs takes the higher need of each step', () => {
    expect(boostLevels('both')).toEqual([3, 2, 3]);
  });
  it('draws levels as dots', () => {
    expect(dots(2)).toBe('●●○');
    expect(dots(0)).toBe('○○○');
    expect(dots(9)).toBe('●●●');
  });
});

describe('padCell', () => {
  it('pads to a fixed width so a live tooltip keeps its size', () => {
    expect(padCell('9 %', 6)).toBe('   9 %');
    expect(padCell('100 %', 3)).toBe('100 %');
  });
});

describe('defaultDiskMetric', () => {
  const limits = { readMBs: 100, writeMBs: 100, iops: 1000 };
  const s = (o: Partial<{ running: boolean; heldBack: number; readMBs: number; writeMBs: number; iops: number }>) => ({
    running: true, heldBack: 0, readMBs: 0, writeMBs: 0, iops: 0, ...o,
  });
  it('is read without a sample, while idle, or when nothing holds the run back', () => {
    expect(defaultDiskMetric(null, limits)).toBe('readMBs');
    expect(defaultDiskMetric(s({ running: false, heldBack: 0.5, writeMBs: 99 }), limits)).toBe('readMBs');
    expect(defaultDiskMetric(s({ heldBack: 0.02, writeMBs: 99 }), limits)).toBe('readMBs');
  });
  it('is the binding budget while the run is held back', () => {
    expect(defaultDiskMetric(s({ heldBack: 0.4, readMBs: 20, writeMBs: 95 }), limits)).toBe('writeMBs');
    expect(defaultDiskMetric(s({ heldBack: 0.4, readMBs: 20, iops: 990 }), limits)).toBe('iops');
  });
});

describe('ledSplit', () => {
  it('splits 12 cells into uploader, others and free', () => {
    expect(ledSplit(100, 41, 12)).toEqual({ run: 5, others: 7 });
    expect(ledSplit(54, 15, 12)).toEqual({ run: 2, others: 4 });
    expect(ledSplit(0, 0, 12)).toEqual({ run: 0, others: 0 });
  });
  it('keeps a small share visible and never overflows', () => {
    expect(ledSplit(3, 2, 30).run).toBe(1);
    expect(ledSplit(250, 300, 12)).toEqual({ run: 12, others: 0 });
    expect(ledSplit(0.4, 0.2, 12)).toEqual({ run: 0, others: 0 });
  });
});
