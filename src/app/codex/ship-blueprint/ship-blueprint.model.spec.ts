import {
  blueprintView,
  cryToGltf,
  humanizePort,
  humanizeType,
  parseShipBlueprint,
  placeSchemaMarkers,
  projectToView,
  schemaHardpointsFromManifest,
  schemaHardpointsFromPayload,
  viewBoxOf,
} from './ship-blueprint.model';
import { blueprintFixture, blueprintSvg } from './ship-blueprint.testing';
import { parseManifest } from '../asset-package/asset-package.model';
import type { HardpointMarker } from '../hardpoint-map';

describe('ship blueprint model', () => {
  describe('parseShipBlueprint', () => {
    it('reads both views, their projection and the three line sets', () => {
      const bp = blueprintFixture('full');
      expect(bp.lod).toBe('full');
      expect(bp.width).toBe(120);
      expect(bp.extentM).toEqual([10, 4, 2]);
      expect(bp.views.map((v) => v.view)).toEqual(['top', 'side']);
      const top = blueprintView(bp, 'top')!;
      expect(top.box).toEqual({ x: 10, y: 10, w: 100, h: 40 });
      expect(top.hull).toBe('M10 10l100 0 0 40 -100 0z');
      expect(top.major).toBe('M40 20l40 0');
      expect(top.minor).toBe('M20 30l10 0');
    });

    it('reads the icon LOD (top view only, no detail lines)', () => {
      const bp = blueprintFixture('icon');
      expect(bp.lod).toBe('icon');
      expect(bp.views.length).toBe(1);
      expect(blueprintView(bp, 'top')!.minor).toBe('');
      expect(blueprintView(bp, 'side')).toBeNull();
    });

    it('refuses anything that is not a blueprint', () => {
      expect(parseShipBlueprint('')).toBeNull();
      expect(parseShipBlueprint('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBeNull();
      expect(parseShipBlueprint('not xml at all <<<')).toBeNull();
      expect(parseShipBlueprint(blueprintSvg('full').replace('data-lod="full"', 'data-lod="huge"'))).toBeNull();
      expect(parseShipBlueprint(blueprintSvg('full').replace('"frame":"gltf-y-up-metres"', '"frame":"cry"'))).toBeNull();
    });

    it('drops path data that is not plain M/l/z numbers, instead of passing it on', () => {
      const evil = blueprintSvg('full').replace('d="M40 20l40 0"', 'd="M40 20 url(javascript:alert(1))"');
      const bp = parseShipBlueprint(evil)!;
      expect(blueprintView(bp, 'top')!.major).toBe('');
      // A view without a usable outline is no view at all.
      const noHull = blueprintSvg('icon').replace('d="M10 10l100 0 0 40 -100 0z"', 'd="<script>"');
      expect(parseShipBlueprint(noHull)).toBeNull();
    });

    it('ignores foreign elements: only the paths it knows are read', () => {
      const withScript = blueprintSvg('icon', '<script>window.__pwned = 1</script>');
      const bp = parseShipBlueprint(withScript)!;
      expect(bp.views.length).toBe(1);
      expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    });
  });

  describe('projection', () => {
    it('maps the nose (-z) to the right end and starboard (+x) down in the top view', () => {
      const top = blueprintView(blueprintFixture(), 'top')!;
      expect(projectToView(top, [0, 0, -5])).toEqual({ x: 110, y: 30 });
      expect(projectToView(top, [0, 0, 5])).toEqual({ x: 10, y: 30 });
      expect(projectToView(top, [2, 0, 0])).toEqual({ x: 60, y: 50 });
    });

    it('maps up (+y) to the top edge in the side view', () => {
      const side = blueprintView(blueprintFixture(), 'side')!;
      expect(projectToView(side, [0, 1, 0]).y).toBe(70);
      expect(projectToView(side, [0, -1, 0]).y).toBe(90);
    });

    it('converts CryEngine positions (+Y nose, +Z up) into glTF space', () => {
      expect(cryToGltf([1, 2, 3])).toEqual([1, 3, -2]);
      // A CryEngine nose point lands on the drawing's nose.
      const top = blueprintView(blueprintFixture(), 'top')!;
      expect(projectToView(top, cryToGltf([0, 5, 0])).x).toBe(110);
    });

    it('frames a view with padding', () => {
      expect(viewBoxOf(blueprintView(blueprintFixture(), 'top')!, 5)).toBe('5 5 110 50');
    });
  });

  describe('schema markers', () => {
    const manifest = parseManifest({
      schemaVersion: 1,
      kind: 'ship',
      coordinateSystem: 'gltf-y-up-metres',
      entity: { className: 'TEST_Ship' },
      root: null,
      parts: {},
      placements: [
        { id: 'a', portName: 'hardpoint_weapon_nose', group: 'weapons', itemClass: 'GUN_S3', itemType: 'WeaponGun.Gun', itemSize: 3, position: [0, 0, -4], rotation: [0, 0, 0, 1] },
        { id: 'b', portName: 'hardpoint_gun_on_mount', parentPort: 'a', group: 'weapons', itemClass: 'GUN', position: [0, 0, -4], rotation: [0, 0, 0, 1] },
        { id: 'c', portName: 'hardpoint_missile_left', group: 'missiles', port: { maxSize: 2, types: ['MissileLauncher'] }, position: [-1.5, 0, 0], rotation: [0, 0, 0, 1] },
        { id: 'd', portName: 'hardpoint_shield', group: 'components', itemClass: 'SHLD', itemType: 'Shield', itemSize: 1, position: [0, 0, 3], rotation: [0, 0, 0, 1] },
        { id: 'e', portName: 'seat_pilot', group: 'interior', itemClass: 'SEAT', position: [0, 0, -2], rotation: [0, 0, 0, 1] },
        { id: 'f', portName: 'hardpoint_unplaced', group: 'weapons', itemClass: 'GUN' },
        { id: 'g', portName: 'hardpoint_far_out', group: 'components', itemClass: 'X', position: [9, 0, 0], rotation: [0, 0, 0, 1] },
      ],
    });

    it('takes every ship-level hardpoint with a position, filled or empty — not children, seats or unplaced ports', () => {
      const hps = schemaHardpointsFromManifest(manifest);
      expect(hps.map((h) => h.port)).toEqual([
        'hardpoint_weapon_nose',
        'hardpoint_missile_left',
        'hardpoint_shield',
        'hardpoint_far_out',
      ]);
      const missile = hps.find((h) => h.port === 'hardpoint_missile_left')!;
      expect(missile.size).toBe(2);
      expect(missile.type).toBe('MissileLauncher');
      expect(missile.itemClass).toBeNull();
    });

    it('projects onto the top view, pins stray points to the box and labels from the stage pins', () => {
      const top = blueprintView(blueprintFixture(), 'top')!;
      const markers = placeSchemaMarkers(top, schemaHardpointsFromManifest(manifest), [
        { portName: 'hardpoint_shield', label: 'FR-66 Shield', index: 2 },
        { portName: 'hardpoint_weapon_nose', label: 'Bulldog Repeater', index: 1 },
      ]);
      // Pinned ports first, in pin order; then by group.
      expect(markers.map((m) => m.port)).toEqual([
        'hardpoint_weapon_nose',
        'hardpoint_shield',
        'hardpoint_missile_left',
        'hardpoint_far_out',
      ]);
      const nose = markers[0]!;
      expect(nose.label).toBe('Bulldog Repeater');
      expect(nose.index).toBe(1);
      expect({ x: nose.x, y: nose.y }).toEqual({ x: 100, y: 30 });
      const missile = markers.find((m) => m.port === 'hardpoint_missile_left')!;
      expect(missile.label).toBe('Missile Left');
      expect(missile.y).toBe(15);
      // 9 m to starboard is outside the 4 m beam: pinned to the box edge.
      expect(markers.find((m) => m.port === 'hardpoint_far_out')!.y).toBe(50);
    });

    it('places the extractor positions (CryEngine space) for hulls without a package', () => {
      const top = blueprintView(blueprintFixture(), 'top')!;
      const payload: HardpointMarker[] = [
        { port: 'hardpoint_nose', label: 'Nose', itemName: null, position: [0, 4, 0], top: { x: 0, y: 0 }, side: { x: 0, y: 0 }, clamped: false },
      ];
      const [m] = placeSchemaMarkers(top, schemaHardpointsFromPayload(payload));
      expect(m!.x).toBe(100);
      expect(m!.group).toBe('other');
    });

    it('humanizes ports and types for rows without a pin', () => {
      expect(humanizePort('hardpoint_weapon_left_wing')).toBe('Weapon Left Wing');
      expect(humanizeType('WeaponGun.Gun')).toBe('Weapon Gun');
      expect(humanizeType(null)).toBeNull();
    });
  });
});
