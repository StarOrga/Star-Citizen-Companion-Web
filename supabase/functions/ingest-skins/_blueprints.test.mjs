// node --test supabase/functions/ingest-skins/_blueprints.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  MAX_BLUEPRINT_BYTES,
  blueprintMarkupError,
  blueprintPath,
  checkBlueprintBytes,
  droppedBlueprints,
  isBlueprintPath,
  parseBlueprintObject,
  parseBlueprintObjects,
} from './_blueprints.ts';

const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);
const enc = (s) => new TextEncoder().encode(s);
const sha = (b) => createHash('sha256').update(b).digest('hex');

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 412 360" data-sc-blueprint="1" data-lod="icon" ' +
  'data-extent-m="19.70 17.30 5.10" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">\n' +
  `<g class="bp-view" data-view="top" data-projection='{"frame":"gltf-y-up-metres","m":[[0,0,-20.3,206],[20.3,0,0,181]],"box":[6,6,400,348]}'>\n` +
  '<path class="bp-hull" fill-rule="evenodd" stroke-width="2" d="M10 10l5 0 0 5z"/>\n' +
  '</g>\n</svg>\n';

/** The committed samples are real generator output (docs/concepts/blueprint). */
const sample = (name) => readFileSync(new URL(`../../../docs/concepts/blueprint/${name}`, import.meta.url), 'utf-8');

describe('blueprint paths', () => {
  it('derives and recognises content-addressed paths', () => {
    assert.equal(blueprintPath(SHA), `_blueprints/${SHA}.svg`);
    assert.ok(isBlueprintPath(blueprintPath(SHA)));
    assert.ok(!isBlueprintPath(`_blueprints/${SHA}.svg/../x`));
    assert.ok(!isBlueprintPath(`_hulls/${SHA}.glb`));
    assert.ok(!isBlueprintPath(null));
  });

  it('lists only replaced drawings as deletion candidates', () => {
    const keep = new Set([blueprintPath(SHA)]);
    assert.deepEqual(droppedBlueprints([blueprintPath(SHA), blueprintPath(SHA2), null, 'x/y.svg'], keep), [blueprintPath(SHA2)]);
  });
});

describe('blueprint sign entries', () => {
  it('accepts one full and one icon within the size bounds', () => {
    const ok = parseBlueprintObjects([
      { type: 'full', sha256: SHA, bytes: 1000 },
      { type: 'icon', sha256: SHA2, bytes: 100 },
    ]);
    assert.equal(ok.length, 2);
    assert.equal(ok[0].path, blueprintPath(SHA));
  });

  it('refuses wrong shapes', () => {
    assert.equal(typeof parseBlueprintObjects([{ type: 'full', sha256: SHA, bytes: 1 }]), 'string');
    assert.equal(
      typeof parseBlueprintObjects([
        { type: 'full', sha256: SHA, bytes: 1 },
        { type: 'full', sha256: SHA2, bytes: 1 },
      ]),
      'string',
    );
    assert.equal(typeof parseBlueprintObject({ type: 'glb', sha256: SHA, bytes: 1 }), 'string');
    assert.equal(typeof parseBlueprintObject({ type: 'icon', sha256: SHA.toUpperCase(), bytes: 1 }), 'string');
    assert.equal(typeof parseBlueprintObject({ type: 'icon', sha256: SHA, bytes: MAX_BLUEPRINT_BYTES.icon + 1 }), 'string');
    assert.equal(typeof parseBlueprintObject({ type: 'icon', sha256: SHA, bytes: 0 }), 'string');
  });
});

describe('blueprint markup allow-list', () => {
  it('accepts the generator vocabulary', () => {
    assert.equal(blueprintMarkupError(ICON, 'icon'), null);
  });

  it('accepts the real samples for the right LOD only', () => {
    for (const ship of ['gladius', 'reclaimer']) {
      assert.equal(blueprintMarkupError(sample(`${ship}.full.svg`), 'full'), null, `${ship} full`);
      assert.equal(blueprintMarkupError(sample(`${ship}.icon.svg`), 'icon'), null, `${ship} icon`);
      assert.match(blueprintMarkupError(sample(`${ship}.icon.svg`), 'full') ?? '', /not a full blueprint/);
    }
  });

  for (const [label, svg] of [
    ['script element', ICON.replace('</g>', '<script>alert(1)</script></g>')],
    ['event handler', ICON.replace('<path ', '<path onload="alert(1)" ')],
    ['href', ICON.replace('<path ', '<path href="https://x.test" ')],
    ['style', ICON.replace('<path ', '<path style="fill:url(https://x.test)" ')],
    ['foreignObject', ICON.replace('</g>', '<foreignObject/></g>')],
    ['entity', ICON.replace('d="M10', 'd="&#77;10')],
    ['doctype', `<!DOCTYPE svg>${ICON}`],
    ['processing instruction', `<?xml-stylesheet href="x"?>${ICON}`],
    ['text', ICON.replace('</g>', 'hello</g>')],
    ['unquoted attribute', ICON.replace('stroke-width="2"', 'stroke-width=2')],
    ['not a blueprint', ICON.replace(' data-sc-blueprint="1"', '')],
  ]) {
    it(`refuses ${label}`, () => {
      assert.notEqual(blueprintMarkupError(svg, 'icon'), null);
    });
  }
});

describe('blueprint read-back', () => {
  it('passes matching bytes', async () => {
    const bytes = enc(ICON);
    assert.deepEqual(await checkBlueprintBytes(bytes, sha(bytes), 'icon'), { ok: true });
  });

  it('flags a hash mismatch, bad UTF-8 and bad markup', async () => {
    const bytes = enc(ICON);
    assert.equal((await checkBlueprintBytes(bytes, SHA, 'icon')).error, 'blueprint_hash_mismatch');
    const bad = new Uint8Array([0xff, 0xfe, 0x3c]);
    assert.equal((await checkBlueprintBytes(bad, sha(bad), 'icon')).error, 'blueprint_invalid');
    const evil = enc(ICON.replace('</g>', '<script/></g>'));
    assert.equal((await checkBlueprintBytes(evil, sha(evil), 'icon')).error, 'blueprint_invalid');
  });

  it('flags an oversized object before hashing', async () => {
    const big = new Uint8Array(MAX_BLUEPRINT_BYTES.icon + 1);
    assert.equal((await checkBlueprintBytes(big, sha(big), 'icon')).error, 'blueprint_too_large');
  });
});
