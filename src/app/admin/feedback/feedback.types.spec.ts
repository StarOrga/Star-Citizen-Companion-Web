import {
  FeedbackMessage,
  FeedbackRow,
  FeedbackStatus,
  buildWorkflowQueue,
  computeStats,
  isArchived,
  isAwaitingAdmin,
  refKind,
  startOfMonth,
  topicTitle,
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

describe('isArchived', () => {
  it('is true for every terminal status', () => {
    for (const s of ['shipped', 'issue_created', 'rejected'] as const) {
      expect(isArchived(row('t', s, '2026-07-01T10:00:00Z'))).toBeTrue();
    }
  });

  it('is false for the statuses the routine still works', () => {
    for (const s of ['open', 'in_progress', 'needs_input'] as const) {
      expect(isArchived(row('a', s, '2026-07-01T10:00:00Z'))).toBeFalse();
    }
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

  it('puts pending questions first, then new topics, each oldest first', () => {
    const queue = buildWorkflowQueue([o1, q1, done, o2, q2, busy, answered], threads);
    expect(queue.map((i) => i.row.id)).toEqual(['q2', 'q1', 'o2', 'o1']);
    expect(queue.map((i) => i.kind)).toEqual(['question', 'question', 'new', 'new']);
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
    expect(computeStats(rows, threads, null)).toEqual({ shipped: 2, open: 3, answered: 2 });
  });

  it('scopes each metric to the window by its own timestamp', () => {
    // shipped: only s1 shipped in July. open: o1 + q1 created in July
    // (rejected never counts). answered: only the 05.07. answer.
    expect(computeStats(rows, threads, from)).toEqual({ shipped: 1, open: 2, answered: 1 });
  });

  it('handles an empty board', () => {
    expect(computeStats([], new Map(), null)).toEqual({ shipped: 0, open: 0, answered: 0 });
  });

  it('does not count an issue hand-off as still open', () => {
    const filed = row('i1', 'issue_created', '2026-07-02T10:00:00Z', {
      ship_ref: 'https://github.com/o/r/issues/9',
    });
    expect(computeStats([filed], new Map(), null)).toEqual({ shipped: 0, open: 0, answered: 0 });
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
