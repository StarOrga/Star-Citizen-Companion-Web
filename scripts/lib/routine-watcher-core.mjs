/**
 * The decisions of the feedback watcher (scripts/routine-watcher.mjs), free of
 * I/O so every failure path can be tested without a database, a browser or a
 * model. See docs/feedback-routine/watcher.md for the failure table.
 */

/** Task Scheduler fires a tick this often; the gate announces it as next_run_at. */
export const WATCH_INTERVAL_MIN = 3;
/** Failed attempts on one item (per human message) before it is parked with a reply. */
export const MAX_ATTEMPTS = 3;
/** Wait before attempt 2 and 3. */
export const BACKOFF_MIN = [15, 60];
/** A run is stopped after this much awake time — below the gate's 180-min lock. */
export const HARD_CAP_MIN = 170;
/** No transcript write (subagents included) for this long ⇒ the run hangs. A Bash call is capped at 10 min. */
export const IDLE_KILL_MIN = 45;
/** Time a fresh run gets before its transcript is judged at all. */
export const IDLE_GRACE_MIN = 10;
/** A watchdog gap longer than this was the PC sleeping, not the run working. */
export const SLEEP_GAP_MIN = 5;
/** A merged item whose deploy was not seen green gets the ⏳ reply after this long. */
export const REPLY_GIVE_UP_MIN = 60;
/** A branch younger than this may still belong to a live session — the sweep leaves it. */
export const BRANCH_MIN_AGE_MIN = 120;

/** The item's status means it is done: its branch has no further purpose. */
export const TERMINAL_STATUSES = new Set(['shipped', 'rejected', 'declined', 'issue_created']);

const MIN = 60_000;

/**
 * A new human message is a new request: its attempts start from zero. That is
 * also what makes the "Erneut versuchen" answer to a parked item work.
 */
export const itemKey = (item) => `${item.id}:${item.last_human_id ?? 'first'}`;

export function emptyState() {
  return { items: {}, cooldownUntil: null, cooldownReason: null, gateErrors: 0, notified: {}, lastSweepAt: null, lastTickAt: null };
}

/**
 * Splits the queue: what may run now, what still waits for its backoff, and
 * what used up its attempts and must get a deterministic reply instead.
 */
export function planQueue(items, state, now) {
  const eligible = [], waiting = [], park = [];
  for (const item of items) {
    const rec = state.items?.[item.id];
    const current = rec && rec.key === itemKey(item) ? rec : null;
    if (current && current.attempts >= MAX_ATTEMPTS) park.push({ item, reason: current.lastReason ?? 'unknown', attempts: current.attempts });
    else if (current && current.nextAttemptAt && current.nextAttemptAt > now) waiting.push(item);
    else eligible.push(item);
  }
  return { eligible, waiting, park };
}

/**
 * What the headless process's output says about how it ended. `tail` is the
 * end of the stream-json log, `exit` the process exit code (null when killed).
 *   ok          the model finished its turn
 *   usage-limit no model available until the limit resets (never the item's fault)
 *   auth        login expired — needs the operator (never the item's fault)
 *   transient   API overload / network — try again soon (never the item's fault)
 *   crash       anything else: it counts against the items
 */
export function classifyExit({ tail = '', exit = null, killedFor = null, now = Date.now() }) {
  if (killedFor) return { kind: 'killed', reason: killedFor };
  let result = null, rejectedUntil = null;
  for (const line of tail.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; }
    if (rec.type === 'result') result = rec;
    if (rec.type === 'rate_limit_event') {
      const info = rec.rate_limit_info ?? {};
      rejectedUntil = info.status === 'rejected' && info.resetsAt ? info.resetsAt * 1000 : null;
    }
  }
  const text = `${result?.result ?? ''} ${result ? '' : tail.slice(-2000)}`;
  const status = result?.api_error_status ?? null;
  if (result && result.is_error === false && result.subtype === 'success' && !rejectedUntil) return { kind: 'ok' };
  if (rejectedUntil || status === 429 || /usage limit|limit reached|hit your .{0,30}limit|out of (?:extra )?usage/i.test(text)) {
    return { kind: 'usage-limit', until: rejectedUntil && rejectedUntil > now ? rejectedUntil : now + 30 * MIN, reason: 'usage limit' };
  }
  if (status === 401 || status === 403 || /please run \/login|not logged in|invalid api key|authentication[_ ]error|oauth token/i.test(text)) {
    return { kind: 'auth', until: now + 60 * MIN, reason: 'login expired' };
  }
  if ((status && status >= 500) || /overloaded|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network error|fetch failed|connection error/i.test(text)) {
    return { kind: 'transient', until: now + 10 * MIN, reason: 'API or network unavailable' };
  }
  return { kind: 'crash', reason: result ? `headless run ended with an error (${result.subtype ?? 'unknown'})` : `headless process exited without a result (exit ${exit})` };
}

/**
 * Books a finished run. A run that resolved something only charges the items it
 * really claimed; a run that resolved nothing charges everything it was given —
 * that is what stops a run dying before its first claim from retrying forever.
 * Limits, login and network never charge an item; neither does a PC shutdown.
 */
export function applyRun({ state, snapshot, unresolvedIds, claimedIds, outcome, now }) {
  const next = { ...state, items: { ...state.items } };
  const unresolved = new Set(unresolvedIds);
  for (const item of snapshot) if (!unresolved.has(item.id)) delete next.items[item.id];

  if (['usage-limit', 'auth', 'transient'].includes(outcome.kind)) {
    next.cooldownUntil = outcome.until;
    next.cooldownReason = outcome.kind;
    return { state: next, charged: [] };
  }
  if (outcome.kind === 'interrupted') return { state: next, charged: [] };

  next.cooldownUntil = null;
  next.cooldownReason = null;
  const resolvedAny = snapshot.some((i) => !unresolved.has(i.id));
  const claimed = new Set(claimedIds);
  const charged = snapshot.filter((i) => unresolved.has(i.id) && (!resolvedAny || claimed.has(i.id)));
  const reason = outcome.reason ?? 'the run ended with this item unfinished';
  for (const item of charged) {
    const key = itemKey(item);
    const prev = next.items[item.id];
    const attempts = (prev && prev.key === key ? prev.attempts : 0) + 1;
    const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
    next.items[item.id] = { key, attempts, nextAttemptAt: now + wait * MIN, lastReason: reason };
  }
  return { state: next, charged: charged.map((i) => i.id) };
}

/**
 * Watchdog of a running headless process. Only awake time counts: a laptop lid
 * closed for a night must not read as a hung run when it opens again.
 */
export function watchdogStep(w, { now, newestWrite, startedAt }) {
  const gap = now - w.lastBeat;
  const slept = gap > SLEEP_GAP_MIN * MIN;
  const awakeMs = w.awakeMs + (slept ? 0 : gap);
  const quietSince = Math.max(newestWrite ?? startedAt, slept ? now : (w.quietFloor ?? startedAt));
  const quietFloor = slept ? now : (w.quietFloor ?? startedAt);
  const next = { awakeMs, lastBeat: now, quietFloor };
  if (awakeMs > HARD_CAP_MIN * MIN) return { ...next, kill: `hard cap of ${HARD_CAP_MIN} minutes reached` };
  if (awakeMs > IDLE_GRACE_MIN * MIN && now - quietSince > IDLE_KILL_MIN * MIN) {
    return { ...next, kill: `no activity for ${IDLE_KILL_MIN} minutes` };
  }
  return { ...next, kill: null };
}

/** feat/feedback-<8 hex>[-<suffix>] → the short item id, anything else → null. */
export function shortIdOfBranch(branch) {
  return /^feat\/feedback-([0-9a-f]{8})(?:-[0-9a-z]+)?$/.exec(branch)?.[1] ?? null;
}

/**
 * What the sweep does with a remote feedback branch.
 *   keep          an active item still needs it (its thread names it), it is too
 *                 young, or it cannot be matched to an item
 *   delete        the item is done and no PR is open
 *   close-delete  the item is done but a PR still hangs on it
 */
export function classifyBranch({ status, prState, ageMin }) {
  if (status == null) return 'keep';
  if (ageMin < BRANCH_MIN_AGE_MIN) return 'keep';
  if (!TERMINAL_STATUSES.has(status)) return 'keep';
  return prState === 'OPEN' ? 'close-delete' : 'delete';
}

/** The merged PR that finished this claim — an older merge on the base branch of a continuation is none. */
export function mergedSinceClaim(prs, processedAt) {
  const claim = Date.parse(processedAt ?? '') || 0;
  return prs.filter((p) => p.state === 'MERGED' && Date.parse(p.mergedAt) >= claim)
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))[0] ?? null;
}

const reasonDe = (reason) => ({
  'usage limit': 'Nutzungslimit erreicht',
  'login expired': 'Claude-Login abgelaufen',
}[reason] ?? reason);

/** The reply an admin gets when the automation gives up — always a thread message, never silence. */
export function parkMessage({ attempts, reason, branch, prUrl }) {
  const lines = [`⚠️ Der automatische Lauf ist an diesem Thema ${attempts}× gescheitert (${reasonDe(reason)}). Es ist nichts live gegangen.`];
  if (prUrl) lines.push(`Der bisherige Stand liegt in ${prUrl}.`);
  else if (branch) lines.push(`Der bisherige Stand liegt auf dem Branch \`${branch}\`.`);
  lines.push('Antworte hier, dann versuche ich es mit deiner Antwort erneut.');
  lines.push('[[Erneut versuchen|Thema schließen]]');
  return lines.join('\n');
}

export function holdClosedMessage(prUrl) {
  return `Der Pull Request ${prUrl} wurde ohne Merge geschlossen, die Änderung ist also nicht live. Antworte hier, wenn ich es neu angehen soll.\n[[Neu angehen|Thema schließen]]`;
}

export function holdMessage(prUrl, note) {
  return `⏸️ Fertig gebaut, aber noch nicht live: ${prUrl} wartet auf deine Prüfung${note ? ` (${note})` : ''}. Antworte hier, wie es weitergehen soll.`;
}

/** Fallback for a shipped item without a PR to verify against. */
export function plainShippedMessage(changed) {
  return `✅ Erledigt${changed ? `: ${changed}` : ''}. Passt etwas nicht? Antworte hier im Thread, dann nehme ich das Thema wieder auf.`;
}

/** Keeps one notification per kind inside the window. */
export function shouldNotify(state, kind, now, windowMs = 6 * 3_600_000) {
  const last = state.notified?.[kind];
  return last == null || now - last >= windowMs;
}
