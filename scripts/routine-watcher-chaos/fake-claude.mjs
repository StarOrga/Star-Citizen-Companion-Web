// Stand-in for `claude -p` in the chaos test. Mode comes from FAKE_MODE; item id from FAKE_ITEM.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const mode = process.env.FAKE_MODE, id = process.env.FAKE_ITEM, short = id?.slice(0, 8);
const sql = (query) => execFileSync(process.execPath, ['scripts/routine-gate.mjs', 'sql', '--query', query], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const out = (o) => console.log(JSON.stringify(o));
process.stdin.resume();
await new Promise((r) => process.stdin.on('end', r));
const claim = () => sql(`update public.admin_feedback set status='in_progress', processed_at=now() where id='${id}' and status in ('open','needs_input')`);
if (mode === 'usage') {
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600 } });
  out({ type: 'result', is_error: true, subtype: 'error_during_execution', result: 'limit' });
  process.exitCode = 1;
} else if (mode === 'auth') {
  console.log('Please run /login');
  process.exitCode = 1;
} else if (mode === 'crash') {
  process.exitCode = 3;
} else if (mode === 'ok-noop') {
  out({ type: 'result', is_error: false, subtype: 'success', result: 'did nothing' });
} else if (mode === 'claim-die') {
  claim();
  execFileSync('git', ['fetch', 'origin', 'main', '--quiet']);
  execFileSync('git', ['worktree', 'add', `.claude/worktrees/scfb-${short}`, '-b', `feat/feedback-${short}`, 'origin/main', '--quiet']);
  fs.writeFileSync(`.claude/worktrees/scfb-${short}/watcher-chaos-test.txt`, 'uncommitted work of a dying run\n');
  process.exitCode = 9;
} else if (mode === 'hang') {
  claim();
  fs.writeFileSync(process.env.FAKE_PIDFILE, String(process.pid));
  await new Promise((r) => setTimeout(r, 600_000));
} else if (mode === 'ship') {
  claim();
  sql(`update public.admin_feedback set status='shipped', shipped_at=now(), ship_ref=null, processed_at=now(), review_reply_pending=true where id='${id}'`);
  out({ type: 'result', is_error: false, subtype: 'success', result: 'shipped' });
}
