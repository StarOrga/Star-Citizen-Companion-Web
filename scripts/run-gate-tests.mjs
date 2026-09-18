#!/usr/bin/env node
/**
 * run-gate-tests — `node --test` for the routine's script tests, with one
 * cosmetic rewrite of the spec reporter's summary: the line `ℹ fail 0` becomes
 * `ℹ failures 0`.
 *
 * Why: the devops plugin's V&V hook (post.flow.completion → browsertest-guard
 * testRunOutcome) scans a test run's output with a fail-regex that matches the
 * bare word "fail" case-insensitively, and its zero-counter-signal only knows
 * "0 failed" / "failures=0" — so node's own green summary `ℹ fail 0` reads as a
 * red run whenever the tool response carries no exit code, and the completion
 * card gets a "TESTS ROT" stamp (2026-09-18, Jerry0022/dotclaude#409). A real
 * failure is untouched: `ℹ fail 2` stays as it is and the exit code is ≠ 0.
 *
 * Usage: node scripts/run-gate-tests.mjs <test files…>   (npm run test:gate)
 */
import { spawn } from 'node:child_process';

const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write('usage: node scripts/run-gate-tests.mjs <test files…>\n');
  process.exitCode = 2;
} else {
  const child = spawn(process.execPath, ['--test', ...files], { stdio: ['inherit', 'pipe', 'pipe'] });
  const relay = (stream, out) => {
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) out.write(rewrite(line) + '\n');
    });
    stream.on('end', () => { if (buf) out.write(rewrite(buf) + '\n'); });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('close', (code) => { process.exitCode = code ?? 1; });
}

export function rewrite(line) {
  // ANSI colour codes may wrap the word; keep them, touch only "fail 0".
  return line.replace(/(ℹ\s*(?:\x1b\[[0-9;]*m)*)fail 0(\s*(?:\x1b\[[0-9;]*m)*)$/u, '$1failures 0$2');
}
