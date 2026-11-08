/**
 * The unit tests run on Vitest in a real browser (concept
 * docs/concepts/20261108-2224-vitest-migration). This keeps the setup from
 * quietly sliding back: jsdom instead of a browser, a lost setup file (zone's
 * Vitest patch, the new-tab guard), or Jasmine API in a spec, which Vitest
 * would only report as "jasmine is not defined" at run time.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const jsonc = (file) => {
  const { config, error } = ts.parseConfigFileTextToJson(file, readFileSync(file, 'utf8'));
  if (error) throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`);
  return config;
};

const SETUP = 'src/app/testing/vitest-setup.ts';
const target = jsonc('angular.json').projects['verse-companion'].architect.test;

test('npm test runs Vitest in a real browser with the project setup', () => {
  assert.equal(target.builder, '@angular/build:unit-test');
  assert.equal(target.options.runner, 'vitest');
  assert.ok(target.options.browsers?.length > 0, 'browsers must be set, or the specs run in jsdom');
  assert.deepEqual(target.options.setupFiles, [SETUP]);
  assert.match(readFileSync(SETUP, 'utf8'), /^import 'zone\.js\/plugins\/vitest-patch';$/m);
});

test('the window size specs return to is the configured one', () => {
  const [w, h] = target.options.browserViewport.split('x').map(Number);
  const helper = readFileSync('src/app/testing/viewport.ts', 'utf8');
  assert.match(helper, new RegExp(`DEFAULT_VIEWPORT = \\{ width: ${w}, height: ${h} \\}`));
});

test('tsconfig.spec.json types the specs for Vitest, not Jasmine', () => {
  const spec = jsonc('tsconfig.spec.json');
  assert.ok(spec.compilerOptions.types.includes('vitest/globals'));
  assert.ok(!spec.compilerOptions.types.includes('jasmine'));
  assert.ok(spec.include.includes(SETUP));
});

test('no spec or test helper still calls the Jasmine API', () => {
  const offenders = [];
  for (const f of readdirSync('src', { recursive: true })) {
    const file = join('src', String(f));
    if (!/\.(spec|testing)\.ts$/.test(file) && !/[\\/]testing[\\/][^\\/]+\.ts$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (/\bjasmine\.|(^|[^.\w])spyOn(Property)?\(|\bexpectAsync\(/m.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test('no spec imports another spec (its tests would vanish, isolate is off)', () => {
  const offenders = [];
  for (const f of readdirSync('src', { recursive: true })) {
    const file = join('src', String(f));
    if (!file.endsWith('.ts')) continue;
    if (/from '[^']*\.spec'/.test(readFileSync(file, 'utf8'))) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
