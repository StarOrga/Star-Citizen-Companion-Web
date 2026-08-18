import { ConfigLoadoutEntry } from '../hangar/hangar.types';
import {
  DraftMap,
  acceptedClassNames,
  beginHydration,
  changedCount,
  decodeDraftParam,
  deleteDraftPaths,
  draftKey,
  encodeDraftParam,
  isNestedPath,
  mergeMapInto,
  mergeSavedLoadout,
  newHydrationEpoch,
  parseLocalDraft,
  restoreDraft,
  selectSaveableEntries,
  serializeLocalDraft,
  setDraftValue,
  setDraftValueForPaths,
  topSegment,
  touchedTopPorts,
} from './codex-loadout-draft';

describe('draftKey / topSegment / isNestedPath', () => {
  it('builds a dotted path only when a child port is given', () => {
    expect(draftKey('hardpoint_weapon_top_left')).toBe('hardpoint_weapon_top_left');
    expect(draftKey('hardpoint_weapon_top_left', 'hardpoint_class_2')).toBe(
      'hardpoint_weapon_top_left.hardpoint_class_2',
    );
  });

  it('reads the top-level segment of either shape', () => {
    expect(topSegment('a')).toBe('a');
    expect(topSegment('a.b')).toBe('a');
  });

  it('flags a nested path', () => {
    expect(isNestedPath('a')).toBe(false);
    expect(isNestedPath('a.b')).toBe(true);
  });
});

describe('setDraftValue / setDraftValueForPaths (03-rules §2.4)', () => {
  it('assigning the stock class again DELETES the override', () => {
    const draft: DraftMap = new Map([['p', 'CUSTOM']]);
    const next = setDraftValue(draft, 'p', 'STOCK', 'STOCK');
    expect(next.has('p')).toBe(false);
  });

  it('item assigned, then the works part again → the entry is deleted, not stored as "unchanged"', () => {
    let draft: DraftMap = new Map();
    draft = setDraftValue(draft, 'p', 'CUSTOM', 'STOCK');
    expect(draft.get('p')).toBe('CUSTOM');
    draft = setDraftValue(draft, 'p', 'STOCK', 'STOCK');
    expect(draft.has('p')).toBe(false);
  });

  it('null (emptied) is distinct from unchanged, and distinct from a stored stock value', () => {
    const draft: DraftMap = new Map();
    const emptied = setDraftValue(draft, 'p', null, 'STOCK');
    expect(emptied.get('p')).toBeNull();
    expect(emptied.has('p')).toBe(true);
  });

  it('emptying an already-empty stock slot is a no-op (nothing changed)', () => {
    const draft: DraftMap = new Map();
    const next = setDraftValue(draft, 'p', null, null);
    expect(next.has('p')).toBe(false);
  });

  it('applies one value to every path a grouped row covers', () => {
    const draft: DraftMap = new Map();
    const stockOf = (): string => 'STOCK';
    const next = setDraftValueForPaths(draft, ['a', 'b', 'c'], 'NEW', stockOf);
    expect([...next.entries()]).toEqual([
      ['a', 'NEW'],
      ['b', 'NEW'],
      ['c', 'NEW'],
    ]);
  });
});

describe('deleteDraftPaths / changedCount', () => {
  it('revert deletes the entry entirely, and the changed count reflects it', () => {
    let draft: DraftMap = new Map([['a', 'X'], ['b', 'Y']]);
    expect(changedCount(draft)).toBe(2);
    draft = deleteDraftPaths(draft, ['a']);
    expect(draft.has('a')).toBe(false);
    expect(changedCount(draft)).toBe(1);
  });

  it('grouped apply then grouped revert clears every member path', () => {
    let draft: DraftMap = new Map();
    draft = setDraftValueForPaths(draft, ['x', 'y', 'z'], 'NEW', () => 'STOCK');
    expect(changedCount(draft)).toBe(3);
    draft = deleteDraftPaths(draft, ['x', 'y', 'z']);
    expect(changedCount(draft)).toBe(0);
  });
});

describe('selectSaveableEntries (R2)', () => {
  const kindOf = (): string => 'weapon';

  it('keeps only top-level, non-emptied, joinable paths', () => {
    const draft: DraftMap = new Map([
      ['hardpoint_weapon_top_left', 'GUN_A'],
      ['hardpoint_weapon_top_left.hardpoint_class_2', 'GUN_B'], // nested — draft-only
      ['hardpoint_weapon_bottom', null], // emptied — draft-only
      ['unknown_port', 'GUN_C'], // not joinable
    ]);
    const joinable = new Set(['hardpoint_weapon_top_left', 'hardpoint_weapon_bottom']);
    const out = selectSaveableEntries(draft, joinable, kindOf);
    expect(out).toEqual([{ portName: 'hardpoint_weapon_top_left', className: 'GUN_A', kind: 'weapon' }]);
  });
});

describe('mergeSavedLoadout (R1)', () => {
  it('preserves foreign entries untouched by this draft', () => {
    const existing: ConfigLoadoutEntry[] = [
      { portName: 'hardpoint_a', className: 'FOREIGN_A', kind: 'weapon' },
      { portName: 'hardpoint_b', className: 'FOREIGN_B', kind: 'component' },
    ];
    const saveable = [{ portName: 'hardpoint_c', className: 'OURS', kind: 'weapon' }];
    const touched = new Set(['hardpoint_c']);
    const merged = mergeSavedLoadout(existing, saveable, touched);
    expect(merged).toEqual([
      { portName: 'hardpoint_a', className: 'FOREIGN_A', kind: 'weapon' },
      { portName: 'hardpoint_b', className: 'FOREIGN_B', kind: 'component' },
      { portName: 'hardpoint_c', className: 'OURS', kind: 'weapon' },
    ]);
  });

  it('upserts a port we already touched instead of duplicating it', () => {
    const existing: ConfigLoadoutEntry[] = [{ portName: 'hardpoint_a', className: 'OLD', kind: 'weapon' }];
    const saveable = [{ portName: 'hardpoint_a', className: 'NEW', kind: 'weapon' }];
    const merged = mergeSavedLoadout(existing, saveable, new Set(['hardpoint_a']));
    expect(merged).toEqual([{ portName: 'hardpoint_a', className: 'NEW', kind: 'weapon' }]);
  });

  it('a reverted (touched but no longer saveable) port is REMOVED from the stored config', () => {
    const existing: ConfigLoadoutEntry[] = [{ portName: 'hardpoint_a', className: 'OLD', kind: 'weapon' }];
    const merged = mergeSavedLoadout(existing, [], new Set(['hardpoint_a']));
    expect(merged).toEqual([]);
  });

  it('touchedTopPorts only names top-level, joinable paths', () => {
    const draft: DraftMap = new Map([
      ['a', 'X'],
      ['a.b', 'Y'],
      ['not-joinable', 'Z'],
    ]);
    expect(touchedTopPorts(draft, new Set(['a']))).toEqual(new Set(['a']));
  });
});

describe('epoch-guarded hydration merge (R6)', () => {
  it('two swaps in flight, the SLOWER one resolves last → the newer class stays resolved', () => {
    const state = newHydrationEpoch();
    const epoch1 = beginHydration(state, ['CLASS_A']);
    const epoch2 = beginHydration(state, ['CLASS_A']); // a second, later swap re-requests it
    expect(epoch2).toBeGreaterThan(epoch1);

    // The SLOWER (epoch1) response resolves last but must be rejected.
    const acceptedOld = acceptedClassNames(state, ['CLASS_A'], epoch1);
    expect(acceptedOld).toEqual([]);

    const acceptedNew = acceptedClassNames(state, ['CLASS_A'], epoch2);
    expect(acceptedNew).toEqual(['CLASS_A']);
  });

  it('merging never clobbers an unrelated class already resolved', () => {
    const base = new Map([['CLASS_A', { hp: 1 }]]);
    const incoming = new Map([['CLASS_B', { hp: 2 }]]);
    const merged = mergeMapInto(base, incoming, ['CLASS_B']);
    expect(merged.get('CLASS_A')).toEqual({ hp: 1 });
    expect(merged.get('CLASS_B')).toEqual({ hp: 2 });
  });

  it('a stale response only writes the keys it was actually accepted for', () => {
    const base = new Map<string, number>();
    const incoming = new Map([['CLASS_A', 1], ['CLASS_B', 2]]);
    const merged = mergeMapInto(base, incoming, ['CLASS_B']); // CLASS_A rejected by epoch check
    expect(merged.has('CLASS_A')).toBe(false);
    expect(merged.get('CLASS_B')).toBe(2);
  });
});

describe('URL draft param (R9)', () => {
  it('round-trips a draft with an emptied slot', () => {
    const draft: DraftMap = new Map([
      ['hardpoint_weapon_top_left', 'GUN_A'],
      ['hardpoint_weapon_bottom', null],
    ]);
    const encoded = encodeDraftParam('build-123', draft);
    expect(encoded).toBeTruthy();
    const decoded = decodeDraftParam(encoded);
    expect(decoded?.buildId).toBe('build-123');
    expect(decoded?.entries).toEqual([
      ['hardpoint_weapon_top_left', 'GUN_A'],
      ['hardpoint_weapon_bottom', null],
    ]);
  });

  it('an empty draft encodes to null — no hash noise', () => {
    expect(encodeDraftParam('build-123', new Map())).toBeNull();
  });

  it('rejects an unknown version instead of misparsing an old link', () => {
    expect(decodeDraftParam('v2.build-123.a~b')).toBeNull();
  });

  it('tolerates garbage without throwing', () => {
    expect(decodeDraftParam('not a valid param')).toBeNull();
    expect(decodeDraftParam(null)).toBeNull();
    expect(decodeDraftParam('')).toBeNull();
  });

  it('restore against the WRONG build flags every class unresolvable', () => {
    const decoded = decodeDraftParam(encodeDraftParam('old-build', new Map([['p', 'GUN_A']]))!)!;
    const restored = restoreDraft(decoded, 'new-build', () => false);
    expect(restored.buildMismatch).toBe(true);
    expect(restored.unresolvable).toEqual(['p']);
    expect(restored.draft.get('p')).toBe('GUN_A'); // kept, visibly unresolvable — never silently dropped
  });

  it('restore against the SAME build with a class the build still resolves is clean', () => {
    const decoded = decodeDraftParam(encodeDraftParam('build-1', new Map([['p', 'GUN_A']]))!)!;
    const restored = restoreDraft(decoded, 'build-1', () => true);
    expect(restored.buildMismatch).toBe(false);
    expect(restored.unresolvable).toEqual([]);
  });
});

describe('localStorage draft mirror', () => {
  it('round-trips through JSON', () => {
    const draft: DraftMap = new Map([['p', 'GUN_A'], ['q', null]]);
    const raw = serializeLocalDraft('CNOU_Nomad', 'build-1', draft);
    const parsed = parseLocalDraft(raw);
    expect(parsed).toEqual({
      shipClassName: 'CNOU_Nomad',
      buildId: 'build-1',
      entries: [['p', 'GUN_A'], ['q', null]],
    });
  });

  it('tolerates malformed/foreign localStorage content', () => {
    expect(parseLocalDraft(null)).toBeNull();
    expect(parseLocalDraft('{"not":"the shape"}')).toBeNull();
    expect(parseLocalDraft('not json at all')).toBeNull();
  });
});
