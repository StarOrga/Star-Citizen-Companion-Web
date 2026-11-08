/**
 * Karma and Vitest split the spec files between them while the migration runs
 * (npm test / npm run test:vitest). The folders that moved are listed in four
 * places; this keeps them in step, so no spec runs twice and none drops out of
 * both runners unnoticed.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const jsonc = (file) => {
  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
  if (error) throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
  return config;
};

const architect = jsonc('angular.json').projects['verse-companion'].architect;
const vitest = architect['test-vitest'].options;
const karma = architect.test.options;
const migrated = vitest.include;
const SETUP = 'src/app/testing/vitest-setup.ts';

test('the Vitest target runs in a real browser, not jsdom', () => {
  assert.equal(architect['test-vitest'].builder, '@angular/build:unit-test');
  assert.equal(vitest.runner, 'vitest');
  assert.ok(vitest.browsers?.length > 0, 'browsers must be set, or the specs run in jsdom');
  assert.deepEqual(vitest.setupFiles, [SETUP]);
});

test('Karma excludes exactly the folders Vitest includes', () => {
  assert.ok(migrated.length > 0);
  assert.deepEqual([...(karma.exclude ?? [])].sort(), [...migrated].sort());
});

test('tsconfig.vitest.json type-checks the migrated specs and the setup', () => {
  const include = jsonc('tsconfig.vitest.json').include;
  for (const glob of migrated) assert.ok(include.includes(`src/${glob}`), `tsconfig.vitest.json lacks src/${glob}`);
  assert.ok(include.includes(SETUP));
});

test('tsconfig.spec.json keeps the migrated specs and the setup away from Karma', () => {
  const exclude = jsonc('tsconfig.spec.json').exclude ?? [];
  for (const glob of migrated) assert.ok(exclude.includes(`src/${glob}`), `tsconfig.spec.json does not exclude src/${glob}`);
  assert.ok(exclude.includes(SETUP));
});
