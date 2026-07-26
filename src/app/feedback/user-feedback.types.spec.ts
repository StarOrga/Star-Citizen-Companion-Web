import {
  AuthorFeedbackMessage,
  authorStatusOf,
  coarseAuthorStatus,
  groupAuthorMessages,
  hasPendingAuthorQuestion,
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

describe('hasPendingAuthorQuestion', () => {
  it('is false without any messages', () => {
    expect(hasPendingAuthorQuestion(undefined)).toBe(false);
    expect(hasPendingAuthorQuestion([])).toBe(false);
  });

  it('is true while an admin question is the last word', () => {
    const thread = [
      msg('m1', '2026-07-01T09:00:00Z', { from_admin: true }),
      msg('m2', '2026-07-02T09:00:00Z', { from_admin: true, is_question: true }),
    ];
    expect(hasPendingAuthorQuestion(thread)).toBe(true);
  });

  it('falls back once the author answered', () => {
    const thread = [
      msg('m1', '2026-07-02T09:00:00Z', { from_admin: true, is_question: true }),
      msg('m2', '2026-07-02T10:00:00Z', { from_admin: false }),
    ];
    expect(hasPendingAuthorQuestion(thread)).toBe(false);
  });

  it('ignores a plain admin note that is not a question', () => {
    const thread = [msg('m1', '2026-07-02T09:00:00Z', { from_admin: true, is_question: false })];
    expect(hasPendingAuthorQuestion(thread)).toBe(false);
  });
});

describe('coarseAuthorStatus', () => {
  it('hides the routine’s needs_input behind "in Bearbeitung"', () => {
    // The admin insisted on this one: needs_input is the routine asking the
    // ADMIN. The feedback author must never see it as a question aimed at them.
    expect(coarseAuthorStatus('needs_input', false)).toBe('in_progress');
  });

  it('maps every active status to in_progress', () => {
    for (const s of ['open', 'in_progress', 'needs_input', 'issue_created'] as const) {
      expect(coarseAuthorStatus(s, false)).toBe('in_progress');
    }
  });

  it('surfaces only an admin question to the author', () => {
    expect(coarseAuthorStatus('open', true)).toBe('question');
    expect(coarseAuthorStatus('needs_input', true)).toBe('question');
  });

  it('maps shipped to done', () => {
    expect(coarseAuthorStatus('shipped', false)).toBe('done');
  });

  it('maps declined and legacy rejected to declined', () => {
    expect(coarseAuthorStatus('declined', false)).toBe('declined');
    expect(coarseAuthorStatus('rejected', false)).toBe('declined');
  });

  it('lets a terminal status win over a stale unanswered question', () => {
    expect(coarseAuthorStatus('shipped', true)).toBe('done');
    expect(coarseAuthorStatus('declined', true)).toBe('declined');
  });
});

describe('authorStatusOf', () => {
  it('derives the pending question from the channel', () => {
    const pending = [msg('m1', '2026-07-02T09:00:00Z', { from_admin: true, is_question: true })];
    expect(authorStatusOf('in_progress', pending)).toBe('question');
    expect(authorStatusOf('in_progress', [])).toBe('in_progress');
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
});
