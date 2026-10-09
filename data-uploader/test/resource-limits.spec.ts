import { describe, expect, it } from 'vitest';
import {
  CPU_MAX_PCT,
  DISK_CAPS,
  clampLimits,
  diskKindFrom,
  dumpWorkers,
  governorLimits,
  matchPreset,
  presetFromLegacyProfile,
  presetLimits,
  rangesFor,
  ramOthersMb,
  silhouetteWorkers,
  skinWorkers,
  type MachineInfo,
} from '../src/lib/resource-limits.js';

const pc: MachineInfo = { cores: 16, totalRamMb: 32768, disk: DISK_CAPS.nvme };
const hddBox: MachineInfo = { cores: 4, totalRamMb: 8192, disk: DISK_CAPS.hdd };

describe('resource limits', () => {
  it('never lets the CPU scale reach the whole machine', () => {
    expect(rangesFor(pc).cpuPct.max).toBe(CPU_MAX_PCT);
    expect(presetLimits('full', pc).cpuPct).toBeLessThanOrEqual(90);
    expect(clampLimits({ cpuPct: 100 }, pc).cpuPct).toBe(90);
  });

  it('derives the scales from the machine', () => {
    expect(rangesFor(pc).ramMb.max).toBe(32768 - 2048);
    expect(rangesFor(pc).readMBs.max).toBe(2000);
    expect(rangesFor(hddBox).iops.max).toBe(150);
  });

  it('orders the presets from gentle to full', () => {
    const g = presetLimits('gaming', pc);
    const b = presetLimits('balanced', pc);
    const f = presetLimits('full', pc);
    for (const key of ['cpuPct', 'ramMb', 'readMBs', 'writeMBs', 'iops'] as const) {
      expect(g[key]).toBeLessThan(b[key]);
      expect(b[key]).toBeLessThan(f[key]);
    }
  });

  it('gives a small box at least one core while gaming', () => {
    expect(presetLimits('gaming', hddBox).cpuPct).toBe(25);
    expect(dumpWorkers(presetLimits('gaming', hddBox), 4)).toBe(1);
  });

  it('recognises a preset and a custom mix', () => {
    expect(matchPreset(presetLimits('gaming', pc), pc)).toBe('gaming');
    expect(matchPreset({ ...presetLimits('gaming', pc), cpuPct: 33 }, pc)).toBeNull();
  });

  it('clamps garbage back into range', () => {
    const l = clampLimits({ cpuPct: 'x', ramMb: -1, readMBs: 1e9, iops: Number.NaN }, pc);
    expect(l.cpuPct).toBe(presetLimits('balanced', pc).cpuPct);
    expect(l.ramMb).toBe(1024);
    expect(l.readMBs).toBe(2000);
  });

  it('sizes workers by CPU share and RAM', () => {
    expect(dumpWorkers({ ...presetLimits('full', pc), cpuPct: 50 }, 16)).toBe(8);
    expect(dumpWorkers({ ...presetLimits('full', pc), cpuPct: 90 }, 16)).toBe(14);
    expect(skinWorkers({ ...presetLimits('full', pc), cpuPct: 90, ramMb: 4096 }, 16)).toBe(1);
    expect(skinWorkers({ ...presetLimits('full', pc), cpuPct: 90, ramMb: 20000 }, 16)).toBe(4);
  });

  it('sizes the silhouette threads by CPU share, capped', () => {
    expect(silhouetteWorkers({ ...presetLimits('full', pc), cpuPct: 90 }, 16)).toBe(8);
    expect(silhouetteWorkers({ ...presetLimits('gaming', pc), cpuPct: 15 }, 16)).toBe(2);
    expect(silhouetteWorkers({ ...presetLimits('gaming', pc), ramMb: 1024 }, 16)).toBe(2);
  });

  it('hands the governor bytes and a background priority', () => {
    const g = governorLimits({ cpuPct: 20, ramMb: 2048, readMBs: 10, writeMBs: 5, iops: 100 });
    expect(g.readBps).toBe(10 * 1024 * 1024);
    expect(g.priority).toBe('idle');
    expect(governorLimits({ cpuPct: 60, ramMb: 2048, readMBs: 10, writeMBs: 5, iops: 100 }).priority).toBe('below_normal');
  });

  it('maps legacy speed profiles and disk types', () => {
    expect(presetFromLegacyProfile('minimal')).toBe('gaming');
    expect(presetFromLegacyProfile('maximum')).toBe('full');
    expect(presetFromLegacyProfile(undefined)).toBe('balanced');
    expect(diskKindFrom('SSD', 'NVMe')).toBe('nvme');
    expect(diskKindFrom('HDD', 'SATA')).toBe('hdd');
    expect(diskKindFrom('4', '11')).toBe('ssd');
    expect(diskKindFrom(null, null)).toBe('unknown');
  });

  it('computes what other programs hold', () => {
    expect(ramOthersMb({ ramUsedMb: 12000, ramAppMb: 400, ramRunMb: 3000 })).toBe(8600);
  });
});
