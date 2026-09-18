// node --test .claude/hooks/pre.ask.unattended.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { decide, scheduledTaskOf } from './pre.ask.unattended.mjs';

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'ccd-sessions-'));
  try {
    const d = join(root, 'ws', 'proj'); mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'local_sched.json'), JSON.stringify({ sessionId: 'local_sched', cliSessionId: 'cli-sched', scheduledTaskId: 'nightly-admin-feedback' }));
    writeFileSync(join(d, 'local_inter.json'), JSON.stringify({ sessionId: 'local_inter', cliSessionId: 'cli-inter' }));
    writeFileSync(join(d, 'broken.json'), '{not json');
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('scheduledTaskOf finds the task by cliSessionId, tolerates broken records', () => withRoot((root) => {
  assert.equal(scheduledTaskOf('cli-sched', root), 'nightly-admin-feedback');
  assert.equal(scheduledTaskOf('cli-inter', root), null);
  assert.equal(scheduledTaskOf('unknown', root), null);
  assert.equal(scheduledTaskOf(null, root), null);
}));

test('decide: blocks only AskUserQuestion in a scheduled session', () => withRoot((root) => {
  const env = { CCD_SESSIONS_ROOT: root };
  assert.equal(decide({ tool_name: 'AskUserQuestion', session_id: 'cli-sched' }, env).block, true);
  assert.match(decide({ tool_name: 'AskUserQuestion', session_id: 'cli-sched' }, env).reason, /needs_input/);
  assert.equal(decide({ tool_name: 'AskUserQuestion', session_id: 'cli-inter' }, env).block, false, 'interactive session may ask');
  assert.equal(decide({ tool_name: 'AskUserQuestion', session_id: 'nobody' }, env).block, false, 'unknown session → allow (safe direction)');
  assert.equal(decide({ tool_name: 'Bash', session_id: 'cli-sched' }, env).block, false, 'other tools untouched');
  assert.equal(decide({ tool_name: 'AskUserQuestion' }, { ...env, CLAUDE_CODE_SESSION_ID: 'cli-sched' }).block, true, 'env fallback');
}));

test('CLI: exit 2 + stderr for a scheduled session, exit 0 otherwise', () => withRoot((root) => {
  const script = new URL('./pre.ask.unattended.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const run = (input) => spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CCD_SESSIONS_ROOT: root } });
  const blocked = run({ tool_name: 'AskUserQuestion', session_id: 'cli-sched' });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /pre\.ask\.unattended/);
  const allowed = run({ tool_name: 'AskUserQuestion', session_id: 'cli-inter' });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stderr, '');
  const empty = spawnSync(process.execPath, [script], { input: '', encoding: 'utf8', env: { ...process.env, CCD_SESSIONS_ROOT: root, CLAUDE_CODE_SESSION_ID: '' } });
  assert.equal(empty.status, 0, 'no input, no session → allow');
  void execFileSync;
}));
