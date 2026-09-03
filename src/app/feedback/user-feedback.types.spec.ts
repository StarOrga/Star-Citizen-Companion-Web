import {
  AuthorFeedbackMessage,
  AuthorFeedbackRow,
  AuthorFeedbackStatus,
  FeedbackReadState,
  coarseAuthorStatus,
  groupAuthorMessages,
  topicHasNews,
  topicsWithNews,
  unreadBadgeText,
} from './user-feedback.types';

function msg(
  id: string,
  createdAt: string,
  over: Partial<AuthorFeedbackMessage> = {},
): AuthorFeedbackMessage {
  return {
    id,
    feedback_id: over.feedback_id ?? 'f1',
    author_id: over.author_id ?? 'u1',
    from_admin: over.from_admin ?? false,
    is_question: over.is_question ?? false,
    body: over.body ?? 'text',
    created_at: createdAt,
  };
}

describe('coarseAuthorStatus', () => {
  it('hides the routine’s needs_input behind "in Bearbeitung"', () => {
    // The admin insisted on this one: needs_input is the routine asking the
    // ADMIN. The feedback author must never see it as a question aimed at them,
    // and must not even be able to tell it apart from ordinary progress.
    expect(coarseAuthorStatus('needs_input')).toBe('in_progress');
  });

  it('surfaces only the author-directed question flavour', () => {
    expect(coarseAuthorStatus('needs_input_author')).toBe('question');
  });

  it('maps every other active status to in_progress', () => {
    for (const s of ['open', 'in_progress', 'needs_input', 'issue_created'] as const) {
      expect(coarseAuthorStatus(s)).toBe('in_progress');
    }
  });

  it('maps shipped to done', () => {
    expect(coarseAuthorStatus('shipped')).toBe('done');
  });

  it('maps declined and legacy rejected to declined', () => {
    expect(coarseAuthorStatus('declined')).toBe('declined');
    expect(coarseAuthorStatus('rejected')).toBe('declined');
  });

  it('mirrors the my_feedback view: exactly four author-visible states', () => {
    // Whatever the admin board's vocabulary grows to, the author side must stay
    // at four coarse states — that is the privacy contract.
    const all = (
      [
        'open',
        'in_progress',
        'needs_input',
        'needs_input_author',
        'issue_created',
        'shipped',
        'rejected',
        'declined',
      ] as const
    ).map(coarseAuthorStatus);
    expect(new Set(all)).toEqual(new Set(['in_progress', 'question', 'done', 'declined']));
  });
});

describe('groupAuthorMessages', () => {
  it('groups by topic and preserves input order', () => {
    const grouped = groupAuthorMessages([
      msg('a', '2026-07-01T09:00:00Z', { feedback_id: 'f1' }),
      msg('b', '2026-07-01T10:00:00Z', { feedback_id: 'f2' }),
      msg('c', '2026-07-01T11:00:00Z', { feedback_id: 'f1' }),
    ]);
    expect(grouped.get('f1')?.map((m) => m.id)).toEqual(['a', 'c']);
    expect(grouped.get('f2')?.map((m) => m.id)).toEqual(['b']);
    expect(grouped.get('nope')).toBeUndefined();
  });

  it('keeps an admin question and the author’s answer in one thread', () => {
    const grouped = groupAuthorMessages([
      msg('q', '2026-07-01T09:00:00Z', { from_admin: true, is_question: true }),
      msg('a', '2026-07-01T10:00:00Z'),
    ]);
    expect(grouped.get('f1')?.map((m) => m.is_question)).toEqual([true, false]);
  });
});

function topic(
  id: string,
  authorStatus: AuthorFeedbackStatus = 'in_progress',
): AuthorFeedbackRow {
  return {
    id,
    body: 'text',
    created_at: '2026-07-01T08:00:00Z',
    updated_at: '2026-07-01T08:00:00Z',
    decision_note: null,
    author_status: authorStatus,
  };
}

function read(
  lastReadAt: string,
  lastSeenStatus: AuthorFeedbackStatus = 'in_progress',
  feedbackId = 'f1',
): FeedbackReadState {
  return { feedback_id: feedbackId, last_read_at: lastReadAt, last_seen_status: lastSeenStatus };
}

describe('topicHasNews', () => {
  it('is quiet on a topic the author just sent and nobody touched', () => {
    // No read marker exists yet — the author has never opened the panel. Their
    // own fresh topic must NOT badge them about their own writing.
    expect(topicHasNews(topic('f1'), [], undefined)).toBe(false);
  });

  it('reports a first team reply on a never-opened panel', () => {
    const messages = [msg('m1', '2026-07-02T09:00:00Z', { from_admin: true })];
    expect(topicHasNews(topic('f1'), messages, undefined)).toBe(true);
  });

  it('ignores the author’s own replies', () => {
    const messages = [msg('m1', '2026-07-02T09:00:00Z', { from_admin: false })];
    expect(topicHasNews(topic('f1'), messages, undefined)).toBe(false);
    expect(topicHasNews(topic('f1'), messages, read('2026-07-01T00:00:00Z'))).toBe(false);
  });

  it('reports a team reply that arrived after the last read, not before', () => {
    const before = [msg('m1', '2026-07-01T09:00:00Z', { from_admin: true })];
    const after = [msg('m2', '2026-07-03T09:00:00Z', { from_admin: true })];
    const marker = read('2026-07-02T00:00:00Z');
    expect(topicHasNews(topic('f1'), before, marker)).toBe(false);
    expect(topicHasNews(topic('f1'), after, marker)).toBe(true);
  });

  it('reports every status the author has not been shown yet', () => {
    const marker = read('2026-07-02T00:00:00Z', 'in_progress');
    for (const s of ['question', 'done', 'declined'] as const) {
      expect(topicHasNews(topic('f1', s), [], marker)).toBe(true);
    }
    expect(topicHasNews(topic('f1', 'in_progress'), [], marker)).toBe(false);
  });

  it('goes quiet again once the seen status matches — that is what "read" means', () => {
    // The admin explicitly asked for this: after looking, the badge disappears
    // even while the question itself is still open.
    expect(topicHasNews(topic('f1', 'question'), [], read('2026-07-02T00:00:00Z', 'question')))
      .toBe(false);
  });

  it('re-reports a status that flipped back and forth to the same value', () => {
    // question -> answered -> question is still news, because the reply that
    // asked again carries a timestamp of its own.
    const marker = read('2026-07-02T00:00:00Z', 'question');
    const messages = [msg('m1', '2026-07-03T09:00:00Z', { from_admin: true, is_question: true })];
    expect(topicHasNews(topic('f1', 'question'), messages, marker)).toBe(true);
  });

  it('treats an unparseable read timestamp as never read rather than as read', () => {
    const messages = [msg('m1', '2026-07-03T09:00:00Z', { from_admin: true })];
    expect(topicHasNews(topic('f1'), messages, read('not a date'))).toBe(true);
  });
});

describe('topicsWithNews', () => {
  it('counts topics, not messages, and keeps the list order', () => {
    const topics = [topic('f1'), topic('f2', 'done'), topic('f3')];
    const threads = groupAuthorMessages([
      msg('a', '2026-07-04T09:00:00Z', { feedback_id: 'f1', from_admin: true }),
      msg('b', '2026-07-04T10:00:00Z', { feedback_id: 'f1', from_admin: true }),
      msg('c', '2026-07-04T11:00:00Z', { feedback_id: 'f3', from_admin: false }),
    ]);
    const state = new Map([
      ['f1', read('2026-07-01T00:00:00Z', 'in_progress', 'f1')],
      ['f2', read('2026-07-01T00:00:00Z', 'in_progress', 'f2')],
      ['f3', read('2026-07-01T00:00:00Z', 'in_progress', 'f3')],
    ]);
    // f1: two replies, still one topic. f2: shipped since the last look.
    // f3: only the author's own message.
    expect(topicsWithNews(topics, threads, state)).toEqual(['f1', 'f2']);
  });

  it('is empty when everything has been seen', () => {
    const topics = [topic('f1', 'done'), topic('f2', 'declined')];
    const state = new Map([
      ['f1', read('2026-07-05T00:00:00Z', 'done', 'f1')],
      ['f2', read('2026-07-05T00:00:00Z', 'declined', 'f2')],
    ]);
    expect(topicsWithNews(topics, new Map(), state)).toEqual([]);
  });
});

describe('unreadBadgeText', () => {
  it('spells out small counts', () => {
    expect(unreadBadgeText(1)).toBe('1');
    expect(unreadBadgeText(9)).toBe('9');
  });

  it('caps at 9+ so the pill stays a glance', () => {
    expect(unreadBadgeText(10)).toBe('9+');
    expect(unreadBadgeText(120)).toBe('9+');
  });
});
