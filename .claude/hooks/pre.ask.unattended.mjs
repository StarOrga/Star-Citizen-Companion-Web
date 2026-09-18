#!/usr/bin/env node
/**
 * PreToolUse guard (matcher: AskUserQuestion) — a scheduled-task session has no
 * user to answer; a pending question would hang that session, the scheduler's
 * "already running" guard would skip that task's next firings, and the claimed
 * feedback item would sit until the gate reaps the lock (30 min). The routine
 * prompt forbids the call; this hook makes it impossible.
 *
 * Detection: the Desktop app writes one record per session under
 * %APPDATA%\Claude\claude-code-sessions\**\*.json with `cliSessionId` (the id
 * this hook receives as `session_id`) and, for scheduled runs, `scheduledTaskId`.
 * No record / no scheduledTaskId → interactive → allow (exit 0). Scheduled →
 * block (exit 2, the stderr text reaches the model) and tell it to park the
 * item as needs_input in the feedback panel instead.
 *
 * Env: CCD_SESSIONS_ROOT overrides the records root (tests).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function sessionsRoot(env = process.env) {
  if (env.CCD_SESSIONS_ROOT) return env.CCD_SESSIONS_ROOT;
  const appData = env.APPDATA || join(env.USERPROFILE || '', 'AppData', 'Roaming');
  return join(appData, 'Claude', 'claude-code-sessions');
}

function* jsonFiles(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* jsonFiles(p);
    else if (e.name.endsWith('.json')) yield p;
  }
}

/** The scheduledTaskId of the session with this CLI id, or null. */
export function scheduledTaskOf(cliSessionId, root = sessionsRoot()) {
  if (!cliSessionId) return null;
  for (const f of jsonFiles(root)) {
    let o;
    try { o = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; }
    if (o?.cliSessionId === cliSessionId) return typeof o.scheduledTaskId === 'string' && o.scheduledTaskId ? o.scheduledTaskId : null;
  }
  return null;
}

export function decide(input, env = process.env) {
  if (input?.tool_name && input.tool_name !== 'AskUserQuestion') return { block: false };
  const sid = input?.session_id || env.CLAUDE_CODE_SESSION_ID || null;
  const task = scheduledTaskOf(sid, sessionsRoot(env));
  if (!task) return { block: false };
  return {
    block: true,
    reason: `[pre.ask.unattended] AskUserQuestion is blocked: this is a scheduled-task session (${task}) — nobody can answer, ` +
      'and a pending question would hang this run and the task\'s next firings. Do not ask. For a genuine fork: park the item — ' +
      'insert a system reply with the question into admin_feedback_messages (optionally ending in one [[Option A|Option B]] line) ' +
      'and set status=\'needs_input\' with a processing_note; otherwise make the reasonable choice and note it in the report.',
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href;
if (isMain) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let input = {};
    try { input = raw.trim() ? JSON.parse(raw) : {}; } catch { input = {}; }
    const d = decide(input);
    if (d.block) { process.stderr.write(d.reason + '\n'); process.exitCode = 2; }
  });
}
