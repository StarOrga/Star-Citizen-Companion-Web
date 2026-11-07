import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache, normalizeCommodities, normalizePrices, upstreamFor } from './prices.ts';

const BASE = 'https://api.uexcorp.uk/2.0';
const NOW = new Date('2026-11-07T12:00:00.000Z');

test('price rows carry source, fetch time and the real UEX date_modified as ISO', () => {
  const body = normalizePrices(
    [{ id_commodity: 5, id_terminal: 9, commodity_name: 'Agricium', terminal_name: 'TDD Area 18', price_buy: 0, price_sell: 2750.5, price_sell_avg: 2600, date_modified: 1762500000 }],
    NOW,
  );
  assert.equal(body.source, 'uex');
  assert.equal(body.fetchedAt, NOW.toISOString());
  assert.deepEqual(body.prices[0], {
    commodityId: 5, commodity: 'Agricium', terminalId: 9, terminal: 'TDD Area 18',
    buy: null, sell: 2750.5, buyAvg: null, sellAvg: 2600, updatedAt: new Date(1762500000 * 1000).toISOString(),
  });
});

test('missing timestamp stays null, malformed rows are dropped', () => {
  const body = normalizePrices([{ id_commodity: 1, id_terminal: 2 }, { id_terminal: 3 }, null], NOW);
  assert.equal(body.prices.length, 1);
  assert.equal(body.prices[0].updatedAt, null);
  assert.deepEqual(normalizePrices('x', NOW).prices, []);
});

test('commodity list is sorted and filtered', () => {
  assert.deepEqual(normalizeCommodities([{ id: 2, name: 'Zinc' }, { id: 1, name: 'Agricium' }, { id: 3 }]), [
    { id: 1, name: 'Agricium' }, { id: 2, name: 'Zinc' },
  ]);
});

test('only the two supported query shapes reach upstream', () => {
  assert.equal(upstreamFor(BASE, new URLSearchParams('id_commodity=12'))?.toString(), `${BASE}/commodities_prices/?id_commodity=12`);
  assert.equal(upstreamFor(BASE, new URLSearchParams('list=commodities'))?.toString(), `${BASE}/commodities/`);
  for (const q of ['', 'id_commodity=abc', 'id_commodity=1;2', 'resource=user', 'id_terminal=4', 'list=users']) {
    assert.equal(upstreamFor(BASE, new URLSearchParams(q)), null, q);
  }
});

test('cache serves within TTL and expires after', () => {
  const c = new TtlCache<string>(1000);
  c.set('k', 'v', 0);
  assert.equal(c.get('k', 999), 'v');
  assert.equal(c.get('k', 1001), undefined);
});
