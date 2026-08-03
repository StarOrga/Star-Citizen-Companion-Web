import { Role, ViewAs, VIEW_RANK, clampViewAs, impersonationTargets, isViewAs } from './impersonation-policy';

const ACTUAL_VALUES: readonly (Role | null)[] = [null, 'viewer', 'collaborator', 'admin'];

// Deliberately includes malformed / adversarial storage payloads: wrong
// case, whitespace, unrelated strings, and non-string JSON-parsed shapes.
const STORED_VALUES: readonly unknown[] = [
  null,
  undefined,
  '',
  'anon',
  'viewer',
  'collaborator',
  'admin',
  'ADMIN',
  ' admin',
  'owner',
  0,
  {},
  [],
];

describe('impersonationTargets', () => {
  it('is empty for viewer', () => {
    expect(impersonationTargets('viewer')).toEqual([]);
  });

  it('is empty for null (not loaded / signed out)', () => {
    expect(impersonationTargets(null)).toEqual([]);
  });

  it('returns strictly weaker views for collaborator', () => {
    expect(impersonationTargets('collaborator')).toEqual(['viewer', 'anon']);
  });

  it('returns strictly weaker views for admin', () => {
    expect(impersonationTargets('admin')).toEqual(['collaborator', 'viewer', 'anon']);
  });

  it('never includes admin as a target for any actual role', () => {
    for (const actual of ACTUAL_VALUES) {
      expect(impersonationTargets(actual)).not.toContain('admin');
    }
  });

  it('only ever returns members strictly weaker than actual', () => {
    for (const actual of ACTUAL_VALUES) {
      const actualRank = actual === null ? Infinity : VIEW_RANK[actual];
      for (const target of impersonationTargets(actual)) {
        expect(VIEW_RANK[target]).toBeLessThan(actualRank);
      }
    }
  });
});

describe('isViewAs', () => {
  it('accepts exactly the four canonical strings', () => {
    expect(isViewAs('admin')).toBe(true);
    expect(isViewAs('collaborator')).toBe(true);
    expect(isViewAs('viewer')).toBe(true);
    expect(isViewAs('anon')).toBe(true);
  });

  it('rejects case variants, whitespace, and non-strings', () => {
    expect(isViewAs('ADMIN')).toBe(false);
    expect(isViewAs(' admin')).toBe(false);
    expect(isViewAs('owner')).toBe(false);
    expect(isViewAs(null)).toBe(false);
    expect(isViewAs(undefined)).toBe(false);
    expect(isViewAs(0)).toBe(false);
    expect(isViewAs({})).toBe(false);
    expect(isViewAs([])).toBe(false);
  });
});

describe('clampViewAs — exhaustive security matrix', () => {
  // No (actual, stored) pair may ever produce a result at or above the
  // actual role's rank. This is the load-bearing invariant of the whole
  // feature: a tampered/stale sessionStorage value can never raise the
  // ceiling set by the live DB-derived role.
  for (const actual of ACTUAL_VALUES) {
    for (const stored of STORED_VALUES) {
      it(`actual=${JSON.stringify(actual)} stored=${JSON.stringify(stored)} never elevates`, () => {
        const result = clampViewAs(actual, stored);
        if (result === null) {
          expect(result).toBeNull();
          return;
        }
        const actualRank = actual === null ? -1 : VIEW_RANK[actual];
        // null actual must never produce a non-null result at all.
        expect(actual).not.toBeNull();
        expect(VIEW_RANK[result as ViewAs]).toBeLessThan(actualRank);
      });
    }
  }

  it('rejects a stored admin value regardless of actual role', () => {
    for (const actual of ACTUAL_VALUES) {
      expect(clampViewAs(actual, 'admin')).toBeNull();
    }
  });

  it('is always null when actual is null, for every stored value', () => {
    for (const stored of STORED_VALUES) {
      expect(clampViewAs(null, stored)).toBeNull();
    }
  });

  it('is always null when actual is viewer, for every stored value', () => {
    for (const stored of STORED_VALUES) {
      expect(clampViewAs('viewer', stored)).toBeNull();
    }
  });

  it('accepts valid weaker targets for collaborator', () => {
    expect(clampViewAs('collaborator', 'viewer')).toBe('viewer');
    expect(clampViewAs('collaborator', 'anon')).toBe('anon');
    expect(clampViewAs('collaborator', 'collaborator')).toBeNull();
  });

  it('accepts valid weaker targets for admin', () => {
    expect(clampViewAs('admin', 'collaborator')).toBe('collaborator');
    expect(clampViewAs('admin', 'viewer')).toBe('viewer');
    expect(clampViewAs('admin', 'anon')).toBe('anon');
    expect(clampViewAs('admin', 'admin')).toBeNull();
  });
});
