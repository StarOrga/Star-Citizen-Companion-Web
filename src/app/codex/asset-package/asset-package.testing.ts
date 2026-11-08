/**
 * Manifest fixtures shared by the asset-package specs. They live here, not in a spec: a spec that
 * another spec imports is evaluated once per worker (Vitest runs with isolate off), so when the
 * importer loaded it first, its own run found no tests ("No test suite found").
 */
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
