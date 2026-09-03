import {
  FriendEdgeRow,
  REPORT_REASON_MAX,
  edgeInitial,
  edgeLabel,
  friendErrorKey,
  groupFriendEdges,
  isValidHandle,
  isValidReportReason,
} from './friends.types';

function edge(kind: string, id: string, username: string | null = null): FriendEdgeRow {
  return {
    kind: kind as FriendEdgeRow['kind'],
    request_id: kind === 'incoming' || kind === 'outgoing' ? `req-${id}` : null,
    user_id: id,
    display_name: null,
    username,
    since: '2026-09-01T10:00:00Z',
  };
}

describe('friends.types — grouping the flat RPC result', () => {
  it('splits every kind into its own bucket', () => {
    const graph = groupFriendEdges([
      edge('friend', 'a'),
      edge('incoming', 'b'),
      edge('outgoing', 'c'),
      edge('blocked', 'd'),
      edge('friend', 'e'),
    ]);

    expect(graph.friends.map((e) => e.user_id)).toEqual(['a', 'e']);
    expect(graph.incoming.map((e) => e.user_id)).toEqual(['b']);
    expect(graph.outgoing.map((e) => e.user_id)).toEqual(['c']);
    expect(graph.blocked.map((e) => e.user_id)).toEqual(['d']);
  });

  it('drops an unknown kind instead of throwing', () => {
    // A client one deploy behind a future migration must still render the
    // buckets it understands rather than blanking the page.
    const graph = groupFriendEdges([edge('friend', 'a'), edge('pen-pal', 'x')]);
    expect(graph.friends.length).toBe(1);
    expect(graph.incoming.length + graph.outgoing.length + graph.blocked.length).toBe(0);
  });

  it('yields four empty buckets for an empty result', () => {
    const graph = groupFriendEdges([]);
    expect(graph).toEqual({ friends: [], incoming: [], outgoing: [], blocked: [] });
  });
});

describe('friends.types — labels', () => {
  it('prefers the handle over the display name', () => {
    expect(edgeLabel({ username: 'nova', display_name: 'Nova Prime' })).toBe('nova');
  });

  it('falls back to the display name, then to a dash — never to a uuid', () => {
    expect(edgeLabel({ username: null, display_name: 'Nova Prime' })).toBe('Nova Prime');
    expect(edgeLabel({ username: null, display_name: null })).toBe('—');
  });

  it('produces a single uppercase initial, and "?" when there is no name', () => {
    expect(edgeInitial({ username: 'nova', display_name: null })).toBe('N');
    expect(edgeInitial({ username: null, display_name: null })).toBe('?');
  });
});

describe('friends.types — client-side validation', () => {
  it('accepts only handles set_username() would accept', () => {
    expect(isValidHandle('nova')).toBeTrue();
    expect(isValidHandle('  nova_7  ')).toBeTrue();
    expect(isValidHandle('no')).toBeFalse();
    expect(isValidHandle('a'.repeat(21))).toBeFalse();
    expect(isValidHandle('nova prime')).toBeFalse();
    expect(isValidHandle('nova@rsi')).toBeFalse();
  });

  it('mirrors the reason length the DB constraint enforces', () => {
    expect(isValidReportReason('a'.repeat(REPORT_REASON_MAX))).toBeTrue();
    expect(isValidReportReason('a'.repeat(REPORT_REASON_MAX + 1))).toBeFalse();
  });
});

describe('friends.types — error mapping', () => {
  it('maps every RPC error code onto its own i18n key', () => {
    expect(friendErrorKey('blocked')).toBe('friends.error.blocked');
    expect(friendErrorKey('user_not_found')).toBe('friends.error.userNotFound');
    expect(friendErrorKey('request_not_found')).toBe('friends.error.requestNotFound');
    expect(friendErrorKey('no_relation')).toBe('friends.error.noRelation');
    expect(friendErrorKey('report_limit')).toBe('friends.error.reportLimit');
  });

  it('never leaks a raw message — anything unknown is the generic key', () => {
    expect(friendErrorKey('duplicate key value violates unique constraint "x"')).toBe(
      'friends.error.generic',
    );
    expect(friendErrorKey(null)).toBe('friends.error.generic');
    expect(friendErrorKey(undefined)).toBe('friends.error.generic');
  });
});
