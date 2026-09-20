import { describe, it, expect } from 'vitest';
import {
  JOB_DIAGNOSTICS_ERROR_TYPE,
  JOB_DIAGNOSTICS_NAME,
  MAX_DIAGNOSTIC_LINES,
  buildJobDiagnostics,
  collectDiagnostic,
  diagnosticLevelOf,
  formatTranscript,
  newJobDiagnostics,
  redactHome,
} from '../src/lib/job-diagnostics.js';

describe('diagnosticLevelOf', () => {
  it('keeps warnings and errors, drops everything else', () => {
    expect(diagnosticLevelOf({ type: 'warning', message: 'x' })).toBe('warn');
    expect(diagnosticLevelOf({ type: 'error', message: 'x' })).toBe('error');
    expect(diagnosticLevelOf({ type: 'log', level: 'warn', message: 'x' })).toBe('warn');
    expect(diagnosticLevelOf({ type: 'log', level: 'error', message: 'x' })).toBe('error');
    expect(diagnosticLevelOf({ type: 'log', level: 'info', message: 'x' })).toBeNull();
    expect(diagnosticLevelOf({ type: 'log', message: 'x' })).toBeNull();
    expect(diagnosticLevelOf({ type: 'progress' })).toBeNull();
    expect(diagnosticLevelOf({ type: 'phase' })).toBeNull();
    expect(diagnosticLevelOf({ type: 'done' })).toBeNull();
  });
});

describe('collectDiagnostic', () => {
  it('records level, message and a relative offset', () => {
    const diag = newJobDiagnostics();
    collectDiagnostic(diag, { type: 'progress' }, 100);
    collectDiagnostic(diag, { type: 'warning', message: 'unreadable record 12' }, 61_500);
    collectDiagnostic(diag, { type: 'log', level: 'error', message: '[py.stderr] Traceback' }, 70_000);
    expect(diag.lines).toEqual([
      { level: 'warn', message: 'unreadable record 12', atMs: 61_500 },
      { level: 'error', message: '[py.stderr] Traceback', atMs: 70_000 },
    ]);
    expect(diag.dropped).toBe(0);
  });

  it('counts instead of keeping past the line cap', () => {
    const diag = newJobDiagnostics();
    for (let i = 0; i < MAX_DIAGNOSTIC_LINES + 7; i++) {
      collectDiagnostic(diag, { type: 'warning', message: `w${i}` }, i);
    }
    expect(diag.lines).toHaveLength(MAX_DIAGNOSTIC_LINES);
    expect(diag.dropped).toBe(7);
  });

  it('masks the operator user name in paths', () => {
    const diag = newJobDiagnostics();
    collectDiagnostic(
      diag,
      { type: 'warning', message: 'cannot write C:\\Users\\jerry\\AppData\\out\\x.json' },
      0,
    );
    expect(diag.lines[0].message).toBe('cannot write C:\\Users\\<user>\\AppData\\out\\x.json');
  });
});

describe('redactHome', () => {
  it('covers Windows, macOS and Linux home roots and leaves the rest', () => {
    expect(redactHome('C:/Users/jerry/Games/Data.p4k')).toBe('C:/Users/<user>/Games/Data.p4k');
    expect(redactHome('/Users/jerry/x')).toBe('/Users/<user>/x');
    expect(redactHome('/home/jerry/x')).toBe('/home/<user>/x');
    expect(redactHome('Data/Libs/Foundry/Records/x.xml')).toBe('Data/Libs/Foundry/Records/x.xml');
  });
});

describe('formatTranscript', () => {
  it('renders one line per entry with a mm:ss offset and level tag', () => {
    const diag = newJobDiagnostics();
    collectDiagnostic(diag, { type: 'warning', message: 'a' }, 5_000);
    collectDiagnostic(diag, { type: 'error', message: 'b' }, 125_000);
    expect(formatTranscript(diag)).toBe('+00:05 [warn] a\n+02:05 [err] b');
  });

  it('keeps head and tail with an omission marker when over budget', () => {
    const diag = newJobDiagnostics();
    for (let i = 0; i < 50; i++) collectDiagnostic(diag, { type: 'warning', message: `line ${i}` }, i * 1000);
    const out = formatTranscript(diag, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out).toContain('line 0');
    expect(out).toContain('line 49');
    expect(out).toMatch(/… \d+ line\(s\) omitted …/);
  });

  it('mentions dropped lines', () => {
    const diag = newJobDiagnostics();
    collectDiagnostic(diag, { type: 'warning', message: 'a' }, 0);
    diag.dropped = 3;
    expect(formatTranscript(diag)).toContain('3 more line(s) not kept');
  });
});

describe('buildJobDiagnostics', () => {
  it('returns null for a clean run — no row for nothing', () => {
    expect(buildJobDiagnostics(newJobDiagnostics(), { kind: 'extract', jobId: 'j', outcome: 'ok' })).toBeNull();
  });

  it('uses its own bucket and carries counts + run context', () => {
    const diag = newJobDiagnostics();
    collectDiagnostic(diag, { type: 'warning', message: 'w1' }, 1000);
    collectDiagnostic(diag, { type: 'warning', message: 'w2' }, 2000);
    collectDiagnostic(diag, { type: 'error', message: 'e1' }, 3000);
    const ev = buildJobDiagnostics(diag, {
      kind: 'extract',
      jobId: 'j1',
      outcome: 'ok',
      phase: 'extract',
      pct: 99.6,
      elapsedMs: 4321.7,
      channel: 'LIVE',
      patchVersion: '4.2.1',
    });
    expect(ev).not.toBeNull();
    expect(ev!.errorType).toBe(JOB_DIAGNOSTICS_ERROR_TYPE);
    expect(ev!.errorType).toBe('job-diagnostics');
    expect(ev!.name).toBe(JOB_DIAGNOSTICS_NAME);
    expect(ev!.message).toBe('extract finished (ok) with 2 warning(s), 1 error(s)');
    expect(ev!.stack).toContain('[warn] w1');
    expect(ev!.stack).toContain('[err] e1');
    expect(ev!.extra).toEqual({
      kind: 'extract',
      jobId: 'j1',
      outcome: 'ok',
      warnings: 2,
      errors: 1,
      dropped: 0,
      phase: 'extract',
      pct: 100,
      elapsedMs: 4322,
      channel: 'LIVE',
      patchVersion: '4.2.1',
    });
  });

  it('still reports when only dropped lines remain countable', () => {
    const diag = newJobDiagnostics();
    diag.dropped = 2;
    const ev = buildJobDiagnostics(diag, { kind: 'skin', jobId: 'j', outcome: 'failed' });
    expect(ev?.message).toBe('skin finished (failed) with 0 warning(s), 0 error(s) (+2 not kept)');
  });
});
