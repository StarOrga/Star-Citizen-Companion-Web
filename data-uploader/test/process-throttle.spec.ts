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
  });

  it('stays inside Int64 at 64 cores, because [IntPtr] converts via Int64', () => {
    // The unsigned mask (2^64-1 = 18446744073709551615) is what the bit math
    // produces, but PowerShell cannot parse it: "[IntPtr]18446744073709551615"
    // raises "Value was either too large or too small for an Int64", which the
    // affinity try/catch swallows. Two's complement is the same 64 bits and
    // parses, so the restore-to-all-cores path actually runs on a 64-thread box.
    expect(affinityMask('auto', 64)).toBe('-1');
    expect(affinityMask(64, 64)).toBe('-1');
    // 63 cores still fits unsigned — exactly Int64.MAX_VALUE.
    expect(affinityMask('auto', 63)).toBe('9223372036854775807');
    // A machine with more logical processors than one Windows processor group
    // holds is clamped to the group, not wrapped.
    expect(affinityMask('auto', 128)).toBe('-1');
  });

  it('emits only masks a Int64 parse would accept', () => {
    // Guards the whole range rather than the two values we happen to name
    // above: every mask must survive the Int64 conversion PowerShell performs.
    for (const total of [1, 2, 8, 31, 32, 33, 63, 64, 96, 128]) {
      const value = BigInt(affinityMask('auto', total));
      expect(value).toBeGreaterThanOrEqual(-(2n ** 63n));
      expect(value).toBeLessThanOrEqual(2n ** 63n - 1n);
      // ...and must still describe a non-empty core set.
      expect(BigInt.asUintN(64, value)).toBeGreaterThan(0n);
    }
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
    expect(script).toContain('$q.Enqueue(4242)');
    expect(script).toContain('ProcessPriorityClass]::Idle');
    expect(script).toContain('[IntPtr]1'); // minimal = 1 core
  });

  it('walks the process TREE, because the sidecar is not the process burning CPU', () => {
    // The record dump runs in worker processes and the skin pipeline shells out
    // to cgf-converter / gltf-transform. Steering only the registered pid leaves
    // the actual hogs untouched while the UI reports the switch as applied.
    const script = buildThrottleCommand('win32', 4242, runtimeFor('minimal'), 8)!.args.at(-1)!;
    expect(script).toContain('ParentProcessId=$id');
    expect(script).toContain('foreach($id in $ids)');
    // Inheritance cannot substitute for this: a child only picks up the parent's
    // class when it is Idle or BelowNormal, so throttling UP never propagates.
    const up = buildThrottleCommand('win32', 4242, runtimeFor('maximum'), 8)!.args.at(-1)!;
    expect(up).toContain('ParentProcessId=$id');
  });

  it('bounds the tree walk so a pid-reuse cycle cannot hang the switch', () => {
    const script = buildThrottleCommand('win32', 4242, runtimeFor('standard'), 8)!.args.at(-1)!;
    expect(script).toContain('$ids.Count -lt 256');
    expect(script).toContain('if($ids.Contains($id)){continue}');
  });

  it('isolates each process so one dead pid does not cost the others', () => {
    const script = buildThrottleCommand('win32', 4242, runtimeFor('minimal'), 8)!.args.at(-1)!;
    expect(script).toContain('Get-Process -Id $id -ErrorAction Stop');
    expect(script).toMatch(/foreach\(\$id in \$ids\)\{try\{/);
  });

  it('maps every profile onto its .NET priority class', () => {
    const priorityOf = (p: 'minimal' | 'standard' | 'maximum' | 'auto'): string =>
      buildThrottleCommand('win32', 1, runtimeFor(p), 8)!.args.at(-1)!;
    expect(priorityOf('minimal')).toContain('::Idle');
    expect(priorityOf('standard')).toContain('::Normal');
    expect(priorityOf('auto')).toContain('::BelowNormal');
    // maximum is Normal, NOT AboveNormal. Raising the class buys nothing here:
    // Windows does not propagate AboveNormal to children (measured on Win11 —
    // only Idle and BelowNormal are inherited), so it could only ever lift the
    // coordinating process, which is idle while the workers run. What it WOULD
    // reliably do is outrank the Electron UI on a low-core box and starve the
    // cancel button. Parallelism is what makes this profile fast.
    expect(priorityOf('maximum')).toContain('::Normal');
    expect(priorityOf('maximum')).not.toContain('::AboveNormal');
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
      'priority=normal cores=8 (all) pacing=0ms',
    );
  });
});
