import { signal } from '@angular/core';
import { stepsOf, type ItemPathState, type PathResult } from '../../hq/data/item-path.service';

const ok = (key: string): PathResult => ({ ok: true, key, undo: async () => ({ ok: true, key: 'itemPath.done.undone' }) });

/** Empty state of one item; overrides set what a spec needs. */
export function pathState(kind: string, over: Partial<ItemPathState> = {}): ItemPathState {
  return {
    kind,
    className: 'cls',
    wished: false,
    wishQty: 0,
    nachschubQty: 0,
    nachschubUnit: null,
    inventarQty: 0,
    places: [],
    inHangar: false,
    hangarQty: 0,
    hangarShipId: null,
    steps: stepsOf(kind),
    hint: kind === 'upcoming' ? 'notYetInGame' : null,
    signedIn: true,
    ...over,
  };
}

/** A stand-in for ItemPathService: `current` is what every state() reads, each write is a spy. */
export function fakeItemPath(start?: Partial<ItemPathState>) {
  const current = signal<Partial<ItemPathState>>(start ?? {});
  return {
    current,
    state: (kind: string, className: string) => () => ({ ...pathState(kind, { className }), ...current() }),
    ensureLoaded: vi.fn().mockName('ensureLoaded'),
    currentPlaceDefault: () => 'Bei mir',
    knownPlaces: () => ['Area 18'],
    addWish: vi.fn().mockName('addWish').mockResolvedValue(ok('itemPath.done.wishOn')),
    setWishQty: vi.fn().mockName('setWishQty').mockResolvedValue({ ok: true, key: 'itemPath.done.wishQty' }),
    removeWish: vi.fn().mockName('removeWish').mockResolvedValue(ok('itemPath.done.wishOff')),
    moveToInventar: vi.fn().mockName('moveToInventar').mockResolvedValue(ok('itemPath.done.inventar')),
    adjustInventar: vi.fn().mockName('adjustInventar').mockResolvedValue(ok('itemPath.done.inventarOff')),
    removeFromInventar: vi.fn().mockName('removeFromInventar').mockResolvedValue(ok('itemPath.done.inventarOff')),
    nachholen: vi.fn().mockName('nachholen').mockResolvedValue(ok('itemPath.done.wishOn')),
    addToHangar: vi.fn().mockName('addToHangar').mockResolvedValue(ok('itemPath.done.hangar')),
    removeFromHangar: vi.fn().mockName('removeFromHangar').mockResolvedValue({ ok: true, key: 'itemPath.done.hangarOff' }),
    ownedBlueprints: signal<ReadonlySet<string>>(new Set()),
    setBlueprintOwned: vi.fn().mockName('setBlueprintOwned').mockResolvedValue(ok('itemPath.done.inventar')),
  };
}
export type FakeItemPath = ReturnType<typeof fakeItemPath>;
