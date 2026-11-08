import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrate } from './jasmine-to-vitest.mjs';

const run = (src, opts) => migrate('x.spec.ts', src, opts);

test('only the changed expressions move; the rest stays byte for byte', () => {
  const src = [
    "import {",
    "  a,",
    "  b,",
    "} from './x';",
    '',
    "describe('x', () => {",
    "  it('y', () => {",
    '    if (a) return; // one-line if stays one line',
    '    expect(b()).toBeTrue();',
    '  });',
    '});',
    '',
  ].join('\n');
  const out = run(src);
  assert.equal(out, src.replace('toBeTrue()', 'toBe(true)'));
});

test('spies keep their wrapped arguments and comments', () => {
  const src = [
    "it('z', () => {",
    "  spyOn(store, 'save').and.callFake(() => {",
    '    /* swallow — two lines',
    '       of comment */',
    '  });',
    '});',
    '',
  ].join('\n');
  const out = run(src);
  assert.match(out, /vi\.spyOn\(store, 'save'\)\.mockImplementation\(\(\) => \{\n {4}\/\* swallow — two lines\n {7}of comment \*\/\n {2}\}\);/);
});

test('a comment in front of a rewritten statement is not doubled', () => {
  const src = ["it('w', () => {", '  // keep me once', '  expect(x).toBeFalse();', '});', ''].join('\n');
  const out = run(src);
  assert.equal(out.match(/keep me once/g)?.length, 1);
  assert.match(out, /expect\(x\)\.toBe\(false\);/);
});

test('a TODO the schematic raises lands in front of its statement', () => {
  const src = ["it('v', () => {", "  const s = spyOn(o, 'm');", '  s.and.callThrough();', '});', ''].join('\n');
  const out = run(src);
  assert.match(out, /\n {2}\/\/ TODO: vitest-migration: [^\n]+\n {2}s\.and\.callThrough\(\);/);
});

test('zone fakeAsync stays unless --fake-async is asked for', () => {
  const src = [
    "import { fakeAsync, tick } from '@angular/core/testing';",
    "describe('d', () => {",
    "  it('u', fakeAsync(() => {",
    '    tick(10);',
    '  }));',
    '});',
    '',
  ].join('\n');
  assert.equal(run(src), src);
  const timers = run(src, { fakeAsync: true });
  assert.match(timers, /\n {4}await vi\.advanceTimersByTimeAsync\(10\);\n/);
  assert.match(timers, /\n {4}vi\.useFakeTimers\(/);
  assert.doesNotMatch(timers, /@angular\/core\/testing/);
});

test('toContain with an object, array or matcher becomes toContainEqual; an identifier stays', () => {
  const src = [
    "it('c', () => {",
    "  expect(rows).toContain({ id: 'a' });",
    "  expect(rows).not.toContain(['eq', 'id']);",
    "  expect(rows).toContain(jasmine.objectContaining({ id: 'b' }));",
    '  expect(rows).toContain(row);',
    "  expect(name).toContain('x');",
    '});',
    '',
  ].join('\n');
  const out = run(src);
  assert.match(out, /expect\(rows\)\.toContainEqual\(\{ id: 'a' \}\);/);
  assert.match(out, /expect\(rows\)\.not\.toContainEqual\(\['eq', 'id'\]\);/);
  assert.match(out, /expect\(rows\)\.toContainEqual\(expect\.objectContaining\(\{ id: 'b' \}\)\);/);
  assert.match(out, /expect\(rows\)\.toContain\(row\);/);
  assert.match(out, /expect\(name\)\.toContain\('x'\);/);
});

test('spy follow-ups: lastCall asserted, empty resolveTo and bare spies typed', () => {
  const src = [
    "it('s', () => {",
    "  const fetch = spyOn(window, 'fetch');",
    "  const load = jasmine.createSpy('load').and.resolveTo();",
    '  const args = fetch.calls.mostRecent().args;',
    '});',
    '',
  ].join('\n');
  const out = run(src);
  assert.match(out, /vi\.spyOn\(window, 'fetch'\)\.mockReturnValue\(undefined as never\)/);
  assert.match(out, /\.mockResolvedValue\(undefined\)/);
  assert.match(out, /\.mock\.lastCall!;/);
});

test('a multi-line template literal inside a replacement is not re-indented', () => {
  const src = ["it('t', () => {", '  expect(f(`a', '      b`)).toBeTrue();', '});', ''].join('\n');
  const out = run(src);
  assert.match(out, /expect\(f\(`a\n {6}b`\)\)\.toBe\(true\);/);
});
