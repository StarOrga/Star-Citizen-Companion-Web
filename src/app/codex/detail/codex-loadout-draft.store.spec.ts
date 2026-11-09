import type { Mock } from 'vitest';
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
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
import type { LoadoutItem } from './codex-detail.types';
import { AUTOSAVE_DEBOUNCE_MS, CodexLoadoutDraftStore } from './codex-loadout-draft.store';

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
    shipByClassName: Mock;
    addShip: Mock;
    listConfigs: Mock;
    createConfig: Mock;
    activateConfig: Mock;
    updateConfig: Mock;
    forkFollowedLoadout: Mock;
  };
  let ensureEditable: Mock;
  let svc: { build: ReturnType<typeof signal>; getEntityPayloads: Mock; resolveEntities: Mock; getAmmoPayloads: Mock };
  let onSaved: Mock;

  beforeEach(() => {
    localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
    queryParams = {};
    hangar = {
      shipByClassName: vi.fn().mockName('shipByClassName').mockReturnValue({ id: 's1' }),
      addShip: vi.fn().mockName('addShip').mockResolvedValue(null),
      listConfigs: vi.fn().mockName('listConfigs').mockResolvedValue([]),
      createConfig: vi.fn().mockName('createConfig').mockResolvedValue({ id: 'c1', loadout: [], isActive: false }),
      activateConfig: vi.fn().mockName('activateConfig').mockResolvedValue(true),
      updateConfig: vi.fn().mockName('updateConfig').mockImplementation(async (id: string, patch: { loadout: unknown }) => ({ id, loadout: patch.loadout })),
      forkFollowedLoadout: vi.fn().mockName('forkFollowedLoadout').mockResolvedValue(null),
    };
    ensureEditable = vi.fn().mockName('ensureEditable').mockResolvedValue('own');
    svc = {
      build: signal({ id: 'B1' }),
      getEntityPayloads: vi.fn().mockName('getEntityPayloads').mockResolvedValue(new Map()),
      resolveEntities: vi.fn().mockName('resolveEntities').mockImplementation(async (names: string[]) => new Map(names.map((n) => [n, entity(n)]))),
      getAmmoPayloads: vi.fn().mockName('getAmmoPayloads').mockResolvedValue(new Map()),
    };
    onSaved = vi.fn().mockName('onSaved');

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
    // The mirror writes the URL; keep the test page where it is.
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
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
    expect(store.isDraftClassPending('BEHR_LaserCannon_S3')).toBe(true);
    expect(svc.getEntityPayloads).toHaveBeenCalledWith(['BEHR_LaserCannon_S3']);
    await new Promise((r) => setTimeout(r));
    expect(store.isDraftClassPending('BEHR_LaserCannon_S3')).toBe(false);
    expect(store.draftResolved().has('BEHR_LaserCannon_S3')).toBe(true);
  });

  it('reverts a path', () => {
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    store.onRevertPaths([PORT]);
    expect(store.draft().has(PORT)).toBe(false);
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

  it('codex mode (no variant) never saves', async () => {
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    expect(await store.saveLoadoutDraft()).toBeNull();
    expect(hangar.listConfigs).not.toHaveBeenCalled();
    expect(hangar.createConfig).not.toHaveBeenCalled();
    expect(hangar.updateConfig).not.toHaveBeenCalled();
  });

  it('a save in personal mode writes into THAT variant and hands the result back', async () => {
    hangar.listConfigs.mockResolvedValue([{ id: 'c1', loadout: [], isActive: true }]);
    store.applyStoredLoadout([], { configId: 'c1' });
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    await store.saveLoadoutDraft();
    expect(hangar.createConfig).not.toHaveBeenCalled();
    expect(hangar.updateConfig).toHaveBeenCalledTimes(1);
    expect(hangar.updateConfig).toHaveBeenCalledWith('c1', expect.anything());
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    expect(store.saveError()).toBeNull();
    expect(store.saving()).toBe(false);
    expect(store.savedPaths().has(PORT)).toBe(true);
  });

  it('adoptToHq creates a NEW variant carrying the draft and never edits an existing one', async () => {
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    const created = await store.adoptToHq();
    expect(created?.id).toBe('c1');
    expect(hangar.createConfig).toHaveBeenCalledTimes(1);
    const [shipId, , , loadout] = vi.mocked(hangar.createConfig).mock.lastCall! as [string, string, string, { portName: string }[]];
    expect(shipId).toBe('s1');
    expect(loadout.map((e) => e.portName)).toContain(PORT);
    expect(hangar.updateConfig).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  it('writes nothing when the fork guard is declined', async () => {
    hangar.listConfigs.mockResolvedValue([{ id: 'c1', loadout: [], isActive: true }]);
    store.applyStoredLoadout([], { configId: 'c1' });
    ensureEditable.mockResolvedValue('cancelled');
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    await store.saveLoadoutDraft();
    expect(hangar.updateConfig).not.toHaveBeenCalled();
    expect(hangar.forkFollowedLoadout).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(store.saveError()).toBeNull();
  });

  // ── stored loadouts on the table (#646) ─────────────────────────────────
  const SHARED = { token: 'tok', ownerName: 'Kestrel', configName: 'Brawler' };

  it('a shared link becomes a READ-ONLY draft: no swap, revert or save, nothing mirrored', async () => {
    const navigate = TestBed.inject(Router).navigate as Mock;
    navigate.mockClear();
    store.applyStoredLoadout(
      [
        { portName: PORT, className: 'BEHR_LaserCannon_S3', kind: 'weapon' },
        // Same as stock = no draft entry; a nested path (D2) comes back like a top-level one.
        { portName: 'hardpoint_other', className: 'KLWE_LaserRepeater_S3', kind: 'weapon' },
        { portName: `${PORT}.sub`, className: 'X', kind: 'weapon' },
      ],
      { readOnly: SHARED },
    );
    expect(store.readOnly()).toBe(true);
    expect(store.readOnlySource()).toEqual(SHARED);
    expect(store.draft().get(PORT)).toBe('BEHR_LaserCannon_S3');
    expect(store.draft().size).toBe(3); // hardpoint_other and the nested sub have no stock → they differ
    expect(svc.getEntityPayloads).toHaveBeenCalledWith(['BEHR_LaserCannon_S3']);
    // Not the reader's draft: neither the URL nor localStorage gets it.
    expect(navigate).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY)).toBeNull();

    store.applySwap(pick('OTHER_GUN'));
    expect(store.draft().get(PORT)).toBe('BEHR_LaserCannon_S3');
    store.onRevertPaths([PORT]);
    expect(store.draft().has(PORT)).toBe(true);
    expect(await store.saveLoadoutDraft()).toBeNull();
    expect(hangar.updateConfig).not.toHaveBeenCalled();

    store.reset();
    expect(store.readOnly()).toBe(false);
  });

  it('an own config (?config=) becomes the draft, counts as saved, and a save writes to THAT config', async () => {
    store.applyStoredLoadout([{ portName: PORT, className: 'BEHR_LaserCannon_S3', kind: 'weapon' }], { configId: 'adopted' });
    expect(store.readOnly()).toBe(false);
    expect(store.draft().get(PORT)).toBe('BEHR_LaserCannon_S3');
    expect(store.savedPaths().has(PORT)).toBe(true);
    hangar.listConfigs.mockResolvedValue([
      { id: 'active-one', loadout: [], isActive: true },
      { id: 'adopted', loadout: [], isActive: false },
    ]);
    store.applySwap(pick('OTHER_GUN'));
    const saved = await store.saveLoadoutDraft();
    expect(hangar.updateConfig).toHaveBeenCalledWith('adopted', expect.anything());
    expect(saved?.id).toBe('adopted');
  });

  it('saveLoadoutDraft resolves the written config, or null when nothing was written', async () => {
    expect(await store.saveLoadoutDraft()).toBeNull(); // nothing to save
    hangar.listConfigs.mockResolvedValue([{ id: 'c1', loadout: [], isActive: true }]);
    store.applyStoredLoadout([], { configId: 'c1' });
    store.applySwap(pick('BEHR_LaserCannon_S3'));
    ensureEditable.mockResolvedValue('cancelled');
    expect(await store.saveLoadoutDraft()).toBeNull();
    ensureEditable.mockResolvedValue('own');
    expect((await store.saveLoadoutDraft())?.id).toBe('c1');
  });

  it('applySavedDraft puts a saved loadout on the table as an unsaved, mirrored draft (#322)', () => {
    const ok = store.applySavedDraft([[PORT, 'PICKED_GUN']], 'B1');
    expect(ok).toBe(true);
    expect(store.draft().get(PORT)).toBe('PICKED_GUN');
    // Same build: a class picked from the swap picker is trusted and hydrated, not flagged.
    expect(store.unresolvableDraftPaths().size).toBe(0);
    expect(svc.resolveEntities).toHaveBeenCalledWith(['PICKED_GUN']);
    expect(store.savedPaths().size).toBe(0);
    expect(localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY)).toContain('PICKED_GUN');
  });

  it('applySavedDraft flags classes of another build that no longer resolve', () => {
    store.applySavedDraft([[PORT, 'GONE_GUN']], 'B0');
    expect(store.unresolvableDraftPaths().has(PORT)).toBe(true);
  });
  // ── nested ports (D2) and autosave on the own exemplar (D3) ─────────────
  function nestedPick(className: string): SwapPick {
    return {
      className,
      target: { port: 'Gun', count: 1, className: null, kind: null, name: null, size: 3, rawPorts: [`${PORT}.gun`] } as SwapTarget,
    };
  }

  it('a nested swap is saved with its dotted path and comes back as a saved draft entry (D2)', async () => {
    hangar.listConfigs.mockResolvedValue([{ id: 'c1', loadout: [], isActive: true }]);
    store.applyStoredLoadout([], { configId: 'c1' });
    store.applySwap(nestedPick('NESTED_GUN'));
    await new Promise((r) => setTimeout(r)); // hydration names the kind
    await store.saveLoadoutDraft();
    expect(hangar.updateConfig).toHaveBeenCalledWith('c1', {
      loadout: [{ portName: `${PORT}.gun`, className: 'NESTED_GUN', kind: 'weapon' }],
    });
    store.reset();
    store.applyStoredLoadout([{ portName: `${PORT}.gun`, className: 'NESTED_GUN', kind: 'weapon' }], { configId: 'c1' });
    expect(store.draft().get(`${PORT}.gun`)).toBe('NESTED_GUN');
    expect(store.savedPaths().has(`${PORT}.gun`)).toBe(true);
  });

  describe('autosave', () => {
    let offer: Mock;
    beforeEach(() => {
      vi.useFakeTimers();
      offer = vi.spyOn(TestBed.inject(UndoToastService), 'offer').mockImplementation(() => undefined) as unknown as Mock;
      hangar.listConfigs.mockResolvedValue([{ id: 'c1', loadout: [{ portName: 'kept', className: 'K', kind: 'item' }], isActive: true }]);
      store.applyStoredLoadout([], { configId: 'c1' });
    });
    afterEach(() => vi.useRealTimers());

    it('off (Werk, the sandbox): a swap writes nothing', async () => {
      store.applySwap(pick('BEHR_LaserCannon_S3'));
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
      expect(hangar.updateConfig).not.toHaveBeenCalled();
    });

    it('on: two quick swaps are ONE save and ONE toast with their count', async () => {
      store.setAutosave(true);
      store.applySwap(pick('BEHR_LaserCannon_S3'));
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS / 2);
      store.applySwap(nestedPick('NESTED_GUN'));
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS / 2);
      expect(hangar.updateConfig).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(hangar.updateConfig).toHaveBeenCalledTimes(1);
      expect(hangar.updateConfig.mock.calls[0][1].loadout).toEqual([
        { portName: 'kept', className: 'K', kind: 'item' },
        { portName: PORT, className: 'BEHR_LaserCannon_S3', kind: 'weapon' },
        { portName: `${PORT}.gun`, className: 'NESTED_GUN', kind: 'weapon' },
      ]);
      expect(offer).toHaveBeenCalledTimes(1);
      expect(offer.mock.calls[0][0]).toMatchObject({ messageKey: 'codex.holo.hangar.autosavedMany', messageParams: { n: 2 } });
    });

    it('a revert back to Werk removes the stored row too', async () => {
      hangar.listConfigs.mockResolvedValue([{ id: 'c1', loadout: [{ portName: PORT, className: 'OLD', kind: 'weapon' }], isActive: true }]);
      store.applyStoredLoadout([{ portName: PORT, className: 'OLD', kind: 'weapon' }], { configId: 'c1' });
      store.setAutosave(true);
      store.onRevertPaths([PORT]);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(hangar.updateConfig).toHaveBeenCalledWith('c1', { loadout: [] });
    });

    it('"Rückgängig" writes the loadout from before the save back and shows it', async () => {
      store.setAutosave(true);
      store.applySwap(pick('BEHR_LaserCannon_S3'));
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      offer.mock.calls[0][0].onUndo();
      await vi.advanceTimersByTimeAsync(0);
      expect(hangar.updateConfig).toHaveBeenLastCalledWith('c1', { loadout: [{ portName: 'kept', className: 'K', kind: 'item' }] });
      expect(store.draft().has(PORT)).toBe(false);
    });

    it('a failed save is shown, never silent, and no toast claims it was saved', async () => {
      hangar.updateConfig.mockResolvedValue(null);
      store.setAutosave(true);
      store.applySwap(pick('BEHR_LaserCannon_S3'));
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(store.saveError()).not.toBeNull();
      expect(offer).not.toHaveBeenCalled();
    });

    it('a new loadout on the table flushes the pending save first', async () => {
      store.setAutosave(true);
      store.applySwap(pick('BEHR_LaserCannon_S3'));
      store.applyStoredLoadout([], { configId: 'c2' });
      await vi.advanceTimersByTimeAsync(0);
      expect(hangar.updateConfig).toHaveBeenCalledTimes(1);
      expect(hangar.updateConfig.mock.calls[0][0]).toBe('c1');
    });
  });
});
