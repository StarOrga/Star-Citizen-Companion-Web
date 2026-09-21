// node --test scripts/build-with-exit-guard.test.mjs
//
// Fakes the ng build child with a tiny inline node script instead of
// spawning the real Angular CLI, so these run in well under a second.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { runGuarded, COMPLETION_MARKER } from './build-with-exit-guard.mjs';

// A script that prints the completion marker then sleeps forever (never
// exits on its own) — this is the hang the guard exists for.
const HANGING_CHILD = `
process.stdout.write(${JSON.stringify(COMPLETION_MARKER)} + '\\n');
setInterval(() => {}, 1000);
`;

const EXIT_2_CHILD = `
process.stdout.write(${JSON.stringify(COMPLETION_MARKER)} + '\\n');
process.exitCode = 2;
`;

function captureStream() {
  let text = '';
  const stream = new Writable({
    write(chunk, _enc, cb) {
      text += chunk.toString('utf8');
      cb();
    },
  });
  return { stream, get text() { return text; } };
}

test('artefacts present: kills the hung child after the grace period and exits 0', async () => {
  const out = captureStream();
  const code = await runGuarded(process.execPath, ['-e', HANGING_CHILD], {
    graceMs: 50,
    timeoutMs: 2000,
    artefactsComplete: () => true,
    stdout: out.stream,
    stderr: out.stream,
  });
  assert.equal(code, 0);
  assert.match(out.text, /ng build hung after completing output — proceeding under exit guard/);
});

test('artefacts missing: hits the hard ceiling and exits non-zero', async () => {
  const out = captureStream();
  const code = await runGuarded(process.execPath, ['-e', HANGING_CHILD], {
    graceMs: 30,
    timeoutMs: 150,
    artefactsComplete: () => false,
    stdout: out.stream,
    stderr: out.stream,
  });
  assert.notEqual(code, 0);
  assert.doesNotMatch(out.text, /proceeding under exit guard/);
});

test('a child that exits 2 on its own propagates exit code 2 unchanged', async () => {
  const out = captureStream();
  const code = await runGuarded(process.execPath, ['-e', EXIT_2_CHILD], {
    graceMs: 5000,
    timeoutMs: 5000,
    artefactsComplete: () => true,
    stdout: out.stream,
    stderr: out.stream,
  });
  assert.equal(code, 2);
});
