import {
  ALL_PRODUCTS,
  KNOWN_PRODUCTS,
  allProductsRow,
  emptyProductRow,
  mergeProductRows,
  normaliseProductParam,
  productLabelKey,
  sharePct,
  type ProductRow,
} from './telemetry-products';

function row(product: string, over: Partial<ProductRow> = {}): ProductRow {
  return { ...emptyProductRow(product), events: 10, ...over };
}

describe('telemetry products', () => {
  describe('mergeProductRows', () => {
    it('keeps the server order and appends the products that reported nothing', () => {
      const merged = mergeProductRows([row('data-uploader', { events: 50 }), row('scc-app')]);
      expect(merged.map((r) => r.product)).toEqual(['data-uploader', 'scc-app', 'starscape']);
    });

    it('shows a silent product as a zero card rather than hiding it', () => {
      // "Did the Starscape build we just shipped report anything?" must be
      // answerable — an absent card looks identical to a card we forgot to add.
      const starscape = mergeProductRows([row('scc-app')]).find((r) => r.product === 'starscape');
      expect(starscape).toBeTruthy();
      expect(starscape!.events).toBe(0);
      expect(starscape!.lastSeen).toBeNull();
    });

    it('lists a product the server reports but the UI has no label for', () => {
      const merged = mergeProductRows([row('some-future-client')]);
      expect(merged.map((r) => r.product)).toContain('some-future-client');
      expect(merged.length).toBe(1 + KNOWN_PRODUCTS.length);
    });

    it('survives a missing or empty products block from an older backend', () => {
      expect(mergeProductRows(undefined).map((r) => r.product)).toEqual([...KNOWN_PRODUCTS]);
      expect(mergeProductRows([]).length).toBe(KNOWN_PRODUCTS.length);
    });
  });

  describe('allProductsRow', () => {
    it('sums every counter and takes the newest lastSeen', () => {
      const all = allProductsRow([
        row('scc-app', { events: 10, crashes: 2, usage: 6, installs: 3, sessions: 4, lastSeen: 100 }),
        row('starscape', { events: 5, crashes: 1, usage: 4, installs: 2, sessions: 2, lastSeen: 900 }),
      ]);
      expect(all.product).toBe(ALL_PRODUCTS);
      expect(all.events).toBe(15);
      expect(all.crashes).toBe(3);
      expect(all.usage).toBe(10);
      expect(all.installs).toBe(5);
      expect(all.sessions).toBe(6);
      expect(all.lastSeen).toBe(900);
    });

    it('reports never-seen rather than epoch zero when nothing reported', () => {
      expect(allProductsRow([]).lastSeen).toBeNull();
      expect(allProductsRow([emptyProductRow('starscape')]).lastSeen).toBeNull();
    });
  });

  describe('normaliseProductParam', () => {
    it('accepts a known product straight from the URL', () => {
      expect(normaliseProductParam('starscape', [])).toBe('starscape');
      expect(normaliseProductParam('  Data-Uploader ', [])).toBe('data-uploader');
    });

    it('accepts an unknown product only once the server has reported it', () => {
      expect(normaliseProductParam('future-client', [])).toBe(ALL_PRODUCTS);
      expect(normaliseProductParam('future-client', ['future-client'])).toBe('future-client');
    });

    it('falls back to the cross-product view for junk or an absent param', () => {
      expect(normaliseProductParam(null, ['scc-app'])).toBe(ALL_PRODUCTS);
      expect(normaliseProductParam('', ['scc-app'])).toBe(ALL_PRODUCTS);
      expect(normaliseProductParam('all', [])).toBe(ALL_PRODUCTS);
      expect(normaliseProductParam('<script>', ['scc-app'])).toBe(ALL_PRODUCTS);
    });
  });

  describe('productLabelKey', () => {
    it('maps every known product and the all-products view to an i18n key', () => {
      for (const p of KNOWN_PRODUCTS) {
        expect(productLabelKey(p)).toBe(`telemetry.product.${p}`);
      }
      expect(productLabelKey(ALL_PRODUCTS)).toBe('telemetry.product.all');
    });

    it('returns null for an unknown id so it renders verbatim, not as a key', () => {
      expect(productLabelKey('future-client')).toBeNull();
      expect(productLabelKey('')).toBeNull();
    });
  });

  describe('sharePct', () => {
    it('scales against the busiest product', () => {
      expect(sharePct(50, 100)).toBe(50);
      expect(sharePct(100, 100)).toBe(100);
    });

    it('never divides by zero, never goes negative, never overflows the track', () => {
      expect(sharePct(0, 0)).toBe(0);
      expect(sharePct(5, 0)).toBe(100);
      expect(sharePct(-3, 10)).toBe(0);
      expect(sharePct(Number.NaN, 10)).toBe(0);
    });
  });
});
