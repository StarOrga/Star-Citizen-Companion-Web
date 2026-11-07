// node --test scheduled-deployment.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCStateTime, pickScheduledDeployment } from './scheduled-deployment.ts';

const NOW = Date.parse('2026-11-07T12:00:00Z');

function issue(title: string, createdAt: string, resolved = false, permalink = 'https://status.robertsspaceindustries.com/issues/x/') {
  return { is: 'issue', title, createdAt, resolved, permalink, severity: 'maintenance' };
}

test('parses the cState timestamp with its offset', () => {
  assert.equal(parseCStateTime('2026-10-09 10:00:00 +0000 UTC'), Date.parse('2026-10-09T10:00:00Z'));
  assert.equal(parseCStateTime('2026-10-22 07:43:38 -0400 -0400'), Date.parse('2026-10-22T11:43:38Z'));
  assert.equal(parseCStateTime('2026-10-22 05:00:00'), Date.parse('2026-10-22T05:00:00Z'));
  assert.ok(Number.isNaN(parseCStateTime('soon')));
});

test('picks the earliest announced, unresolved LIVE deployment', () => {
  const d = pickScheduledDeployment({
    pages: [
      issue('Live Deployment', '2026-11-20 14:00:00 +0000 UTC'),
      issue('Live Deployment', '2026-11-12 14:00:00 +0000 UTC'),
      issue('Live Deployment', '2026-10-09 10:00:00 +0000 UTC', true),
    ],
  }, NOW);
  assert.deepEqual(d, { title: 'Live Deployment', at: '2026-11-12T14:00:00.000Z', url: 'https://status.robertsspaceindustries.com/issues/x/' });
});

test('ignores resolved, past, PTU and non-deployment issues', () => {
  assert.equal(pickScheduledDeployment({
    pages: [
      issue('Live Deployment', '2026-10-09 10:00:00 +0000 UTC', true),
      issue('Live Deployment', '2026-11-01 10:00:00 +0000 UTC'),
      issue('PTU Deployment', '2026-11-10 10:00:00 +0000 UTC'),
      issue('RSI Platform Maintenance', '2026-11-10 10:00:00 +0000 UTC'),
    ],
  }, NOW), null);
});

test('a window that started a few hours ago still counts', () => {
  const d = pickScheduledDeployment({ pages: [issue('Live Deployment', '2026-11-07 08:00:00 +0000 UTC')] }, NOW);
  assert.equal(d?.at, '2026-11-07T08:00:00.000Z');
});

test('foreign permalinks fall back to the status site', () => {
  const d = pickScheduledDeployment({ pages: [issue('Live Release', '2026-11-10 10:00:00 +0000 UTC', false, 'https://evil.example/')] }, NOW);
  assert.equal(d?.url, 'https://status.robertsspaceindustries.com/');
});

test('garbage in, null out', () => {
  assert.equal(pickScheduledDeployment(null, NOW), null);
  assert.equal(pickScheduledDeployment({ pages: 'x' }, NOW), null);
  assert.equal(pickScheduledDeployment({ pages: [null, { title: 1 }] }, NOW), null);
});
