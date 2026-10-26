import { TestBed } from '@angular/core/testing';
import { HqSuppliesService, SUPPLIES_MAX_ITEMS, SUPPLIES_STORAGE_KEY, SUPPLY_QTY_MAX } from './hq-supplies.service';

describe('HqSuppliesService', () => {
  beforeEach(() => localStorage.removeItem(SUPPLIES_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(SUPPLIES_STORAGE_KEY));

  function make(): HqSuppliesService {
    TestBed.resetTestingModule();
    return TestBed.inject(HqSuppliesService);
  }

  it('adds a line, merges the same open name like a cart and persists', () => {
    const s = make();
    expect(s.add('  Quantum drive ', 1)).toBeTrue();
    expect(s.add('quantum DRIVE', 2)).toBeTrue();
    expect(s.items().length).toBe(1);
    expect(s.items()[0].qty).toBe(3);
    expect(make().items()[0].name).toBe('Quantum drive');
  });

  it('rejects empty names and clamps quantities', () => {
    const s = make();
    expect(s.add('   ', 1)).toBeFalse();
    s.add('Shield', 5000);
    expect(s.items()[0].qty).toBe(SUPPLY_QTY_MAX);
    s.setQty(s.items()[0].id, -4);
    expect(s.items()[0].qty).toBe(1);
  });

  it('ticks lines off, counts what is open and clears the ticked ones', () => {
    const s = make();
    s.add('A', 2);
    s.add('B', 3);
    s.toggle(s.items()[0].id);
    expect(s.open().map((i) => i.name)).toEqual(['B']);
    expect(s.openUnits()).toBe(3);
    s.clearDone();
    expect(s.items().map((i) => i.name)).toEqual(['B']);
    s.remove(s.items()[0].id);
    expect(s.items()).toEqual([]);
  });

  it('caps the list and survives a corrupt store', () => {
    const s = make();
    for (let i = 0; i < SUPPLIES_MAX_ITEMS + 5; i++) s.add(`item ${i}`, 1);
    expect(s.items().length).toBe(SUPPLIES_MAX_ITEMS);
    localStorage.setItem(SUPPLIES_STORAGE_KEY, '{not json');
    expect(make().items()).toEqual([]);
  });
});
