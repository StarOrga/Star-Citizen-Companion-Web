import {
  HardpointAnchor,
  Vec3,
  hotspotPosition,
  parseGlbNodePositions,
  positionForPort,
  readGlbJson,
  resolveAnchors,
} from './glb-hardpoints';

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

/** Wraps a glTF JSON object in a minimal, spec-valid GLB container. */
function encodeGlb(json: unknown): ArrayBuffer {
  return encodeGlbText(JSON.stringify(json));
}

/** Wraps raw (possibly malformed) JSON text in a GLB container. */
function encodeGlbText(jsonText: string): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(jsonText);
  const padLength = (4 - (jsonBytes.length % 4)) % 4;
  const paddedLength = jsonBytes.length + padLength;
  const totalLength = 12 + 8 + paddedLength;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  const bytes = new Uint8Array(buffer);
  bytes.set(jsonBytes, 20);
  for (let i = 0; i < padLength; i++) bytes[20 + jsonBytes.length + i] = 0x20;
  return buffer;
}

const ROT_Y_90 = [0, Math.SQRT1_2, 0, Math.SQRT1_2];

describe('readGlbJson', () => {
  it('reads the JSON chunk of a valid container', () => {
    const buffer = encodeGlb({ asset: { version: '2.0' }, nodes: [] });
    expect(readGlbJson(buffer)).toEqual({ asset: { version: '2.0' }, nodes: [] });
  });

  it('rejects the wrong magic', () => {
    const buffer = encodeGlb({ nodes: [] });
    new DataView(buffer).setUint32(0, 0xdeadbeef, true);
    expect(readGlbJson(buffer)).toBeNull();
  });

  it('rejects the wrong version', () => {
    const buffer = encodeGlb({ nodes: [] });
    new DataView(buffer).setUint32(4, 1, true);
    expect(readGlbJson(buffer)).toBeNull();
  });

  it('rejects a truncated buffer', () => {
    const buffer = encodeGlb({ nodes: [] });
    expect(readGlbJson(buffer.slice(0, 15))).toBeNull();
  });

  it('rejects a chunk length that overruns the buffer', () => {
    const buffer = encodeGlb({ nodes: [] });
    new DataView(buffer).setUint32(12, 0xffffff, true);
    expect(readGlbJson(buffer)).toBeNull();
  });

  it('rejects malformed JSON', () => {
    const buffer = encodeGlbText('{not valid json');
    expect(readGlbJson(buffer)).toBeNull();
  });
});

describe('parseGlbNodePositions', () => {
  it('reads a flat node translation', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'hardpoint_a', translation: [1, 2, 3] }],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.get('hardpoint_a')).toEqual([1, 2, 3]);
  });

  it('accumulates the parent translation onto the child', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'parent', translation: [10, 0, 0], children: [1] },
        { name: 'child', translation: [1, 2, 3] },
      ],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.get('parent')).toEqual([10, 0, 0]);
    expect(positions.get('child')).toEqual([11, 2, 3]);
  });

  it('rotates the child offset by the parent rotation', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'parent', rotation: ROT_Y_90, children: [1] },
        { name: 'child', translation: [1, 0, 0] },
      ],
    });
    const positions = parseGlbNodePositions(buffer);
    const child = positions.get('child')!;
    expect(child[0]).toBeCloseTo(0, 5);
    expect(child[1]).toBeCloseTo(0, 5);
    expect(child[2]).toBeCloseTo(-1, 5);
  });

  it('multiplies the child offset by the parent scale', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'parent', scale: [2, 2, 2], children: [1] },
        { name: 'child', translation: [1, 0, 0] },
      ],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.get('child')).toEqual([2, 0, 0]);
  });

  it('reads a node using an explicit matrix instead of TRS', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        {
          name: 'matrix_node',
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1],
        },
      ],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.get('matrix_node')).toEqual([5, 6, 7]);
  });

  it('skips nodes without a name', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ translation: [1, 2, 3] }],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.size).toBe(0);
  });

  it('keeps the first occurrence of a duplicate name (parent before descendant)', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'dupe', translation: [1, 0, 0], children: [1] },
        { name: 'dupe', translation: [99, 99, 99] },
      ],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.get('dupe')).toEqual([1, 0, 0]);
  });

  it('keeps the first occurrence of a duplicate name (siblings, declared order)', () => {
    // Regression guard: the walk is a LIFO stack, so siblings must be pushed in
    // reverse to be VISITED in declaration order. Without that, the last
    // declared sibling would win and the documented guarantee would be a lie.
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { name: 'dupe', translation: [1, 0, 0] },
        { name: 'dupe', translation: [99, 99, 99] },
      ],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.get('dupe')).toEqual([1, 0, 0]);
  });

  it('visits child nodes in declaration order', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'root', translation: [0, 0, 0], children: [1, 2] },
        { name: 'shared', translation: [5, 0, 0] },
        { name: 'shared', translation: [-5, 0, 0] },
      ],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.get('shared')).toEqual([5, 0, 0]);
  });

  it('terminates on a cyclic children graph instead of hanging', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'a', translation: [1, 0, 0], children: [1] },
        { name: 'b', translation: [0, 1, 0], children: [0] },
      ],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.get('a')).toEqual([1, 0, 0]);
    expect(positions.get('b')).toEqual([1, 1, 0]);
  });

  it('yields no entry for a non-finite translation', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'broken', translation: [Number.POSITIVE_INFINITY, 0, 0] }],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.has('broken')).toBe(false);
  });

  it('yields no entry for a malformed matrix and does not crash the walk', () => {
    const buffer = encodeGlb({
      scene: 0,
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { name: 'wrong_length', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7] },
        { name: 'nan_matrix', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Number.NaN, 6, 7, 1] },
      ],
    });
    const positions = parseGlbNodePositions(buffer);
    expect(positions.has('wrong_length')).toBe(false);
    expect(positions.has('nan_matrix')).toBe(false);
  });

  describe('root selection', () => {
    it('honours scenes[scene].nodes', () => {
      const buffer = encodeGlb({
        scene: 0,
        scenes: [{ nodes: [1] }],
        nodes: [
          { name: 'unclaimed', translation: [1, 1, 1] },
          { name: 'declared_root', translation: [2, 2, 2] },
        ],
      });
      const positions = parseGlbNodePositions(buffer);
      expect(positions.has('unclaimed')).toBe(false);
      expect(positions.get('declared_root')).toEqual([2, 2, 2]);
    });

    it('falls back to unclaimed nodes when there are no scenes', () => {
      const buffer = encodeGlb({
        nodes: [
          { name: 'root', translation: [1, 1, 1], children: [1] },
          { name: 'child', translation: [1, 0, 0] },
        ],
      });
      const positions = parseGlbNodePositions(buffer);
      expect(positions.get('root')).toEqual([1, 1, 1]);
      expect(positions.get('child')).toEqual([2, 1, 1]);
    });
  });
});

describe('positionForPort', () => {
  it('matches exactly', () => {
    const positions = new Map<string, Vec3>([['hardpoint_weapon_left', [1, 2, 3]]]);
    expect(positionForPort(positions, 'hardpoint_weapon_left')).toEqual([1, 2, 3]);
  });

  it('matches case-insensitively', () => {
    const positions = new Map<string, Vec3>([['Hardpoint_Weapon_Left', [1, 2, 3]]]);
    expect(positionForPort(positions, 'hardpoint_weapon_left')).toEqual([1, 2, 3]);
  });

  it('matches the helper_<port> form', () => {
    const positions = new Map<string, Vec3>([['helper_hardpoint_relay_front', [4, 5, 6]]]);
    expect(positionForPort(positions, 'hardpoint_relay_front')).toEqual([4, 5, 6]);
  });

  it('matches the helper_<port without the hardpoint_ prefix> form', () => {
    const positions = new Map<string, Vec3>([['helper_life_support', [7, 8, 9]]]);
    expect(positionForPort(positions, 'hardpoint_life_support')).toEqual([7, 8, 9]);
  });

  it('returns null for an unknown port', () => {
    const positions = new Map<string, Vec3>([['hardpoint_weapon_left', [1, 2, 3]]]);
    expect(positionForPort(positions, 'hardpoint_missing')).toBeNull();
  });

  it('returns null for an empty string', () => {
    const positions = new Map<string, Vec3>([['hardpoint_weapon_left', [1, 2, 3]]]);
    expect(positionForPort(positions, '')).toBeNull();
  });
});

describe('resolveAnchors', () => {
  const positions = new Map<string, Vec3>([
    ['hardpoint_weapon_left', [1, 2, 3]],
    ['hardpoint_weapon_right', [4, 5, 6]],
  ]);

  it('drops ports with no locator', () => {
    const anchors = resolveAnchors(positions, [
      { port: 'hardpoint_weapon_left', label: 'Left', itemName: null },
      { port: 'hardpoint_missing', label: 'Missing', itemName: null },
    ]);
    expect(anchors.map((a) => a.port)).toEqual(['hardpoint_weapon_left']);
  });

  it('preserves input order', () => {
    const anchors = resolveAnchors(positions, [
      { port: 'hardpoint_weapon_right', label: 'Right', itemName: null },
      { port: 'hardpoint_weapon_left', label: 'Left', itemName: null },
    ]);
    expect(anchors.map((a) => a.port)).toEqual(['hardpoint_weapon_right', 'hardpoint_weapon_left']);
  });

  it('de-duplicates repeated ports', () => {
    const anchors = resolveAnchors(positions, [
      { port: 'hardpoint_weapon_left', label: 'Left', itemName: null },
      { port: 'hardpoint_weapon_left', label: 'Left again', itemName: null },
    ]);
    expect(anchors.length).toBe(1);
  });

  it('passes itemName through, null when absent', () => {
    const anchors: HardpointAnchor[] = resolveAnchors(positions, [
      { port: 'hardpoint_weapon_left', label: 'Left', itemName: 'Panther' },
      { port: 'hardpoint_weapon_right', label: 'Right', itemName: null },
    ]);
    expect(anchors[0].itemName).toBe('Panther');
    expect(anchors[1].itemName).toBeNull();
  });
});

describe('hotspotPosition', () => {
  it('formats as three space-separated fixed-4-decimal numbers', () => {
    expect(hotspotPosition([1, -2.5, 3.14159])).toBe('1.0000 -2.5000 3.1416');
  });
});
