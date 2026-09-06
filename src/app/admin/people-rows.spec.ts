import {
  mergePeopleRows,
  type PeopleAccountLike,
  type PeopleInviteLike,
} from './people-rows';

describe('mergePeopleRows', () => {
  const account = (email: string, id = email): PeopleAccountLike => ({
    id,
    email,
    role: 'viewer',
    created_at: '2026-09-01T00:00:00Z',
  });
  const invite = (email: string, joined = false): PeopleInviteLike => ({
    email,
    role: 'collaborator',
    created_at: '2026-09-02T00:00:00Z',
    joined,
  });

  it('lists every account exactly once', () => {
    const rows = mergePeopleRows([account('a@x.test'), account('b@x.test')], []);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.user !== null && r.invite === null)).toBe(true);
  });

  it('adds an open invitation as its own row', () => {
    const rows = mergePeopleRows([], [invite('new@x.test')]);
    expect(rows.length).toBe(1);
    expect(rows[0].user).toBeNull();
    expect(rows[0].invite?.email).toBe('new@x.test');
    expect(rows[0].role).toBe('collaborator');
    expect(rows[0].since).toBe('2026-09-02T00:00:00Z');
  });

  // The whole point of the consolidation: a consumed invitation is the same
  // person as the account it produced, so it must not double the list.
  it('drops an invitation the RPC already reports as joined', () => {
    const rows = mergePeopleRows([account('joined@x.test')], [invite('joined@x.test', true)]);
    expect(rows.length).toBe(1);
    expect(rows[0].user).not.toBeNull();
  });

  it('drops an invitation whose account exists even if joined is still false', () => {
    const rows = mergePeopleRows([account('fresh@x.test')], [invite('fresh@x.test', false)]);
    expect(rows.length).toBe(1);
    expect(rows[0].invite).toBeNull();
  });

  it('matches the account regardless of address casing', () => {
    const rows = mergePeopleRows([account('Mixed@X.test')], [invite('mixed@x.TEST')]);
    expect(rows.length).toBe(1);
  });

  it('keeps row keys unique across accounts and invitations', () => {
    const rows = mergePeopleRows([account('a@x.test', 'id-1')], [invite('b@x.test')]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows[0].key).toBe('id-1');
    expect(rows[1].key).toBe('invite:b@x.test');
  });
});
