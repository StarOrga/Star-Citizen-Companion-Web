import { isSilhouetteKind, parseHoloSilhouette } from './holo-silhouette';

function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'ship',
    class_name: 'DRAK_Cutlass_Black',
    channel: 'LIVE',
    patch_version: '4.9.0',
    build_number: '9999999',
    view_box: '0 0 1000 1000',
    path: 'M 0 0 L 100 0 L 100 100 Z',
    bbox: { x: 120, y: 40, w: 760, h: 920 },
    anchors: [
      { portId: 'hardpoint_gun_left', x: 31.2, y: 42.7, side: 'port', depth: 0.31, source: 'helper', helper: 'hardpoint_gun_left', clamped: false },
    ],
    unresolved: ['hardpoint_shield_generator_2'],
    meta: {
      schema: 1,
      toolVersion: '0.31.0',
      scaleMPerUnit: 0.0323,
      source: {
        hullCga: 'Data/Objects/Spaceships/Ships/DRAK/Cutlass/DRAK_Cutlass_Black.cga',
        method: 'glb-topdown-raster-trace',
        modelSpace: 'cryengine:+X right,+Y nose,+Z up',
        frame: { min: [1, 2, 3], max: [4, 5, 6], source: 'bbox' },
      },
    },
    generated_at: '2026-09-21T10:00:00Z',
    ...overrides,
  };
}

describe('isSilhouetteKind', () => {
  it('accepts the five contract kinds', () => {
    expect(isSilhouetteKind('ship')).toBe(true);
    expect(isSilhouetteKind('weapon')).toBe(true);
    expect(isSilhouetteKind('component')).toBe(true);
    expect(isSilhouetteKind('item')).toBe(true);
    expect(isSilhouetteKind('armor')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isSilhouetteKind('manufacturer')).toBe(false);
    expect(isSilhouetteKind(null)).toBe(false);
    expect(isSilhouetteKind(42)).toBe(false);
  });
});

describe('parseHoloSilhouette', () => {
  it('returns null for a missing row', () => {
    expect(parseHoloSilhouette(null)).toBeNull();
    expect(parseHoloSilhouette(undefined)).toBeNull();
  });

  it('parses a full valid row into the typed contract', () => {
    const result = parseHoloSilhouette(validRow());
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('ship');
    expect(result!.classNameSlug).toBe('DRAK_Cutlass_Black');
    expect(result!.build).toEqual({ channel: 'LIVE', patchVersion: '4.9.0', buildNumber: '9999999' });
    expect(result!.viewBox).toBe('0 0 1000 1000');
    expect(result!.bbox).toEqual({ x: 120, y: 40, w: 760, h: 920 });
    expect(result!.anchors.length).toBe(1);
    expect(result!.anchors[0].portId).toBe('hardpoint_gun_left');
    expect(result!.unresolved).toEqual(['hardpoint_shield_generator_2']);
    expect(result!.toolVersion).toBe('0.31.0');
    expect(result!.scaleMPerUnit).toBeCloseTo(0.0323);
    expect(result!.source?.hullCga).toContain('DRAK_Cutlass_Black.cga');
    expect(result!.source?.frame?.min).toEqual([1, 2, 3]);
  });

  it('defaults schema to 1 and source/toolVersion to null when meta is absent', () => {
    const row = validRow({ meta: undefined });
    const result = parseHoloSilhouette(row);
    expect(result).not.toBeNull();
    expect(result!.schema).toBe(1);
    expect(result!.toolVersion).toBeNull();
    expect(result!.source).toBeNull();
    expect(result!.scaleMPerUnit).toBeNull();
  });

  it('rejects a row with an empty path', () => {
    expect(parseHoloSilhouette(validRow({ path: '' }))).toBeNull();
  });

  it('rejects a row whose path exceeds the size cap', () => {
    expect(parseHoloSilhouette(validRow({ path: 'M'.repeat(200_001) }))).toBeNull();
  });

  it('rejects a row with a missing viewBox', () => {
    expect(parseHoloSilhouette(validRow({ view_box: '' }))).toBeNull();
  });

  it('rejects a row with a non-finite bbox field', () => {
    expect(parseHoloSilhouette(validRow({ bbox: { x: 1, y: 2, w: 'oops', h: 4 } }))).toBeNull();
  });

  it('rejects a row with no bbox at all', () => {
    expect(parseHoloSilhouette(validRow({ bbox: null }))).toBeNull();
  });

  it('rejects a row with a missing class_name', () => {
    expect(parseHoloSilhouette(validRow({ class_name: '' }))).toBeNull();
  });

  it('rejects a row with an unknown kind value instead of guessing "ship"', () => {
    const result = parseHoloSilhouette(validRow({ kind: 'nonsense' }));
    expect(result).toBeNull();
  });

  it('drops an anchor with an out-of-range percentage instead of clamping it', () => {
    const row = validRow({
      anchors: [
        { portId: 'ok', x: 50, y: 50, side: null, depth: null, source: null, helper: null, clamped: false },
        { portId: 'bad', x: 150, y: 50, side: null, depth: null, source: null, helper: null, clamped: false },
      ],
    });
    const result = parseHoloSilhouette(row);
    expect(result!.anchors.length).toBe(1);
    expect(result!.anchors[0].portId).toBe('ok');
  });

  it('drops an anchor missing its portId', () => {
    const row = validRow({ anchors: [{ x: 10, y: 10 }] });
    expect(parseHoloSilhouette(row)!.anchors).toEqual([]);
  });

  it('treats a non-array anchors/unresolved value as empty', () => {
    const row = validRow({ anchors: null, unresolved: null });
    const result = parseHoloSilhouette(row);
    expect(result!.anchors).toEqual([]);
    expect(result!.unresolved).toEqual([]);
  });

  it('filters non-string entries out of unresolved', () => {
    const row = validRow({ unresolved: ['a', 42, null, 'b'] });
    expect(parseHoloSilhouette(row)!.unresolved).toEqual(['a', 'b']);
  });
});
