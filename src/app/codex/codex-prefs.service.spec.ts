import { TestBed } from '@angular/core/testing';
import { CodexPrefsService, SHIP_RANK_SCOPE_KEY } from './codex-prefs.service';

describe('CodexPrefsService', () => {
  afterEach(() => localStorage.removeItem('sc.codex.showNonUsable'));

  it('hides non-usable items by default and remembers the opt-in', () => {
    localStorage.removeItem('sc.codex.showNonUsable');
    const prefs = TestBed.inject(CodexPrefsService);
    expect(prefs.showNonUsable()).toBe(false);
    prefs.setShowNonUsable(true);
    expect(prefs.showNonUsable()).toBe(true);
    expect(localStorage.getItem('sc.codex.showNonUsable')).toBe('1');
    prefs.setShowNonUsable(false);
    expect(localStorage.getItem('sc.codex.showNonUsable')).toBeNull();
  });
});

/**
 * Concept r1-default (holotisch unten, 2026-11-07): the Holotable opens a ship
 * on its narrowest group; a clicked group holds for THAT ship for 12 hours.
 * The host resolves `shipRankScope(ship) ?? narrowestRankScope(...)`, so these
 * four cases are the whole contract.
 */
describe('CodexPrefsService · comparison group per ship (12 h)', () => {
  const HOUR = 60 * 60 * 1000;
  let prefs: CodexPrefsService;
  let clock: number;
  const effective = (ship: string, narrowest: 'role' | 'career' | 'all' = 'role') => prefs.shipRankScope(ship) ?? narrowest;

  beforeEach(() => {
    localStorage.removeItem(SHIP_RANK_SCOPE_KEY);
    TestBed.resetTestingModule();
    prefs = TestBed.inject(CodexPrefsService);
    clock = Date.UTC(2026, 10, 7, 9, 0, 0);
    prefs.now = () => clock;
  });
  afterEach(() => localStorage.removeItem(SHIP_RANK_SCOPE_KEY));

  it('a fresh ship opens on the narrowest group', () => {
    expect(prefs.shipRankScope('AEGS_Gladius')).toBeNull();
    expect(effective('AEGS_Gladius')).toBe('role');
  });

  it('a clicked group is kept when the ship is opened again within 12 hours', () => {
    prefs.setShipRankScope('AEGS_Gladius', 'all');
    clock += 11 * HOUR + 59 * 60 * 1000;
    expect(effective('AEGS_Gladius')).toBe('all');
  });

  it('another ship is not affected by that click', () => {
    prefs.setShipRankScope('AEGS_Gladius', 'all');
    expect(prefs.shipRankScope('ANVL_Arrow')).toBeNull();
    expect(effective('ANVL_Arrow', 'career')).toBe('career');
  });

  it('after 12 hours the ship opens fresh on the narrowest group again', () => {
    prefs.setShipRankScope('AEGS_Gladius', 'all');
    clock += 12 * HOUR;
    expect(prefs.shipRankScope('AEGS_Gladius')).toBeNull();
    expect(effective('AEGS_Gladius')).toBe('role');
  });

  it('drops expired entries of other ships on the next write and ignores junk', () => {
    prefs.setShipRankScope('AEGS_Gladius', 'career');
    clock += 13 * HOUR;
    prefs.setShipRankScope('ANVL_Arrow', 'all');
    const stored = JSON.parse(localStorage.getItem(SHIP_RANK_SCOPE_KEY)!);
    expect(Object.keys(stored)).toEqual(['ANVL_Arrow']);
    localStorage.setItem(SHIP_RANK_SCOPE_KEY, '{"X":{"scope":"bogus","at":1}}');
    expect(prefs.shipRankScope('X')).toBeNull();
  });
});
