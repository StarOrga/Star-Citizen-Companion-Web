import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { HangarService } from '../hangar/hangar.service';
import { HangarRoleLoadout, HangarShip, HangarShipConfig } from '../hangar/hangar.types';
import { HqOwnershipService } from './hq-ownership.service';
import { personalItemLink, personalShipLink, hqSet, hqShip } from './hq-routes';

describe('HqOwnershipService', () => {
  const T = '2026-01-01T00:00:00Z';

  function ship(id: string, shipClassName: string, customName: string | null = null): HangarShip {
    return { id, shipClassName, customName, status: 'owned', pinnedRank: null, selectedSkinId: null, notes: null, createdAt: T, updatedAt: T };
  }

  function config(id: string, hangarShipId: string, name: string, isActive: boolean, loadout: HangarShipConfig['loadout']): HangarShipConfig {
    return {
      id, hangarShipId, name, role: 'combat', loadout, isActive, createdAt: T, updatedAt: T,
      sourceConfigId: null, followsOwner: false, ownerUserId: null, forkedAt: null,
    } as HangarShipConfig;
  }

  function set(id: string, name: string, classNames: (string | null)[]): HangarRoleLoadout {
    return {
      id, name, role: 'fps', createdAt: T, updatedAt: T,
      items: classNames.map((className, i) => ({ slot: `s${i}`, className, kind: className ? 'item' : null })),
    };
  }

  let user: ReturnType<typeof signal<{ id: string } | null>>;
  let ships: ReturnType<typeof signal<HangarShip[]>>;
  let sets: ReturnType<typeof signal<HangarRoleLoadout[]>>;
  let configs: HangarShipConfig[];
  let hangar: { ships: typeof ships; roleLoadouts: typeof sets; loadAll: jasmine.Spy; listAllConfigs: jasmine.Spy };

  function make(): HqOwnershipService {
    user = signal<{ id: string } | null>({ id: 'u1' });
    ships = signal<HangarShip[]>([]);
    sets = signal<HangarRoleLoadout[]>([]);
    configs = [];
    hangar = {
      ships,
      roleLoadouts: sets,
      loadAll: jasmine.createSpy('loadAll').and.callFake(async () => {
        ships.set([ship('h1', 'AEGS_Gladius', 'Blade'), ship('h2', 'RSI_Aurora_MR')]);
        sets.set([set('s1', 'Assault', ['BEHR_Rifle_01', 'BEHR_Rifle_01', null]), set('s2', 'Medic', ['behr_rifle_01'])]);
      }),
      listAllConfigs: jasmine.createSpy('listAllConfigs').and.callFake(async () => configs),
    };
    TestBed.configureTestingModule({
      providers: [
        HqOwnershipService,
        { provide: HangarService, useValue: hangar },
        { provide: AuthService, useValue: { user } },
      ],
    });
    return TestBed.inject(HqOwnershipService);
  }

  it('indexes ships, variants, fits and sets by lower-cased class name', async () => {
    const svc = make();
    configs = [
      config('c1', 'h1', 'Stock', false, [{ portName: 'gun_left', className: 'BEHR_LaserCannon_S3', kind: 'weapon' }]),
      config('c2', 'h1', 'PvP', true, [{ portName: 'gun_right', className: 'BEHR_LaserCannon_S3', kind: 'weapon' }]),
      config('c9', 'gone', 'Orphan', false, [{ portName: 'x', className: 'ORPHAN_Item', kind: 'item' }]),
    ];
    await svc.ensureLoaded();

    expect(svc.loaded()).toBeTrue();
    expect(svc.ownsShip('aegs_gladius')).toBeTrue();
    expect(svc.ownsShip('ANVL_Arrow')).toBeFalse();
    expect(svc.ownsShip(null)).toBeFalse();

    const gladius = svc.lookup('AEGS_Gladius')!;
    expect(gladius.configs.map((c) => c.id)).toEqual(['c2', 'c1']); // active first
    expect(gladius.configs[0].active).toBeTrue();

    const cannon = svc.lookup('behr_lasercannon_s3')!;
    expect(cannon.ship).toBeNull();
    expect(cannon.equippedOn.map((e) => [e.configId, e.portName, e.shipName])).toEqual([
      ['c1', 'gun_left', 'Blade'],
      ['c2', 'gun_right', 'Blade'],
    ]);

    // Duplicate pieces in one set count once; case-insensitive across sets.
    expect(svc.lookup('BEHR_Rifle_01')!.inSets).toEqual([
      { setId: 's1', setName: 'Assault' },
      { setId: 's2', setName: 'Medic' },
    ]);
    expect(svc.lookup('ORPHAN_Item')).toBeNull();
    expect(svc.configById('c2')?.name).toBe('PvP');
    expect(svc.configById('nope')).toBeNull();
    expect(svc.configsForShip('h1').map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(svc.shipClassNames().has('rsi_aurora_mr')).toBeTrue();
  });

  it('is idempotent and shares one in-flight load', async () => {
    const svc = make();
    await Promise.all([svc.ensureLoaded(), svc.ensureLoaded()]);
    await svc.ensureLoaded();
    expect(hangar.loadAll).toHaveBeenCalledTimes(1);
    expect(hangar.listAllConfigs).toHaveBeenCalledTimes(1);
  });

  it('skips loadAll when the hangar store is already filled', async () => {
    const svc = make();
    ships.set([ship('h1', 'AEGS_Gladius')]);
    await svc.ensureLoaded();
    expect(hangar.loadAll).not.toHaveBeenCalled();
    expect(hangar.listAllConfigs).toHaveBeenCalledTimes(1);
  });

  it('re-reads configs after invalidate()', async () => {
    const svc = make();
    await svc.ensureLoaded();
    expect(svc.lookup('KLWE_Gun')).toBeNull();
    configs = [config('c3', 'h2', 'New', true, [{ portName: 'nose', className: 'KLWE_Gun', kind: 'weapon' }])];
    svc.invalidate();
    await svc.ensureLoaded();
    expect(hangar.listAllConfigs).toHaveBeenCalledTimes(2);
    expect(svc.lookup('klwe_gun')!.equippedOn[0].configId).toBe('c3');
  });

  it('ownership() is a reactive signal', async () => {
    const svc = make();
    const own = TestBed.runInInjectionContext(() => svc.ownership('ANVL_Arrow'));
    expect(own()).toBeNull();
    ships.set([ship('h3', 'ANVL_Arrow')]);
    expect(own()?.ship?.id).toBe('h3');
  });

  it('does nothing signed out and hides configs of another user', async () => {
    const svc = make();
    configs = [config('c1', 'h1', 'Stock', true, [])];
    await svc.ensureLoaded();
    expect(svc.configs().length).toBe(1);
    user.set({ id: 'u2' });
    expect(svc.configs()).toEqual([]);
    user.set(null);
    hangar.listAllConfigs.calls.reset();
    await svc.ensureLoaded();
    expect(hangar.listAllConfigs).not.toHaveBeenCalled();
  });

  it('records a translated error key and never throws', async () => {
    const svc = make();
    hangar.listAllConfigs.and.rejectWith(new Error('boom'));
    await expectAsync(svc.ensureLoaded()).toBeResolved();
    expect(svc.error()).toMatch(/^errors\./);
    expect(svc.loaded()).toBeFalse();
  });

  it('route helpers build the contract links', () => {
    expect(hqShip('h1')).toEqual(['/hq/hangar', 'h1']);
    expect(hqSet('s1')).toEqual(['/hq/spind', 's1']);
    expect(personalShipLink('AEGS_Gladius', 'c1')).toEqual({ commands: ['/codex/ship', 'AEGS_Gladius'], queryParams: { v: 'c1' } });
    expect(personalItemLink('weapon', 'BEHR_Rifle_01')).toEqual({ commands: ['/codex', 'weapon', 'BEHR_Rifle_01'], queryParams: { mine: '' } });
  });
});
