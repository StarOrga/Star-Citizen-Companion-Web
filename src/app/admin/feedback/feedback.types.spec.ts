import {
  FeedbackMessage,
  FeedbackRow,
  FeedbackStatus,
  buildWorkflowQueue,
  DECLINE_REASONS,
  declineReasonLabelKey,
  declineReasonTextKey,
  matchDeclineReason,
  bucketLabelStatus,
  awaitsReview,
  computePace,
  computeStats,
  feedbackBucket,
  awaitsTriage,
  filterWorkflowScope,
  isArchived,
  isAwaitingAdmin,
  isContinuedAfterShip,
  isOwnTopic,
  isUserSubmitted,
  ISSUE_REQUEST_MARKER,
  isIssueRequest,
  lifecycleSnapshot,
  pendingIssueRequest,
  neededInput,
  normalizeSearchText,
  rankFeedbackSearch,
  refKind,
  filterWorkflowKind,
  foldThread,
  workflowKindCounts,
  searchFeedback,
  searchTokens,
  weeklyPulse,
  weeklySeries,
  startOfMonth,
  startOfWeek,
  topicNumber,
  displayTitle,
  topicTitle,
  workflowFocusIndex,
  workflowScopeCounts,
  adminAsk,
  deliveredByDay,
  doneTime,
  isDelivered,
  flightPosition,
  isLongMessage,
  isNewSince,
  parseAnswerOptions,
  StationGlyph,
  stationGlyphLabelKey,
  stationGlyphs,
  stationIndex,
  stationLabelKey,
  turnLabelKey,
  turnOf,
  waitingSince,
} from './feedback.types';

function row(id: string, status: FeedbackStatus, created: string, extra: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id,
    author_id: 'admin',
    body: `body of ${id}`,
    status,
    ship_ref: null,
    processing_note: null,
    created_at: created,
    updated_at: created,
    shipped_at: null,
    processed_at: null,
    author: null,
    ...extra,
  };
}

function msg(id: string, feedbackId: string, isSystem: boolean, created: string): FeedbackMessage {
  return {
    id,
    feedback_id: feedbackId,
    author_id: isSystem ? null : 'admin',
    is_system: isSystem,
    body: `reply ${id}`,
    created_at: created,
    author: null,
  };
}

describe('topicTitle', () => {
  it('strips markdown and keeps the first sentence', () => {
    expect(topicTitle('**Fix** the `panel`. And more text after.')).toBe('Fix the panel.');
  });

  it('falls back to a dash for image-only bodies', () => {
    expect(topicTitle('![shot](https://example.test/a.png)')).toBe('—');
  });

  it('caps overlong titles with an ellipsis', () => {
    const title = topicTitle('x'.repeat(200), 20);
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.endsWith('…')).toBeTrue();
  });
});

/**
 * The card head asks `displayTitle`, never `topicTitle`, so a topic the routine
 * summarised reads as its summary and one it has not yet touched keeps reading
 * exactly as before (feedback d08f1983).
 */
describe('displayTitle', () => {
  it('prefers the summary the routine wrote over the body', () => {
    const r = row('t1', 'open', '2026-09-05T10:00:00Z', {
      body: 'Lass uns doch mal schauen, ob wir da nicht was machen. Titel kommt spaeter.',
      summary: 'Karten-Titel: Zusammenfassung statt Body-Anfang',
    });
    expect(displayTitle(r, 96)).toBe('Karten-Titel: Zusammenfassung statt Body-Anfang');
  });

  it('falls back to the body title when nothing summarised the topic', () => {
    const r = row('t2', 'open', '2026-09-05T10:00:00Z', { body: '**Fix** the `panel`. And more.' });
    expect(displayTitle(r, 96)).toBe('Fix the panel.');
    expect(displayTitle({ ...r, summary: null }, 96)).toBe('Fix the panel.');
    expect(displayTitle({ ...r, summary: '   ' }, 96)).toBe('Fix the panel.');
  });

  it('strips markup out of a summary and caps it like any other title', () => {
    const r = row('t3', 'open', '2026-09-05T10:00:00Z', {
      body: 'irrelevant',
      summary: `**${'y'.repeat(200)}**`,
    });
    const title = displayTitle(r, 20);
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title.endsWith('…')).toBeTrue();
    expect(title.startsWith('*')).toBeFalse();
  });
});

describe('topicNumber (feedback 21587480)', () => {
  const at = '2026-07-01T10:00:00Z';

  it('reads the row\'s stable sequential number', () => {
    expect(topicNumber(row('a', 'open', at, { seq: 42 }))).toBe(42);
    expect(topicNumber(row('a', 'open', at, { seq: 1 }))).toBe(1);
  });

  it('is null for a row that carries no number', () => {
    expect(topicNumber(row('a', 'open', at))).toBeNull();
    expect(topicNumber(row('a', 'open', at, { seq: null }))).toBeNull();
  });

  it('rejects 0 and negatives — the numbering starts at 1', () => {
    expect(topicNumber(row('a', 'open', at, { seq: 0 }))).toBeNull();
    expect(topicNumber(row('a', 'open', at, { seq: -3 }))).toBeNull();
  });

  it('is independent of the row\'s position in any list', () => {
    const first = row('first', 'open', '2026-07-01T10:00:00Z', { seq: 9 });
    const second = row('second', 'open', '2026-07-02T10:00:00Z', { seq: 4 });
    // Sorting/filtering the list must never renumber a topic — that is the whole
    // reason the number comes from the DB instead of from an index.
    const sorted = [first, second].sort((a, b) => timeOfCreated(b) - timeOfCreated(a));
    expect(sorted.map(topicNumber)).toEqual([4, 9]);
  });

  function timeOfCreated(r: FeedbackRow): number {
    return Date.parse(r.created_at);
  }
});

describe('isAwaitingAdmin', () => {
  const r = row('a', 'needs_input', '2026-07-01T10:00:00Z');

  it('is true when the routine asked last', () => {
    expect(isAwaitingAdmin(r, [msg('m1', 'a', true, '2026-07-01T11:00:00Z')])).toBeTrue();
  });

  it('is true when nobody replied yet', () => {
    expect(isAwaitingAdmin(r, [])).toBeTrue();
    expect(isAwaitingAdmin(r, undefined)).toBeTrue();
  });

  it('is false once a human answered last', () => {
    const replies = [
      msg('m1', 'a', true, '2026-07-01T11:00:00Z'),
      msg('m2', 'a', false, '2026-07-01T12:00:00Z'),
    ];
    expect(isAwaitingAdmin(r, replies)).toBeFalse();
  });

  it('only ever applies to needs_input topics', () => {
    expect(isAwaitingAdmin(row('b', 'open', '2026-07-01T10:00:00Z'), [])).toBeFalse();
  });
});

describe('feedbackBucket', () => {
  const at = '2026-07-01T10:00:00Z';
  const question = row('q', 'needs_input', at);

  it('buckets an answered Rückfrage as ToDo — the routine has to pick it up', () => {
    const replies = [
      msg('m1', 'q', true, '2026-07-01T11:00:00Z'),
      msg('m2', 'q', false, '2026-07-01T12:00:00Z'),
    ];
    expect(feedbackBucket(question, replies)).toBe('todo');
  });

  it('keeps a Rückfrage the routine asked last as awaiting the admin', () => {
    expect(feedbackBucket(question, [msg('m1', 'q', true, '2026-07-01T11:00:00Z')])).toBe('awaiting_admin');
  });

  it('treats an unanswered Rückfrage without any reply as awaiting the admin', () => {
    expect(feedbackBucket(question, [])).toBe('awaiting_admin');
    expect(feedbackBucket(question)).toBe('awaiting_admin');
  });

  it('buckets a plain open topic as ToDo, replies or not', () => {
    const open = row('o', 'open', at);
    expect(feedbackBucket(open, [])).toBe('todo');
    expect(feedbackBucket(open, [msg('m1', 'o', false, '2026-07-01T11:00:00Z')])).toBe('todo');
  });

  it('leaves in_progress and every terminal status on their own bucket', () => {
    expect(feedbackBucket(row('p', 'in_progress', at), [])).toBe('in_progress');
    for (const s of ['shipped', 'issue_created', 'rejected', 'declined'] as const) {
      expect(feedbackBucket(row('t', s, at), [msg('m1', 't', false, at)])).toBe(s);
    }
  });

  // feedback 5920cf8c: the second Rückfrage direction. A topic where the ADMIN
  // asked the topic's author is waiting on that person — never on the admin, and
  // never the routine's ToDo, whatever the admin<->routine thread looks like.
  it('buckets a question to the author as awaiting_author, not awaiting_admin', () => {
    const asked = row('u', 'needs_input_author', at, { source: 'user', triaged: true });
    expect(feedbackBucket(asked, [])).toBe('awaiting_author');
    expect(feedbackBucket(asked, [msg('m1', 'u', true, '2026-07-01T11:00:00Z')])).toBe(
      'awaiting_author',
    );
    expect(feedbackBucket(asked, [msg('m2', 'u', false, '2026-07-01T12:00:00Z')])).toBe(
      'awaiting_author',
    );
  });

  it('reopens a shipped topic to ToDo when the admin replies after the ship', () => {
    const shipped = row('s', 'shipped', at, { shipped_at: '2026-07-01T12:00:00Z' });
    const humanAfter = [msg('m1', 's', false, '2026-07-01T13:00:00Z')];
    expect(feedbackBucket(shipped, humanAfter)).toBe('todo');
  });

  it('keeps a shipped topic archived when the last post-ship reply is the routine (review reply)', () => {
    const shipped = row('s', 'shipped', at, { shipped_at: '2026-07-01T12:00:00Z' });
    const systemAfter = [msg('m1', 's', true, '2026-07-01T13:00:00Z')];
    expect(feedbackBucket(shipped, systemAfter)).toBe('shipped');
  });

  it('does not reopen a shipped topic on a reply that predates the (re-)ship', () => {
    const shipped = row('s', 'shipped', at, { shipped_at: '2026-07-01T14:00:00Z' });
    const humanBefore = [msg('m1', 's', false, '2026-07-01T13:00:00Z')];
    expect(feedbackBucket(shipped, humanBefore)).toBe('shipped');
  });
});

describe('bucketLabelStatus', () => {
  it('labels the ToDo bucket with the (renamed) open vocabulary', () => {
    expect(bucketLabelStatus('todo')).toBe('open');
  });

  it('labels the awaiting-admin bucket as a Rückfrage', () => {
    expect(bucketLabelStatus('awaiting_admin')).toBe('needs_input');
  });

  it('keeps the two Rückfrage directions on distinct labels', () => {
    expect(bucketLabelStatus('awaiting_author')).toBe('needs_input_author');
    expect(bucketLabelStatus('awaiting_author')).not.toBe(bucketLabelStatus('awaiting_admin'));
  });

  it('passes every other bucket through unchanged', () => {
    for (const b of ['in_progress', 'shipped', 'issue_created', 'rejected', 'declined'] as const) {
      expect(bucketLabelStatus(b)).toBe(b);
    }
  });
});

describe('isArchived', () => {
  it('is true for every terminal status', () => {
    for (const s of ['shipped', 'issue_created', 'rejected', 'declined'] as const) {
      expect(isArchived(row('t', s, '2026-07-01T10:00:00Z'))).toBeTrue();
    }
  });

  it('is false for the statuses the routine still works', () => {
    for (const s of ['open', 'in_progress', 'needs_input', 'needs_input_author'] as const) {
      expect(isArchived(row('a', s, '2026-07-01T10:00:00Z'))).toBeFalse();
    }
  });

  it('un-archives a shipped topic the admin reopened after the ship (needs the thread)', () => {
    const shipped = row('s', 'shipped', '2026-07-01T10:00:00Z', { shipped_at: '2026-07-01T12:00:00Z' });
    const humanAfter = [msg('m1', 's', false, '2026-07-01T13:00:00Z')];
    // Without the thread it still reads as archived (back-compat for callers that don't track replies).
    expect(isArchived(shipped)).toBeTrue();
    // With the thread, the continuation pulls it back onto the active board.
    expect(isArchived(shipped, humanAfter)).toBeFalse();
  });

  it('keeps issue_created / rejected archived even with a fresh human reply', () => {
    for (const s of ['issue_created', 'rejected'] as const) {
      const term = row('t', s, '2026-07-01T10:00:00Z', { shipped_at: '2026-07-01T12:00:00Z' });
      expect(isArchived(term, [msg('m1', 't', false, '2026-07-01T13:00:00Z')])).toBeTrue();
    }
  });
});

describe('isContinuedAfterShip', () => {
  const shippedAt = '2026-07-01T12:00:00Z';
  const shipped = () => row('s', 'shipped', '2026-07-01T10:00:00Z', { shipped_at: shippedAt });

  it('is true when the newest reply is the admin and it lands after shipped_at', () => {
    expect(isContinuedAfterShip(shipped(), [msg('m1', 's', false, '2026-07-01T13:00:00Z')])).toBeTrue();
  });

  it('is false when the newest post-ship reply is the routine (its own review reply)', () => {
    expect(isContinuedAfterShip(shipped(), [msg('m1', 's', true, '2026-07-01T13:00:00Z')])).toBeFalse();
  });

  it('is false when the human reply predates the ship (an older thread message)', () => {
    expect(isContinuedAfterShip(shipped(), [msg('m1', 's', false, '2026-07-01T11:00:00Z')])).toBeFalse();
  });

  it('only looks at the newest reply — a later routine reply closes the loop again', () => {
    const replies = [
      msg('m1', 's', false, '2026-07-01T13:00:00Z'), // admin reopened
      msg('m2', 's', true, '2026-07-01T14:00:00Z'), // routine re-shipped + review reply
    ];
    expect(isContinuedAfterShip(shipped(), replies)).toBeFalse();
  });

  it('is false for a non-shipped status and for an empty/absent thread', () => {
    expect(isContinuedAfterShip(row('o', 'open', '2026-07-01T10:00:00Z'), [msg('m1', 'o', false, '2026-07-01T13:00:00Z')])).toBeFalse();
    expect(isContinuedAfterShip(shipped(), [])).toBeFalse();
    expect(isContinuedAfterShip(shipped())).toBeFalse();
  });

  it('falls back to processed_at then created_at when shipped_at is absent', () => {
    const noShipTs = row('s', 'shipped', '2026-07-01T10:00:00Z', { processed_at: '2026-07-01T12:00:00Z' });
    expect(isContinuedAfterShip(noShipTs, [msg('m1', 's', false, '2026-07-01T13:00:00Z')])).toBeTrue();
    expect(isContinuedAfterShip(noShipTs, [msg('m1', 's', false, '2026-07-01T11:00:00Z')])).toBeFalse();
  });
});

describe('isUserSubmitted / awaitsTriage', () => {
  const at = '2026-07-01T10:00:00Z';

  it('treats every legacy row (no source column yet) as admin-authored', () => {
    const legacy = row('l', 'open', at);
    expect(isUserSubmitted(legacy)).toBeFalse();
    expect(awaitsTriage(legacy)).toBeFalse();
  });

  it('gates a fresh user topic until an admin releases it to the routine', () => {
    const fresh = row('u', 'open', at, { source: 'user', triaged: false });
    expect(isUserSubmitted(fresh)).toBeTrue();
    expect(awaitsTriage(fresh)).toBeTrue();
    expect(awaitsTriage({ ...fresh, triaged: true })).toBeFalse();
  });

  it('never gates an admin topic, whatever triaged says', () => {
    expect(awaitsTriage(row('a', 'open', at, { source: 'admin', triaged: false }))).toBeFalse();
  });
});

describe('refKind', () => {
  const at = '2026-07-01T10:00:00Z';

  it('labels an issue_created row as an issue, whatever the url looks like', () => {
    expect(refKind(row('i', 'issue_created', at, { ship_ref: 'https://example.test/x' }))).toBe('issue');
  });

  it('labels a shipped PR as a ship link', () => {
    expect(refKind(row('s', 'shipped', at, { ship_ref: 'https://github.com/o/r/pull/42' }))).toBe('ship');
  });

  it('sniffs an issue url attached to a non-issue_created row', () => {
    expect(refKind(row('s', 'in_progress', at, { ship_ref: 'https://github.com/o/r/issues/7' }))).toBe('issue');
  });

  it('falls back to a ship link without a ref', () => {
    expect(refKind(row('s', 'open', at))).toBe('ship');
  });
});

describe('buildWorkflowQueue', () => {
  const q1 = row('q1', 'needs_input', '2026-07-03T10:00:00Z');
  const q2 = row('q2', 'needs_input', '2026-07-01T10:00:00Z');
  const answered = row('q3', 'needs_input', '2026-07-02T10:00:00Z');
  const o1 = row('o1', 'open', '2026-07-05T10:00:00Z');
  const o2 = row('o2', 'open', '2026-07-04T10:00:00Z');
  const busy = row('p1', 'in_progress', '2026-07-01T09:00:00Z');
  const done = row('s1', 'shipped', '2026-06-01T09:00:00Z');

  const threads = new Map<string, FeedbackMessage[]>([
    ['q1', [msg('m1', 'q1', true, '2026-07-03T11:00:00Z')]],
    ['q3', [msg('m2', 'q3', true, '2026-07-02T11:00:00Z'), msg('m3', 'q3', false, '2026-07-02T12:00:00Z')]],
  ]);

  it('queues the pending questions, oldest first', () => {
    const queue = buildWorkflowQueue([o1, q1, done, o2, q2, busy, answered], threads);
    expect(queue.map((i) => i.row.id)).toEqual(['q2', 'q1']);
  });

  it('keeps plain ToDo topics out — they wait on the routine (feedback b0cc6efc)', () => {
    expect(buildWorkflowQueue([o1, o2], threads).map((i) => i.row.id)).toEqual([]);
  });

  it('lets a ToDo topic in once the routine asks something back', () => {
    const asked = { ...o1, status: 'needs_input' as FeedbackStatus };
    expect(buildWorkflowQueue([asked], threads).map((i) => i.row.id)).toEqual(['o1']);
  });

  it('excludes shipped, in_progress and already-answered questions', () => {
    const ids = buildWorkflowQueue([done, busy, answered], threads).map((i) => i.row.id);
    expect(ids).toEqual([]);
  });

  it('excludes archived topics, including issue hand-offs', () => {
    const filed = row('i1', 'issue_created', '2026-07-01T09:00:00Z', {
      ship_ref: 'https://github.com/o/r/issues/9',
    });
    const dropped = row('x1', 'rejected', '2026-07-01T09:00:00Z');
    expect(buildWorkflowQueue([filed, dropped], threads).map((i) => i.row.id)).toEqual([]);
  });

  it('excludes a topic whose author was asked — the ball is with them', () => {
    // Since feedback b0cc6efc the queue holds open Rückfragen only, so the
    // control here is q1 (awaiting_admin), not an untouched open topic.
    const asked = row('u1', 'needs_input_author', '2026-07-01T08:00:00Z', {
      source: 'user',
      triaged: true,
    });
    expect(buildWorkflowQueue([asked, q1], threads).map((i) => i.row.id)).toEqual(['q1']);
  });

  it('hides items ticked off while their updated_at is unchanged', () => {
    const handled = new Map([['q2', q2.updated_at]]);
    expect(buildWorkflowQueue([q1, q2], threads, handled).map((i) => i.row.id)).toEqual(['q1']);
  });

  it('resurfaces a ticked-off item once the routine touches it again', () => {
    const handled = new Map([['q2', '2026-07-01T10:00:00Z']]);
    const touched = { ...q2, updated_at: '2026-07-09T08:00:00Z' };
    expect(buildWorkflowQueue([touched], threads, handled).map((i) => i.row.id)).toEqual(['q2']);
  });

  it('attaches each topic its own replies', () => {
    const queue = buildWorkflowQueue([q1], threads);
    expect(queue[0].replies.map((m) => m.id)).toEqual(['m1']);
  });

  it('marks every question item as such', () => {
    expect(buildWorkflowQueue([q1, q2], threads).map((i) => i.kind)).toEqual([
      'question',
      'question',
    ]);
  });

  // ---- Abnahme folded into the queue (feedback d4990269) ----

  const review1 = row('r1', 'shipped', '2026-06-20T10:00:00Z', {
    reviewed_at: null,
    shipped_at: '2026-07-08T10:00:00Z',
  });
  const review2 = row('r2', 'issue_created', '2026-06-21T10:00:00Z', {
    reviewed_at: null,
    processed_at: '2026-07-06T10:00:00Z',
  });

  it('queues topics waiting for the sign-off after the questions', () => {
    const queue = buildWorkflowQueue([review1, q1, review2, q2], threads);
    expect(queue.map((i) => i.row.id)).toEqual(['q2', 'q1', 'r2', 'r1']);
    expect(queue.map((i) => i.kind)).toEqual(['question', 'question', 'review', 'review']);
  });

  it('ages an Abnahme by when its outcome landed, not by the topic\'s birthday', () => {
    // r1 is the OLDER topic but the NEWER outcome — it must come second.
    expect(buildWorkflowQueue([review1, review2], threads).map((i) => i.row.id)).toEqual([
      'r2',
      'r1',
    ]);
  });

  it('keeps a signed-off topic out — it is archived, not waiting', () => {
    const signed = { ...review1, reviewed_at: '2026-07-09T10:00:00Z' };
    expect(buildWorkflowQueue([signed], threads).map((i) => i.row.id)).toEqual([]);
  });

  it('lets the tick-off hide an Abnahme like any other item', () => {
    const handled = new Map([['r1', review1.updated_at]]);
    expect(buildWorkflowQueue([review1, review2], threads, handled).map((i) => i.row.id)).toEqual([
      'r2',
    ]);
  });

  // ---- Triage steps folded into the queue (feedback 89925995) ----

  const user1 = row('u1', 'open', '2026-07-07T10:00:00Z', { source: 'user', triaged: false });
  const user2 = row('u2', 'open', '2026-07-06T10:00:00Z', { source: 'user', triaged: false });

  it('queues untriaged user topics FIRST — nothing at all happens to them otherwise', () => {
    const queue = buildWorkflowQueue([review1, q1, user1, q2, user2], threads);
    expect(queue.map((i) => i.row.id)).toEqual(['u2', 'u1', 'q2', 'q1', 'r1']);
    expect(queue.map((i) => i.kind)).toEqual(['triage', 'triage', 'question', 'question', 'review']);
  });

  it('drops a user topic out of the queue once it is released', () => {
    expect(buildWorkflowQueue([{ ...user1, triaged: true }], threads).map((i) => i.row.id)).toEqual([]);
  });

  it('keeps an untriaged topic out while its author owes an answer', () => {
    const asked = { ...user1, status: 'needs_input_author' as FeedbackStatus };
    expect(buildWorkflowQueue([asked], threads).map((i) => i.row.id)).toEqual([]);
  });

  it('keeps a declined user topic out — it is archived, not waiting', () => {
    const declined = { ...user1, status: 'declined' as FeedbackStatus };
    expect(buildWorkflowQueue([declined], threads).map((i) => i.row.id)).toEqual([]);
  });

  it('lets the tick-off hide a triage step like any other item', () => {
    const handled = new Map([['u1', user1.updated_at]]);
    expect(buildWorkflowQueue([user1, user2], threads, handled).map((i) => i.row.id)).toEqual(['u2']);
  });
});

describe('workflow scope (feedback abfa97c6)', () => {
  // Unanswered Rückfragen — the only thing the processing queue holds.
  const mine1 = row('m1', 'needs_input', '2026-07-05T10:00:00Z', { author_id: 'me' });
  const mine2 = row('m2', 'needs_input', '2026-07-06T10:00:00Z', { author_id: 'me' });
  const theirs = row('t1', 'needs_input', '2026-07-07T10:00:00Z', { author_id: 'you' });
  const orphan = row('n1', 'needs_input', '2026-07-08T10:00:00Z', { author_id: null });
  const queue = buildWorkflowQueue([mine1, mine2, theirs, orphan], new Map());

  it('counts each scope, with authorless topics landing under "others"', () => {
    expect(workflowScopeCounts(queue, 'me')).toEqual({ mine: 2, others: 2, all: 4 });
  });

  it('narrows the queue to the admin\'s own topics', () => {
    expect(filterWorkflowScope(queue, 'mine', 'me').map((i) => i.row.id)).toEqual(['m1', 'm2']);
  });

  it('narrows to everyone else, keeping authorless topics visible', () => {
    expect(filterWorkflowScope(queue, 'others', 'me').map((i) => i.row.id)).toEqual(['t1', 'n1']);
  });

  it('keeps the whole queue for "all"', () => {
    expect(filterWorkflowScope(queue, 'all', 'me').length).toBe(4);
  });

  it('falls back to the full queue while the user id is unknown', () => {
    // Auth not settled yet — a blank mode would look like an empty backlog.
    expect(filterWorkflowScope(queue, 'mine', null).length).toBe(4);
    expect(workflowScopeCounts(queue, null)).toEqual({ mine: 0, others: 4, all: 4 });
  });

  it('preserves the queue order inside a scope', () => {
    const q = buildWorkflowQueue([mine2, theirs, mine1], new Map());
    expect(filterWorkflowScope(q, 'mine', 'me').map((i) => i.row.id)).toEqual(['m1', 'm2']);
  });

  it('keeps triage steps in every scope — a user topic is nobody\'s own', () => {
    // The scope splits ADMIN topics by who raised them; a user-submitted one was
    // raised by neither, so `mine` must not hide the thing that blocks the
    // routine outright (feedback 89925995).
    const userTopic = row('u1', 'open', '2026-07-09T10:00:00Z', {
      author_id: 'someone-else',
      source: 'user',
      triaged: false,
    });
    const withTriage = buildWorkflowQueue([mine1, theirs, userTopic], new Map());
    expect(filterWorkflowScope(withTriage, 'mine', 'me').map((i) => i.row.id)).toEqual(['u1', 'm1']);
    expect(filterWorkflowScope(withTriage, 'others', 'me').map((i) => i.row.id)).toEqual(['u1', 't1']);
    // ...and the chip counts say the same thing the chips hand over.
    expect(workflowScopeCounts(withTriage, 'me')).toEqual({ mine: 2, others: 2, all: 3 });
  });

  it('recognises ownership only for a matching author id', () => {
    expect(isOwnTopic(mine1, 'me')).toBeTrue();
    expect(isOwnTopic(theirs, 'me')).toBeFalse();
    expect(isOwnTopic(orphan, 'me')).toBeFalse();
    expect(isOwnTopic(mine1, null)).toBeFalse();
  });
});

describe('workflow kind lens — replaces the Abnahme tab (feedback d4990269)', () => {
  // The tab that used to hold these rows is gone; the run narrows to them
  // instead. Same items, same order — only fewer of them on screen.
  const q1 = { row: row('q1', 'needs_input', '2026-07-05T10:00:00Z'), replies: [], kind: 'question' as const };
  const r1 = { row: row('r1', 'shipped', '2026-07-06T10:00:00Z'), replies: [], kind: 'review' as const };
  const q2 = { row: row('q2', 'needs_input', '2026-07-07T10:00:00Z'), replies: [], kind: 'question' as const };
  const items = [q1, r1, q2];

  it('counts every kind, with "all" as the untouched total', () => {
    expect(workflowKindCounts(items)).toEqual({ all: 3, triage: 0, question: 2, review: 1 });
  });

  it('hands back the whole run for "all"', () => {
    expect(filterWorkflowKind(items, 'all').map((i) => i.row.id)).toEqual(['q1', 'r1', 'q2']);
  });

  it('narrows to the Abnahmen', () => {
    expect(filterWorkflowKind(items, 'review').map((i) => i.row.id)).toEqual(['r1']);
  });

  it('narrows to the Rückfragen, keeping the queue order', () => {
    expect(filterWorkflowKind(items, 'question').map((i) => i.row.id)).toEqual(['q1', 'q2']);
  });

  it('counts an empty run as empty rather than throwing', () => {
    expect(workflowKindCounts([])).toEqual({ all: 0, triage: 0, question: 0, review: 0 });
    expect(filterWorkflowKind([], 'review')).toEqual([]);
  });
});

describe('workflowFocusIndex', () => {
  it('returns null for an empty thread', () => {
    expect(workflowFocusIndex([])).toBeNull();
  });

  it('focuses the start of a trailing routine block, not its tail', () => {
    const replies = [
      msg('m1', 'q1', false, '2026-07-01T10:00:00Z'),
      msg('m2', 'q1', true, '2026-07-01T11:00:00Z'),
      msg('m3', 'q1', true, '2026-07-01T12:00:00Z'),
    ];
    expect(workflowFocusIndex(replies)).toBe(1);
  });

  it('focuses the single open Rückfrage', () => {
    expect(workflowFocusIndex([msg('m1', 'q1', true, '2026-07-01T10:00:00Z')])).toBe(0);
  });

  it('falls back to the thread end when the admin had the last word', () => {
    const replies = [
      msg('m1', 'q1', true, '2026-07-01T10:00:00Z'),
      msg('m2', 'q1', false, '2026-07-01T11:00:00Z'),
    ];
    expect(workflowFocusIndex(replies)).toBe(1);
  });

  it('ignores routine messages that were already answered', () => {
    const replies = [
      msg('m1', 'q1', true, '2026-07-01T10:00:00Z'),
      msg('m2', 'q1', false, '2026-07-01T11:00:00Z'),
      msg('m3', 'q1', false, '2026-07-01T12:00:00Z'),
    ];
    expect(workflowFocusIndex(replies)).toBe(2);
  });
});

describe('foldThread', () => {
  const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

  it('hands a short thread back whole, so nothing grows a needless control', () => {
    const replies = [
      msg('m1', 'q1', true, '2026-07-01T10:00:00Z'),
      msg('m2', 'q1', false, '2026-07-01T11:00:00Z'),
    ];
    const folded = foldThread(replies);
    expect(folded.lead).toBeNull();
    expect(folded.hidden).toEqual([]);
    expect(ids(folded.tail)).toEqual(['m1', 'm2']);
  });

  it('is a no-op on an empty thread', () => {
    expect(foldThread([])).toEqual({ lead: null, hidden: [], tail: [] });
  });

  it('keeps the first and the newest message, folding everything between', () => {
    const replies = ['m1', 'm2', 'm3', 'm4', 'm5'].map((id, i) => msg(id, 'q1', false, `2026-07-0${i + 1}T10:00:00Z`));
    const folded = foldThread(replies);
    expect(folded.lead?.id).toBe('m1');
    expect(ids(folded.hidden)).toEqual(['m2', 'm3', 'm4']);
    expect(ids(folded.tail)).toEqual(['m5']);
  });

  it('never loses a message: lead + hidden + tail is the whole thread', () => {
    const replies = ['m1', 'm2', 'm3', 'm4'].map((id, i) => msg(id, 'q1', false, `2026-07-0${i + 1}T10:00:00Z`));
    const folded = foldThread(replies);
    expect(ids([...(folded.lead ? [folded.lead] : []), ...folded.hidden, ...folded.tail])).toEqual(
      ids(replies),
    );
  });

  it('can keep a longer tail on screen', () => {
    const replies = ['m1', 'm2', 'm3', 'm4'].map((id, i) => msg(id, 'q1', false, `2026-07-0${i + 1}T10:00:00Z`));
    const folded = foldThread(replies, 2);
    expect(folded.lead?.id).toBe('m1');
    expect(ids(folded.hidden)).toEqual(['m2']);
    expect(ids(folded.tail)).toEqual(['m3', 'm4']);
  });
});

describe('computeStats', () => {
  const from = Date.parse('2026-07-01T00:00:00Z');
  const rows: FeedbackRow[] = [
    row('s1', 'shipped', '2026-06-10T10:00:00Z', { shipped_at: '2026-07-12T10:00:00Z' }),
    row('s2', 'shipped', '2026-05-10T10:00:00Z', { shipped_at: '2026-06-11T10:00:00Z' }),
    row('o1', 'open', '2026-07-02T10:00:00Z'),
    row('o2', 'open', '2026-06-02T10:00:00Z'),
    row('r1', 'rejected', '2026-07-02T10:00:00Z'),
    row('q1', 'needs_input', '2026-07-04T10:00:00Z'),
  ];
  const threads = new Map<string, FeedbackMessage[]>([
    // Two routine questions, both answered — one this month, one last month.
    ['q1', [
      msg('a1', 'q1', true, '2026-06-20T10:00:00Z'),
      msg('a2', 'q1', false, '2026-06-20T12:00:00Z'),
      msg('a3', 'q1', true, '2026-07-05T10:00:00Z'),
      msg('a4', 'q1', false, '2026-07-05T12:00:00Z'),
    ]],
    // A plain follow-up on an open topic is not an answer to a question.
    ['o1', [msg('b1', 'o1', false, '2026-07-06T10:00:00Z')]],
  ]);

  it('counts all-time totals', () => {
    expect(computeStats(rows, threads, null)).toEqual({ todo: 3, open: 0, done: 2, issues: 0, answered: 2 });
  });

  it('scopes each metric to the window by its own timestamp', () => {
    // done: only s1 shipped in July. todo: o1 + q1 created in July
    // (rejected never counts). answered: only the 05.07. answer.
    expect(computeStats(rows, threads, from)).toEqual({ todo: 2, open: 0, done: 1, issues: 0, answered: 1 });
  });

  it('handles an empty board', () => {
    expect(computeStats([], new Map(), null)).toEqual({ todo: 0, open: 0, done: 0, issues: 0, answered: 0 });
  });

  it('counts an answered Rückfrage as still open (its ToDo bucket)', () => {
    const answered = row('q9', 'needs_input', '2026-07-02T10:00:00Z');
    const thread = new Map<string, FeedbackMessage[]>([
      ['q9', [
        msg('s1', 'q9', true, '2026-07-02T11:00:00Z'),
        msg('h1', 'q9', false, '2026-07-02T12:00:00Z'),
      ]],
    ]);
    expect(computeStats([answered], thread, null)).toEqual({ todo: 1, open: 0, done: 0, issues: 0, answered: 1 });
  });

  it('counts an issue hand-off as its own outcome, never as still open', () => {
    const filed = row('i1', 'issue_created', '2026-07-02T10:00:00Z', {
      ship_ref: 'https://github.com/o/r/issues/9',
    });
    expect(computeStats([filed], new Map(), null)).toEqual({ todo: 0, open: 0, done: 0, issues: 1, answered: 0 });
  });
});

describe('normalizeSearchText', () => {
  it('folds case, diacritics and the German sharp s', () => {
    expect(normalizeSearchText('Übersicht GRÖSSE straße')).toBe('ubersicht grosse strasse');
  });

  it('collapses markdown punctuation into word separators', () => {
    expect(normalizeSearchText('**Fix** the `admin-panel`, bitte!')).toBe('fix the admin panel bitte');
  });

  it('is empty for blank or punctuation-only input', () => {
    expect(normalizeSearchText('   ')).toBe('');
    expect(normalizeSearchText('...')).toBe('');
  });
});

describe('searchTokens', () => {
  it('splits into distinct normalized terms', () => {
    expect(searchTokens('Suche  im   PANEL suche')).toEqual(['suche', 'im', 'panel']);
  });

  it('is empty for a blank query', () => {
    expect(searchTokens('')).toEqual([]);
    expect(searchTokens('  —  ')).toEqual([]);
  });
});

describe('searchFeedback', () => {
  const at = '2026-07-01T10:00:00Z';

  function topic(id: string, body: string, extra: Partial<FeedbackRow> = {}): FeedbackRow {
    return row(id, 'open', at, { body, ...extra });
  }

  function reply(id: string, feedbackId: string, body: string): FeedbackMessage {
    return { ...msg(id, feedbackId, true, at), body };
  }

  const exact = topic('exact', 'Implementiere eine Suche im Feedback-Panel');
  const prefix = topic('prefix', 'Wir suchen noch eine Lösung für die Übersicht');
  const threadOnly = topic('thread', 'Ganz anderes Thema ohne Bezug');
  const rows = [threadOnly, exact, prefix];
  const threads = new Map<string, FeedbackMessage[]>([
    ['thread', [reply('r1', 'thread', 'Die Suche liefert eine Regression im Panel')]],
  ]);

  it('finds an exact term in the topic body', () => {
    const ids = searchFeedback(rows, threads, 'Suche').map((h) => h.row.id);
    expect(ids).toContain('exact');
  });

  it('still hits through a typo (transposition and substitution)', () => {
    expect(searchFeedback(rows, threads, 'Panle').map((h) => h.row.id)).toContain('exact');
    expect(searchFeedback(rows, threads, 'Sucje').map((h) => h.row.id)).toContain('exact');
  });

  it('ignores diacritics and case', () => {
    expect(searchFeedback(rows, threads, 'ubersicht').map((h) => h.row.id)).toEqual(['prefix']);
  });

  it('matches a term that only ever appears in a thread reply', () => {
    const hits = searchFeedback(rows, threads, 'Regression');
    expect(hits.map((h) => h.row.id)).toEqual(['thread']);
    expect(hits[0].inThread).toBeTrue();
    expect(hits[0].inBody).toBeFalse();
  });

  it('ranks exact body > prefix body > thread-only', () => {
    const hits = searchFeedback(rows, threads, 'Suche');
    expect(hits.map((h) => h.row.id)).toEqual(['exact', 'prefix', 'thread']);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
    expect(hits[1].score).toBeGreaterThan(hits[2].score);
  });

  it('requires every term to match somewhere (AND, not OR)', () => {
    expect(searchFeedback(rows, threads, 'Suche Triebwerkskrümmer')).toEqual([]);
  });

  it('rewards the verbatim phrase over the same words scattered apart', () => {
    const phrase = topic('phrase', 'Die Suche im Panel ist kaputt');
    const scattered = topic('scattered', 'Im Panel ist der Rest ok, aber die Suche fehlt komplett');
    const hits = searchFeedback([scattered, phrase], new Map(), 'Suche im Panel');
    expect(hits.map((h) => h.row.id)).toEqual(['phrase', 'scattered']);
  });

  it('breaks a score tie by recency', () => {
    const older = topic('older', 'Suche kaputt', { updated_at: '2026-07-01T10:00:00Z' });
    const newer = topic('newer', 'Suche kaputt', { updated_at: '2026-07-09T10:00:00Z' });
    expect(searchFeedback([older, newer], new Map(), 'Suche').map((h) => h.row.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('yields nothing for a blank query', () => {
    expect(searchFeedback(rows, threads, '   ')).toEqual([]);
  });
});

describe('searchFeedback by topic number (feedback 21587480)', () => {
  const at = '2026-07-01T10:00:00Z';
  /** The topic actually numbered #42 — its text holds no digits at all. */
  const numbered = row('numbered', 'open', at, { seq: 42, body: 'Codex Sortierung der Komponenten' });
  /** A different topic that merely mentions "42" in its prose. */
  const mentions = row('mentions', 'open', at, { seq: 7, body: 'Der Preis liegt bei 42 Credits' });
  /** #142 — must not answer a search for #42. */
  const other = row('other', 'open', at, { seq: 142, body: 'Ganz anderes Thema' });
  const unnumbered = row('unnumbered', 'open', at, { body: 'Alte Zeile ohne Nummer' });
  const rows = [mentions, other, numbered, unnumbered];
  const noThreads = new Map<string, FeedbackMessage[]>();

  it('finds the topic by its bare number', () => {
    expect(searchFeedback(rows, noThreads, '42').map((h) => h.row.id)).toContain('numbered');
  });

  it('accepts the "#42" reference form — the hash folds away in normalization', () => {
    const hits = searchFeedback(rows, noThreads, '#42');
    expect(hits[0].row.id).toBe('numbered');
    expect(hits[0].inNumber).toBeTrue();
  });

  it('ranks the numbered topic above one that merely mentions the digits', () => {
    expect(searchFeedback(rows, noThreads, '#42').map((h) => h.row.id)).toEqual([
      'numbered',
      'mentions',
    ]);
  });

  it('matches the number exactly — "#4" is not topic #42', () => {
    expect(searchFeedback(rows, noThreads, '#4').map((h) => h.row.id)).not.toContain('numbered');
  });

  it('does not confuse #42 with #142', () => {
    expect(searchFeedback(rows, noThreads, '#142').map((h) => h.row.id)).toEqual(['other']);
  });

  it('leaves a row without a number out of every number search', () => {
    for (const query of ['#42', '42', '#7']) {
      expect(searchFeedback(rows, noThreads, query).map((h) => h.row.id)).not.toContain(
        'unnumbered',
      );
    }
  });

  it('keeps the number out of inBody / inThread', () => {
    const hit = searchFeedback(rows, noThreads, '#42')[0];
    expect(hit.inBody).toBeFalse();
    expect(hit.inThread).toBeFalse();
  });
});

describe('rankFeedbackSearch', () => {
  const at = '2026-07-01T10:00:00Z';
  const a = row('a', 'open', at, { body: 'Suche im Panel' });
  const b = row('b', 'open', at, { body: 'Ganz anderes Thema' });

  it('leaves the list untouched for an empty query', () => {
    expect(rankFeedbackSearch([a, b], new Map(), '')).toEqual([a, b]);
    expect(rankFeedbackSearch([a, b], new Map(), '   ')).toEqual([a, b]);
  });

  it('narrows and reorders once a query is typed', () => {
    expect(rankFeedbackSearch([b, a], new Map(), 'Panel').map((r) => r.id)).toEqual(['a']);
  });
});

describe('startOfMonth', () => {
  it('returns the first local instant of the containing month', () => {
    const d = new Date(2026, 6, 24, 13, 45, 12);
    const start = new Date(startOfMonth(d.getTime()));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(6);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
  });
});

describe('startOfWeek', () => {
  it('returns Monday 00:00 of the containing week', () => {
    // 2026-07-24 is a Friday.
    const start = new Date(startOfWeek(new Date(2026, 6, 24, 13, 45).getTime()));
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(20);
    expect(start.getHours()).toBe(0);
  });

  it('keeps a Sunday in the week that started the Monday before', () => {
    // 2026-07-26 is a Sunday → still the week of Monday the 20th.
    const start = new Date(startOfWeek(new Date(2026, 6, 26, 23, 0).getTime()));
    expect(start.getDate()).toBe(20);
  });
});

describe('neededInput', () => {
  const shipped = '2026-07-10T10:00:00Z';

  it('is true while the topic is parked as a Rückfrage', () => {
    expect(neededInput(row('a', 'needs_input', '2026-07-01T10:00:00Z'), [])).toBeTrue();
  });

  it('is true for a system message posted before the ship', () => {
    const r = row('b', 'shipped', '2026-07-01T10:00:00Z', { shipped_at: shipped });
    expect(neededInput(r, [msg('m1', 'b', true, '2026-07-05T10:00:00Z')])).toBeTrue();
  });

  it('ignores the post-ship review reply', () => {
    const r = row('c', 'shipped', '2026-07-01T10:00:00Z', { shipped_at: shipped });
    expect(neededInput(r, [msg('m1', 'c', true, '2026-07-10T10:00:05Z')])).toBeFalse();
  });

  it('ignores human replies entirely', () => {
    const r = row('d', 'open', '2026-07-01T10:00:00Z');
    expect(neededInput(r, [msg('m1', 'd', false, '2026-07-02T10:00:00Z')])).toBeFalse();
    expect(neededInput(r, undefined)).toBeFalse();
  });
});

describe('computePace', () => {
  const rows: FeedbackRow[] = [
    // 24 h, 48 h and 96 h to ship — all in July.
    row('s1', 'shipped', '2026-07-02T10:00:00Z', { shipped_at: '2026-07-03T10:00:00Z' }),
    row('s2', 'shipped', '2026-07-04T10:00:00Z', { shipped_at: '2026-07-06T10:00:00Z' }),
    row('s3', 'shipped', '2026-07-05T10:00:00Z', { shipped_at: '2026-07-09T10:00:00Z' }),
    // Shipped in June — outside the July window, but part of all-time.
    row('s0', 'shipped', '2026-06-01T10:00:00Z', { shipped_at: '2026-06-02T10:00:00Z' }),
    row('q1', 'needs_input', '2026-07-06T10:00:00Z'),
  ];
  const threads = new Map<string, FeedbackMessage[]>([
    ['s2', [msg('m1', 's2', true, '2026-07-05T10:00:00Z')]],
  ]);
  const july = Date.parse('2026-07-01T00:00:00Z');

  it('takes the median of the durations that shipped inside the window', () => {
    expect(computePace(rows, threads, july).medianShipHours).toBe(48);
  });

  it('averages the two middle values for an even count', () => {
    expect(computePace(rows, threads, null).medianShipHours).toBe(36);
  });

  it('reports null when nothing shipped in the window', () => {
    expect(computePace([rows[4]], threads, july).medianShipHours).toBeNull();
  });

  it('rates the Rückfragen against the topics raised in the window', () => {
    const pace = computePace(rows, threads, july);
    expect(pace.raised).toBe(4);
    expect(pace.questioned).toBe(2);
    expect(pace.questionRate).toBeCloseTo(0.5, 5);
  });

  it('handles an empty board', () => {
    expect(computePace([], new Map(), null)).toEqual({
      medianShipHours: null,
      raised: 0,
      questioned: 0,
      questionRate: 0,
    });
  });

  it('ignores a ship stamp that predates the topic', () => {
    const broken = row('x', 'shipped', '2026-07-10T10:00:00Z', { shipped_at: '2026-07-01T10:00:00Z' });
    expect(computePace([broken], new Map(), null).medianShipHours).toBeNull();
  });
});

describe('weeklySeries', () => {
  const now = new Date(2026, 6, 24, 12, 0).getTime(); // Friday 2026-07-24
  const thisWeek = new Date(2026, 6, 22, 9, 0).toISOString(); // Wed 22.07.
  const lastWeek = new Date(2026, 6, 15, 9, 0).toISOString(); // Wed 15.07.

  const rows: FeedbackRow[] = [
    row('a', 'shipped', '2026-07-01T10:00:00Z', { shipped_at: thisWeek }),
    row('b', 'shipped', '2026-07-01T10:00:00Z', { shipped_at: thisWeek }),
    row('c', 'shipped', '2026-07-01T10:00:00Z', { shipped_at: lastWeek }),
    // Never shipped → not throughput.
    row('d', 'open', '2026-07-01T10:00:00Z'),
  ];

  it('buckets ships into the requested number of weeks, newest last', () => {
    const weeks = weeklySeries(rows, 4, now);
    expect(weeks.length).toBe(4);
    expect(weeks.map((w) => w.count)).toEqual([0, 0, 1, 2]);
    expect(weeks[3].current).toBeTrue();
    expect(weeks[0].current).toBeFalse();
  });

  it('starts every bucket on a Monday', () => {
    for (const week of weeklySeries(rows, 4, now)) {
      expect(new Date(week.start).getDay()).toBe(1);
    }
  });

  it('drops ships older than the covered range', () => {
    expect(weeklySeries(rows, 1, now).map((w) => w.count)).toEqual([2]);
  });

  it('handles an empty board', () => {
    expect(weeklySeries([], 3, now).map((w) => w.count)).toEqual([0, 0, 0]);
  });

  // The second series (feedback a33ba528): a ship count alone cannot say
  // whether the routine kept up, so the chart also carries the week's intake.
  it('counts intake by created_at, independently of the ship buckets', () => {
    const intake: FeedbackRow[] = [
      // Raised AND shipped in the running week → counted in both series.
      row('a', 'shipped', new Date(2026, 6, 21, 8, 0).toISOString(), { shipped_at: thisWeek }),
      // Raised last week, shipped this week → one bucket each, different weeks.
      row('b', 'shipped', new Date(2026, 6, 14, 8, 0).toISOString(), { shipped_at: thisWeek }),
      // Raised this week, still open → intake only.
      row('c', 'open', new Date(2026, 6, 23, 8, 0).toISOString()),
      // Raised before the covered range → neither series.
      row('d', 'open', '2026-05-01T10:00:00Z'),
    ];
    const weeks = weeklySeries(intake, 2, now);
    expect(weeks.map((w) => w.raised)).toEqual([1, 2]);
    expect(weeks.map((w) => w.count)).toEqual([0, 2]);
  });
});

describe('weeklyPulse (feedback a33ba528)', () => {
  const now = new Date(2026, 6, 24, 12, 0).getTime(); // Friday 2026-07-24
  const at = (day: number, hour = 9) => new Date(2026, 6, day, hour, 0).toISOString();

  it('splits ships and intake into the running week and the one before', () => {
    const rows: FeedbackRow[] = [
      // Running week (Mon 20.07. – now).
      row('a', 'shipped', at(20), { shipped_at: at(22) }),
      row('b', 'shipped', at(21), { shipped_at: at(23) }),
      row('c', 'open', at(23)),
      // Previous week (Mon 13.07. – Sun 19.07.).
      row('d', 'shipped', at(13), { shipped_at: at(15) }),
      row('e', 'open', at(16)),
      // Older than both windows → counted in neither.
      row('f', 'shipped', '2026-06-01T09:00:00Z', { shipped_at: '2026-06-04T09:00:00Z' }),
    ];
    const p = weeklyPulse(rows, now);
    expect(p.shipped).toBe(2);
    expect(p.shippedPrev).toBe(1);
    expect(p.raised).toBe(3);
    expect(p.raisedPrev).toBe(2);
    expect(new Date(p.weekStart).getDate()).toBe(20);
    expect(new Date(p.prevStart).getDate()).toBe(13);
  });

  it('measures the median only over rows carrying a real ship stamp', () => {
    const rows: FeedbackRow[] = [
      // 48 h and 24 h → median 36 h over two samples.
      row('a', 'shipped', at(20, 9), { shipped_at: at(22, 9) }),
      row('b', 'shipped', at(21, 9), { shipped_at: at(22, 9) }),
      // Shipped-by-status but never stamped: it must not invent a duration.
      row('c', 'shipped', at(20, 9), { updated_at: at(23, 9) }),
    ];
    const p = weeklyPulse(rows, now);
    expect(p.medianShipHours).toBe(36);
    expect(p.medianSample).toBe(2);
  });

  it('reports a null median rather than a zero when nothing shipped', () => {
    const p = weeklyPulse([row('a', 'open', at(21))], now);
    expect(p.medianShipHours).toBeNull();
    expect(p.medianSample).toBe(0);
    expect(p.shipped).toBe(0);
  });

  it('handles an empty board without inventing a comparison', () => {
    const p = weeklyPulse([], now);
    expect(p.shipped).toBe(0);
    expect(p.shippedPrev).toBe(0);
    expect(p.raised).toBe(0);
    expect(p.raisedPrev).toBe(0);
    expect(p.medianShipHours).toBeNull();
    expect(p.medianShipHoursPrev).toBeNull();
  });
});

describe('lifecycleSnapshot', () => {
  const now = Date.parse('2026-07-26T10:00:00Z');
  const rows: FeedbackRow[] = [
    row('todo', 'open', '2026-07-20T10:00:00Z'),
    row('oldest', 'open', '2026-07-16T10:00:00Z'),
    row('reaped', 'open', '2026-07-22T10:00:00Z', {
      processing_note: 'auto-reopened: in_progress claim went stale (interrupted run) — resuming',
    }),
    row('answered', 'needs_input', '2026-07-21T10:00:00Z'),
    row('asking', 'needs_input', '2026-07-23T10:00:00Z'),
    row('working', 'in_progress', '2026-07-24T10:00:00Z'),
    row('hold', 'in_progress', '2026-07-24T10:00:00Z', { ship_ref: 'https://example.test/pull/1' }),
    row('shipped', 'shipped', '2026-07-10T10:00:00Z', { shipped_at: '2026-07-12T10:00:00Z' }),
    row('continued', 'shipped', '2026-07-10T10:00:00Z', { shipped_at: '2026-07-12T10:00:00Z' }),
    row('issue', 'issue_created', '2026-07-11T10:00:00Z'),
  ];
  const threads = new Map<string, FeedbackMessage[]>([
    ['answered', [
      msg('a1', 'answered', true, '2026-07-21T11:00:00Z'),
      msg('a2', 'answered', false, '2026-07-21T12:00:00Z'),
    ]],
    ['asking', [msg('b1', 'asking', true, '2026-07-23T11:00:00Z')]],
    ['continued', [msg('c1', 'continued', false, '2026-07-13T10:00:00Z')]],
  ]);

  const snapshot = lifecycleSnapshot(rows, threads, now);

  it('counts live occupancy through the board buckets', () => {
    expect(snapshot.counts).toEqual({
      // 3 open + the answered Rückfrage + the continuation
      todo: 5,
      awaiting_admin: 1,
      awaiting_author: 0,
      in_progress: 2,
      review: 0,
      shipped: 1,
      issue_created: 1,
      rejected: 0,
      declined: 0,
    });
    expect(snapshot.total).toBe(10);
  });

  it('splits in_progress into active work and review holds', () => {
    expect(snapshot.working).toBe(1);
    expect(snapshot.reviewHolds).toBe(1);
  });

  it('breaks the ToDo bucket down by how a topic got there', () => {
    expect(snapshot.answered).toBe(1);
    expect(snapshot.continuations).toBe(1);
    expect(snapshot.reopened).toBe(1);
  });

  it('ages the oldest active topic in whole days', () => {
    // The reopened continuation ("continued", raised 10.07.) is active again,
    // so it — not the oldest plain ToDo — sets the backlog age.
    expect(snapshot.oldestActiveDays).toBe(16);
  });

  it('handles an empty board', () => {
    const empty = lifecycleSnapshot([], new Map(), now);
    expect(empty.total).toBe(0);
    expect(empty.oldestActiveDays).toBeNull();
    expect(empty.counts.todo).toBe(0);
  });

  it('ignores terminal topics when ageing the backlog', () => {
    const onlyArchive = lifecycleSnapshot(
      [row('old', 'issue_created', '2020-01-01T10:00:00Z')],
      new Map(),
      now,
    );
    expect(onlyArchive.oldestActiveDays).toBeNull();
  });
});

/**
 * The review gate (migration 20260729130000): shipping is not the end of a
 * topic, an admin saying "yes, that was it" is. Until then the topic stays on
 * the ACTIVE board with a way back into the work loop.
 */
describe('review gate', () => {
  const shipped = (extra: Partial<FeedbackRow> = {}) =>
    row('s', 'shipped', '2026-07-20T10:00:00Z', {
      shipped_at: '2026-07-21T10:00:00Z',
      reviewed_at: null,
      ...extra,
    });

  it('holds a fresh ship in the gate instead of archiving it', () => {
    const m = shipped();
    expect(awaitsReview(m)).toBeTrue();
    expect(feedbackBucket(m)).toBe('review');
    expect(isArchived(m)).toBeFalse();
  });

  it('holds an issue hand-off in the same gate', () => {
    const m = row('i', 'issue_created', '2026-07-20T10:00:00Z', {
      ship_ref: 'https://github.com/o/r/issues/9',
      reviewed_at: null,
    });
    expect(feedbackBucket(m)).toBe('review');
    expect(isArchived(m)).toBeFalse();
  });

  it('archives the topic once an admin signed it off', () => {
    const m = shipped({ reviewed_at: '2026-07-22T09:00:00Z' });
    expect(awaitsReview(m)).toBeFalse();
    expect(feedbackBucket(m)).toBe('shipped');
    expect(isArchived(m)).toBeTrue();
  });

  it('never gates the admin\'s own decisions — declined and legacy rejected', () => {
    const declined = row('d', 'declined', '2026-07-20T10:00:00Z', { reviewed_at: null });
    const rejected = row('r', 'rejected', '2026-07-20T10:00:00Z', { reviewed_at: null });
    expect(awaitsReview(declined)).toBeFalse();
    expect(awaitsReview(rejected)).toBeFalse();
    expect(isArchived(declined)).toBeTrue();
    expect(isArchived(rejected)).toBeTrue();
  });

  it('lets a post-ship continuation win over the gate — it is already back in the loop', () => {
    const m = shipped();
    const replies = new Map<string, FeedbackMessage[]>([
      ['s', [msg('h1', 's', false, '2026-07-22T10:00:00Z')]],
    ]);
    expect(awaitsReview(m, replies.get('s'))).toBeFalse();
    expect(feedbackBucket(m, replies.get('s'))).toBe('todo');
  });

  it('treats an absent column as signed off, so fixtures and projections keep working', () => {
    const legacy = row('s', 'shipped', '2026-07-20T10:00:00Z');
    expect(legacy.reviewed_at).toBeUndefined();
    expect(awaitsReview(legacy)).toBeFalse();
    expect(feedbackBucket(legacy)).toBe('shipped');
  });

  it('keeps the gate on the active side of the board and labels it "review"', () => {
    expect(bucketLabelStatus('review')).toBe('review');
    const pending = shipped();
    const signedOff = shipped({ reviewed_at: '2026-07-22T09:00:00Z' });
    const snapshot = lifecycleSnapshot([pending, signedOff], new Map(), Date.parse('2026-07-25T00:00:00Z'));
    expect(snapshot.counts.review).toBe(1);
    expect(snapshot.counts.shipped).toBe(1);
    expect(snapshot.reviewShipped).toBe(1);
    expect(snapshot.reviewIssues).toBe(0);
  });

  it('counts a topic awaiting sign-off as Offen, not as done', () => {
    const stats = computeStats([shipped()], new Map(), null);
    expect(stats.open).toBe(1);
    expect(stats.done).toBe(0);
  });
});

/**
 * "Issue erstellen" is an ORDER in the thread, undoable until the routine
 * carries it out (admin feedback 18e96ad3).
 */
describe('issue requests', () => {
  const order = (id: string, created: string): FeedbackMessage => ({
    ...msg(id, 'f1', false, created),
    body: `${ISSUE_REQUEST_MARKER} bitte ein GitHub-Issue anlegen`,
  });

  it('recognises the order by its marker, and only on a human message', () => {
    expect(isIssueRequest(order('m1', '2026-09-01T10:00:00Z'))).toBeTrue();
    expect(isIssueRequest(msg('m2', 'f1', false, '2026-09-01T10:00:00Z'))).toBeFalse();
    expect(
      isIssueRequest({ ...order('m3', '2026-09-01T10:00:00Z'), is_system: true }),
    ).withContext('the routine never orders itself around').toBeFalse();
  });

  it('stays open — and undoable — while the topic is still a plain ToDo', () => {
    const todo = row('f1', 'open', '2026-09-01T09:00:00Z');
    expect(pendingIssueRequest(todo, [order('m1', '2026-09-01T10:00:00Z')])?.id).toBe('m1');
    expect(pendingIssueRequest(todo, [])).toBeNull();
  });

  it('is closed once the routine filed the issue', () => {
    const replies = [order('m1', '2026-09-01T10:00:00Z')];
    const filed = row('f1', 'issue_created', '2026-09-01T09:00:00Z', {
      ship_ref: 'https://github.com/o/r/issues/7',
    });
    expect(pendingIssueRequest(filed, replies)).toBeNull();
    // A ship_ref alone closes it too — the hand-off happened, whatever the
    // status is called at that moment.
    const withRef = row('f1', 'open', '2026-09-01T09:00:00Z', {
      ship_ref: 'https://github.com/o/r/issues/7',
    });
    expect(pendingIssueRequest(withRef, replies)).toBeNull();
  });

  it('does not change the topic bucket — it is still work in the queue', () => {
    const todo = row('f1', 'open', '2026-09-01T09:00:00Z');
    expect(feedbackBucket(todo, [order('m1', '2026-09-01T10:00:00Z')])).toBe('todo');
    expect(isArchived(todo, [order('m1', '2026-09-01T10:00:00Z')])).toBeFalse();
  });
});

describe('canned decline reasons', () => {
  const texts = {
    duplicate: '  Das gibt es schon.  ',
    alreadyShipped: 'Ist längst drin.',
    notReproducible: 'Konnten wir nicht nachstellen.',
    tooLittleInfo: 'Zu wenig Info.',
    offRoadmap: 'Passt nicht zur Richtung.',
    noise: 'Damit können wir nichts anfangen.',
  };

  it('gives every reason a distinct label and text key', () => {
    const keys = DECLINE_REASONS.flatMap((id) => [declineReasonLabelKey(id), declineReasonTextKey(id)]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(declineReasonLabelKey('duplicate')).toBe('adminFeedback.decline.reasons.duplicate.label');
    expect(declineReasonTextKey('duplicate')).toBe('adminFeedback.decline.reasons.duplicate.text');
  });

  it('recognises a note that is still a canned reason, whitespace aside', () => {
    expect(matchDeclineReason('Das gibt es schon.', texts)).toBe('duplicate');
    expect(matchDeclineReason('\n Ist längst drin. \n', texts)).toBe('alreadyShipped');
  });

  it('drops the selection as soon as the admin edits the pre-filled text', () => {
    expect(matchDeclineReason('Das gibt es schon. Siehe #12.', texts)).toBeNull();
    expect(matchDeclineReason('Das gibt es scho', texts)).toBeNull();
  });

  it('treats an empty note as no reason at all', () => {
    expect(matchDeclineReason('', texts)).toBeNull();
    expect(matchDeclineReason('   ', texts)).toBeNull();
  });

  it('never matches against a reason the caller could not translate', () => {
    // A missing key resolves to '' in the caller's map — that must not make an
    // empty-ish note look like a deliberate pick.
    expect(matchDeclineReason('anything', { duplicate: '' })).toBeNull();
  });
});

// ---- The stream: whose turn, flight path, delivered feed (concept 2026-09-04) ----

describe('turnOf / adminAsk (whose move is it)', () => {
  const T0 = '2026-09-01T10:00:00Z';
  const T1 = '2026-09-01T11:00:00Z';
  const T2 = '2026-09-01T12:00:00Z';

  it('an unanswered Rückfrage is the admin\'s turn — a question to answer', () => {
    const r = row('a', 'needs_input', T0);
    const replies = [msg('m1', 'a', true, T1)];
    expect(turnOf(r, replies)).toBe('admin');
    expect(adminAsk(r, replies)).toBe('question');
  });

  it('an answered Rückfrage is back on the routine\'s pile', () => {
    const r = row('a', 'needs_input', T0);
    const replies = [msg('m1', 'a', true, T1), msg('m2', 'a', false, T2)];
    expect(turnOf(r, replies)).toBe('routine');
    expect(adminAsk(r, replies)).toBeNull();
  });

  it('a pending sign-off is the admin\'s turn — a review, even on a topic never released', () => {
    const r = row('a', 'shipped', T0, { shipped_at: T1, reviewed_at: null });
    expect(turnOf(r)).toBe('admin');
    expect(adminAsk(r)).toBe('review');
    expect(adminAsk(row('u', 'shipped', T0, { shipped_at: T1, reviewed_at: null, source: 'user', triaged: false }))).toBe('review');
    const issue = row('b', 'issue_created', T0, { reviewed_at: null });
    expect(turnOf(issue)).toBe('admin');
    expect(adminAsk(issue)).toBe('review');
  });

  it('a user topic held back from the routine is the admin\'s turn — a release', () => {
    const r = row('a', 'open', T0, { source: 'user', triaged: false });
    expect(turnOf(r)).toBe('admin');
    expect(adminAsk(r)).toBe('release');
  });

  it('a question to the author waits on the user', () => {
    const r = row('a', 'needs_input_author', T0, { source: 'user', triaged: true });
    expect(turnOf(r)).toBe('user');
    expect(adminAsk(r)).toBeNull();
  });

  it('open and in_progress are the routine\'s, a post-ship continuation too', () => {
    expect(turnOf(row('a', 'open', T0))).toBe('routine');
    expect(turnOf(row('b', 'in_progress', T0))).toBe('routine');
    const shipped = row('c', 'shipped', T0, { shipped_at: T1, reviewed_at: T1 });
    expect(turnOf(shipped, [msg('m1', 'c', false, T2)])).toBe('routine');
  });

  it('signed-off and decided topics are nobody\'s', () => {
    expect(turnOf(row('a', 'shipped', T0, { shipped_at: T1, reviewed_at: T2 }))).toBe('nobody');
    expect(turnOf(row('b', 'issue_created', T0, { reviewed_at: T2 }))).toBe('nobody');
    expect(turnOf(row('c', 'declined', T0, { source: 'user', triaged: true }))).toBe('nobody');
    expect(turnOf(row('d', 'rejected', T0))).toBe('nobody');
  });

  it('a declined user topic that was never released is still nobody\'s', () => {
    // awaitsTriage would say "release" — but the topic is over.
    expect(turnOf(row('a', 'declined', T0, { source: 'user', triaged: false }))).toBe('nobody');
    expect(adminAsk(row('a', 'declined', T0, { source: 'user', triaged: false }))).toBeNull();
  });
});

describe('flightPosition (place on the path)', () => {
  const T0 = '2026-09-01T10:00:00Z';
  const T1 = '2026-09-01T11:00:00Z';
  const T2 = '2026-09-01T12:00:00Z';

  it('an unreleased user topic sits in the inbox', () => {
    expect(flightPosition(row('a', 'open', T0, { source: 'user', triaged: false })))
      .toEqual({ station: 'inbox', branch: null, loop: false, queued: false, answered: false, question: false });
  });

  it('everything the routine or the admin still works on is "work"', () => {
    for (const status of ['open', 'in_progress', 'needs_input', 'needs_input_author'] as FeedbackStatus[]) {
      expect(flightPosition(row('a', status, T0)).station).toBe('work');
      expect(flightPosition(row('a', status, T0)).branch).toBeNull();
    }
    // …but the queue is told apart from a topic the routine holds right now.
    expect(flightPosition(row('a', 'open', T0)).queued).toBeTrue();
    expect(flightPosition(row('a', 'in_progress', T0)).queued).toBeFalse();
    expect(stationLabelKey(flightPosition(row('a', 'open', T0)))).toBe('adminFeedback.station.queued');
    expect(stationLabelKey(flightPosition(row('a', 'in_progress', T0)))).toBe('adminFeedback.station.work');
  });

  it('a delivered result waits at "delivered" until it is signed off', () => {
    expect(flightPosition(row('a', 'shipped', T0, { shipped_at: T1, reviewed_at: null })))
      .toEqual({ station: 'delivered', branch: null, loop: false, queued: false, answered: false, question: false });
    expect(flightPosition(row('b', 'issue_created', T0, { reviewed_at: null })))
      .toEqual({ station: 'delivered', branch: 'issue', loop: false, queued: false, answered: false, question: false });
  });

  it('a signed-off result is "accepted", an issue keeps its branch marker', () => {
    expect(flightPosition(row('a', 'shipped', T0, { shipped_at: T1, reviewed_at: T2 })))
      .toEqual({ station: 'accepted', branch: null, loop: false, queued: false, answered: false, question: false });
    expect(flightPosition(row('b', 'issue_created', T0, { reviewed_at: T2 })))
      .toEqual({ station: 'accepted', branch: 'issue', loop: false, queued: false, answered: false, question: false });
  });

  it('declined and rejected leave the path from "work"', () => {
    expect(flightPosition(row('a', 'declined', T0)).branch).toBe('declined');
    expect(flightPosition(row('a', 'declined', T0)).station).toBe('work');
    expect(flightPosition(row('b', 'rejected', T0)).branch).toBe('rejected');
  });

  it('an answered Rückfrage is queued AND marked answered', () => {
    const r = row('a', 'needs_input', T0);
    const pos = flightPosition(r, [msg('m1', 'a', true, T1), msg('m2', 'a', false, T2)]);
    expect(pos.queued).toBeTrue();
    expect(pos.answered).toBeTrue();
    expect(stationLabelKey(pos)).toBe('adminFeedback.station.answered');
    expect(flightPosition(row('b', 'open', T0)).answered).toBeFalse();
  });

  it('a post-ship continuation loops back into "work"', () => {
    const r = row('a', 'shipped', T0, { shipped_at: T1, reviewed_at: T1 });
    expect(flightPosition(r, [msg('m1', 'a', false, T2)]))
      .toEqual({ station: 'work', branch: null, loop: true, queued: true, answered: false, question: false });
  });

  it('labels and indexes follow the position', () => {
    expect(stationIndex('inbox')).toBe(0);
    expect(stationIndex('accepted')).toBe(3);
    expect(stationLabelKey({ station: 'work', branch: null, loop: false, queued: false, answered: false, question: false })).toBe('adminFeedback.station.work');
    expect(stationLabelKey({ station: 'work', branch: null, loop: true, queued: true, answered: false, question: false })).toBe('adminFeedback.station.loop');
    expect(stationLabelKey({ station: 'accepted', branch: 'issue', loop: false, queued: false, answered: false, question: false })).toBe('adminFeedback.station.issue');
    expect(turnLabelKey('admin')).toBe('adminFeedback.turn.admin');
  });

  it('keeps every one of the eleven old states distinguishable', () => {
    const sig = (r: FeedbackRow, replies?: FeedbackMessage[]) => {
      const p = flightPosition(r, replies);
      return `${turnOf(r, replies)}/${p.station}/${p.branch}/${p.loop}/${p.queued}/${p.answered}/${adminAsk(r, replies)}`;
    };
    const shippedReviewed = row('s', 'shipped', T0, { shipped_at: T1, reviewed_at: T2 });
    const seen = new Set([
      sig(row('1', 'open', T0)),
      sig(row('2', 'in_progress', T0)),
      sig(row('3', 'needs_input', T0), [msg('m', '3', true, T1)]),
      sig(row('4', 'needs_input', T0), [msg('m', '4', true, T1), msg('n', '4', false, T2)]),
      sig(row('5', 'needs_input_author', T0)),
      sig(row('6', 'shipped', T0, { shipped_at: T1, reviewed_at: null })),
      sig(shippedReviewed),
      sig(row('8', 'issue_created', T0, { reviewed_at: null })),
      sig(row('9', 'issue_created', T0, { reviewed_at: T2 })),
      sig(row('10', 'declined', T0)),
      sig(row('11', 'rejected', T0)),
      sig(row('12', 'open', T0, { source: 'user', triaged: false })),
      sig(shippedReviewed, [msg('m', 's', false, T2)]),
    ]);
    // Every one of the thirteen states keeps its own signature — including the
    // answered Rückfrage (feedback 34c44134), which reads as "beantwortet" next
    // to an untouched ToDo.
    expect(seen.size).toBe(13);
  });
});

/**
 * The four dots were unreadable as dots (feedback 1d013d69): each step now
 * names itself with a glyph. Slots 1, 3 and 4 are the step, not the state, so
 * they never change; slot 2 is the one that has three fates.
 */
describe('stationGlyphs (the four mini icons)', () => {
  const T0 = '2026-09-01T10:00:00Z';
  const T1 = '2026-09-01T11:00:00Z';
  const T2 = '2026-09-01T12:00:00Z';
  const glyphs = (r: FeedbackRow, replies?: FeedbackMessage[]) => stationGlyphs(flightPosition(r, replies));

  it('draws Vertrag → Werkzeug → Haken → Haken-im-Kreis on the plain path', () => {
    expect(glyphs(row('a', 'open', T0))).toEqual(['contract', 'doing', 'delivered', 'accepted']);
    expect(glyphs(row('b', 'in_progress', T0))).toEqual(['contract', 'doing', 'delivered', 'accepted']);
    // The outer slots hold their glyph wherever the topic actually stands.
    expect(glyphs(row('c', 'open', T0, { source: 'user', triaged: false })))
      .toEqual(['contract', 'doing', 'delivered', 'accepted']);
    expect(glyphs(row('d', 'shipped', T0, { shipped_at: T1, reviewed_at: T2 })))
      .toEqual(['contract', 'doing', 'delivered', 'accepted']);
  });

  it('turns the work slot into the loop arrow while a Rückfrage is open — either way round', () => {
    // The routine asked the admin and waits on the answer.
    expect(glyphs(row('a', 'needs_input', T0), [msg('m', 'a', true, T1)])[1]).toBe('recycle');
    // The admin asked the author and waits on them.
    expect(glyphs(row('b', 'needs_input_author', T0))[1]).toBe('recycle');
    // A post-ship continuation is the same "round again" motion.
    const shipped = row('c', 'shipped', T0, { shipped_at: T1, reviewed_at: T1 });
    expect(glyphs(shipped, [msg('m', 'c', false, T2)])[1]).toBe('recycle');
  });

  it('an answered Rückfrage is back at work, not still in the loop', () => {
    const answered = glyphs(row('a', 'needs_input', T0), [msg('m', 'a', true, T1), msg('n', 'a', false, T2)]);
    expect(answered[1]).toBe('doing');
  });

  it('a declined or rejected topic wears the cross instead of the tool', () => {
    expect(glyphs(row('a', 'declined', T0))).toEqual(['contract', 'rejected', 'delivered', 'accepted']);
    expect(glyphs(row('b', 'rejected', T0))[1]).toBe('rejected');
  });

  it('every glyph has its own name key', () => {
    const all: StationGlyph[] = ['contract', 'doing', 'recycle', 'rejected', 'delivered', 'accepted'];
    const keys = all.map(stationGlyphLabelKey);
    expect(keys).toEqual([
      'adminFeedback.station.step.contract',
      'adminFeedback.station.step.doing',
      'adminFeedback.station.step.recycle',
      'adminFeedback.station.step.rejected',
      'adminFeedback.station.step.delivered',
      'adminFeedback.station.step.accepted',
    ]);
    expect(new Set(keys).size).toBe(all.length);
  });
});

describe('waitingSince (band order: longest wait first)', () => {
  const T0 = '2026-09-01T10:00:00Z';
  const T1 = '2026-09-01T11:00:00Z';
  const T2 = '2026-09-01T12:00:00Z';

  it('a Rückfrage waits since the routine asked', () => {
    const r = row('a', 'needs_input', T0, { updated_at: T2 });
    expect(waitingSince(r, [msg('m', 'a', true, T1)])).toBe(Date.parse(T1));
  });

  it('a sign-off waits since the ship', () => {
    const r = row('a', 'shipped', T0, { shipped_at: T1, updated_at: T2, reviewed_at: null });
    expect(waitingSince(r)).toBe(Date.parse(T1));
  });

  it('a release waits since the topic last moved', () => {
    const r = row('a', 'open', T0, { source: 'user', triaged: false, updated_at: T1 });
    expect(waitingSince(r)).toBe(Date.parse(T1));
  });
});

describe('deliveredByDay (the Geliefert feed)', () => {
  const day = (d: string, h: string) => `2026-09-${d}T${h}:00:00Z`;

  it('groups finished topics by local day, newest day first, newest topic first', () => {
    const rows = [
      row('a', 'shipped', day('01', '08'), { shipped_at: day('01', '09'), reviewed_at: day('01', '10') }),
      row('b', 'shipped', day('01', '08'), { shipped_at: day('03', '09'), reviewed_at: day('03', '10') }),
      row('c', 'issue_created', day('01', '08'), { processed_at: day('03', '12'), reviewed_at: day('03', '13') }),
      row('d', 'declined', day('02', '08'), { processed_at: day('02', '15') }),
      row('e', 'open', day('04', '08')),
      row('f', 'shipped', day('04', '08'), { shipped_at: day('04', '09'), reviewed_at: null }), // still in review
    ];
    const days = deliveredByDay(rows, new Map());
    // 'f' shipped and waits for its sign-off: it IS in the feed on its ship day
    // (the ✓ sits in the row) and in the "Du bist dran" band at the same time.
    expect(days.map((d) => d.items.map((i) => i.id))).toEqual([['f'], ['c', 'b'], ['d'], ['a']]);
    expect(days[0].day).toBeGreaterThan(days[1].day);
    expect(days[1].day).toBeGreaterThan(days[2].day);
    expect(days[2].day).toBeGreaterThan(days[3].day);
  });

  it('isDelivered: an outcome, signed off or not — never an open topic or a continuation', () => {
    expect(isDelivered(row('a', 'shipped', day('01', '08'), { shipped_at: day('01', '09'), reviewed_at: null }))).toBeTrue();
    expect(isDelivered(row('b', 'issue_created', day('01', '08'), { reviewed_at: null }))).toBeTrue();
    expect(isDelivered(row('c', 'declined', day('01', '08')))).toBeTrue();
    expect(isDelivered(row('d', 'open', day('01', '08')))).toBeFalse();
    expect(isDelivered(row('e', 'needs_input', day('01', '08')))).toBeFalse();
    const cont = row('f', 'shipped', day('01', '08'), { shipped_at: day('01', '09'), reviewed_at: day('01', '10') });
    expect(isDelivered(cont, [msg('m', 'f', false, day('02', '09'))])).toBeFalse();
  });

  it('a post-ship continuation is not delivered any more', () => {
    const r = row('a', 'shipped', day('01', '08'), { shipped_at: day('01', '09'), reviewed_at: day('01', '10') });
    const threads = new Map([['a', [msg('m', 'a', false, day('02', '09'))]]]);
    expect(deliveredByDay([r], threads)).toEqual([]);
  });

  it('doneTime prefers the ship, then the routine\'s touch, then the row', () => {
    expect(doneTime(row('a', 'shipped', day('01', '08'), { shipped_at: day('02', '08'), processed_at: day('03', '08') })))
      .toBe(Date.parse(day('02', '08')));
    expect(doneTime(row('b', 'declined', day('01', '08'), { processed_at: day('03', '08') })))
      .toBe(Date.parse(day('03', '08')));
    expect(doneTime(row('c', 'rejected', day('01', '08')))).toBe(Date.parse(day('01', '08')));
  });

  it('isNewSince marks only what finished after the last look — and nothing on a first visit', () => {
    const r = row('a', 'shipped', day('01', '08'), { shipped_at: day('02', '08'), reviewed_at: day('02', '09') });
    expect(isNewSince(r, Date.parse(day('01', '12')))).toBeTrue();
    expect(isNewSince(r, Date.parse(day('02', '12')))).toBeFalse();
    expect(isNewSince(r, 0)).toBeFalse();
  });
});

describe('parseAnswerOptions ([[A|B]] convention)', () => {
  it('splits the marked last line off the question text', () => {
    expect(parseAnswerOptions('Soll ich das Panel rot lassen?\n\n[[Ja|Nein|Später]]'))
      .toEqual({ text: 'Soll ich das Panel rot lassen?', options: ['Ja', 'Nein', 'Später'] });
    expect(parseAnswerOptions('Frage?\n[[ Erhalten | Zurücksetzen ]]\n\n'))
      .toEqual({ text: 'Frage?', options: ['Erhalten', 'Zurücksetzen'] });
  });

  it('is null without markup, with one option, with more than four, or with an empty / overlong label', () => {
    expect(parseAnswerOptions('Plain question?')).toBeNull();
    expect(parseAnswerOptions('One?\n[[Ja]]')).toBeNull();
    expect(parseAnswerOptions('Many?\n[[1|2|3|4|5]]')).toBeNull();
    expect(parseAnswerOptions('Empty?\n[[ | ]]')).toBeNull();
    expect(parseAnswerOptions('Long?\n[[' + 'x'.repeat(41) + '|Nein]]')).toBeNull();
    expect(parseAnswerOptions('')).toBeNull();
  });

  it('only reads the LAST line — a marker mid-text is prose', () => {
    expect(parseAnswerOptions('Vorne [[A|B]] hinten.')).toBeNull();
    expect(parseAnswerOptions('[[A|B]]\nUnd dann noch Text.')).toBeNull();
  });

  it('does not eat a markdown link or a code span that happens to use brackets', () => {
    expect(parseAnswerOptions('See [docs](https://x) and [[not|a\nchoice]]')).toBeNull();
    expect(parseAnswerOptions('Frage?\n`[[A|B]]`')).toBeNull();
  });
});

describe('isLongMessage (fold sent messages > 3 lines)', () => {
  it('short messages stay open', () => {
    expect(isLongMessage('Eine Zeile.')).toBeFalse();
    expect(isLongMessage('Eins\nZwei\nDrei')).toBeFalse();
    expect(isLongMessage('')).toBeFalse();
  });

  it('four explicit lines fold', () => {
    expect(isLongMessage('Eins\nZwei\nDrei\nVier')).toBeTrue();
  });

  it('one long paragraph folds by wrapped width', () => {
    expect(isLongMessage('x'.repeat(300))).toBeTrue();
    expect(isLongMessage('x'.repeat(140))).toBeFalse();
  });

  it('images do not count as lines', () => {
    expect(isLongMessage('Text\n![a](u1)\n![b](u2)\n![c](u3)\n![d](u4)')).toBeFalse();
  });
});
