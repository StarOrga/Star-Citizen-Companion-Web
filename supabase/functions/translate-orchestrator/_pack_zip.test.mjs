// node --test supabase/functions/translate-orchestrator/_pack_zip.test.mjs
// The zip path of the community seed import (42Kit data.zip). Deno uses npm:fflate; here a small
// in-test reader with the same `unzipSync(zip, { filter })` contract is injected, over a zip the
// test builds itself (raw deflate + stored entries, central directory).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync, crc32 } from 'node:zlib';
import { parsePack, resolveSource, unzipEntry } from './_pack.ts';

const enc = (s) => new TextEncoder().encode(s);

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, deflate } of entries) {
    const nameB = Buffer.from(name);
    const raw = Buffer.from(data);
    const body = deflate ? deflateRawSync(raw) : raw;
    const method = deflate ? 8 : 0;
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameB.length, 26);
    locals.push(lh, nameB, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameB.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameB);
    offset += lh.length + nameB.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

/** Same contract as fflate's unzipSync(data, { filter }): only entries passing the filter are inflated. */
function miniUnzip(zip, opts) {
  const b = Buffer.from(zip);
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  const n = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    const method = b.readUInt16LE(p + 10);
    const csize = b.readUInt32LE(p + 20);
    const nl = b.readUInt16LE(p + 28);
    const el = b.readUInt16LE(p + 30);
    const cl = b.readUInt16LE(p + 32);
    const lho = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + el + cl;
    if (!opts.filter({ name })) continue;
    const start = lho + 30 + b.readUInt16LE(lho + 26) + b.readUInt16LE(lho + 28);
    const body = b.subarray(start, start + csize);
    out[name] = new Uint8Array(method === 8 ? Buffer.from(require_inflate(body)) : body);
  }
  return out;
}
import { inflateRawSync } from 'node:zlib';
const require_inflate = (body) => inflateRawSync(body);

const INI = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Frontend_PU_Version=Pack\r\nItem_Name,P=Wert Ä\r\nUI_Foo=a=b\r\n')]);

const zip = () => buildZip([
  { name: 'readme.txt', data: 'hi', deflate: false },
  { name: 'data/Localization/chinese_(simplified)/global.ini', data: INI, deflate: true },
]);

describe('unzipEntry', () => {
  it('finds the entry and returns its inflated bytes', async () => {
    const out = await unzipEntry(zip(), 'data/Localization/chinese_(simplified)/global.ini', miniUnzip);
    assert.deepEqual(Buffer.from(out), INI);
  });
  it('a missing entry fails with the translate.source_entry_missing key', async () => {
    await assert.rejects(unzipEntry(zip(), 'data/nope.ini', miniUnzip), { message: 'translate.source_entry_missing' });
  });
  it('the UTF-8 BOM and ,P keys survive the zip round trip into parsePack', async () => {
    const out = await unzipEntry(zip(), 'data/Localization/chinese_(simplified)/global.ini', miniUnzip);
    assert.equal(out[0], 0xef);
    const p = parsePack(out);
    assert.equal(p.header, 'Pack');
    assert.equal(p.map.get('item_name'), 'Wert Ä');
    assert.equal(p.map.get('ui_foo'), 'a=b');
  });
});

describe('resolveSource zip-entry', () => {
  const src = { raw_url: 'https://example.test/data.zip', resolver: 'zip-entry:data/Localization/chinese_(simplified)/global.ini' };
  it('downloads the zip, extracts the entry and keeps the etag as token', async () => {
    const bytes = zip();
    const f = async () => new Response(bytes, { status: 200, headers: { etag: '"abc"' } });
    const r = await resolveSource(src, f, undefined, miniUnzip);
    assert.deepEqual(Buffer.from(r.bytes), INI);
    assert.equal(r.token, '"abc"');
  });
  it('a zip over the size cap is refused before unzipping', async () => {
    const f = async () => new Response(enc('x'), { status: 200, headers: { 'content-length': String(500 * 1024 * 1024) } });
    let called = false;
    const r = resolveSource(src, f, undefined, () => { called = true; return {}; });
    await r.catch(() => {});
    if (!called) return;
    assert.fail('unzip must not run for an oversized zip');
  });
});
