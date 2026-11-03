import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_RESOURCES, safeParam, upstreamUrl } from './allow.ts';

const BASE = 'https://api.uexcorp.uk/2.0';

test('ship purchase resources are allowed (search CTA Bezugsquelle)', () => {
  assert.ok(ALLOWED_RESOURCES.has('vehicles'));
  assert.ok(ALLOWED_RESOURCES.has('vehicles_purchases_prices'));
  const u = upstreamUrl(BASE, 'vehicles_purchases_prices', new URLSearchParams('resource=vehicles_purchases_prices&id_vehicle=12'));
  assert.equal(u?.toString(), `${BASE}/vehicles_purchases_prices/?id_vehicle=12`);
});

test('item resources stay allowed', () => {
  for (const r of ['items', 'items_prices', 'categories', 'terminals', 'cities', 'space_stations', 'outposts', 'planets', 'star_systems']) {
    assert.ok(ALLOWED_RESOURCES.has(r), r);
  }
});

test('user / write / rental resources are refused', () => {
  for (const r of ['user', 'data_submit', 'user_trades', 'vehicles_rentals_prices', 'commodities_prices', '../items', '']) {
    assert.equal(upstreamUrl(BASE, r, new URLSearchParams()), null, r);
  }
});

test('only safe filter params are forwarded', () => {
  assert.ok(safeParam('id_item', '42'));
  assert.equal(safeParam('ID_ITEM', '42'), false);
  assert.equal(safeParam('id_item', 'a&b=c'), false);
  assert.equal(safeParam('id_item', 'x'.repeat(121)), false);
  const u = upstreamUrl(BASE, 'items', new URLSearchParams('resource=items&id_category=3&evil=<script>&Bad=1'));
  assert.equal(u?.toString(), `${BASE}/items/?id_category=3`);
});
