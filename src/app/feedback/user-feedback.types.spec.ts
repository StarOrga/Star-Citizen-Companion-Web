import {
  AuthorFeedbackMessage,
  coarseAuthorStatus,
  groupAuthorMessages,
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
