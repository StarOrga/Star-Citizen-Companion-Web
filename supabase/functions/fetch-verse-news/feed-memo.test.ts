// Tests for feed-memo.ts. Pure logic with an injected clock, so it runs under
// both `deno test` and Node 24's built-in test runner + type stripping:
//   node --test feed-memo.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeedMemo } from './feed-memo.ts';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('a fresh build is shared until the TTL runs out', async () => {
  const c = clock();
  const memo = createFeedMemo<number>(1000, () => true, c.now);
  let builds = 0;
  const build = async () => ++builds;

  assert.deepEqual(await memo.get(build), { value: 1, fresh: true });
  c.advance(999);
  assert.deepEqual(await memo.get(build), { value: 1, fresh: false });
  c.advance(1);
  assert.deepEqual(await memo.get(build), { value: 2, fresh: true });
  assert.equal(builds, 2);
});

test('concurrent callers share one in-flight build', async () => {
  const memo = createFeedMemo<string>(1000, () => true, () => 0);
  let builds = 0;
  let release!: (v: string) => void;
  const build = () => {
    builds++;
    return new Promise<string>((r) => (release = r));
  };

  const a = memo.get(build);
  const b = memo.get(build);
  release('feed');
  assert.deepEqual(await a, { value: 'feed', fresh: true });
  assert.deepEqual(await b, { value: 'feed', fresh: false });
  assert.equal(builds, 1);
});

test('an unusable build is served once but not kept', async () => {
  const memo = createFeedMemo<number[]>(1000, (v) => v.length > 0, () => 0);
  let builds = 0;
  const build = async () => (++builds === 1 ? [] : [1]);

  assert.deepEqual(await memo.get(build), { value: [], fresh: true });
  assert.deepEqual(await memo.get(build), { value: [1], fresh: true });
  assert.deepEqual(await memo.get(build), { value: [1], fresh: false });
  assert.equal(builds, 2);
});

test('a failed build is not kept', async () => {
  const memo = createFeedMemo<number>(1000, () => true, () => 0);
  let builds = 0;
  const build = async () => {
    if (++builds === 1) throw new Error('upstream down');
    return 7;
  };

  await assert.rejects(memo.get(build), /upstream down/);
  assert.deepEqual(await memo.get(build), { value: 7, fresh: true });
});
