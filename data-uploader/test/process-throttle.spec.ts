import { describe, it, expect } from 'vitest';
import { affinityMask, buildThrottleCommand, describeThrottle } from '../src/lib/process-throttle.js';
import { runtimeFor } from '../src/lib/throttle-control.js';

describe('affinityMask', () => {
  it('maps a core count onto the low bits', () => {
    expect(affinityMask(1, 8)).toBe('1');
    expect(affinityMask(4, 8)).toBe('15');
    expect(affinityMask(8, 8)).toBe('255');
  });

  it("expands 'auto' to every core the machine has", () => {
    expect(affinityMask('auto', 4)).toBe('15');
    expect(affinityMask('auto', 16)).toBe('65535');
  });

  it('does not wrap past 32 cores', () => {
    // A JS `1 << 32` wraps to 1, which would pin "all cores" to core 0 — the
    // exact inverse of the request, and invisible without a profiler.
    expect(affinityMask('auto', 32)).toBe('4294967295');
    expect(affinityMask('auto', 64)).toBe('18446744073709551615');
  });

  it('clamps a request for more cores than exist', () => {
    expect(affinityMask(64, 4)).toBe('15');
    expect(affinityMask(0, 8)).toBe('1');
    expect(affinityMask(-2, 8)).toBe('1');
  });
});

describe('buildThrottleCommand', () => {
  it('sets priority AND affinity in one PowerShell call on Windows', () => {
    const cmd = buildThrottleCommand('win32', 4242, runtimeFor('minimal'), 8);
    expect(cmd?.command).toBe('powershell.exe');
    const script = cmd!.args.at(-1)!;
    expect(script).toContain('Get-Process -Id 4242');
    expect(script).toContain('ProcessPriorityClass]::Idle');
    expect(script).toContain('[IntPtr]1'); // minimal = 1 core
  });

  it('maps every profile onto its .NET priority class', () => {
    const priorityOf = (p: 'minimal' | 'standard' | 'maximum' | 'auto'): string =>
      buildThrottleCommand('win32', 1, runtimeFor(p), 8)!.args.at(-1)!;
    expect(priorityOf('minimal')).toContain('::Idle');
    expect(priorityOf('standard')).toContain('::Normal');
    expect(priorityOf('maximum')).toContain('::AboveNormal');
    expect(priorityOf('auto')).toContain('::BelowNormal');
  });

  it('only narrows affinity for the throttled profile, and restores it otherwise', () => {
    const maskOf = (p: 'minimal' | 'standard' | 'maximum' | 'auto'): string =>
      buildThrottleCommand('win32', 1, runtimeFor(p), 8)!.args.at(-1)!;
    // Throttling back up has to GIVE THE CORES BACK, so every non-minimal
    // profile sets the full mask rather than leaving the previous one in place.
    expect(maskOf('minimal')).toContain('[IntPtr]1');
    for (const p of ['standard', 'maximum', 'auto'] as const) {
      expect(maskOf(p)).toContain('[IntPtr]255');
    }
  });

  it('keeps the priority change even if affinity is refused', () => {
    const script = buildThrottleCommand('win32', 7, runtimeFor('minimal'), 8)!.args.at(-1)!;
    // Affinity sits in its own try/catch — a locked-down process must not cost
    // us the priority change too.
    expect(script).toMatch(/try\{.*ProcessorAffinity.*\}catch\{\}/);
  });

  it('renices on POSIX (no affinity: taskset is Linux-only)', () => {
    expect(buildThrottleCommand('linux', 99, runtimeFor('minimal'), 8)).toEqual({
      command: 'renice',
      args: ['-n', '19', '-p', '99'],
    });
    expect(buildThrottleCommand('darwin', 99, runtimeFor('standard'), 8)?.args).toEqual([
      '-n',
      '0',
      '-p',
      '99',
    ]);
  });

  it('returns null for a platform with no mechanism, so the UI can say so', () => {
    expect(buildThrottleCommand('aix', 99, runtimeFor('minimal'), 8)).toBeNull();
  });

  it('refuses a non-integer or non-positive pid instead of interpolating it', () => {
    for (const pid of [0, -1, 1.5, Number.NaN]) {
      expect(buildThrottleCommand('win32', pid, runtimeFor('minimal'), 8)).toBeNull();
    }
  });
});

describe('describeThrottle', () => {
  it('spells out what was asked of the OS', () => {
    expect(describeThrottle(runtimeFor('minimal'), 8)).toBe('priority=idle cores=1 pacing=150ms');
    expect(describeThrottle(runtimeFor('maximum'), 8)).toBe(
      'priority=above_normal cores=8 (all) pacing=0ms',
    );
  });
});
