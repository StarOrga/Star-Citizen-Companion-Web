import {
  MIN_SCORE,
  READY_COUNT,
  RecContext,
  RecItem,
  complement,
  craftOrBuy,
  dismissSuggestion,
  emptyDismissState,
  materialOverlap,
  onWishlistAdd,
  placeOverlap,
  recommend,
  visibleSuggestions,
} from './recommend';

const it_ = (o: Partial<RecItem> & Pick<RecItem, 'className' | 'kind'>): RecItem => ({ name: o.className, ...o });

const FIX: RecItem[] = [
  it_({ className: 'pem_helmet', name: 'Pembroke Helm', kind: 'armor', setKey: 'rsi-pembroke', armorPart: 'helmet', manufacturer: 'RSI' }),
  it_({ className: 'pem_torso', name: 'Pembroke Torso', kind: 'armor', setKey: 'rsi-pembroke', armorPart: 'torso' }),
  it_({ className: 'pem_legs', name: 'Pembroke Beine', kind: 'armor', setKey: 'rsi-pembroke', armorPart: 'legs' }),
  it_({ className: 'pem_arms', name: 'Pembroke Arme', kind: 'armor', setKey: 'rsi-pembroke', armorPart: 'arms' }),
  it_({ className: 'pem_bag', name: 'Pembroke Rucksack', kind: 'armor', setKey: 'rsi-pembroke', armorPart: 'backpack' }),
  it_({ className: 'other_torso', name: 'Anderer Torso', kind: 'armor', setKey: 'cds-other', armorPart: 'torso' }),
  it_({ className: 'p4ar', name: 'P4-AR', kind: 'fps_weapon', magazineClass: 'p4ar_mag', manufacturer: 'Behring', ports: [{ type: 'optic', minSize: 1, maxSize: 2 }], activity: 'fps' }),
  it_({ className: 'p4ar_mag', name: 'P4-AR Magazin', kind: 'magazine', place: { shop: 'Area18-Armory', station: 'Area18', system: 'Stanton' } }),
  it_({ className: 'optic_s1', name: 'Optik S1', kind: 'attachment', slotType: 'optic', size: 1 }),
  it_({ className: 'optic_s4', name: 'Optik S4', kind: 'attachment', slotType: 'optic', size: 4 }),
  it_({ className: 'bp_gallant', name: 'Gallant-Blaupause', kind: 'blueprint', outputClass: 'gallant', ingredients: { aluminium: 4, agricium: 1 } }),
  it_({ className: 'gallant', name: 'Gallant', kind: 'fps_weapon', magazineClass: 'gallant_mag' }),
  it_({ className: 'gallant_mag', name: 'Gallant Magazin', kind: 'magazine' }),
  it_({ className: 'aluminium', name: 'Aluminium', kind: 'material' }),
  it_({ className: 'agricium', name: 'Agricium', kind: 'material' }),
  it_({ className: 'bp_other', name: 'Andere Blaupause', kind: 'blueprint', ingredients: { aluminium: 4, agricium: 1 }, activity: 'crafting' }),
  it_({ className: 'bp_far', name: 'Ferne Blaupause', kind: 'blueprint', ingredients: { iron: 2 } }),
  it_({ className: 'cutlass', name: 'Cutlass Black', kind: 'ship', manufacturer: 'Drake', ports: [{ type: 'weapon', minSize: 2, maxSize: 3 }, { type: 'shield', minSize: 1, maxSize: 1 }, { type: 'power', minSize: 1, maxSize: 1 }, { type: 'missile', minSize: 1, maxSize: 2 }] }),
  it_({ className: 'power_s1', name: 'Kraftwerk S1', kind: 'ship_component', slotType: 'power', size: 1 }),
  it_({ className: 'missile_s1', name: 'Rakete S1', kind: 'missile', slotType: 'missile', size: 1 }),
  it_({ className: 'gun_s3', name: 'Laser S3', kind: 'ship_weapon', slotType: 'weapon', size: 3, grade: 2 }),
  it_({ className: 'gun_s3b', name: 'Mass Driver S3', kind: 'ship_weapon', slotType: 'weapon', size: 3, grade: 1 }),
  it_({ className: 'gun_s5', name: 'Laser S5', kind: 'ship_weapon', slotType: 'weapon', size: 5 }),
  it_({ className: 'shield_s1', name: 'Schild S1', kind: 'ship_component', slotType: 'shield', size: 1 }),
  it_({ className: 'paint_cut', name: 'Cutlass Lackierung', kind: 'paint', shipClasses: ['cutlass'] }),
];

const cat = (items: RecItem[] = FIX): Map<string, RecItem> => new Map(items.map((i) => [i.className, i]));

const ctx = (anchors: string[], over: Partial<RecContext> = {}, items: RecItem[] = FIX): RecContext => ({
  anchors: anchors.map((className, i) => ({ className, addedAt: `2026-11-07T10:0${9 - i}:00Z` })),
  catalogue: cat(items),
  owned: new Set(),
  wished: new Set(anchors),
  ...over,
});

describe('recommend', () => {
  it('is deterministic: the same input twice gives the same list', () => {
    const a = recommend(ctx(['pem_helmet']));
    const b = recommend(ctx(['pem_helmet']));
    expect(a).toEqual(b);
  });

  it('is independent of catalogue insertion order', () => {
    const a = recommend(ctx(['p4ar'])).map((r) => r.className);
    const b = recommend(ctx(['p4ar'], {}, [...FIX].reverse())).map((r) => r.className);
    expect(b).toEqual(a);
  });

  describe('armor set', () => {
    it('Pembroke helmet suggests the other Pembroke parts first, torso and legs before the backpack, never another set', () => {
      const r = recommend(ctx(['pem_helmet'], { count: 7 })).map((x) => x.className);
      // one per bucket pass: only the armor bucket has real candidates, the rest fills in fixed part order
      expect(r.slice(0, 4)).toEqual(['pem_torso', 'pem_legs', 'pem_arms', 'pem_bag']);
      expect(r).not.toContain('other_torso');
      const first = recommend(ctx(['pem_helmet']))[0];
      expect(first.reason).toBe('sameSet');
    });

    it('leaves out parts already owned or wished', () => {
      const r = recommend(ctx(['pem_helmet'], { owned: new Set(['pem_torso']), wished: new Set(['pem_helmet', 'pem_legs']) })).map((x) => x.className);
      expect(r).not.toContain('pem_torso');
      expect(r).not.toContain('pem_legs');
      expect(r).toContain('pem_arms');
    });
  });

  describe('weapon', () => {
    it('suggests its magazine first (hard relation), then a fitting attachment, not a wrong-size one', () => {
      const r = recommend(ctx(['p4ar']));
      expect(r[0]).toEqual(jasmine.objectContaining({ className: 'p4ar_mag', reason: 'magazineFor' }));
      const names = r.map((x) => x.className);
      expect(names).toContain('optic_s1');
      expect(names).not.toContain('optic_s4');
    });

    it('a magazine suggests its weapon', () => {
      const r = recommend(ctx(['p4ar_mag']));
      expect(r[0]).toEqual(jasmine.objectContaining({ className: 'p4ar', reason: 'weaponFor' }));
    });
  });

  describe('blueprint', () => {
    it('suggests ingredients and the crafted item magazine, and ranks a recipe-sharing blueprint below them', () => {
      const r = recommend(ctx(['bp_gallant'], { count: 7 }));
      const names = r.map((x) => x.className);
      // ingredients (hard relation + same material) and the crafted item's magazine come before anything else
      expect(['agricium', 'aluminium']).toContain(names[0]);
      expect(names[1]).toBe('gallant_mag');
      expect(names).toEqual(jasmine.arrayContaining(['agricium', 'aluminium']));
      expect(names.indexOf('bp_other')).toBeGreaterThan(names.indexOf('gallant_mag'));
      expect(names).not.toContain('bp_far');
    });

    it('a material suggests blueprints that use it', () => {
      const r = recommend(ctx(['aluminium']));
      expect(r.map((x) => x.className)).toEqual(jasmine.arrayContaining(['bp_gallant', 'bp_other']));
      expect(r[0].reason).toBe('usedIn');
    });
  });

  describe('ship', () => {
    it('suggests weapons, shield and paint that fit its ports; skips a too-big gun; dampens the substitute', () => {
      const r = recommend(ctx(['cutlass'], { count: 7 }));
      const names = r.map((x) => x.className);
      expect(names).toContain('gun_s3');
      expect(names).toContain('shield_s1');
      expect(names).toContain('paint_cut');
      expect(names).not.toContain('gun_s5');
      // two guns of the same slot and size are substitutes: only one of them is suggested
      expect(names.filter((n) => n.startsWith('gun_s3')).length).toBe(1);
      expect(names).toContain('gun_s3'); // higher grade wins the tie
    });

    it('a ship weapon suggests the ship it fits when not in the Hangar, and nothing when it is owned', () => {
      expect(recommend(ctx(['gun_s3'])).map((x) => x.className)).toContain('cutlass');
      expect(recommend(ctx(['gun_s3'], { owned: new Set(['cutlass']) })).map((x) => x.className)).not.toContain('cutlass');
    });
  });

  describe('selection', () => {
    it('takes one suggestion per bucket first, then fills up', () => {
      const r = recommend(ctx(['cutlass'], { count: 7 }));
      const buckets = r.map((x) => x.bucket);
      // shipcomp, paint and missile are all different buckets: they lead before a second shipcomp
      expect(new Set(buckets.slice(0, 3)).size).toBe(3);
      expect(r.length).toBeGreaterThanOrEqual(5);
    });

    it('anchors are the newest 3: an older fourth one is ignored', () => {
      const c: RecContext = {
        ...ctx([]),
        anchors: [
          { className: 'pem_helmet', addedAt: '2026-11-07T10:00:00Z' },
          { className: 'cutlass', addedAt: '2026-11-07T10:01:00Z' },
          { className: 'aluminium', addedAt: '2026-11-07T10:02:00Z' },
          { className: 'p4ar', addedAt: '2026-11-07T10:03:00Z' },
        ],
        wished: new Set(['pem_helmet', 'cutlass', 'aluminium', 'p4ar']),
      };
      const names = recommend({ ...c, count: 20 }).map((x) => x.className);
      expect(names).not.toContain('pem_torso'); // helmet was the oldest -> dropped
      expect(names).toContain('p4ar_mag');
    });

    it('the newest anchor outweighs an older one', () => {
      const c = ctx(['p4ar', 'pem_helmet']);
      expect(recommend(c)[0].className).toBe('p4ar_mag');
      const swapped = ctx(['pem_helmet', 'p4ar']);
      expect(['pem_torso', 'pem_legs']).toContain(recommend(swapped)[0].className);
    });

    it('returns nothing for no anchor, an unknown anchor, or when every score is below the threshold', () => {
      expect(recommend(ctx([]))).toEqual([]);
      expect(recommend(ctx(['nope']))).toEqual([]);
      expect(recommend(ctx(['bp_far'])).length).toBe(0);
      expect(MIN_SCORE).toBe(20);
    });

    it('excludes variants, placeholders and items missing from the build', () => {
      const items = FIX.map((i) => (i.className === 'pem_torso' ? { ...i, isVariant: true } : i.className === 'pem_legs' ? { ...i, inBuild: false } : i.className === 'pem_arms' ? { ...i, placeholder: true } : i));
      const names = recommend(ctx(['pem_helmet'], {}, items)).map((x) => x.className);
      expect(names).toEqual(['pem_bag']);
    });

    it('keeps 7 ready when enough candidates exist', () => {
      expect(recommend(ctx(['cutlass'], { count: READY_COUNT })).length).toBeGreaterThanOrEqual(5);
      const many: RecItem[] = [...FIX, ...Array.from({ length: 10 }, (_, i) => it_({ className: `extra${i}`, name: `Extra ${i}`, kind: 'armor', setKey: 'rsi-pembroke', armorPart: `x${i}` }))];
      expect(recommend(ctx(['pem_helmet'], { count: READY_COUNT }, many)).length).toBe(READY_COUNT);
    });
  });

  describe('parts', () => {
    it('complement tiers', () => {
      const c = cat();
      expect(complement(c.get('pem_helmet')!, c.get('pem_legs')!, c).c).toBe(1);
      expect(complement(c.get('cutlass')!, c.get('gun_s3')!, c).c).toBe(0.7);
      expect(complement(c.get('cutlass')!, c.get('paint_cut')!, c).c).toBe(0.5);
      expect(complement(c.get('cutlass')!, c.get('p4ar_mag')!, c).c).toBe(0);
    });

    it('materialOverlap is a weighted Jaccard, 1 for an ingredient itself', () => {
      const c = cat();
      expect(materialOverlap(c.get('bp_gallant')!, c.get('bp_other')!)).toBe(1);
      expect(materialOverlap(c.get('bp_gallant')!, c.get('bp_far')!)).toBe(0);
      expect(materialOverlap(c.get('bp_gallant')!, c.get('aluminium')!)).toBe(1);
      expect(materialOverlap({ ...c.get('bp_gallant')!, ingredients: { a: 2, b: 2 } }, { ...c.get('bp_other')!, ingredients: { a: 2 } })).toBe(0.5);
    });

    it('placeOverlap steps shop > station > body > system', () => {
      const mk = (place: RecItem['place']) => it_({ className: 'x', kind: 'other', place });
      const a = mk({ shop: 's1', station: 'st1', body: 'b1', system: 'sys' });
      expect(placeOverlap(a, mk({ shop: 's1' }))).toBe(1);
      expect(placeOverlap(a, mk({ station: 'st1' }))).toBe(0.8);
      expect(placeOverlap(a, mk({ body: 'b1' }))).toBe(0.4);
      expect(placeOverlap(a, mk({ system: 'sys' }))).toBe(0.2);
      expect(placeOverlap(a, mk({ system: 'other' }))).toBe(0);
    });

    it('craftOrBuy: craft with 60 % of the recipe in stock, else buy when a shop exists', () => {
      const c = it_({ className: 'x', kind: 'other', ingredients: { a: 1, b: 1, c: 1 }, place: { shop: 's' } });
      expect(craftOrBuy(c, new Set(['a', 'b']))).toBe('craft');
      expect(craftOrBuy(c, new Set(['a']))).toBe('buy');
      expect(craftOrBuy({ ...c, place: null }, new Set())).toBe('craft');
      expect(craftOrBuy(it_({ className: 'y', kind: 'other' }), undefined)).toBeNull();
    });
  });

  describe('dismiss and refill', () => {
    it('hides a dismissed suggestion, the next ready one slides up, an add brings it back', () => {
      const ready = recommend(ctx(['cutlass'], { count: READY_COUNT }));
      expect(ready.length).toBeGreaterThanOrEqual(5);
      const shown = visibleSuggestions(ready, emptyDismissState);
      expect(shown.length).toBe(3);
      const after = dismissSuggestion(emptyDismissState, shown[0].className);
      const next = visibleSuggestions(ready, after);
      expect(next.map((r) => r.className)).not.toContain(shown[0].className);
      expect(next.length).toBe(3);
      expect(next[0].className).toBe(shown[1].className);
      expect(next[2].className).toBe(ready[3].className);
      expect(visibleSuggestions(ready, onWishlistAdd()).map((r) => r.className)).toEqual(shown.map((r) => r.className));
    });

    it('a dismissed class is also skipped by the engine when passed in', () => {
      const names = recommend(ctx(['p4ar'], { dismissed: new Set(['p4ar_mag']) })).map((x) => x.className);
      expect(names).not.toContain('p4ar_mag');
    });
  });
});
