import {
  HardpointFrame,
  buildHardpointMarkers,
  hardpointViewBox,
  isVec3,
  projectHardpoint,
  readHardpointFrame,
  readHardpointTransforms,
} from './hardpoint-map';

// A 8 m wide (X), 16 m long (Y), 4 m tall (Z) hull, centred on the origin.
const FRAME: HardpointFrame = { min: [-4, -8, -1.5], max: [4, 8, 2.5], source: 'bbox' };

describe('isVec3', () => {
  it('accepts a finite numeric triple only', () => {
    expect(isVec3([1, 2, 3])).toBe(true);
    expect(isVec3([1, 2])).toBe(false);
    expect(isVec3([1, 2, 3, 4])).toBe(false);
    expect(isVec3([1, Number.NaN, 3])).toBe(false);
    expect(isVec3([1, Number.POSITIVE_INFINITY, 3])).toBe(false);
    expect(isVec3(['1', '2', '3'])).toBe(false);
    expect(isVec3(null)).toBe(false);
  });
});

describe('readHardpointFrame', () => {
  it('reads a valid frame and keeps its source', () => {
    expect(readHardpointFrame({ min: [-1, -2, -3], max: [1, 2, 3], source: 'ports' })).toEqual({
      min: [-1, -2, -3],
      max: [1, 2, 3],
      source: 'ports',
    });
  });

  it('defaults an unknown source to bbox', () => {
    expect(readHardpointFrame({ min: [0, 0, 0], max: [1, 1, 1] })?.source).toBe('bbox');
  });

  it('rejects a missing, degenerate or inverted box', () => {
    expect(readHardpointFrame(undefined)).toBeNull();
    expect(readHardpointFrame(null)).toBeNull();
    expect(readHardpointFrame({})).toBeNull();
    expect(readHardpointFrame({ min: [0, 0, 0], max: [0, 1, 1] })).toBeNull(); // flat X
    expect(readHardpointFrame({ min: [0, 0, 0], max: [-1, 1, 1] })).toBeNull(); // inverted
    expect(readHardpointFrame({ min: [0, 0], max: [1, 1] })).toBeNull();
  });
});

describe('readHardpointTransforms', () => {
  it('reads position, rotation, helper and source', () => {
    const map = readHardpointTransforms({
      hardpoint_weapon_left: {
        position: [-3.5, 2, 0.5],
        rotation: [0, 0, 0, 1],
        helper: 'hardpoint_weapon_left',
        source: 'helper',
      },
    });
    expect(map.size).toBe(1);
    expect(map.get('hardpoint_weapon_left')).toEqual({
      position: [-3.5, 2, 0.5],
      rotation: [0, 0, 0, 1],
      helper: 'hardpoint_weapon_left',
      source: 'helper',
    });
  });

  it('drops entries without a usable position', () => {
    const map = readHardpointTransforms({
      good: { position: [1, 2, 3] },
      short: { position: [1, 2] },
      nan: { position: [1, Number.NaN, 3] },
      textual: { position: ['1', '2', '3'] },
      nothing: {},
      wrongType: 42,
    });
    expect([...map.keys()]).toEqual(['good']);
    // A missing rotation is null, not a fake identity quaternion.
    expect(map.get('good')!.rotation).toBeNull();
    expect(map.get('good')!.helper).toBeNull();
  });

  it('treats a missing map as no data', () => {
    expect(readHardpointTransforms(undefined).size).toBe(0);
    expect(readHardpointTransforms(null).size).toBe(0);
    expect(readHardpointTransforms([1, 2]).size).toBe(0);
  });
});

describe('projectHardpoint', () => {
  it('puts the nose up in the top view and to the right in the side view', () => {
    const nose = projectHardpoint([0, 8, 0.5], FRAME)!;
    expect(nose.top.x).toBeCloseTo(0.5, 6);
    expect(nose.top.y).toBeCloseTo(0, 6); // top edge
    expect(nose.side.x).toBeCloseTo(1, 6); // right edge
  });

  it('puts starboard on the right and up at the top', () => {
    const p = projectHardpoint([4, 0, 2.5], FRAME)!;
    expect(p.top.x).toBeCloseTo(1, 6); // +X = right
    expect(p.side.y).toBeCloseTo(0, 6); // +Z = up = top edge
  });

  it('maps the hull centre to the centre of both panels', () => {
    const p = projectHardpoint([0, 0, 0.5], FRAME)!;
    expect(p.top.x).toBeCloseTo(0.5, 6);
    expect(p.top.y).toBeCloseTo(0.5, 6);
    expect(p.side.x).toBeCloseTo(0.5, 6);
    expect(p.side.y).toBeCloseTo(0.5, 6);
    expect(p.clamped).toBe(false);
  });

  it('clamps an out-of-frame position to the edge and flags it', () => {
    const p = projectHardpoint([40, 80, 90], FRAME)!;
    expect(p.clamped).toBe(true);
    expect(p.top.x).toBe(1);
    expect(p.top.y).toBe(0);
    expect(p.side.x).toBe(1);
    expect(p.side.y).toBe(0);
  });

  it('refuses a malformed position', () => {
    expect(projectHardpoint([1, 2], FRAME)).toBeNull();
    expect(projectHardpoint(undefined, FRAME)).toBeNull();
    expect(projectHardpoint([1, Number.NaN, 3], FRAME)).toBeNull();
  });
});

describe('hardpointViewBox', () => {
  it('keeps the hull proportions (a long ship gets a tall top view)', () => {
    const box = hardpointViewBox(FRAME);
    expect(box.top).toBe(200); // 16 m long / 8 m wide
    expect(box.side).toBe(25); // 4 m tall / 16 m long
  });

  it('bounds extreme aspect ratios so a panel stays usable', () => {
    const needle = hardpointViewBox({ min: [-0.2, -60, -0.2], max: [0.2, 60, 0.2], source: 'bbox' });
    expect(needle.top).toBeLessThanOrEqual(260);
    expect(needle.side).toBeGreaterThanOrEqual(16);
  });
});

describe('buildHardpointMarkers', () => {
  const inputs = [
    { port: 'hardpoint_weapon_left', label: 'Weapon Left', itemName: 'Panther', position: [-3.5, 2, 0.5] },
    { port: 'broken', label: 'Broken', itemName: null, position: [1, 2] as unknown as number[] },
  ];

  it('projects the usable hardpoints and keeps input order', () => {
    const markers = buildHardpointMarkers(inputs, FRAME);
    expect(markers.map((m) => m.port)).toEqual(['hardpoint_weapon_left']);
    expect(markers[0].itemName).toBe('Panther');
    expect(markers[0].top.x).toBeCloseTo(0.0625, 4);
  });

  it('yields nothing without a frame — no frame means no shared space', () => {
    expect(buildHardpointMarkers(inputs, null)).toEqual([]);
  });
});
