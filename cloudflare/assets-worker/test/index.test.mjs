// node --test cloudflare/assets-worker/test
// Exercises the Worker against an in-memory stand-in for the R2 binding.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import worker, { keyFor } from '../src/index.js';

const GLB = 'ship-skins/DRAK_Cutlass_Black/standard.glb';

function fakeBucket(objects) {
  const make = (key) => {
    const bytes = objects[key];
    return {
      key,
      size: bytes.length,
      httpEtag: `"etag-${key.length}"`,
      writeHttpMetadata(h) {
        h.set('content-type', 'application/octet-stream');
      },
    };
  };
  return {
    async head(key) {
      return key in objects ? make(key) : null;
    },
    async get(key, opts = {}) {
      if (!(key in objects)) return null;
      const meta = make(key);
      const inm = opts.onlyIf?.get?.('if-none-match');
      if (inm && inm === meta.httpEtag) return meta; // no body = precondition failed
      return { ...meta, body: new Blob([objects[key]]).stream() };
    },
  };
}

const env = (objects = {}) => ({
  ASSETS: fakeBucket(objects),
  SUPABASE_URL: 'https://example.supabase.co',
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('keyFor', () => {
  it('accepts the exact ingest-skins key shape', () => {
    assert.equal(keyFor(`/${GLB}`), GLB);
    assert.equal(keyFor('/ship-skins/AEGS_Idris/standard.webp'), 'ship-skins/AEGS_Idris/standard.webp');
  });
  it('rejects traversal, other prefixes and other extensions', () => {
    assert.equal(keyFor('/ship-skins/../secret.glb'), null);
    assert.equal(keyFor('/ship-skins/a%2F..%2Fb/c.glb'), null);
    assert.equal(keyFor('/desktop/alpha/setup.exe'), null);
    assert.equal(keyFor('/ship-skins/a/b.json'), null);
    assert.equal(keyFor('/ship-skins/a/b/c.glb'), null);
    assert.equal(keyFor('/%E0%A4%A'), null);
  });
});

describe('fetch', () => {
  it('serves an R2 object with contract headers', async () => {
    const res = await worker.fetch(new Request(`https://w.dev/${GLB}`), env({ [GLB]: 'glTF' }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('cache-control'), /max-age=3600/);
    assert.equal(res.headers.get('content-length'), '4');
    assert.equal(await res.text(), 'glTF');
  });

  it('answers a matching If-None-Match with 304', async () => {
    const e = env({ [GLB]: 'glTF' });
    const etag = (await worker.fetch(new Request(`https://w.dev/${GLB}`), e)).headers.get('etag');
    const res = await worker.fetch(
      new Request(`https://w.dev/${GLB}`, { headers: { 'if-none-match': etag } }),
      e,
    );
    assert.equal(res.status, 304);
  });

  it('answers HEAD without a body', async () => {
    const res = await worker.fetch(new Request(`https://w.dev/${GLB}`, { method: 'HEAD' }), env({ [GLB]: 'glTF' }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), '4');
    assert.equal(res.body, null);
  });

  it('falls back to the Supabase bucket for a key R2 does not hold yet', async () => {
    let asked = '';
    globalThis.fetch = async (url) => {
      asked = String(url);
      return new Response('legacy', { status: 200, headers: { etag: '"s"', 'content-length': '6' } });
    };
    const res = await worker.fetch(new Request(`https://w.dev/${GLB}`), env());
    assert.equal(asked, `https://example.supabase.co/storage/v1/object/public/${GLB}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-sc-origin'), 'supabase');
    assert.equal(await res.text(), 'legacy');
  });

  it('404s when neither R2 nor Supabase has the key', async () => {
    globalThis.fetch = async () => new Response('', { status: 400 });
    const res = await worker.fetch(new Request(`https://w.dev/${GLB}`), env());
    assert.equal(res.status, 404);
  });

  it('refuses writes and unknown paths', async () => {
    assert.equal((await worker.fetch(new Request(`https://w.dev/${GLB}`, { method: 'PUT' }), env())).status, 405);
    assert.equal((await worker.fetch(new Request('https://w.dev/index.html'), env())).status, 404);
  });
});
