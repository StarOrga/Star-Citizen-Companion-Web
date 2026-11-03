// node --test supabase/functions/ingest-catalog/_missions.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMissions } from './_missions.ts';

const B = { build_id: '00000000-0000-0000-0000-000000000001', channel: 'LIVE', patch_version: '4.3', build_number: 'desktop' };
const body = {
  className: 'BlockadeRunner_Counter',
  guid: '84274b59',
  title: { en: "Lookin' for Zeta-Prolanide", de: '', key: '@t' },
  titleClean: { en: "Lookin' for Zeta-Prolanide", de: null },
  description: { en: 'Word is …', de: '' },
  type: { className: 'Delivery', name: { en: 'Delivery', de: '' } },
  giver: { name: { en: 'Ruto' }, className: null },
  location: { className: 'Stanton4', name: { en: 'microTech' } },
  reward: { amount: 12500, currency: 'UEC' },
  lawful: true,
  category: 'delivery',
  source: { channel: 'LIVE' },
  extra: 'kept in payload only',
};

describe('parseMissions', () => {
  it('maps an extractor body to a pinned codex_missions row', () => {
    const [row] = parseMissions([body], B);
    assert.equal(row.class_name, 'BlockadeRunner_Counter');
    assert.equal(row.title, "Lookin' for Zeta-Prolanide");
    assert.equal(row.type_name, 'Delivery');
    assert.equal(row.giver_name, 'Ruto');
    assert.equal(row.location_name, 'microTech');
    assert.equal(row.reward_amount, 12500);
    assert.equal(row.reward_currency, 'UEC');
    assert.equal(row.lawful, true);
    assert.equal(row.build_id, B.build_id);
    assert.equal(row.extra, undefined);
    assert.equal(row.payload.extra, 'kept in payload only');
    assert.equal(row.payload.source, undefined);
  });

  it('names a templated mission by its type, never by an invented title', () => {
    const [row] = parseMissions([{ ...body, titleClean: null, title: { en: '~mission(Title)' } }], B);
    assert.equal(row.title, 'Delivery');
    assert.equal(row.title_raw, '~mission(Title)');
  });

  it('drops bodies without class name or any readable title, and unresolved @-keys', () => {
    const rows = parseMissions([
      { ...body, className: 'bad name!' },
      { ...body, className: 'NoTitle', titleClean: null, type: { name: { en: '@unresolved' } } },
      { ...body, className: 'NoReward', reward: { amount: 0, currency: 'UEC' }, giver: { name: { en: '@x' } } },
    ], B);
    assert.deepEqual(rows.map((r) => r.class_name), ['NoReward']);
    assert.equal(rows[0].reward_amount, null);
    assert.equal(rows[0].reward_currency, null);
    assert.equal(rows[0].giver_name, null);
  });

  it('is empty for junk input and dedupes class names', () => {
    assert.deepEqual(parseMissions(null, B), []);
    assert.equal(parseMissions([body, body], B).length, 1);
  });
});
