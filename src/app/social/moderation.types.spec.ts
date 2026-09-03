import {
  clearAccountStatus,
  isMissingFunction,
  isSuspended,
  isValidModerationReason,
  isValidSuspensionDays,
  moderationErrorKey,
  suspensionEnd,
} from './moderation.types';

/**
 * Moderation helpers (migration 20260904020000).
 *
 * The theme of every case below is the same: this feature can take a real
 * user's access away, so "we don't know" must never be readable as "yes".
 */
describe('moderation.types — suspension state', () => {
  it('treats a missing flag as NOT suspended', () => {
    // A client running against a DB without migration 20260904020000 gets
    // rows with no `suspended` field at all. Reading that as suspended would
    // lock the whole instance out during the deploy→migration window.
    expect(isSuspended(undefined)).toBe(false);
    expect(isSuspended(null)).toBe(false);
    expect(isSuspended({})).toBe(false);
    expect(isSuspended({ suspended: null })).toBe(false);
  });

  it('only a literal true counts', () => {
    expect(isSuspended({ suspended: true })).toBe(true);
    expect(isSuspended({ suspended: false })).toBe(false);
  });

  it('reads an indefinite suspension as "no end date", not as "ends now"', () => {
    expect(suspensionEnd({ suspended: true, suspended_until: null })).toBeNull();
  });

  it('parses a real end date and refuses an unparseable one', () => {
    expect(suspensionEnd({ suspended_until: '2026-10-01T00:00:00Z' })?.getUTCMonth()).toBe(9);
    expect(suspensionEnd({ suspended_until: 'nonsense' })).toBeNull();
  });

  it('starts from a clean, non-suspended status object', () => {
    const s = clearAccountStatus();
    expect(s.suspended).toBe(false);
    expect(s.suspension_reason).toBeNull();
    expect(s.warning_id).toBeNull();
  });
});

describe('moderation.types — input guards mirroring the RPC', () => {
  it('requires a non-blank reason', () => {
    // suspend_user()/warn_user() raise `reason_required` on blank, and the
    // reason is what the affected user gets shown — an empty suspension
    // notice would be the worst possible version of this feature.
    expect(isValidModerationReason('')).toBe(false);
    expect(isValidModerationReason('   ')).toBe(false);
    expect(isValidModerationReason('spamming the feedback board')).toBe(true);
  });

  it('refuses a reason past the 2000-char DB constraint', () => {
    expect(isValidModerationReason('x'.repeat(2000))).toBe(true);
    expect(isValidModerationReason('x'.repeat(2001))).toBe(false);
  });

  it('accepts null (indefinite) and the 1…3650 day window only', () => {
    expect(isValidSuspensionDays(null)).toBe(true);
    expect(isValidSuspensionDays(1)).toBe(true);
    expect(isValidSuspensionDays(3650)).toBe(true);
    expect(isValidSuspensionDays(0)).toBe(false);
    expect(isValidSuspensionDays(3651)).toBe(false);
    expect(isValidSuspensionDays(1.5)).toBe(false);
  });
});

describe('moderation.types — error mapping', () => {
  it('maps every RPC code to its own key', () => {
    expect(moderationErrorKey('target_protected')).toBe('admin.moderation.error.protected');
    expect(moderationErrorKey('reason_required')).toBe('admin.moderation.error.reasonRequired');
    expect(moderationErrorKey('invalid_duration')).toBe('admin.moderation.error.invalidDuration');
    expect(moderationErrorKey('forbidden')).toBe('admin.moderation.error.forbidden');
  });

  it('falls back to generic rather than leaking SQL text', () => {
    expect(moderationErrorKey('ERROR: duplicate key value violates …')).toBe(
      'admin.moderation.error.generic',
    );
    expect(moderationErrorKey(null)).toBe('admin.moderation.error.generic');
  });

  it('recognises a not-yet-migrated DB by code and by message', () => {
    expect(isMissingFunction(null, 'PGRST202')).toBe(true);
    expect(isMissingFunction(null, '42883')).toBe(true);
    expect(isMissingFunction('Could not find the function public.my_account_status')).toBe(true);
    expect(isMissingFunction('JWT expired')).toBe(false);
  });
});
