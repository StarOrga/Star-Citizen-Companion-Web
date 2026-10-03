import {
  ManifestError,
  availableGroups,
  focusedPlacementIds,
  hotspotPlacements,
  isFreeSlot,
  listPlacements,
  packageUrls,
  parseManifest,
  placementVisible,
  plausibleBounds,
  rowFromDb,
  selectablePlacements,
  type PlacementGroup,
} from './asset-package.model';

export function placementFixture(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'hp',
    portName: 'hp',
    helperName: null,
    parentPort: null,
    group: 'components',
    itemClass: null,
    itemGuid: null,
    itemType: null,
    itemSubType: null,
    itemSize: null,
    parentClass: 'SHIP',
    port: null,
    loadout: 'default',
    partSha256: null,
    position: null,
    rotation: null,
    ...over,
  };
}

export function manifestFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'ship',
    coordinateSystem: 'gltf-y-up-metres',
    entity: { className: 'AEGS_Gladius', guid: 'g' },
    root: { sha256: 'root', bytes: 10, bounds: { min: [-5, -2, -10], max: [5, 2, 10] } },
    interior: { sha256: 'int', bytes: 5 },
    parts: { pp: { bytes: 3, geometryPath: 'a.cgf', bounds: null }, gun: { bytes: 3, geometryPath: 'g.cgf', bounds: null } },
    placements: [
      placementFixture({
        id: 'hardpoint_power_plant', portName: 'hardpoint_power_plant', itemClass: 'POWR_A', itemType: 'PowerPlant',
        itemSize: 1, partSha256: 'pp', position: [0, 0.1, -1.7], rotation: [0, 0, 0, 1],
      }),
      placementFixture({
        id: 'turret', portName: 'turret', group: 'weapons', itemClass: 'MOUNT', partSha256: 'gun',
        position: [1, 0, 0], rotation: [0, 0, 0, 1],
      }),
      placementFixture({
        id: 'turret/gun', portName: 'gun', parentPort: 'turret', group: 'weapons', itemClass: 'GUN', partSha256: 'gun',
        position: [1, 0.5, 0], rotation: [0, 0, 0, 1],
      }),
      placementFixture({ id: 'paint', portName: 'hardpoint_paint', group: 'other' }),
      placementFixture({
        id: 'optic', portName: 'optics_attach', group: 'attachments',
        port: { minSize: 1, maxSize: 2, types: ['WeaponAttachment.IronSight'], flags: [], editable: true }, loadout: 'empty',
      }),
      placementFixture({ id: 'half', portName: 'half', itemClass: 'X', position: [1, 2, 3], rotation: null }),
    ],
  };
}

describe('asset-package model', () => {
  it('parses a manifest and keeps transforms verbatim', () => {
    const m = parseManifest(manifestFixture());
    expect(m.kind).toBe('ship');
    expect(m.placements.length).toBe(6);
    const pp = m.placements[0];
    expect(pp.position).toEqual([0, 0.1, -1.7]);
    expect(pp.rotation).toEqual([0, 0, 0, 1]);
    expect(m.root?.bounds?.max).toEqual([5, 2, 10]);
    expect(m.parts['pp'].geometryPath).toBe('a.cgf');
  });

  it('drops a half transform instead of guessing', () => {
    const m = parseManifest(manifestFixture());
    const half = m.placements.find((p) => p.id === 'half')!;
    expect(half.position).toBeNull();
    expect(half.rotation).toBeNull();
  });

  it('rejects contract breaks', () => {
    expect(() => parseManifest({ ...manifestFixture(), schemaVersion: 2 })).toThrowError(ManifestError);
    expect(() => parseManifest({ ...manifestFixture(), coordinateSystem: 'cry-z-up' })).toThrowError(ManifestError);
    expect(() => parseManifest({ ...manifestFixture(), kind: 'vehicle' })).toThrowError(ManifestError);
    expect(() => parseManifest(null)).toThrowError(ManifestError);
  });

  it('maps an unknown group to other', () => {
    const raw = manifestFixture();
    (raw['placements'] as Record<string, unknown>[])[0]['group'] = 'thrusters';
    expect(parseManifest(raw).placements[0].group).toBe('other');
  });

  it('maps db rows and rejects incomplete ones', () => {
    const row = rowFromDb({
      kind: 'item', entity_class: 'POWR_A', ship_id: null, manifest_sha256: 'm', root_sha256: 'r',
      interior_sha256: null, part_count: 2, total_bytes: 99, schema_version: 1,
    });
    expect(row).toEqual(jasmine.objectContaining({ kind: 'item', entityClass: 'POWR_A', manifestSha256: 'm', partCount: 2 }));
    expect(rowFromDb({ kind: 'ship', entity_class: 'X' })).toBeNull();
    expect(rowFromDb({ kind: 'boat', entity_class: 'X', manifest_sha256: 'm' })).toBeNull();
  });

  it('builds sha-keyed urls; ship roots are hulls, item roots are parts', () => {
    const u = packageUrls('https://r2.test/ship-skins');
    expect(u.manifest('m')).toBe('https://r2.test/ship-skins/_manifests/m.json');
    expect(u.root('ship', 'h')).toBe('https://r2.test/ship-skins/_hulls/h.glb');
    expect(u.root('fps_weapon', 'h')).toBe('https://r2.test/ship-skins/_parts/h.glb');
    expect(u.root('item', 'h')).toBe('https://r2.test/ship-skins/_parts/h.glb');
    expect(u.interior('i')).toBe('https://r2.test/ship-skins/_interiors/i.glb');
  });

  it('selects hotspots, list rows, free slots and toggleable groups', () => {
    const m = parseManifest(manifestFixture());
    expect(hotspotPlacements(m).map((p) => p.id)).toEqual(['hardpoint_power_plant', 'turret', 'turret/gun']);
    expect(listPlacements(m).map((p) => p.id)).toEqual(['hardpoint_power_plant', 'turret', 'turret/gun', 'optic', 'half']);
    expect(isFreeSlot(m.placements.find((p) => p.id === 'optic')!)).toBeTrue();
    expect(availableGroups(m)).toEqual(['weapons', 'components', 'interior']);
  });

  it('lets the label step through filled hotspots and positioned free slots', () => {
    const raw = manifestFixture();
    (raw['placements'] as Record<string, unknown>[]).push(
      placementFixture({
        id: 'empty_gun', portName: 'hardpoint_weapon_left', group: 'weapons', position: [2, 0, 1], rotation: [0, 0, 0, 1],
        port: { minSize: 1, maxSize: 3, types: ['WeaponGun'], flags: [], editable: true }, loadout: 'empty',
      }),
    );
    const m = parseManifest(raw);
    // optic is free but has no transform; paint has no port; half has no transform.
    expect(selectablePlacements(m).map((p) => p.id)).toEqual(['hardpoint_power_plant', 'turret', 'turret/gun', 'empty_gun']);
  });

  it('cascades show/hide through parentPort', () => {
    const m = parseManifest(manifestFixture());
    const byId = new Map(m.placements.map((p) => [p.id, p] as const));
    const gun = byId.get('turret/gun')!;
    const all = new Set<PlacementGroup>(['weapons', 'components']);
    expect(placementVisible(gun, all, new Set(), byId)).toBeTrue();
    expect(placementVisible(gun, all, new Set(['turret']), byId)).toBeFalse();
    expect(placementVisible(gun, new Set<PlacementGroup>(['components']), new Set(), byId)).toBeFalse();
  });

  it('focuses the hovered placement with its children, or the active ports by exact name', () => {
    const m = parseManifest(manifestFixture());
    expect(focusedPlacementIds(m, 'turret', [])).toEqual(['turret', 'turret/gun']);
    expect(focusedPlacementIds(m, null, ['HARDPOINT_POWER_PLANT'])).toEqual(['hardpoint_power_plant']);
    expect(focusedPlacementIds(m, null, ['power_plant'])).toEqual([]);
    expect(focusedPlacementIds(m, 'turret/gun', ['hardpoint_power_plant'])).toEqual(['turret/gun']);
  });

  it('only trusts plausible metre bounds for framing', () => {
    expect(plausibleBounds({ min: [-5, -2, -10], max: [5, 2, 10] })).not.toBeNull();
    expect(plausibleBounds({ min: [-283871, -83811, -322447], max: [283871, 83812, 322444] })).toBeNull();
    expect(plausibleBounds(null)).toBeNull();
  });
});
