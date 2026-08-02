import {
  isDeleteBlocked,
  isProtectedAccount,
  isRoleChangeBlocked,
  type ProtectableUser,
} from './admin-protection';

describe('admin-protection', () => {
  const founder: ProtectableUser = { role: 'admin', protected: true };
  const plainAdmin: ProtectableUser = { role: 'admin', protected: false };
  const legacyRow = { role: 'viewer' } as ProtectableUser; // pre-migration payload

  it('flags only rows the RPC reports as protected', () => {
    expect(isProtectedAccount(founder)).toBe(true);
    expect(isProtectedAccount(plainAdmin)).toBe(false);
    expect(isProtectedAccount(legacyRow)).toBe(false);
  });

  it('blocks every role change on a protected account, demotion or not', () => {
    expect(isRoleChangeBlocked(founder, 'viewer')).toBe(true);
    expect(isRoleChangeBlocked(founder, 'collaborator')).toBe(true);
  });

  it('does not report a no-op role change as blocked', () => {
    expect(isRoleChangeBlocked(founder, 'admin')).toBe(false);
  });

  it('leaves ordinary admins fully manageable', () => {
    expect(isRoleChangeBlocked(plainAdmin, 'viewer')).toBe(false);
    expect(isDeleteBlocked(plainAdmin)).toBe(false);
  });

  it('blocks deletion of a protected account', () => {
    expect(isDeleteBlocked(founder)).toBe(true);
  });
});
