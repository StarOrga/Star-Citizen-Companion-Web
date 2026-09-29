import { AuthorFeedbackMessage } from '../../feedback/user-feedback.types';
import { BoardDelta, BoardState, applyBoardDelta, sinceFrom } from './feedback-delta';
import { FeedbackMessage, FeedbackRow } from './feedback.types';

function topic(id: string, created: string, updated = created): FeedbackRow {
  return {
    id,
    author_id: null,
    body: `topic ${id}`,
    status: 'open',
    ship_ref: null,
    processing_note: null,
    created_at: created,
    updated_at: updated,
    shipped_at: null,
    processed_at: null,
    author: null,
  };
}

function msg(id: string, feedbackId: string, created: string): FeedbackMessage {
  return { id, feedback_id: feedbackId, author_id: null, is_system: false, body: id, created_at: created, author: null };
}

function amsg(id: string, feedbackId: string, created: string): AuthorFeedbackMessage {
  return { id, feedback_id: feedbackId, author_id: null, from_admin: true, is_question: false, body: id, created_at: created };
}

const T = (min: number): string => `2026-09-28T12:${String(min).padStart(2, '0')}:00+00:00`;

function delta(over: Partial<BoardDelta>): BoardDelta {
  return {
    now: T(30),
    full: false,
    topics: [],
    messages: [],
    author_messages: [],
    topic_ids: [],
    message_count: 0,
    author_message_count: 0,
    ...over,
  };
}

/** A board with topics a, b; replies m1 (a), m2 (b); one author message x1 (a). */
function baseState(): BoardState {
  return applyBoardDelta(
    null,
    delta({
      full: true,
      topics: [topic('a', T(1)), topic('b', T(2))],
      messages: [msg('m1', 'a', T(3)), msg('m2', 'b', T(4))],
      author_messages: [amsg('x1', 'a', T(5))],
      topic_ids: ['a', 'b'],
      message_count: 2,
      author_message_count: 1,
    }),
  ).state;
}

/** The delta envelope that matches baseState() with nothing new in it. */
const quiet = (over: Partial<BoardDelta> = {}): BoardDelta =>
  delta({ topic_ids: ['a', 'b'], message_count: 2, author_message_count: 1, ...over });

describe('applyBoardDelta', () => {
  it('replaces everything on a full snapshot', () => {
    const prev = baseState();
    const r = applyBoardDelta(
      prev,
      delta({ full: true, topics: [topic('c', T(9))], topic_ids: ['c'] }),
    );
    expect(r.changed).toBeTrue();
    expect(r.consistent).toBeTrue();
    expect(r.state.topics.map((t) => t.id)).toEqual(['c']);
    expect(r.state.threads.size).toBe(0);
    expect(r.state.authorMessages).toEqual([]);
  });

  it('keeps the same state for a full snapshot equal to it (quiet 10-min resync)', () => {
    const prev = baseState();
    const r = applyBoardDelta(
      prev,
      quiet({
        full: true,
        topics: [topic('a', T(1)), topic('b', T(2))],
        messages: [msg('m1', 'a', T(3)), msg('m2', 'b', T(4))],
        author_messages: [amsg('x1', 'a', T(5))],
      }),
    );
    expect(r.changed).toBeFalse();
    expect(r.state).toBe(prev);
  });

  it('replaces a changed topic and appends a new one, ordered by created_at', () => {
    const prev = baseState();
    const changedA = { ...topic('a', T(1), T(20)), status: 'in_progress' as const };
    const r = applyBoardDelta(
      prev,
      quiet({ topics: [topic('c', T(0)), changedA], topic_ids: ['a', 'b', 'c'] }),
    );
    expect(r.changed).toBeTrue();
    expect(r.consistent).toBeTrue();
    expect(r.state.topics.map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(r.state.topics[1].status).toBe('in_progress');
    // The previous state is never mutated.
    expect(prev.topics.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('sorts a new reply into the right thread', () => {
    const prev = baseState();
    const r = applyBoardDelta(
      prev,
      quiet({ messages: [msg('m0', 'a', T(2)), msg('m9', 'b', T(25))], message_count: 4 }),
    );
    expect(r.changed).toBeTrue();
    expect(r.consistent).toBeTrue();
    expect(r.state.threads.get('a')!.map((m) => m.id)).toEqual(['m0', 'm1']);
    expect(r.state.threads.get('b')!.map((m) => m.id)).toEqual(['m2', 'm9']);
    expect(prev.threads.get('a')!.map((m) => m.id)).toEqual(['m1']);
    // Only messages changed — the topics array keeps its reference.
    expect(r.state.topics).toBe(prev.topics);
  });

  it('adds a new author message to the flat list', () => {
    const prev = baseState();
    const r = applyBoardDelta(prev, quiet({ author_messages: [amsg('x2', 'b', T(26))], author_message_count: 2 }));
    expect(r.changed).toBeTrue();
    expect(r.state.authorMessages.map((a) => a.id)).toEqual(['x1', 'x2']);
  });

  it('removes a topic missing from topic_ids together with its thread and author messages', () => {
    const prev = baseState();
    const r = applyBoardDelta(prev, delta({ topic_ids: ['b'], message_count: 1, author_message_count: 0 }));
    expect(r.changed).toBeTrue();
    expect(r.consistent).toBeTrue();
    expect(r.state.topics.map((t) => t.id)).toEqual(['b']);
    expect(r.state.threads.has('a')).toBeFalse();
    expect(r.state.authorMessages).toEqual([]);
  });

  it('reports inconsistent when a count no longer adds up (a deleted reply)', () => {
    const prev = baseState();
    expect(applyBoardDelta(prev, quiet({ message_count: 1 })).consistent).toBeFalse();
    expect(applyBoardDelta(prev, quiet({ author_message_count: 0 })).consistent).toBeFalse();
  });

  it('reports inconsistent when a live topic id is unknown (a missed topic)', () => {
    const prev = baseState();
    expect(applyBoardDelta(prev, quiet({ topic_ids: ['a', 'b', 'z'] })).consistent).toBeFalse();
  });

  it('an empty delta changes nothing and keeps the references', () => {
    const prev = baseState();
    const r = applyBoardDelta(prev, quiet());
    expect(r.changed).toBeFalse();
    expect(r.consistent).toBeTrue();
    expect(r.state).toBe(prev);
    expect(r.state.topics).toBe(prev.topics);
    expect(r.state.threads).toBe(prev.threads);
    expect(r.state.authorMessages).toBe(prev.authorMessages);
  });

  it('the 30 s overlap re-delivering known rows is no change', () => {
    const prev = baseState();
    const r = applyBoardDelta(
      prev,
      quiet({
        topics: [topic('b', T(2))],
        messages: [msg('m2', 'b', T(4))],
        author_messages: [amsg('x1', 'a', T(5))],
      }),
    );
    expect(r.changed).toBeFalse();
    expect(r.state).toBe(prev);
    expect(r.state.topics).toBe(prev.topics);
    expect(r.state.threads).toBe(prev.threads);
    expect(r.state.authorMessages).toBe(prev.authorMessages);
  });
});

describe('sinceFrom', () => {
  it('subtracts the 30 s overlap', () => {
    expect(sinceFrom('2026-09-28T12:00:30.000Z')).toBe('2026-09-28T12:00:00.000Z');
  });

  it('reads the Postgres timestamptz format the RPC returns', () => {
    expect(sinceFrom('2026-09-28T12:00:30.123456+00:00')).toBe('2026-09-28T12:00:00.123Z');
  });
});
