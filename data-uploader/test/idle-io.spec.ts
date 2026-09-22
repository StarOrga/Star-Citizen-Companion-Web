import { describe, it, expect } from 'vitest';
import { settleInitialVisibility, shouldStartHidden } from '../src/lib/window-visibility.js';
import { evaluateIdleBudget, IDLE_BUDGET } from '../scripts/idle-io-probe.js';

function fakeWindow() {
  const calls: string[] = [];
  return { calls, win: { show: () => void calls.push('show'), hide: () => void calls.push('hide') } };
}

describe('window visibility on the autostart launch', () => {
  it('starts hidden only for --hidden with minimize-to-tray on', () => {
    expect(shouldStartHidden(['app.exe', '--hidden'], true)).toBe(true);
    expect(shouldStartHidden(['app.exe', '--hidden'], false)).toBe(false);
    expect(shouldStartHidden(['app.exe'], true)).toBe(false);
  });

  it('a hidden start hides the window explicitly — never just leaves it unshown', () => {
    // Regression for 0.35.1: the handler returned without hide(), the
    // never-shown page stayed 'visible' and the connection-dot pulse kept the
    // renderer + GPU process busy (~1,900 writes / 4 MB per 30 s while idle).
    const { win, calls } = fakeWindow();
    settleInitialVisibility(win, true);
    expect(calls).toEqual(['hide']);
  });

  it('a normal start shows the window', () => {
    const { win, calls } = fakeWindow();
    settleInitialVisibility(win, false);
    expect(calls).toEqual(['show']);
  });
});

describe('idle I/O budget', () => {
  const sample = (writes: number, writeBytes: number) => ({ writes, writeBytes });

  it('encodes the acceptance thresholds', () => {
    expect(IDLE_BUDGET).toEqual({ maxWritesPer30s: 50, maxBytesPerSec: 10 * 1024, maxLogGrowthBytes: 0 });
  });

  it('fails on the 0.35.1 field measurement', () => {
    const r = evaluateIdleBudget({
      before: { '18136': sample(0, 0), '16876': sample(0, 0), '17548': sample(0, 0) },
      after: {
        '18136': sample(1899, 4.1 * 1024 * 1024),
        '16876': sample(1537, 0.4 * 1024 * 1024),
        '17548': sample(734, 0.1 * 1024 * 1024),
      },
      seconds: 30,
      logGrowthBytes: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.writesPer30s).toBe(4170);
    expect(r.breaches).toHaveLength(2);
  });

  it('passes a quiet idle and normalizes longer windows to per-30 s', () => {
    const r = evaluateIdleBudget({
      before: { a: sample(100, 10_000), b: sample(5, 500) },
      after: { a: sample(200, 20_000), b: sample(5, 500) },
      seconds: 300,
      logGrowthBytes: 0,
    });
    expect(r.writesPer30s).toBe(10);
    expect(r.ok).toBe(true);
  });

  it('fails when main.log grows at all', () => {
    const r = evaluateIdleBudget({ before: {}, after: {}, seconds: 300, logGrowthBytes: 1 });
    expect(r.ok).toBe(false);
    expect(r.breaches[0]).toMatch(/main\.log/);
  });

  it('counts a process that spawned mid-window from zero', () => {
    const r = evaluateIdleBudget({ before: {}, after: { x: sample(60, 0) }, seconds: 30, logGrowthBytes: 0 });
    expect(r.ok).toBe(false);
  });
});
