// Tests for once-until-success.ts. Pure logic, no Deno APIs, so it runs under
// both `deno test` and Node 24's built-in test runner + type stripping:
//   node --test once-until-success.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onceUntilSuccess } from './once-until-success.ts';

test('remembers a success: init runs once for three calls', async () => {
  let calls = 0;
  const get = onceUntilSuccess(async () => ++calls);
  assert.equal(await get(), 1);
  assert.equal(await get(), 1);
  assert.equal(await get(), 1);
  assert.equal(calls, 1);
});

test('forgets a failure: the next call runs init again and resolves', async () => {
  let calls = 0;
  const get = onceUntilSuccess(async () => {
    calls++;
    if (calls === 1) throw new Error('cdn down');
    return 'ready';
  });
  await assert.rejects(get(), /cdn down/);
  assert.equal(await get(), 'ready');
  assert.equal(calls, 2);
});

test('two concurrent calls share one init', async () => {
  let calls = 0;
  let release!: (v: string) => void;
  const get = onceUntilSuccess(() => {
    calls++;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  });
  const a = get();
  const b = get();
  release('ok');
  assert.deepEqual(await Promise.all([a, b]), ['ok', 'ok']);
  assert.equal(calls, 1);
});
