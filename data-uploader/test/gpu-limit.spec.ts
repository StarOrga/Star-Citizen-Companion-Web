import { describe, expect, it } from 'vitest';
import {
  DISK_CAPS,
  appCpuPct,
  clampLimits,
  diskScaleTop,
  governorLimits,
  matchPreset,
  migrateLegacyGpu,
  parseSampleGpu,
  presetGpuPct,
  presetLimits,
  rangesFor,
  type MachineInfo,
} from '../src/lib/resource-limits.js';
import { descendantPids, parseGpuDetect, parseProcessTable, parseVramBytes, shortGpuName } from '../src/lib/drive-load.js';

const pc: MachineInfo = { cores: 16, totalRamMb: 32768, disk: DISK_CAPS.nvme };
const MB = 1024 * 1024;

describe('GPU limit gpuPct', () => {
  it('has a 0..100 range and clamps into it (0 = GPU off is valid)', () => {
    expect(rangesFor(pc).gpuPct).toEqual({ min: 0, max: 100, step: 1 });
    expect(clampLimits({ gpuPct: 150 }, pc).gpuPct).toBe(100);
    expect(clampLimits({ gpuPct: -5 }, pc).gpuPct).toBe(0);
    expect(clampLimits({ gpuPct: 0 }, pc).gpuPct).toBe(0);
    expect(clampLimits({ gpuPct: 42.4 }, pc).gpuPct).toBe(42);
    // Missing / garbage falls back to the default preset (balanced = 80).
    expect(clampLimits({ gpuPct: 'x' }, pc).gpuPct).toBe(80);
  });

  it('presets carry their GPU share: gaming off, balanced 80, full 100', () => {
    expect(presetLimits('gaming', pc).gpuPct).toBe(0);
    expect(presetLimits('balanced', pc).gpuPct).toBe(80);
    expect(presetLimits('full', pc).gpuPct).toBe(100);
    expect(presetGpuPct('balanced')).toBe(80);
  });

  it('matchPreset compares the GPU share too', () => {
    expect(matchPreset(presetLimits('balanced', pc), pc)).toBe('balanced');
    expect(matchPreset({ ...presetLimits('balanced', pc), gpuPct: 50 }, pc)).toBeNull();
    expect(matchPreset({ ...presetLimits('gaming', pc), gpuPct: 0 }, pc)).toBe('gaming');
  });

  it('is not part of what the governor enforces', () => {
    expect(governorLimits(presetLimits('full', pc))).not.toHaveProperty('gpuPct');
  });
});

describe('legacy useGpu migration', () => {
  it('a custom mix without gpuPct keeps the old switch meaning', () => {
    const custom: { preset: null; cpuPct: number; gpuPct?: number } = { preset: null, cpuPct: 40 };
    const off = migrateLegacyGpu(custom, false);
    expect(off).toEqual({ stored: { preset: null, cpuPct: 40, gpuPct: 0 }, migrated: true });
    expect(migrateLegacyGpu({ ...custom }, true).stored?.gpuPct).toBe(80);
  });

  it('a preset carries its own value; an existing gpuPct and no stored limits pass through', () => {
    expect(migrateLegacyGpu({ preset: 'balanced' as const }, false)).toEqual({ stored: { preset: 'balanced' }, migrated: false });
    expect(migrateLegacyGpu({ preset: null, gpuPct: 30 }, false).migrated).toBe(false);
    expect(migrateLegacyGpu(undefined, true)).toEqual({ stored: undefined, migrated: false });
  });
});

describe('sysmon GPU sample', () => {
  it('converts bytes to MB and keeps the shares within the whole', () => {
    expect(parseSampleGpu({ loadPct: 63.27, runLoadPct: 41.04, vramUsedBytes: 3500 * MB, vramRunBytes: 900 * MB }, 8192)).toEqual({
      loadPct: 63.3,
      runLoadPct: 41,
      vramUsedMb: 3500,
      vramRunMb: 900,
      vramTotalMb: 8192,
    });
    expect(parseSampleGpu({ loadPct: 20, runLoadPct: 35, vramUsedBytes: 10 * MB, vramRunBytes: 50 * MB }, null)).toMatchObject({
      runLoadPct: 20,
      vramRunMb: 10,
      vramTotalMb: null,
    });
  });

  it('absent or malformed = unmeasured (null)', () => {
    expect(parseSampleGpu(undefined, 8192)).toBeNull();
    expect(parseSampleGpu(null, 8192)).toBeNull();
    expect(parseSampleGpu({ runLoadPct: 4 }, 8192)).toBeNull();
    expect(parseSampleGpu({ loadPct: 12 }, 0)).toEqual({ loadPct: 12, runLoadPct: 0, vramUsedMb: 0, vramRunMb: 0, vramTotalMb: null });
  });
});

describe('app CPU share', () => {
  it('normalises per-core percentCPUUsage to the whole machine', () => {
    expect(appCpuPct([50, 30, 0, 80], 16)).toBe(10);
    expect(appCpuPct([null, undefined, Number.NaN, -3], 8)).toBe(0);
    expect(appCpuPct([500], 2)).toBe(100);
  });
});

describe('GPU detection parsing', () => {
  it('reads VRAM from a REG_QWORD decimal or a little-endian REG_BINARY', () => {
    expect(parseVramBytes('8589934592')).toBe(8589934592);
    expect(parseVramBytes('hex:0000000002000000')).toBe(8589934592);
    expect(parseVramBytes('hex:00000080')).toBe(2147483648);
    expect(parseVramBytes('')).toBeNull();
    expect(parseVramBytes('0')).toBeNull();
    expect(parseVramBytes('hex:abc')).toBeNull();
  });

  it('picks the primary GPU and the VRAM of the adapter whose DriverDesc matches', () => {
    const out = [
      'NAME|Intel(R) UHD Graphics 770',
      'NAME|NVIDIA GeForce RTX 2080 SUPER',
      'REG|Intel(R) UHD Graphics 770|hex:0000000080000000',
      'REG|NVIDIA GeForce RTX 2080 SUPER|8589934592',
    ].join('\r\n');
    expect(parseGpuDetect(out)).toEqual({ name: 'NVIDIA GeForce RTX 2080 SUPER', vramTotalMb: 8192 });
    // No matching description: the only adapter with a size is taken.
    expect(parseGpuDetect('NAME|AMD Radeon RX 7900 XTX\nREG|AMD Radeon RX 7900 XTX (driver)|25769803776')).toEqual({
      name: 'AMD Radeon RX 7900 XTX',
      vramTotalMb: 24576,
    });
    expect(parseGpuDetect('NAME|NVIDIA GeForce GTX 1080')).toEqual({ name: 'NVIDIA GeForce GTX 1080', vramTotalMb: null });
    expect(parseGpuDetect('')).toEqual({ name: null, vramTotalMb: null });
  });

  it('strips the vendor prefix for the card header', () => {
    expect(shortGpuName('NVIDIA GeForce RTX 2080 SUPER')).toBe('RTX 2080 SUPER');
    expect(shortGpuName('AMD Radeon RX 7900 XTX')).toBe('RX 7900 XTX');
    expect(shortGpuName('Intel(R) Arc(TM) A770 Graphics')).toBe('Arc A770 Graphics');
    expect(shortGpuName('AMD Radeon(TM) Graphics')).toBe('Radeon Graphics');
    expect(shortGpuName('Intel(R) UHD Graphics 770')).toBe('UHD Graphics 770');
    expect(shortGpuName(null)).toBeNull();
  });
});

describe('uploader process tree', () => {
  it('collects every descendant of the sidecars, without loops', () => {
    const table = parseProcessTable('0 0\r\n4 0\r\n100 1\r\n200 100\r\n201 100\r\n300 200\r\n999 4\r\ngarbage');
    expect(descendantPids([100], table).sort((a, b) => a - b)).toEqual([200, 201, 300]);
    expect(descendantPids([555], table)).toEqual([]);
    expect(descendantPids([0], table)).toEqual([4, 999]);
  });
});

describe('disk scale top (every drive kind)', () => {
  it('follows the measured peak, also above the nominal class', () => {
    expect(diskScaleTop(3100, 800, 5, 2000)).toBe(5000);
    expect(diskScaleTop(1850, 800, 5, 2000)).toBe(2000);
  });

  it('gives the limit headroom, but never past the range top', () => {
    expect(diskScaleTop(0, 800, 5, 2000)).toBe(2000);
    expect(diskScaleTop(0, 100, 5, 2000)).toBe(200);
    expect(diskScaleTop(0, 2000, 5, 2000)).toBe(2000);
    expect(diskScaleTop(0, 0, 5, 2000)).toBe(5);
  });

  it('only grows', () => {
    expect(diskScaleTop(0, 50, 5, 2000, 500)).toBe(500);
    expect(diskScaleTop(900, 50, 5, 2000, 500)).toBe(1000);
  });
});
