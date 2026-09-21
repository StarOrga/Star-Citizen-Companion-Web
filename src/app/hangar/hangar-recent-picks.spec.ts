import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { HangarService } from './hangar.service';
import { HangarRoleLoadout, HangarShip } from './hangar.types';

/**
 * "Recently chosen" facility backing the codex landing HangarPicker fly-out
 * (implement-brief.md §17): top 3 ships/sets, most recent first, with a
 * fallback to the first 3 hangar entries when nothing was picked yet.
 */
describe('HangarService recent picks', () => {
  const USER_ID = 'user-abc';

  function ship(id: string, shipClassName: string): HangarShip {
    return {
      id,
      shipClassName,
      customName: null,
      status: 'owned',
      pinnedRank: null,
      selectedSkinId: null,
      notes: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
  }

  function roleLoadout(id: string, name: string): HangarRoleLoadout {
    return { id, name, role: 'fps', items: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  }

  function makeService(): HangarService {
    const auth = { user: signal({ id: USER_ID }) } as unknown as AuthService;
    const sb = { client: {} } as unknown as SupabaseClientProvider;
    TestBed.configureTestingModule({
      providers: [
        HangarService,
        { provide: AuthService, useValue: auth },
        { provide: SupabaseClientProvider, useValue: sb },
      ],
    });
    return TestBed.inject(HangarService);
  }

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('falls back to the first 3 hangar ships when nothing was picked', () => {
    const svc = makeService();
    const ships = [ship('1', 'AEGS_Gladius'), ship('2', 'ANVL_Arrow'), ship('3', 'DRAK_Cutlass_Black'), ship('4', 'ORIG_300i')];
    (svc as unknown as { ships: { set: (v: HangarShip[]) => void } }).ships.set(ships);
    expect(svc.recentShips().map((s) => s.shipClassName)).toEqual([
      'AEGS_Gladius',
      'ANVL_Arrow',
      'DRAK_Cutlass_Black',
    ]);
  });

  it('markShipPicked moves a ship to the front, most recent first, deduped', () => {
    const svc = makeService();
    const ships = [ship('1', 'AEGS_Gladius'), ship('2', 'ANVL_Arrow'), ship('3', 'DRAK_Cutlass_Black')];
    (svc as unknown as { ships: { set: (v: HangarShip[]) => void } }).ships.set(ships);

    svc.markShipPicked('DRAK_Cutlass_Black');
    svc.markShipPicked('AEGS_Gladius');
    expect(svc.recentShips().map((s) => s.shipClassName)).toEqual(['AEGS_Gladius', 'DRAK_Cutlass_Black']);

    // Re-picking an already-recent ship moves it to the front instead of duplicating it.
    svc.markShipPicked('DRAK_Cutlass_Black');
    expect(svc.recentShips().map((s) => s.shipClassName)).toEqual(['DRAK_Cutlass_Black', 'AEGS_Gladius']);
  });

  it('caps recent ships at 3', () => {
    const svc = makeService();
    const ships = [ship('1', 'A'), ship('2', 'B'), ship('3', 'C'), ship('4', 'D')];
    (svc as unknown as { ships: { set: (v: HangarShip[]) => void } }).ships.set(ships);
    svc.markShipPicked('A');
    svc.markShipPicked('B');
    svc.markShipPicked('C');
    svc.markShipPicked('D');
    expect(svc.recentShips().map((s) => s.shipClassName)).toEqual(['D', 'C', 'B']);
  });

  it('persists recent ship picks across service instances (localStorage)', () => {
    const svc = makeService();
    const ships = [ship('1', 'AEGS_Gladius'), ship('2', 'ANVL_Arrow')];
    (svc as unknown as { ships: { set: (v: HangarShip[]) => void } }).ships.set(ships);
    svc.markShipPicked('ANVL_Arrow');

    TestBed.resetTestingModule();
    const svc2 = makeService();
    (svc2 as unknown as { ships: { set: (v: HangarShip[]) => void } }).ships.set(ships);
    expect(svc2.recentShips().map((s) => s.shipClassName)).toEqual(['ANVL_Arrow']);
  });

  it('falls back to the first 3 role loadouts ("sets") when nothing was picked', () => {
    const svc = makeService();
    const sets = [roleLoadout('1', 'FixIt'), roleLoadout('2', 'Mining'), roleLoadout('3', 'Medical'), roleLoadout('4', 'Salvage')];
    (svc as unknown as { roleLoadouts: { set: (v: HangarRoleLoadout[]) => void } }).roleLoadouts.set(sets);
    expect(svc.recentSets().map((s) => s.name)).toEqual(['FixIt', 'Mining', 'Medical']);
  });

  it('markSetPicked moves a set to the front, most recent first, deduped', () => {
    const svc = makeService();
    const sets = [roleLoadout('1', 'FixIt'), roleLoadout('2', 'Mining'), roleLoadout('3', 'Medical')];
    (svc as unknown as { roleLoadouts: { set: (v: HangarRoleLoadout[]) => void } }).roleLoadouts.set(sets);

    svc.markSetPicked('3');
    svc.markSetPicked('1');
    expect(svc.recentSets().map((s) => s.id)).toEqual(['1', '3']);

    svc.markSetPicked('3');
    expect(svc.recentSets().map((s) => s.id)).toEqual(['3', '1']);
  });

  it('a no-op pick (empty id) is ignored', () => {
    const svc = makeService();
    svc.markShipPicked('');
    svc.markSetPicked('');
    expect(svc.recentShips()).toEqual([]);
    expect(svc.recentSets()).toEqual([]);
  });
});
