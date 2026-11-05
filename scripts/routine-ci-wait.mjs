#!/usr/bin/env node
/**
 * Waits for the web-ci run of a commit, so a feedback worker gets the verdict of
 * the full gate (typecheck, lint, Karma, build) in about 3 minutes instead of
 * building locally, which took 10 to 30 minutes with three workers on one PC.
 *
 *   node <repo>/scripts/routine-ci-wait.mjs [--sha <sha>] [--minutes 9]
 *
 * Run it inside the worktree, with a Bash timeout of 600000.
 *   exit 0  green
 *   exit 1  red: the failed log follows
 *   exit 2  still running: call it again
 *   exit 3  no run for this commit: no PR yet, or the PR has a merge conflict
 */
import { execFileSync } from 'node:child_process';
import { ciVerdict } from './lib/routine-watcher-core.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });

const POLL_MS = 20_000;
const NO_RUN_GIVE_UP_MS = 4 * 60_000;
const sha = arg('sha') ?? run('git', ['rev-parse', 'HEAD']).trim();
const started = Date.now();
const deadline = started + Number(arg('minutes', 9)) * 60_000;

async function main() {
  while (Date.now() < deadline) {
    let verdict;
    try {
      verdict = ciVerdict(JSON.parse(run('gh', ['run', 'list', '--commit', sha, '--workflow', 'web-ci.yml', '--limit', '1', '--json', 'databaseId,status,conclusion,url'])));
    } catch (e) {
      // GitHub away for a moment is no verdict: the deadline ends the wait.
      console.error(`gh failed, trying again: ${String(e.message).split('\n')[0]}`);
      verdict = { state: 'unknown' };
    }
    if (verdict.state === 'green') {
      console.log(`CI green: ${verdict.url}`);
      return 0;
    }
    if (verdict.state === 'red') {
      console.log(`CI red (${verdict.conclusion}): ${verdict.url}`);
      try {
        const lines = run('gh', ['run', 'view', String(verdict.id), '--log-failed']).split('\n');
        console.log(lines.slice(-150).map((l) => l.slice(0, 300)).join('\n'));
      } catch (e) { console.log(`the failed log could not be read: ${String(e.message).split('\n')[0]}`); }
      return 1;
    }
    if (verdict.state === 'none' && Date.now() - started > NO_RUN_GIVE_UP_MS) {
      console.log(`no web-ci run for ${sha}: open the PR, or resolve its merge conflict`);
      return 3;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  console.log(`CI still running for ${sha}: call this again`);
  return 2;
}

process.exitCode = await main();
