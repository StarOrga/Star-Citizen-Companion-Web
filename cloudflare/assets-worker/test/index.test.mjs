// node --test cloudflare/assets-worker/test
// Exercises the Worker against an in-memory stand-in for the R2 binding.
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import worker, { fallbackBucket, keyFor, parseRange } from '../src/index.js';

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
      // Real R2 would parse a Headers range itself; the Worker must hand over
      // explicit numbers, so a regression to the old call fails loudly here.
      if (opts.range instanceof Headers) throw new Error('fake R2: range must be explicit');
      if (!(key in objects)) return null;
      const meta = make(key);
      const inm = opts.onlyIf?.get?.('if-none-match');
      if (inm && inm === meta.httpEtag) return meta; // no body = precondition failed
      let bytes = objects[key];
      if (opts.range) {
        const { offset, length, suffix } = opts.range;
        const start = suffix !== undefined ? bytes.length - suffix : (offset ?? 0);
        const len = suffix !== undefined ? suffix : (length ?? bytes.length - start);
        bytes = bytes.slice(start, start + len);
        // R2 echoes the range with the `suffix` key present but undefined.
        return { ...meta, range: { offset: start, length: len, suffix: undefined }, body: new Blob([bytes]).stream() };
      }
      return { ...meta, body: new Blob([bytes]).stream() };
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

describe('parseRange', () => {
  it('resolves single ranges against the size', () => {
    assert.deepEqual(parseRange('bytes=0-3', 10), { offset: 0, length: 4 });
    assert.deepEqual(parseRange('bytes=7-', 10), { offset: 7, length: 3 });
    assert.deepEqual(parseRange('bytes=-2', 10), { offset: 8, length: 2 });
    assert.deepEqual(parseRange('bytes=-20', 10), { offset: 0, length: 10 });
    assert.deepEqual(parseRange('bytes=0-99', 10), { offset: 0, length: 10 });
  });
  it('marks ranges no byte can satisfy', () => {
    assert.equal(parseRange('bytes=99-', 10), 'unsatisfiable');
    assert.equal(parseRange('bytes=-0', 10), 'unsatisfiable');
    assert.equal(parseRange('bytes=0-', 0), 'unsatisfiable');
    assert.equal(parseRange('bytes=-5', 0), 'unsatisfiable');
  });
  it('ignores missing, multiple, foreign-unit and invalid ranges', () => {
    assert.equal(parseRange(null, 10), null);
    assert.equal(parseRange('bytes=5-2', 10), null);
    assert.equal(parseRange('bytes=0-1,4-5', 10), null);
    assert.equal(parseRange('items=0-3', 10), null);
    assert.equal(parseRange('bytes=-', 10), null);
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

  it('serves content-addressed package objects immutable with the right type', async () => {
    const sha = 'ab'.repeat(32);
    const cases = [
      [`ship-skins/_parts/${sha}.glb`, 'model/gltf-binary'],
      [`ship-skins/_interiors/${sha}.glb`, 'model/gltf-binary'],
      [`ship-skins/_hulls/${sha}.glb`, 'model/gltf-binary'],
      [`ship-skins/_manifests/${sha}.json`, 'application/json'],
    ];
    for (const [key, type] of cases) {
      const res = await worker.fetch(new Request(`https://w.dev/${key}`), env({ [key]: 'x' }));
      assert.equal(res.status, 200, key);
      assert.equal(res.headers.get('content-type'), type);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
    }
  });

  it('only exposes manifests under a sha256 name', () => {
    assert.equal(keyFor('/ship-skins/_manifests/' + 'ab'.repeat(32) + '.json'), 'ship-skins/_manifests/' + 'ab'.repeat(32) + '.json');
    assert.equal(keyFor('/ship-skins/_manifests/index.json'), null);
    assert.equal(keyFor('/ship-skins/DRAK/standard.json'), null);
    assert.equal(keyFor('/ship-skins/_parts/index.json'), null);
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

  it('serves codex locale shards immutable and the index short-cached', async () => {
    const dir = 'codex-locale/a3fb1249-9115-4035-9039-2ffc6043d832/pt-BR';
    const shard = `${dir}/mgaq1z2k/_misc-0.json`;
    const index = `${dir}/index.json`;
    const e = env({ [shard]: '{}', [index]: '{}' });
    const s = await worker.fetch(new Request(`https://w.dev/${shard}`), e);
    assert.equal(s.status, 200);
    assert.equal(s.headers.get('content-type'), 'application/json');
    assert.equal(s.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const i = await worker.fetch(new Request(`https://w.dev/${index}?verify=1`), e);
    assert.equal(i.status, 200);
    assert.equal(i.headers.get('cache-control'), 'public, max-age=300');
  });

  it('404s a missing locale key without asking Supabase, and rejects foreign locale shapes', async () => {
    globalThis.fetch = async () => {
      throw new Error('must not proxy locale keys');
    };
    const key = 'codex-locale/a3fb1249-9115-4035-9039-2ffc6043d832/en/index.json';
    const res = await worker.fetch(new Request(`https://w.dev/${key}`), env());
    assert.equal(res.status, 404);
    assert.equal(keyFor('/codex-locale/not-a-uuid/en/index.json'), null);
    assert.equal(keyFor('/codex-locale/a3fb1249-9115-4035-9039-2ffc6043d832/en/../index.json'), null);
    assert.equal(keyFor('/codex-locale/a3fb1249-9115-4035-9039-2ffc6043d832/en/gen/ui-0.json'), null);
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

  it('404s on an upstream 404', async () => {
    globalThis.fetch = async () => new Response('', { status: 404 });
    const res = await worker.fetch(new Request(`https://w.dev/${GLB}`), env());
    assert.equal(res.status, 404);
  });

  it('answers 502 no-store when the Supabase fallback throws', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('network');
    };
    const res = await worker.fetch(new Request(`https://w.dev/${GLB}`), env());
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  for (const status of [503, 429]) {
    it(`answers 502 when the Supabase fallback answers ${status}`, async () => {
      globalThis.fetch = async () => new Response('', { status });
      const res = await worker.fetch(new Request(`https://w.dev/${GLB}`), env());
      assert.equal(res.status, 502);
      assert.equal(res.headers.get('cache-control'), 'no-store');
    });
  }

  it('passes an upstream 304 through with its etag', async () => {
    globalThis.fetch = async () => new Response(null, { status: 304, headers: { etag: '"s"' } });
    const res = await worker.fetch(
      new Request(`https://w.dev/${GLB}`, { headers: { 'if-none-match': '"s"' } }),
      env(),
    );
    assert.equal(res.status, 304);
    assert.equal(res.headers.get('etag'), '"s"');
  });

  it('forwards Range to the Supabase fallback and passes its 206 through', async () => {
    let forwarded;
    globalThis.fetch = async (_url, init) => {
      forwarded = init.headers.range;
      return new Response('le', { status: 206, headers: { 'content-range': 'bytes 0-1/6', 'content-length': '2' } });
    };
    const res = await worker.fetch(
      new Request(`https://w.dev/${GLB}`, { headers: { range: 'bytes=0-1' } }),
      env(),
    );
    assert.equal(forwarded, 'bytes=0-1');
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 0-1/6');
    assert.equal(await res.text(), 'le');
  });

  describe('Range', () => {
    const TEN = '0123456789';
    const get = (range) =>
      worker.fetch(new Request(`https://w.dev/${GLB}`, { headers: { range } }), env({ [GLB]: TEN }));

    for (const [range, contentRange, body] of [
      ['bytes=0-3', 'bytes 0-3/10', '0123'],
      ['bytes=7-', 'bytes 7-9/10', '789'],
      ['bytes=-2', 'bytes 8-9/10', '89'],
      ['bytes=-20', 'bytes 0-9/10', TEN],
      ['bytes=0-99', 'bytes 0-9/10', TEN],
    ]) {
      it(`answers ${range} with 206 ${contentRange}`, async () => {
        const res = await get(range);
        assert.equal(res.status, 206);
        assert.equal(res.headers.get('content-range'), contentRange);
        assert.equal(res.headers.get('content-length'), String(body.length));
        assert.equal(res.headers.get('accept-ranges'), 'bytes');
        assert.equal(res.headers.get('content-type'), 'model/gltf-binary');
        assert.equal(await res.text(), body);
      });
    }

    it('answers a range past the end with 416 and CORS', async () => {
      const res = await get('bytes=99-');
      assert.equal(res.status, 416);
      assert.equal(res.headers.get('content-range'), 'bytes */10');
      assert.equal(res.headers.get('access-control-allow-origin'), '*');
    });

    for (const range of ['bytes=5-2', 'bytes=0-1,4-5', 'items=0-3']) {
      it(`ignores ${range} and serves the whole object`, async () => {
        const res = await get(range);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-range'), null);
        assert.equal(await res.text(), TEN);
      });
    }

    it('advertises accept-ranges on 200 and HEAD', async () => {
      const e = env({ [GLB]: TEN });
      const full = await worker.fetch(new Request(`https://w.dev/${GLB}`), e);
      const head = await worker.fetch(new Request(`https://w.dev/${GLB}`, { method: 'HEAD' }), e);
      assert.equal(full.headers.get('accept-ranges'), 'bytes');
      assert.equal(head.headers.get('accept-ranges'), 'bytes');
    });
  });

  it('answers OPTIONS with 204 and CORS', async () => {
    const res = await worker.fetch(new Request(`https://w.dev/${GLB}`, { method: 'OPTIONS' }), env());
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-methods'), /GET/);
  });

  it('refuses writes and unknown paths', async () => {
    assert.equal((await worker.fetch(new Request(`https://w.dev/${GLB}`, { method: 'PUT' }), env())).status, 405);
    assert.equal((await worker.fetch(new Request('https://w.dev/index.html'), env())).status, 404);
  });
});

describe('news-images', () => {
  const hash = '3f2a9c0d1e';
  const KEY = `news-images/${hash}/w800.webp`;

  it('accepts the fetch-verse-news key shapes and image extensions only', () => {
    assert.equal(keyFor(`/${KEY}`), KEY);
    for (const k of [
      `news-images/${hash}/cover.jpg`,
      `news-images/${hash}/post.jpeg`,
      `news-images/${hash}/w400.png`,
      `news-images/${hash}/w1140.gif`,
      'news-images/x.avif',
    ]) {
      assert.equal(keyFor(`/${k}`), k);
    }
    assert.equal(keyFor(`/news-images/${hash}/w800.svg`), null);
    assert.equal(keyFor(`/news-images/${hash}/w800.html`), null);
    assert.equal(keyFor('/news-images/../ship-skins/a.webp'), null);
    assert.equal(keyFor('/news-images/%2e%2e/secret.png'), null);
    assert.equal(keyFor('/news-images/.hidden/a.png'), null);
    assert.equal(fallbackBucket(KEY), 'news-images');
  });

  it('serves an R2 copy with the short cache and image type', async () => {
    const key = `news-images/${hash}/cover.jpg`;
    const res = await worker.fetch(new Request(`https://w.dev/${key}`), env({ [key]: 'jpg' }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=3600, stale-while-revalidate=86400');
  });

  it('streams a key R2 lacks from the public news-images bucket', async () => {
    let asked = '';
    globalThis.fetch = async (url) => {
      asked = String(url);
      return new Response('img', { status: 200, headers: { etag: '"n"', 'content-length': '3' } });
    };
    const res = await worker.fetch(new Request(`https://w.dev/${KEY}`), env());
    assert.equal(asked, `https://example.supabase.co/storage/v1/object/public/news-images/${hash}/w800.webp`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/webp');
    assert.equal(res.headers.get('x-sc-origin'), 'supabase');
  });
});
