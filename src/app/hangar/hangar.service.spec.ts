import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { AnalyticsService } from '../core/analytics.service';
import { chainArgs, fakeSupabase, FakeCall, FakeResult } from '../testing/fake-supabase';
import { HangarService } from './hangar.service';
import { HangarRoleLoadout, HangarShip, HangarShipConfig } from './hangar.types';

// Hangar write paths (D16 step 5): table, payload, cache and `error` signal for
// each mutation. `error` holds an i18n KEY (D05), never raw backend text.
describe('HangarService writes and loads', () => {
  const failure = { code: '42501', message: 'permission denied for table x' };

  const configRow = (over: Record<string, unknown> = {}) => ({
    id: 'cfg-1',
    hangar_ship_id: 'ship-1',
    name: 'Bounty',
    role: 'combat',
    loadout: [],
    is_active: false,
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
    ...over,
  });
  const setRow = (over: Record<string, unknown> = {}) => ({
    id: 'set-1',
    user_id: 'u1',
    name: 'Recon',
    role: 'fps',
    items: [],
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
    ...over,
  });
  const shipRow = (over: Record<string, unknown> = {}) => ({
    id: 'ship-1',
    user_id: 'u1',
    ship_class_name: 'aegs_gladius',
    custom_name: null,
    status: 'owned',
    pinned_rank: null,
    selected_skin_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00+00:00',
    updated_at: '2026-01-01T00:00:00+00:00',
    ...over,
  });

  let analytics: { capture: jasmine.Spy };

  function setup(answer?: (call: FakeCall) => FakeResult | Promise<FakeResult>, user: { id: string } | null = { id: 'u1' }) {
    const fake = fakeSupabase({ answer });
    analytics = { capture: jasmine.createSpy('capture') };
    TestBed.configureTestingModule({
      providers: [
        HangarService,
        fake.provider,
        { provide: AuthService, useValue: { user: signal(user) } as unknown as AuthService },
        { provide: AnalyticsService, useValue: analytics },
      ],
    });
    return { svc: TestBed.inject(HangarService), calls: fake.calls };
  }

  /** The one call to `table`, failing when there is none or several. */
  const only = (calls: FakeCall[], table: string): FakeCall => {
    const hits = calls.filter((c) => c.target === table);
    expect(hits.length).withContext(`calls to ${table}`).toBe(1);
    return hits[0];
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  describe('createConfig', () => {
    it('inserts the config for the signed-in user and returns the mapped row', async () => {
      const { svc, calls } = setup(() => ({ data: configRow({ loadout: [{ port: 'a' }] }) }));

      const created = await svc.createConfig('ship-1', 'Bounty', 'combat', [{ port: 'a' } as never]);

      const call = only(calls, 'hangar_ship_configs');
      expect(chainArgs(call, 'insert')).toEqual([
        { user_id: 'u1', hangar_ship_id: 'ship-1', name: 'Bounty', role: 'combat', loadout: [{ port: 'a' }] },
      ]);
      expect(created?.id).toBe('cfg-1');
      expect(created?.hangarShipId).toBe('ship-1');
      expect(svc.error()).toBeNull();
    });

    it('defaults to an empty loadout', async () => {
      const { svc, calls } = setup(() => ({ data: configRow() }));
      await svc.createConfig('ship-1', 'Bounty', 'combat');
      expect((chainArgs(only(calls, 'hangar_ship_configs'), 'insert')![0] as { loadout: unknown }).loadout).toEqual([]);
    });

    it('returns null and sets an error key when the insert fails', async () => {
      const { svc } = setup(() => ({ error: failure }));

      expect(await svc.createConfig('ship-1', 'Bounty', 'combat')).toBeNull();
      expect(svc.error()).toBe('errors.forbidden');
    });

    it('returns null without a query when signed out', async () => {
      const { svc, calls } = setup(undefined, null);

      expect(await svc.createConfig('ship-1', 'Bounty', 'combat')).toBeNull();
      expect(calls).toEqual([]);
    });
  });

  describe('updateConfig', () => {
    it('writes only the given fields, scoped to the id', async () => {
      const { svc, calls } = setup(() => ({ data: configRow({ name: 'Renamed' }) }));

      const updated = await svc.updateConfig('cfg-1', { name: 'Renamed' });

      const call = only(calls, 'hangar_ship_configs');
      expect(chainArgs(call, 'update')).toEqual([{ name: 'Renamed' }]);
      expect(chainArgs(call, 'eq')).toEqual(['id', 'cfg-1']);
      expect(updated?.name).toBe('Renamed');
      expect(analytics.capture).toHaveBeenCalledWith('hangar_ship_config_saved', { role: 'combat' });
    });

    it('sends role and loadout when given', async () => {
      const { svc, calls } = setup(() => ({ data: configRow() }));
      await svc.updateConfig('cfg-1', { role: 'mining', loadout: [] });
      expect(chainArgs(only(calls, 'hangar_ship_configs'), 'update')).toEqual([{ role: 'mining', loadout: [] }]);
    });

    it('returns null, sets an error key and records no analytics event on failure', async () => {
      const { svc } = setup(() => ({ error: failure }));

      expect(await svc.updateConfig('cfg-1', { name: 'x' })).toBeNull();
      expect(svc.error()).toBe('errors.forbidden');
      expect(analytics.capture).not.toHaveBeenCalled();
    });
  });

  describe('deleteConfig', () => {
    it('deletes by id and reports true', async () => {
      const { svc, calls } = setup();

      expect(await svc.deleteConfig('cfg-1')).toBeTrue();

      const call = only(calls, 'hangar_ship_configs');
      expect(call.chain.map(([m]) => m)).toContain('delete');
      expect(chainArgs(call, 'eq')).toEqual(['id', 'cfg-1']);
      expect(svc.error()).toBeNull();
    });

    it('reports false and sets an error key on failure', async () => {
      const { svc } = setup(() => ({ error: failure }));

      expect(await svc.deleteConfig('cfg-1')).toBeFalse();
      expect(svc.error()).toBe('errors.forbidden');
    });
  });

  describe('createRoleLoadout', () => {
    it('inserts the set, puts it first in the cache and records the event', async () => {
      const { svc, calls } = setup(() => ({ data: setRow({ id: 'set-2', name: 'New' }) }));
      svc.roleLoadouts.set([{ id: 'set-1' } as HangarRoleLoadout]);

      const created = await svc.createRoleLoadout('New', 'fps');

      expect(chainArgs(only(calls, 'hangar_role_loadouts'), 'insert')).toEqual([
        { user_id: 'u1', name: 'New', role: 'fps', items: [] },
      ]);
      expect(created?.id).toBe('set-2');
      expect(svc.roleLoadouts().map((l) => l.id)).toEqual(['set-2', 'set-1']);
      expect(analytics.capture).toHaveBeenCalledWith('hangar_loadout_created', { role: 'fps' });
    });

    it('returns null, leaves the cache alone and sets an error key on failure', async () => {
      const { svc } = setup(() => ({ error: failure }));
      svc.roleLoadouts.set([{ id: 'set-1' } as HangarRoleLoadout]);

      expect(await svc.createRoleLoadout('New', 'fps')).toBeNull();
      expect(svc.roleLoadouts().map((l) => l.id)).toEqual(['set-1']);
      expect(svc.error()).toBe('errors.forbidden');
    });

    it('returns null without a query when signed out', async () => {
      const { svc, calls } = setup(undefined, null);
      expect(await svc.createRoleLoadout('New', 'fps')).toBeNull();
      expect(calls).toEqual([]);
    });
  });

  describe('updateRoleLoadout', () => {
    it('renames only the name and replaces the cached set in place', async () => {
      const { svc, calls } = setup(() => ({ data: setRow({ id: 'set-2', name: 'Renamed' }) }));
      svc.roleLoadouts.set([{ id: 'set-1', name: 'A' } as HangarRoleLoadout, { id: 'set-2', name: 'B' } as HangarRoleLoadout]);

      const updated = await svc.updateRoleLoadout('set-2', { name: 'Renamed' });

      const call = only(calls, 'hangar_role_loadouts');
      expect(chainArgs(call, 'update')).toEqual([{ name: 'Renamed' }]);
      expect(chainArgs(call, 'eq')).toEqual(['id', 'set-2']);
      expect(updated?.name).toBe('Renamed');
      expect(svc.roleLoadouts().map((l) => l.name)).toEqual(['A', 'Renamed']);
    });

    it('returns null, keeps the cache and sets an error key on failure', async () => {
      const { svc } = setup(() => ({ error: failure }));
      svc.roleLoadouts.set([{ id: 'set-1', name: 'A' } as HangarRoleLoadout]);

      expect(await svc.updateRoleLoadout('set-1', { name: 'x' })).toBeNull();
      expect(svc.roleLoadouts()[0].name).toBe('A');
      expect(svc.error()).toBe('errors.forbidden');
    });
  });

  describe('deleteRoleLoadout', () => {
    it('deletes by id and drops the set from the cache', async () => {
      const { svc, calls } = setup();
      svc.roleLoadouts.set([{ id: 'set-1' } as HangarRoleLoadout, { id: 'set-2' } as HangarRoleLoadout]);

      expect(await svc.deleteRoleLoadout('set-1')).toBeTrue();

      const call = only(calls, 'hangar_role_loadouts');
      expect(call.chain.map(([m]) => m)).toContain('delete');
      expect(chainArgs(call, 'eq')).toEqual(['id', 'set-1']);
      expect(svc.roleLoadouts().map((l) => l.id)).toEqual(['set-2']);
    });

    it('reports false, keeps the cache and sets an error key on failure', async () => {
      const { svc } = setup(() => ({ error: failure }));
      svc.roleLoadouts.set([{ id: 'set-1' } as HangarRoleLoadout]);

      expect(await svc.deleteRoleLoadout('set-1')).toBeFalse();
      expect(svc.roleLoadouts().map((l) => l.id)).toEqual(['set-1']);
      expect(svc.error()).toBe('errors.forbidden');
    });
  });

  describe('createShareLink', () => {
    const config = {
      id: 'cfg-1',
      name: 'Bounty',
      role: 'combat',
      loadout: [{ port: 'a' }],
    } as unknown as HangarShipConfig;

    it('inserts a snapshot of the config with channel, patch and expiry', async () => {
      const { svc, calls } = setup(() => ({
        data: { id: 'link-1', token: 'tok', ship_class_name: 'aegs_gladius', channel: 'LIVE', patch_version: '4.3', loadout: [{ port: 'a' }] },
      }));

      const link = await svc.createShareLink(config, 'aegs_gladius', 'LIVE', '4.3', '2027-01-01T00:00:00Z');

      expect(chainArgs(only(calls, 'hangar_share_links'), 'insert')).toEqual([
        {
          created_by: 'u1',
          ship_class_name: 'aegs_gladius',
          channel: 'LIVE',
          patch_version: '4.3',
          loadout: [{ port: 'a' }],
          config_name: 'Bounty',
          role: 'combat',
          source_config_id: 'cfg-1',
          expires_at: '2027-01-01T00:00:00Z',
        },
      ]);
      expect(link?.token).toBe('tok');
    });

    it('never expires by default', async () => {
      const { svc, calls } = setup(() => ({ data: { id: 'l', token: 't' } }));
      await svc.createShareLink(config, 'aegs_gladius', 'LIVE', '4.3');
      expect((chainArgs(only(calls, 'hangar_share_links'), 'insert')![0] as { expires_at: unknown }).expires_at).toBeNull();
    });

    it('returns null and sets an error key on failure', async () => {
      const { svc } = setup(() => ({ error: failure }));

      expect(await svc.createShareLink(config, 'aegs_gladius', 'LIVE', '4.3')).toBeNull();
      expect(svc.error()).toBe('errors.forbidden');
    });

    it('returns null without a query when signed out', async () => {
      const { svc, calls } = setup(undefined, null);
      expect(await svc.createShareLink(config, 'aegs_gladius', 'LIVE', '4.3')).toBeNull();
      expect(calls).toEqual([]);
    });
  });

  describe('updateShip', () => {
    const cached = (over: Partial<HangarShip> = {}) =>
      ({ id: 'ship-1', shipClassName: 'aegs_gladius', status: 'owned', customName: null, ...over }) as HangarShip;

    it('maps the patch to columns, scopes it to the id and swaps the cached ship', async () => {
      const { svc, calls } = setup(() => ({ data: shipRow({ custom_name: 'Ace', status: 'wishlist', notes: 'n', selected_skin_id: 's1' }) }));
      svc.ships.set([cached()]);

      const ok = await svc.updateShip('ship-1', { customName: 'Ace', status: 'wishlist', notes: 'n', selectedSkinId: 's1' });

      const call = only(calls, 'hangar_ships');
      expect(chainArgs(call, 'update')).toEqual([
        { custom_name: 'Ace', status: 'wishlist', selected_skin_id: 's1', notes: 'n' },
      ]);
      expect(chainArgs(call, 'eq')).toEqual(['id', 'ship-1']);
      expect(ok).toBeTrue();
      expect(svc.ships()[0].customName).toBe('Ace');
      expect(svc.ships()[0].status).toBe('wishlist');
    });

    it('sends an explicit null (clearing a field) but leaves absent keys out', async () => {
      const { svc, calls } = setup(() => ({ data: shipRow() }));
      await svc.updateShip('ship-1', { customName: null });
      expect(chainArgs(only(calls, 'hangar_ships'), 'update')).toEqual([{ custom_name: null }]);
    });

    it('reports false, keeps the cache and sets an error key on failure', async () => {
      const { svc } = setup(() => ({ error: failure }));
      svc.ships.set([cached()]);

      expect(await svc.updateShip('ship-1', { notes: 'x' })).toBeFalse();
      expect(svc.ships()[0].customName).toBeNull();
      expect(svc.error()).toBe('errors.forbidden');
    });
  });

  describe('loadAll', () => {
    const answerAll = (call: FakeCall): FakeResult => {
      switch (call.target) {
        case 'hangar_ships':
          return { data: [shipRow()] };
        case 'hangar_role_loadouts':
          return { data: [setRow()] };
        case 'hangar_concept_ships':
          return { data: [{ id: 'c1', name: 'Idris' }] };
        default:
          return { data: { flagship_ship_class: null } };
      }
    };

    it('fills ships, sets and concept ships from their tables', async () => {
      const { svc, calls } = setup(answerAll);

      await svc.loadAll();

      expect(svc.ships().map((s) => s.id)).toEqual(['ship-1']);
      expect(svc.roleLoadouts().map((l) => l.id)).toEqual(['set-1']);
      expect(svc.conceptShips().map((c) => c.name)).toEqual(['Idris']);
      expect(calls.filter((c) => c.target === 'hangar_ships').length).toBe(1);
      expect(svc.loading()).toBeFalse();
      expect(svc.error()).toBeNull();
    });

    it('sets an error key and clears loading when the ships query fails', async () => {
      const { svc } = setup((call) => (call.target === 'hangar_ships' ? { error: failure } : answerAll(call)));

      await svc.loadAll();

      expect(svc.error()).toBe('errors.forbidden');
      expect(svc.loading()).toBeFalse();
      expect(svc.ships()).toEqual([]);
    });

    it('does not fail the hangar when only the concept table is missing', async () => {
      const { svc } = setup((call) => (call.target === 'hangar_concept_ships' ? { error: failure } : answerAll(call)));

      await svc.loadAll();

      expect(svc.error()).toBeNull();
      expect(svc.ships().length).toBe(1);
      expect(svc.conceptShips()).toEqual([]);
    });

    it('clears a previous error on the next load', async () => {
      let fail = true;
      const { svc } = setup((call) => (fail && call.target === 'hangar_ships' ? { error: failure } : answerAll(call)));
      await svc.loadAll();
      expect(svc.error()).not.toBeNull();

      fail = false;
      await svc.loadAll();

      expect(svc.error()).toBeNull();
    });

    it('bundles two concurrent calls into one round trip', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const { svc, calls } = setup(async (call) => {
        if (call.target === 'hangar_ships') await gate;
        return answerAll(call);
      });

      const first = svc.loadAll();
      const second = svc.loadAll();
      expect(second).toBe(first);
      release();
      await Promise.all([first, second]);

      expect(calls.filter((c) => c.target === 'hangar_ships').length).toBe(1);
      expect(calls.filter((c) => c.target === 'hangar_role_loadouts').length).toBe(1);
    });

    it('queries again once the first load has settled', async () => {
      const { svc, calls } = setup(answerAll);
      await svc.loadAll();
      await svc.loadAll();
      expect(calls.filter((c) => c.target === 'hangar_ships').length).toBe(2);
    });
  });

  describe('ensureConceptShipsLoaded', () => {
    const conceptAnswer = (call: FakeCall): FakeResult =>
      call.target === 'hangar_concept_ships' ? { data: [{ id: 'c1', name: 'Idris' }] } : { data: null };

    it('reads the concept table only and fills the cache', async () => {
      const { svc, calls } = setup(conceptAnswer);

      await svc.ensureConceptShipsLoaded();

      expect(calls.map((c) => c.target)).toEqual(['hangar_concept_ships']);
      expect(svc.conceptShips().map((c) => c.name)).toEqual(['Idris']);
    });

    it('is idempotent once loaded for this user', async () => {
      const { svc, calls } = setup(conceptAnswer);
      await svc.ensureConceptShipsLoaded();
      await svc.ensureConceptShipsLoaded();
      expect(calls.length).toBe(1);
    });

    it('bundles two concurrent calls into one query', async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const { svc, calls } = setup(async (call) => {
        await gate;
        return conceptAnswer(call);
      });

      const first = svc.ensureConceptShipsLoaded();
      const second = svc.ensureConceptShipsLoaded();
      expect(second).toBe(first);
      release();
      await Promise.all([first, second]);

      expect(calls.length).toBe(1);
    });

    it('degrades silently on failure — no error banner, and it retries next time', async () => {
      let fail = true;
      const { svc, calls } = setup((call) => (fail ? { error: failure } : conceptAnswer(call)));

      await svc.ensureConceptShipsLoaded();
      expect(svc.error()).toBeNull();
      expect(svc.conceptShips()).toEqual([]);

      fail = false;
      await svc.ensureConceptShipsLoaded();
      expect(calls.length).toBe(2);
      expect(svc.conceptShips().length).toBe(1);
    });

    it('does nothing when signed out', async () => {
      const { svc, calls } = setup(conceptAnswer, null);
      await svc.ensureConceptShipsLoaded();
      expect(calls).toEqual([]);
    });
  });
});
