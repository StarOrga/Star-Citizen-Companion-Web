import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { uploadSkins, type SkinUploadResult } from '../src/main/skin-ingest.js';

interface CatalogSkin {
  id: string;
  name: string;
  model?: string | null;
  icon?: string | null;
}

/** One exported ship dir: `skins.json` plus a stand-in glb per built skin. */
async function makeShip(shipId: string, skins: CatalogSkin[]): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), 'sc-skins-')), shipId);
  await mkdir(join(dir, 'models'), { recursive: true });
  for (const s of skins) {
    if (s.model) await writeFile(join(dir, s.model), 'glb-bytes');
  }
  await writeFile(join(dir, 'skins.json'), JSON.stringify({ ship: shipId, skins }));
  return dir;
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Happy-path `ingest-skins` + storage responses. */
function stubHappyPath(): void {
  fetchMock.mockImplementation(async (url: string | URL) => {
    const href = String(url);
    if (href.includes('ingest-skins')) {
      return {
        ok: true,
        json: async () => ({
          uploads: [{ path: 'SHIP_A/standard.glb', token: 't', signedUrl: 'http://x/upload' }],
          count: 1,
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe('uploadSkins', () => {
  it('treats a ship with no built model as a successful no-op, not a failure', async () => {
    // A ship can still export nothing even after #512 tightened the manifest
    // gate (its materials resolve, its paints fail to build). Signing an empty
    // object list is a 400 from the function, so such a ship used to be
    // recorded as a failed ship — silently.
    const dir = await makeShip('SHIP_EMPTY', [{ id: 'standard', name: 'Standard', model: null }]);
    const logs: { message: string; level?: string }[] = [];

    const res = await uploadSkins('jwt', [{ shipId: 'SHIP_EMPTY', dir }], (message, level) =>
      logs.push({ message, level }),
    );

    expect(res).toEqual<SkinUploadResult[]>([
      { ok: true, ship_id: 'SHIP_EMPTY', uploaded: 0, committed: 0, empty: true },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    // Marked shipped, so a re-run does not reconsider it.
    expect(await exists(join(dir, '.uploaded'))).toBe(true);
    expect(logs.some((l) => l.level === 'error')).toBe(false);
  });

  it('uploads and commits a ship that did build a model', async () => {
    stubHappyPath();
    const dir = await makeShip('SHIP_A', [
      { id: 'standard', name: 'Standard', model: 'models/standard.glb' },
    ]);

    const res = await uploadSkins('jwt', [{ shipId: 'SHIP_A', dir }], () => {});

    expect(res[0]).toMatchObject({ ok: true, ship_id: 'SHIP_A', uploaded: 1, committed: 1 });
    expect(res[0].empty).toBeUndefined();
    expect(await exists(join(dir, '.uploaded'))).toBe(true);
  });

  it('logs a failing ship instead of dropping the reason on the floor', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) });
    const dir = await makeShip('SHIP_A', [
      { id: 'standard', name: 'Standard', model: 'models/standard.glb' },
    ]);
    const logs: { message: string; level?: string }[] = [];

    const res = await uploadSkins('jwt', [{ shipId: 'SHIP_A', dir }], (message, level) =>
      logs.push({ message, level }),
    );

    expect(res[0]).toMatchObject({ ok: false, ship_id: 'SHIP_A', error: 'forbidden' });
    expect(logs).toContainEqual({ message: 'SHIP_A: sign failed — forbidden', level: 'error' });
    expect(await exists(join(dir, '.uploaded'))).toBe(false);
  });

  it('reports progress for every ship, whatever its outcome', async () => {
    stubHappyPath();
    const built = await makeShip('SHIP_A', [
      { id: 'standard', name: 'Standard', model: 'models/standard.glb' },
    ]);
    const empty = await makeShip('SHIP_EMPTY', [{ id: 'standard', name: 'Standard', model: null }]);
    const seen: [number, number, string][] = [];

    await uploadSkins(
      'jwt',
      [
        { shipId: 'SHIP_A', dir: built },
        { shipId: 'SHIP_EMPTY', dir: empty },
      ],
      () => {},
      { onProgress: (done, total, shipId) => seen.push([done, total, shipId]) },
    );

    expect(seen).toEqual([
      [1, 2, 'SHIP_A'],
      [2, 2, 'SHIP_EMPTY'],
    ]);
  });
});
