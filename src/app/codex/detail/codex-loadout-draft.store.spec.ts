import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarService } from '../../hangar/hangar.service';
import { CodexDetail, CodexService, ResolvedEntity } from '../codex.service';
import {
  LOCAL_DRAFT_STORAGE_KEY,
  encodeDraftParam,
  serializeLocalDraft,
} from '../codex-loadout-draft';
import type { SwapPick, SwapTarget } from '../codex-swap-picker.component';
import { CodexHoloForkGuard } from '../holo/codex-holo-fork-guard';
import type { LoadoutItem } from './codex-detail.types';
import { CodexLoadoutDraftStore } from './codex-loadout-draft.store';

const PORT = 'hardpoint_weapon_top_left';
const SHIP: CodexDetail = {
  classNameSlug: 'cnou_nomad',
  kind: 'ship',
  row: {},
  payload: { defaultLoadout: [] },
  ports: [{ portName: PORT } as CodexDetail['ports'][number]],
  strings: [],
};

function entity(className: string): ResolvedEntity {
  return { kind: 'weapon', className } as ResolvedEntity;
}

describe('CodexLoadoutDraftStore', () => {
  let store: CodexLoadoutDraftStore;
  let queryParams: Record<string, string>;
  let hangar: {
    shipByClassName: jasmine.Spy;
    addShip: jasmine.Spy;
    listConfigs: jasmine.Spy;
    createConfig: jasmine.Spy;
    activateConfig: jasmine.Spy;
    updateConfig: jasmine.Spy;
    forkFollowedLoadout: jasmine.Spy;
  };
  let ensureEditable: jasmine.Spy;
  let svc: { build: ReturnType<typeof signal>; getEntityPayloads: jasmine.Spy; resolveEntities: jasmine.Spy; getAmmoPayloads: jasmine.Spy };
  let onSaved: jasmine.Spy;

  beforeEach(() => {
    localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
    queryParams = {};
    hangar = {
      shipByClassName: jasmine.createSpy('shipByClassName').and.returnValue({ id: 's1' }),
      addShip: jasmine.createSpy('addShip').and.resolveTo(null),
      listConfigs: jasmine.createSpy('listConfigs').and.resolveTo([]),
      createConfig: jasmine.createSpy('createConfig').and.resolveTo({ id: 'c1', loadout: [], isActive: false }),
      activateConfig: jasmine.createSpy('activateConfig').and.resolveTo(true),
      updateConfig: jasmine
        .createSpy('updateConfig')
        .and.callFake(async (id: string, patch: { loadout: unknown }) => ({ id, loadout: patch.loadout })),
      forkFollowedLoadout: jasmine.createSpy('forkFollowedLoadout').and.resolveTo(null),
    };
    ensureEditable = jasmine.createSpy('ensureEditable').and.resolveTo('own');
    svc = {
      build: signal({ id: 'B1' }),
      getEntityPayloads: jasmine.createSpy('getEntityPayloads').and.resolveTo(new Map()),
      resolveEntities: jasmine
        .createSpy('resolveEntities')
        .and.callFake(async (names: string[]) => new Map(names.map((n) => [n, entity(n)]))),
      getAmmoPayloads: jasmine.createSpy('getAmmoPayloads').and.resolveTo(new Map()),
    };
    onSaved = jasmine.createSpy('onSaved');

    TestBed.configureTestingModule({
      providers: [
        CodexLoadoutDraftStore,
        provideRouter([]),
        provideTranslateService(),
        { provide: CodexService, useValue: svc as unknown as CodexService },
        { provide: HangarService, useValue: hangar as unknown as HangarService },
        { provide: CodexHoloForkGuard, useValue: { ensureEditable } as unknown as CodexHoloForkGuard },
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { queryParamMap: convertToParamMap(queryParams) };
            },
          },
        },
      ],
    });
    // The mirror writes the URL; keep the Karma page where it is.
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    store = TestBed.inject(CodexLoadoutDraftStore);
    const stock: LoadoutItem = {
      port: PORT,
      className: 'KLWE_LaserRepeater_S3',
      kind: 'weapon',
      name: null,
      size: 3,
      grade: null,
      manufacturerCode: null,
      carried: new Map(),
    };
    store.connect({
      detail: signal<CodexDetail | null>(SHIP),
      loadoutEntities: signal(new Map([['URL_GUN', entity('URL_GUN')], ['LOCAL_GUN', entity('LOCAL_GUN')]])),
      loadoutAll: signal([stock]),
      joinablePorts: signal<ReadonlySet<string>>(new Set([PORT])),
      onSaved,
    });
  });

  afterEach(() => localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY));

  function pick(className: string | null): SwapPick {
    return {
      className,
      target: { port: 'Weapon', count: 1, className: null, kind: null, name: null, size: 3, rawPorts: [PORT] } as SwapTarget,
    };
  }

  it('drafts the swapped class on the path and hydrates it', async () => {
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    expect(store.draft().get(PORT)).toBe('BEHR_LaserCannon_S3');
    expect(store.draftChangedCount()).toBe(1);
    expect(store.isDraftClassPending('BEHR_LaserCannon_S3')).toBeTrue();
    expect(svc.getEntityPayloads).toHaveBeenCalledWith(['BEHR_LaserCannon_S3']);
    await new Promise((r) => setTimeout(r));
    expect(store.isDraftClassPending('BEHR_LaserCannon_S3')).toBeFalse();
    expect(store.draftResolved().has('BEHR_LaserCannon_S3')).toBeTrue();
  });

  it('reverts a path', () => {
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    store.onRevertPaths([PORT]);
    expect(store.draft().has(PORT)).toBeFalse();
    expect(store.draftChangedCount()).toBe(0);
  });

  it('discard empties everything and forgets the stored draft', () => {
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    expect(localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY)).not.toBeNull();
    store.discardLoadoutDraft();
    expect(store.draft().size).toBe(0);
    expect(store.saveError()).toBeNull();
    expect(localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('restores from the URL before localStorage', () => {
    localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, serializeLocalDraft('cnou_nomad', 'B1', new Map([[PORT, 'LOCAL_GUN']])));
    queryParams = { loadout: encodeDraftParam('B1', new Map([[PORT, 'URL_GUN']]))! };
    store.restoreDraftFromUrlOrStorage('cnou_nomad');
    expect(store.draft().get(PORT)).toBe('URL_GUN');
  });

  it('restores from localStorage when the URL carries no draft', () => {
    localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, serializeLocalDraft('cnou_nomad', 'B1', new Map([[PORT, 'LOCAL_GUN']])));
    store.restoreDraftFromUrlOrStorage('cnou_nomad');
    expect(store.draft().get(PORT)).toBe('LOCAL_GUN');
  });

  it('creates and activates a config when the ship has none, then hands the result back', async () => {
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    await store.saveLoadoutDraft();
    expect(hangar.createConfig).toHaveBeenCalledTimes(1);
    expect(hangar.activateConfig).toHaveBeenCalledWith('c1', 's1');
    expect(hangar.updateConfig).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: 'c1' }));
    expect(store.saveError()).toBeNull();
    expect(store.saving()).toBeFalse();
    expect(store.savedPaths().has(PORT)).toBeTrue();
  });

  it('writes nothing when the fork guard is declined', async () => {
    ensureEditable.and.resolveTo('cancelled');
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    await store.saveLoadoutDraft();
    expect(hangar.updateConfig).not.toHaveBeenCalled();
    expect(hangar.forkFollowedLoadout).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(store.saveError()).toBeNull();
  });
});
