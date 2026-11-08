import {
  Nachschub,
  OpenLine,
  WishPosition,
  addToWishlist,
  archive,
  autoArchive,
  blueprintMaterialWishes,
  clampName,
  clearNachschub,
  evaluateNachschub,
  followAnnounced,
  gameStatus,
  ingameSources,
  nextShipCopies,
  followBlueprintQty,
  freeSlot,
  isFinished,
  lineStatus,
  newNachschubBlock,
  nachschubProgress,
  positionKey,
  reactivate,
  takeFromWishlist,
  wishNodeClick,
  withBaseline,
} from './nachschub.model';

const nach = (id: string, slot: number | null, status: Nachschub['status'] = 'active'): Nachschub => ({
  id,
  name: id,
  status,
  slot,
  snapshot: {},
  createdAt: '2026-11-07T10:00:00Z',
  archivedAt: null,
});
const w = (className: string, qty: number, forClassName?: string): WishPosition => ({ kind: 'item', className, name: className, qty, forClassName });

describe('nachschub.model', () => {
  describe('slots', () => {
    it('hands out the lowest free slot and fills gaps', () => {
      expect(freeSlot([])).toBe(1);
      expect(freeSlot([nach('a', 1), nach('b', 3)])).toBe(2);
    });

    it('an archived Nachschub holds no slot', () => {
      expect(freeSlot([nach('a', null, 'archived'), nach('b', 1)])).toBe(2);
    });

    it('blocks a new Nachschub with a reason once all 7 slots are active', () => {
      const all = [1, 2, 3, 4, 5, 6, 7].map((s) => nach(`n${s}`, s));
      expect(freeSlot(all)).toBeNull();
      expect(newNachschubBlock(all)).toBe('hq.nachschub.slotsFull');
      expect(newNachschubBlock(all.slice(1))).toBeNull();
    });

    it('archive frees the slot and reactivate takes the lowest free one', () => {
      const all = [1, 2, 3, 4, 5, 6, 7].map((s) => nach(`n${s}`, s));
      const archived = archive(all[2], '2026-11-08T00:00:00Z');
      expect(archived.slot).toBeNull();
      expect(archived.status).toBe('archived');
      const next = all.map((n) => (n.id === 'n3' ? archived : n));
      expect(reactivate(all, 'n3')).toBeNull(); // nothing archived / no slot free
      expect(reactivate(next, 'n3')?.slot).toBe(3);
    });
  });

  describe('clampName', () => {
    it('keeps short names, cuts at a word boundary, never splits a code point', () => {
      expect(clampName('  Rattler  Vorrat ', 28)).toBe('Rattler Vorrat');
      expect(clampName('Rattler-Raketen und Magazine fuer Vanguard', 28).length).toBeLessThanOrEqual(28);
      expect(Array.from(clampName('😀'.repeat(40), 28)).length).toBe(28);
    });
  });

  describe('takeFromWishlist', () => {
    const wish = [w('rattler', 20), w('medpen', 3)];

    it('takes the full quantity by default', () => {
      const r = takeFromWishlist(wish, [{ key: positionKey(wish[0]) }]);
      expect(r.taken).toEqual([{ ...wish[0], qty: 20 }]);
      expect(r.remaining).toEqual([wish[1]]);
    });

    it('splits: 5 of 20 move, 15 stay', () => {
      const r = takeFromWishlist(wish, [{ key: positionKey(wish[0]), qty: 5 }]);
      expect(r.taken[0].qty).toBe(5);
      expect(r.remaining.find((x) => x.className === 'rattler')?.qty).toBe(15);
    });

    it('caps at the wished quantity and ignores unknown keys and zero', () => {
      const r = takeFromWishlist(wish, [{ key: positionKey(wish[1]), qty: 99 }, { key: 'item:nope' }, { key: positionKey(wish[0]), qty: 0 }]);
      expect(r.taken.map((t) => [t.className, t.qty])).toEqual([['medpen', 3]]);
      expect(r.remaining.map((x) => x.className)).toEqual(['rattler']);
    });

    it('keeps material for two blueprints apart', () => {
      const a = w('aluminium', 2, 'gallant');
      const b = w('aluminium', 3, 'p4ar');
      expect(positionKey(a)).not.toBe(positionKey(b));
      const r = takeFromWishlist([a, b], [{ key: positionKey(b) }]);
      expect(r.taken).toEqual([b]);
      expect(r.remaining).toEqual([a]);
    });
  });

  describe('followBlueprintQty', () => {
    it('shrinks the blueprint count with the largest share taken', () => {
      expect(followBlueprintQty(4, [0.5, 0.25])).toBe(2);
      expect(followBlueprintQty(4, [1])).toBe(4);
      expect(followBlueprintQty(3, [0.1])).toBe(1);
      expect(followBlueprintQty(2, [])).toBe(2);
    });
  });

  describe('addToWishlist', () => {
    it('counts up an existing position and appends a new one', () => {
      const base = [w('rattler', 2)];
      expect(addToWishlist(base, w('rattler', 3))[0].qty).toBe(5);
      expect(addToWishlist(base, w('medpen', 1)).length).toBe(2);
      expect(addToWishlist([w('x', 998)], w('x', 5))[0].qty).toBe(999);
    });
  });

  describe('wishNodeClick', () => {
    it('adds 1 on an empty node, opens the cart on a filled one', () => {
      expect(wishNodeClick(0)).toBe('add');
      expect(wishNodeClick(1)).toBe('openCart');
    });
  });

  describe('lineStatus (closing)', () => {
    const line = { id: 'l1', need: 2, ticked: false };

    it('does not close without a baseline and asks for one', () => {
      const s = lineStatus(line, {}, 7);
      expect(s.closed).toBeFalse();
      expect(s.baseline).toBeNull();
      expect(withBaseline({}, 'l1', 7)).toEqual({ l1: 7 });
    });

    it('does not close on time alone, nor on a partial rise', () => {
      expect(lineStatus(line, { l1: 5 }, 5).closed).toBeFalse();
      const part = lineStatus(line, { l1: 5 }, 6);
      expect(part.closed).toBeFalse();
      expect(part.rise).toBe(1);
    });

    it('closes when the inventory rose by the need (manual or SCC-App, both raise the stock)', () => {
      const s = lineStatus(line, { l1: 5 }, 7);
      expect(s.closed).toBeTrue();
      expect(s.by).toBe('inventory');
    });

    it('a manual tick closes regardless', () => {
      expect(lineStatus({ ...line, ticked: true }, { l1: 5 }, 5)).toEqual(jasmine.objectContaining({ closed: true, by: 'tick' }));
    });

    it('a fall of the stock never closes and never goes negative', () => {
      expect(lineStatus(line, { l1: 5 }, 1)).toEqual(jasmine.objectContaining({ closed: false, rise: 0 }));
    });

    it('works for exact SCU amounts and for a ship line counted in the Hangar', () => {
      expect(lineStatus({ id: 'm', need: 0.36, ticked: false }, { m: 1 }, 1.36).closed).toBeTrue();
      expect(lineStatus({ id: 's', need: 1, ticked: false }, { s: 0 }, 1).closed).toBeTrue();
    });

    it('keeps an existing baseline', () => {
      expect(withBaseline({ l1: 5 }, 'l1', 99)).toEqual({ l1: 5 });
    });
  });

  describe('finish and auto-archive', () => {
    it('is finished only with lines and all closed', () => {
      expect(isFinished([])).toBeFalse();
      expect(isFinished([{ closed: true }, { closed: false }])).toBeFalse();
      expect(isFinished([{ closed: true }, { closed: true }])).toBeTrue();
      expect(nachschubProgress([{ closed: true }, { closed: false }])).toEqual({ done: 1, total: 2 });
    });

    it('archives finished active Nachschuebe on their own and frees the slots', () => {
      const all = [nach('a', 1), nach('b', 2)];
      const next = autoArchive(all, new Set(['a']), '2026-11-08T00:00:00Z');
      expect(next[0]).toEqual(jasmine.objectContaining({ status: 'archived', slot: null }));
      expect(next[1]).toBe(all[1]);
      expect(freeSlot(next)).toBe(1);
    });
  });

  describe('clearNachschub', () => {
    const lines: OpenLine[] = [
      { id: '1', kind: 'item', className: 'rattler', name: 'Rattler', qty: 4, closed: false },
      { id: '2', kind: 'item', className: 'medpen', name: 'Medpen', qty: 2, closed: true },
    ];

    it('returns the open lines to the wishlist and counts up', () => {
      const r = clearNachschub(lines, [w('rattler', 1)], true);
      expect(r.removeIds).toEqual(['1']);
      expect(r.wishlist.find((x) => x.className === 'rattler')?.qty).toBe(5);
      expect(r.wishlist.some((x) => x.className === 'medpen')).toBeFalse();
    });

    it('drops them entirely without the checkbox', () => {
      const wishlist = [w('rattler', 1)];
      const r = clearNachschub(lines, wishlist, false);
      expect(r.removeIds).toEqual(['1']);
      expect(r.wishlist).toBe(wishlist);
    });
  });

  describe('blueprintMaterialWishes', () => {
    it('groups material under the blueprint, multiplied and rounded up', () => {
      const out = blueprintMaterialWishes('gallant', [
        { className: 'agricium', name: 'Agricium', perBlueprint: 0.36 },
        { className: 'alu', name: 'Aluminium', perBlueprint: 2 },
        { className: '', name: 'ghost', perBlueprint: 1 },
      ], 3);
      expect(out.map((o) => [o.className, o.qty, o.forClassName])).toEqual([
        ['agricium', 2, 'gallant'],
        ['alu', 6, 'gallant'],
      ]);
    });
  });

  describe('evaluateNachschub', () => {
    const lines = [
      { id: 'a', need: 2, ticked: false, ship: false, className: 'rattler' },
      { id: 'b', need: 1, ticked: false, ship: true, className: 'vanguard' },
    ];

    it('stores missing baselines from the current stock and closes nothing at first sight', () => {
      const stock: Record<string, number> = { rattler: 5, vanguard: 0 };
      const e = evaluateNachschub(lines, {}, (l) => stock[l.className!]);
      expect(e.snapshot).toEqual({ a: 5, b: 0 });
      expect(e.snapshotChanged).toBeTrue();
      expect(e.finished).toBeFalse();
      expect(e.closeIds).toEqual([]);
    });

    it('closes by the rise since planning, and is finished (archive) once every line closed', () => {
      const e1 = evaluateNachschub(lines, { a: 5, b: 0 }, (l) => (l.id === 'a' ? 7 : 0));
      expect(e1.closeIds).toEqual(['a']);
      expect(e1.progress).toEqual({ done: 1, total: 2 });
      expect(e1.finished).toBeFalse();
      expect(e1.snapshotChanged).toBeFalse();
      const e2 = evaluateNachschub(lines, { a: 5, b: 0 }, (l) => (l.id === 'a' ? 7 : 1));
      expect(e2.finished).toBeTrue();
    });

    it('an empty Nachschub is never finished', () => {
      expect(evaluateNachschub([], {}, () => 0).finished).toBeFalse();
    });
  });

  describe('edge rules', () => {
    it('the catalogue only flags a missing item, it never deletes', () => {
      expect(gameStatus('old_gun', new Set(['new_gun']))).toBe('notInGame');
      expect(gameStatus('new_gun', new Set(['new_gun']))).toBe('inGame');
    });

    it('an announced ship wish follows the catalogue by folded name', () => {
      const f = followAnnounced(['idris', 'zeta'], new Map([['idris', 'RSI_Idris_P']]));
      expect(f).toEqual([{ foldedName: 'idris', shipClassName: 'RSI_Idris_P' }]);
    });

    it('a wipe resets only what the game wrote, a second ship copy counts up', () => {
      expect(ingameSources()).not.toContain('manual');
      expect(nextShipCopies(undefined)).toBe(2);
      expect(nextShipCopies(1)).toBe(2);
      expect(nextShipCopies(999)).toBe(999);
    });
  });
});
