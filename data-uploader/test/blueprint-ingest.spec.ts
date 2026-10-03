import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { BLUEPRINT_MARKER, hullFileOf, uploadBlueprint } from '../src/main/blueprint-ingest.js';
import type { BlueprintFiles } from '../src/lib/blueprint/build.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const FILES: BlueprintFiles = { full: '<svg data-lod="full"/>', icon: '<svg data-lod="icon"/>', extentM: [1, 1, 1] };

async function makeShip(withModel = true): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'sc-bp-')), 'SHIP_A');
  await mkdir(join(dir, 'models'), { recursive: true });
  if (withModel) await writeFile(join(dir, 'models', 'hull.glb'), 'hull-bytes');
  await writeFile(
    join(dir, 'skins.json'),
    JSON.stringify({ ship: 'SHIP_A', skins: [{ id: 'paint', icon: 'icons/p.webp' }, ...(withModel ? [{ id: 'standard', model: 'models/hull.glb' }] : [])] }),
  );
  return dir;
}

const exists = async (p: string): Promise<boolean> => access(p).then(() => true, () => false);

function deps(signReply: Record<string, unknown> | { error: string }) {
  const calls: Record<string, unknown>[] = [];
  const call = vi.fn(async (body: unknown) => {
    const b = body as Record<string, unknown>;
    calls.push(b);
    if (b['action'] === 'blueprint_sign') {
      return 'error' in signReply
        ? { ok: false, json: {}, error: signReply.error as string }
        : { ok: true, json: signReply };
    }
    return { ok: true, json: { ok: true, rows: 1 } };
  });
  const put = vi.fn(async () => undefined);
  const draw = vi.fn(async () => FILES);
  return { calls, call, put, draw, onLog: vi.fn() };
}

const BOTH_NEW = {
  uploads: [
    { type: 'full', sha256: sha(FILES.full), signedUrl: 'http://r2/full' },
    { type: 'icon', sha256: sha(FILES.icon), signedUrl: 'http://r2/icon' },
  ],
};

describe('blueprint upload', () => {
  it('finds the hull through skins.json', async () => {
    const dir = await makeShip();
    expect(hullFileOf(dir)).toBe(join(dir, 'models', 'hull.glb'));
    expect(hullFileOf(await makeShip(false))).toBeNull();
  });

  it('skips a ship without a hull and calls nothing', async () => {
    const d = deps(BOTH_NEW);
    const r = await uploadBlueprint({ shipId: 'SHIP_A', dir: await makeShip(false), force: false }, d);
    expect(r).toEqual({ ok: true, skipped: 'no_hull' });
    expect(d.call).not.toHaveBeenCalled();
  });

  it('draws, caches, signs, PUTs the new files and commits both shas', async () => {
    const dir = await makeShip();
    const d = deps(BOTH_NEW);
    const r = await uploadBlueprint({ shipId: 'SHIP_A', dir, force: false }, d);
    expect(r).toEqual({ ok: true, uploaded: 2 });
    expect(d.calls[0]).toEqual({
      action: 'blueprint_sign',
      ship_id: 'SHIP_A',
      objects: [
        { type: 'full', sha256: sha(FILES.full), bytes: FILES.full.length },
        { type: 'icon', sha256: sha(FILES.icon), bytes: FILES.icon.length },
      ],
    });
    expect(d.put).toHaveBeenCalledWith('http://r2/full', expect.any(Buffer), 'image/svg+xml');
    expect(d.calls[1]).toEqual({
      action: 'blueprint_commit',
      ship_id: 'SHIP_A',
      full_sha256: sha(FILES.full),
      icon_sha256: sha(FILES.icon),
    });
    expect(await readFile(join(dir, 'blueprint', 'full.svg'), 'utf-8')).toBe(FILES.full);
    expect((await readFile(join(dir, BLUEPRINT_MARKER), 'utf-8')).trim()).toBe(`${sha(FILES.full)} ${sha(FILES.icon)}`);
  });

  it('a live ship costs no call; the cached drawing is reused', async () => {
    const dir = await makeShip();
    await uploadBlueprint({ shipId: 'SHIP_A', dir, force: false }, deps(BOTH_NEW));
    const d = deps(BOTH_NEW);
    expect(await uploadBlueprint({ shipId: 'SHIP_A', dir, force: false }, d)).toEqual({ ok: true, skipped: 'live' });
    expect(d.call).not.toHaveBeenCalled();
    expect(d.draw).not.toHaveBeenCalled();
  });

  it('force re-links a live ship (its hull was just re-committed); stored objects are not PUT again', async () => {
    const dir = await makeShip();
    await uploadBlueprint({ shipId: 'SHIP_A', dir, force: false }, deps(BOTH_NEW));
    const d = deps({ uploads: BOTH_NEW.uploads.map((u) => ({ ...u, signedUrl: '', exists: true })) });
    expect(await uploadBlueprint({ shipId: 'SHIP_A', dir, force: true }, d)).toEqual({ ok: true, uploaded: 0 });
    expect(d.put).not.toHaveBeenCalled();
    expect(d.calls.map((c) => c['action'])).toEqual(['blueprint_sign', 'blueprint_commit']);
  });

  it('redraws when the hull changed', async () => {
    const dir = await makeShip();
    await uploadBlueprint({ shipId: 'SHIP_A', dir, force: false }, deps(BOTH_NEW));
    await writeFile(join(dir, 'models', 'hull.glb'), 'other-hull');
    const d = deps(BOTH_NEW);
    await uploadBlueprint({ shipId: 'SHIP_A', dir, force: false }, d);
    expect(d.draw).toHaveBeenCalledTimes(1);
  });

  it('reports a closed cost gate and an unsupported function so the run stops asking', async () => {
    const gated = await uploadBlueprint({ shipId: 'SHIP_A', dir: await makeShip(), force: false }, deps({ error: 'r2_free_tier_guard' }));
    expect(gated).toMatchObject({ ok: false, gate: 'r2_free_tier_guard' });
    const old = await uploadBlueprint({ shipId: 'SHIP_A', dir: await makeShip(), force: false }, deps({ error: 'r2_required' }));
    expect(old).toMatchObject({ ok: false, unsupported: true });
  });

  it('a drawing failure never throws and writes no marker', async () => {
    const dir = await makeShip();
    const d = deps(BOTH_NEW);
    d.draw.mockRejectedValueOnce(new Error('bad glb'));
    const r = await uploadBlueprint({ shipId: 'SHIP_A', dir, force: false }, d);
    expect(r).toMatchObject({ ok: false, error: 'bad glb' });
    expect(await exists(join(dir, BLUEPRINT_MARKER))).toBe(false);
  });
});
