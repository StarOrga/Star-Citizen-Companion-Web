import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHardWidths } from './check-overlay-sizes.mjs';

test('flags a hard width or max-width of 240px and more', () => {
  assert.equal(findHardWidths('.a { max-width: 760px; }').length, 1);
  assert.equal(findHardWidths('.a { width: min(100%, 960px); }').length, 1);
  assert.equal(findHardWidths('x\n.a { width: 240px }').at(0)?.line, 2);
});
test('lets tokens, small px, min-width and heights through', () => {
  assert.equal(findHardWidths('.a { width: min(var(--sc-ov-s), 100%); }').length, 0);
  assert.equal(findHardWidths('.a { width: 220px; max-width: 160px; }').length, 0);
  assert.equal(findHardWidths('.a { min-width: 320px; max-height: 680px; }').length, 0);
  assert.equal(findHardWidths('.a { width: calc(100vw - 32px); }').length, 0);
});
test('an exception comment on the line exempts it', () => {
  assert.equal(findHardWidths('.a { width: 720px; /* overlay-size: exception — hangs off the field */ }').length, 0);
});
