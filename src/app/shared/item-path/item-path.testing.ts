import { signal } from '@angular/core';
import { stepsOf, type ItemPathState, type PathResult } from '../../hq/data/item-path.service';

const ok = (key: string): PathResult => ({ ok: true, key, undo: async () => ({ ok: true, key: 'itemPath.done.undone' }) });

/** Empty state of one item; overrides set what a spec needs. */
export function pathState(kind: string, over: Partial<ItemPathState> = {}): ItemPathState {
  return {
    kind,
    className: 'cls',
    wished: false,
    nachschubQty: 0,
    inventarQty: 0,
    places: [],
    inHangar: false,
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
    ensureLoaded: jasmine.createSpy('ensureLoaded'),
    currentPlaceDefault: () => 'Bei mir',
    knownPlaces: () => ['Area 18'],
    addWish: jasmine.createSpy('addWish').and.resolveTo(ok('itemPath.done.wishOn')),
    removeWish: jasmine.createSpy('removeWish').and.resolveTo(ok('itemPath.done.wishOff')),
    addToNachschub: jasmine.createSpy('addToNachschub').and.resolveTo(ok('itemPath.done.nachschub')),
    changeNachschubQty: jasmine.createSpy('changeNachschubQty').and.returnValue(ok('itemPath.done.qty')),
    removeFromNachschub: jasmine.createSpy('removeFromNachschub').and.returnValue(ok('itemPath.done.nachschubOff')),
    moveToInventar: jasmine.createSpy('moveToInventar').and.resolveTo(ok('itemPath.done.inventar')),
    adjustInventar: jasmine.createSpy('adjustInventar').and.resolveTo(ok('itemPath.done.inventarOff')),
    removeFromInventar: jasmine.createSpy('removeFromInventar').and.resolveTo(ok('itemPath.done.inventarOff')),
    addToHangar: jasmine.createSpy('addToHangar').and.resolveTo(ok('itemPath.done.hangar')),
    removeFromHangar: jasmine.createSpy('removeFromHangar').and.resolveTo({ ok: true, key: 'itemPath.done.hangarOff' }),
  };
}
export type FakeItemPath = ReturnType<typeof fakeItemPath>;

/** Sign-in is answered by the spec: signed in unless it says otherwise. */
export function fakeSignIn(answer = true) {
  return { ensure: jasmine.createSpy('ensure').and.resolveTo(answer) };
}
