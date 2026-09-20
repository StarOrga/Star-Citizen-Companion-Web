import { FEEDBACK_MAX_CHARS } from '../feedback/feedback-limits';
import {
  DIAGNOSTIC_EXCERPT_CHARS,
  buildDiagnosticTopic,
  diagnosticExcerpt,
  diagnosticLogFile,
  diagnosticLogName,
  type DiagnosticRow,
} from './telemetry-diagnostics';

function row(over: Partial<DiagnosticRow> = {}): DiagnosticRow {
  return {
    id: 4711,
    at: Date.UTC(2026, 8, 20, 9, 30, 0),
    product: 'data-uploader',
    version: '0.31.0',
    channel: 'stable',
    os: 'win',
    kind: 'extract',
    outcome: 'ok',
    warnings: 2,
    errors: 1,
    dropped: 0,
    phase: 'extract',
    pct: 100,
    elapsedMs: 90_000,
    gameChannel: 'LIVE',
    patchVersion: '4.2.1',
    message: 'extract finished (ok) with 2 warning(s), 1 error(s)',
    lines: '+00:05 [warn] unreadable record a\n+00:06 [warn] unreadable record b\n+01:30 [err] Traceback',
    ...over,
  };
}

/** Echoes the key with its params — enough to see what the body is built from. */
const t = (key: string, params?: Record<string, unknown>): string =>
  params ? `${key}${JSON.stringify(params)}` : key;

describe('telemetry diagnostics → feedback topic', () => {
  describe('diagnosticExcerpt', () => {
    it('keeps the first lines and says how many follow', () => {
      const lines = Array.from({ length: 20 }, (_, i) => `+00:0${i % 10} [warn] w${i}`).join('\n');
      const out = diagnosticExcerpt(lines);
      expect(out).toContain('w0');
      expect(out).toContain('w11');
      expect(out).not.toContain('w12');
      expect(out).toContain('(8 more)');
    });

    it('cuts to the character budget', () => {
      const out = diagnosticExcerpt('x'.repeat(2000), 100);
      expect(out.length).toBeLessThanOrEqual(100);
      expect(out.endsWith('…')).toBe(true);
    });
  });

  describe('buildDiagnosticTopic', () => {
    it('carries the run facts, the ask and the excerpt in a code block', () => {
      const body = buildDiagnosticTopic(row(), t);
      expect(body).toContain('telemetry.diagnostics.topic.head');
      expect(body).toContain('"version":"0.31.0"');
      expect(body).toContain('"warnings":2');
      expect(body).toContain('"errors":1');
      expect(body).toContain('"game":"LIVE 4.2.1"');
      expect(body).toContain('"id":4711');
      expect(body).toContain('telemetry.diagnostics.topic.ask');
      expect(body).toContain('```\n+00:05 [warn] unreadable record a');
      expect(body.endsWith('```')).toBe(true);
    });

    it('translates kind and outcome when a label exists, falls back to the raw value', () => {
      const labelled = (key: string, params?: Record<string, unknown>): string =>
        key === 'telemetry.diagnostics.kind.extract' ? 'Extraktion' : t(key, params);
      const body = buildDiagnosticTopic(row({ outcome: 'weird' }), labelled);
      expect(body).toContain('"kind":"Extraktion"');
      // No label for it → the wire value, never the untranslated key.
      expect(body).toContain('"outcome":"weird"');
    });

    it('always fits the message cap, even with the longest transcript', () => {
      const lines = Array.from({ length: 400 }, (_, i) => `+00:00 [warn] ${'m'.repeat(380)} ${i}`).join('\n');
      const body = buildDiagnosticTopic(row({ lines }), t);
      expect(body.length).toBeLessThanOrEqual(FEEDBACK_MAX_CHARS);
      expect(body.length).toBeLessThanOrEqual(DIAGNOSTIC_EXCERPT_CHARS + 600);
    });
  });

  describe('diagnosticLogFile', () => {
    it('names the file by version, kind, time and event id — no spaces', () => {
      const name = diagnosticLogName(row());
      expect(name).toBe('data-uploader-0.31.0-extract-2026-09-20T09-30-00-4711.log');
      expect(name).not.toContain(' ');
    });

    it('is a plain-text file holding a header and the full transcript', async () => {
      const file = diagnosticLogFile(row({ dropped: 3 }));
      expect(file.type).toBe('text/plain');
      expect(file.name).toMatch(/\.log$/);
      const text = await file.text();
      expect(text).toContain('# Data Uploader 0.31.0 (stable) — extract ok');
      expect(text).toContain('telemetry event #4711');
      expect(text).toContain('2 warning(s), 1 error(s), 3 not kept');
      expect(text).toContain('+01:30 [err] Traceback');
    });
  });
});
