/**
 * Typed mirror of the 3D asset package manifest
 * (`data-uploader/python/sc_extract/assets3d/manifest.schema.json`,
 * `data-uploader/docs/asset-package.md`).
 *
 * The web only DISPLAYS a package: it loads the GLBs the manifest names and
 * shows/hides them. No geometry math beyond applying the absolute placement
 * transforms, no port-to-node name matching. Everything in this file is pure
 * so the specs can cover it without three.js.
 */

export type AssetPackageKind = 'ship' | 'fps_weapon' | 'item';

export type PlacementGroup = 'weapons' | 'missiles' | 'components' | 'interior' | 'attachments' | 'other';

/** Toolbar order. */
export const PLACEMENT_GROUPS: readonly PlacementGroup[] = [
  'weapons',
  'missiles',
  'components',
  'attachments',
  'interior',
  'other',
];

/** Groups whose filled ports get a hotspot (an inspectable, linkable item). */
export const HOTSPOT_GROUPS: ReadonlySet<PlacementGroup> = new Set<PlacementGroup>([
  'weapons',
  'missiles',
  'components',
  'attachments',
]);

/** Visible on first load. Interior is off: its GLB loads only when switched on. */
export const DEFAULT_GROUPS: readonly PlacementGroup[] = ['weapons', 'missiles', 'components', 'attachments', 'other'];

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface PackagePort {
  readonly minSize: number | null;
  readonly maxSize: number | null;
  readonly types: readonly string[];
  readonly flags: readonly string[];
  readonly editable: boolean;
}

export interface PackagePlacement {
  readonly id: string;
  readonly portName: string;
  readonly helperName: string | null;
  readonly parentPort: string | null;
  readonly group: PlacementGroup;
  readonly itemClass: string | null;
  readonly itemGuid: string | null;
  readonly itemType: string | null;
  readonly itemSubType: string | null;
  readonly itemSize: number | null;
  readonly parentClass: string | null;
  readonly port: PackagePort | null;
  readonly loadout: 'default' | 'empty';
  readonly partSha256: string | null;
  readonly position: Vec3 | null;
  readonly rotation: Quat | null;
}

export interface PackagePart {
  readonly bytes: number;
  readonly geometryPath: string;
  readonly bounds: Bounds | null;
}

export interface AssetPackageManifest {
  readonly schemaVersion: 1;
  readonly kind: AssetPackageKind;
  readonly coordinateSystem: 'gltf-y-up-metres';
  readonly entity: { readonly className: string; readonly guid: string | null };
  readonly root: { readonly sha256: string; readonly bytes: number; readonly bounds: Bounds | null } | null;
  readonly interior: { readonly sha256: string; readonly bytes: number } | null;
  readonly parts: Readonly<Record<string, PackagePart>>;
  readonly placements: readonly PackagePlacement[];
}

/** One `asset_packages` row. */
export interface AssetPackageRow {
  readonly kind: AssetPackageKind;
  readonly entityClass: string;
  readonly shipId: string | null;
  readonly manifestSha256: string;
  readonly rootSha256: string | null;
  readonly interiorSha256: string | null;
  readonly partCount: number;
  readonly totalBytes: number;
  readonly schemaVersion: number;
}

export class ManifestError extends Error {
  override readonly name = 'ManifestError';
}

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const KINDS: readonly AssetPackageKind[] = ['ship', 'fps_weapon', 'item'];

function vec(v: unknown, n: 3): Vec3 | null;
function vec(v: unknown, n: 4): Quat | null;
function vec(v: unknown, n: number): readonly number[] | null {
  if (!Array.isArray(v) || v.length !== n || v.some((x) => num(x) === null)) return null;
  return v as number[];
}

function bounds(v: unknown): Bounds | null {
  if (!isObj(v)) return null;
  const min = vec(v['min'], 3);
  const max = vec(v['max'], 3);
  return min && max ? { min, max } : null;
}

function port(v: unknown): PackagePort | null {
  if (!isObj(v)) return null;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  return {
    minSize: num(v['minSize']),
    maxSize: num(v['maxSize']),
    types: list(v['types']),
    flags: list(v['flags']),
    editable: v['editable'] === true,
  };
}

function placement(v: unknown, i: number): PackagePlacement {
  if (!isObj(v) || !str(v['id'])) throw new ManifestError(`placement ${i} has no id`);
  const group = PLACEMENT_GROUPS.includes(v['group'] as PlacementGroup) ? (v['group'] as PlacementGroup) : 'other';
  const position = vec(v['position'], 3);
  const rotation = vec(v['rotation'], 4);
  return {
    id: v['id'] as string,
    portName: str(v['portName']) ?? (v['id'] as string),
    helperName: str(v['helperName']),
    parentPort: str(v['parentPort']),
    group,
    itemClass: str(v['itemClass']),
    itemGuid: str(v['itemGuid']),
    itemType: str(v['itemType']),
    itemSubType: str(v['itemSubType']),
    itemSize: num(v['itemSize']),
    parentClass: str(v['parentClass']),
    port: port(v['port']),
    loadout: v['loadout'] === 'empty' ? 'empty' : 'default',
    partSha256: str(v['partSha256']),
    // Both or neither: a half transform is not placeable.
    position: position && rotation ? position : null,
    rotation: position && rotation ? rotation : null,
  };
}

/** Validate + type a manifest. Throws {@link ManifestError} on a contract break. */
export function parseManifest(raw: unknown): AssetPackageManifest {
  if (!isObj(raw)) throw new ManifestError('manifest is not an object');
  if (raw['schemaVersion'] !== 1) throw new ManifestError(`unsupported schemaVersion ${String(raw['schemaVersion'])}`);
  if (raw['coordinateSystem'] !== 'gltf-y-up-metres') throw new ManifestError('unexpected coordinateSystem');
  const kind = raw['kind'] as AssetPackageKind;
  if (!KINDS.includes(kind)) throw new ManifestError(`unknown kind ${String(kind)}`);
  if (!Array.isArray(raw['placements'])) throw new ManifestError('placements missing');
  const entity = isObj(raw['entity']) ? raw['entity'] : {};
  const rootRaw = isObj(raw['root']) ? raw['root'] : null;
  const interiorRaw = isObj(raw['interior']) ? raw['interior'] : null;
  const parts: Record<string, PackagePart> = {};
  if (isObj(raw['parts'])) {
    for (const [sha, p] of Object.entries(raw['parts'])) {
      if (!isObj(p)) continue;
      parts[sha] = { bytes: num(p['bytes']) ?? 0, geometryPath: str(p['geometryPath']) ?? '', bounds: bounds(p['bounds']) };
    }
  }
  return {
    schemaVersion: 1,
    kind,
    coordinateSystem: 'gltf-y-up-metres',
    entity: { className: str(entity['className']) ?? '', guid: str(entity['guid']) },
    root:
      rootRaw && str(rootRaw['sha256'])
        ? { sha256: rootRaw['sha256'] as string, bytes: num(rootRaw['bytes']) ?? 0, bounds: bounds(rootRaw['bounds']) }
        : null,
    interior:
      interiorRaw && str(interiorRaw['sha256'])
        ? { sha256: interiorRaw['sha256'] as string, bytes: num(interiorRaw['bytes']) ?? 0 }
        : null,
    parts,
    placements: (raw['placements'] as unknown[]).map(placement),
  };
}

/** Map a raw `asset_packages` row (snake_case); null when unusable. */
export function rowFromDb(r: unknown): AssetPackageRow | null {
  if (!isObj(r)) return null;
  const kind = r['kind'] as AssetPackageKind;
  const entityClass = str(r['entity_class']);
  const manifestSha256 = str(r['manifest_sha256']);
  if (!KINDS.includes(kind) || !entityClass || !manifestSha256) return null;
  return {
    kind,
    entityClass,
    shipId: str(r['ship_id']),
    manifestSha256,
    rootSha256: str(r['root_sha256']),
    interiorSha256: str(r['interior_sha256']),
    partCount: num(r['part_count']) ?? 0,
    totalBytes: num(r['total_bytes']) ?? 0,
    schemaVersion: num(r['schema_version']) ?? 1,
  };
}

/** URL layout under `<base>/ship-skins/` (storage.md, asset-package.md § Upload). */
export function packageUrls(base: string) {
  const b = base.endsWith('/') ? base : `${base}/`;
  return {
    manifest: (sha: string) => `${b}_manifests/${sha}.json`,
    /** Ship roots are hulls; FPS weapon / item roots live with the parts. */
    root: (kind: AssetPackageKind, sha: string) => (kind === 'ship' ? `${b}_hulls/${sha}.glb` : `${b}_parts/${sha}.glb`),
    part: (sha: string) => `${b}_parts/${sha}.glb`,
    interior: (sha: string) => `${b}_interiors/${sha}.glb`,
  };
}

export const isPlaced = (p: PackagePlacement): boolean => !!p.position && !!p.rotation;

/** An empty, fittable port — rendered as "free slot, accepts …". */
export const isFreeSlot = (p: PackagePlacement): boolean => !p.itemClass && !!p.port && p.port.types.length > 0;

/** Placements that get a hotspot: positioned, filled, in an inspectable group. */
export function hotspotPlacements(m: AssetPackageManifest): PackagePlacement[] {
  return m.placements.filter((p) => isPlaced(p) && !!p.itemClass && HOTSPOT_GROUPS.has(p.group));
}

/**
 * Slots the component label can step through: positioned and either a filled
 * hotspot or an empty, fittable port (shown as its ring marker).
 */
export function selectablePlacements(m: AssetPackageManifest): PackagePlacement[] {
  return m.placements.filter(
    (p) => isPlaced(p) && (p.itemClass ? HOTSPOT_GROUPS.has(p.group) : isFreeSlot(p) && p.group !== 'other'),
  );
}

/** Rows the parts list shows: filled items in any group plus free attachment slots. */
export function listPlacements(m: AssetPackageManifest): PackagePlacement[] {
  return m.placements.filter((p) => !!p.itemClass || (p.group === 'attachments' && isFreeSlot(p)));
}

/** Groups that actually carry something worth a toggle in this package. */
export function availableGroups(m: AssetPackageManifest): PlacementGroup[] {
  const has = new Set<PlacementGroup>();
  for (const p of m.placements) if (p.partSha256 && isPlaced(p)) has.add(p.group);
  if (m.interior) has.add('interior');
  return PLACEMENT_GROUPS.filter((g) => has.has(g));
}

/**
 * Whether a placement renders: its group is on, neither it nor any ancestor
 * (via `parentPort`, the show/hide cascade) is hidden.
 */
export function placementVisible(
  p: PackagePlacement,
  groups: ReadonlySet<PlacementGroup>,
  hidden: ReadonlySet<string>,
  byId: ReadonlyMap<string, PackagePlacement>,
): boolean {
  if (!groups.has(p.group)) return false;
  let cur: PackagePlacement | undefined = p;
  for (let guard = 0; cur && guard < 64; guard++) {
    if (hidden.has(cur.id)) return false;
    cur = cur.parentPort ? byId.get(cur.parentPort) : undefined;
  }
  return true;
}

/**
 * The placements to render solid during an x-ray: the hovered/focused one
 * (local), else every placement whose port the outside list is pointing at
 * (`activePorts` are raw port names — exact match on `portName`/`id`, no
 * fuzzy join). Children of a focused placement come along (a turret's guns).
 */
export function focusedPlacementIds(
  m: AssetPackageManifest,
  localFocus: string | null,
  activePorts: readonly string[],
): string[] {
  const seeds = new Set<string>();
  if (localFocus) seeds.add(localFocus);
  else if (activePorts.length) {
    const want = new Set(activePorts.map((p) => p.toLowerCase()));
    for (const p of m.placements) {
      if (want.has(p.portName.toLowerCase()) || want.has(p.id.toLowerCase())) seeds.add(p.id);
    }
  }
  if (seeds.size === 0) return [];
  const out: string[] = [];
  for (const p of m.placements) {
    let cur: PackagePlacement | undefined = p;
    const byId = (id: string) => m.placements.find((x) => x.id === id);
    for (let guard = 0; cur && guard < 64; guard++) {
      if (seeds.has(cur.id)) {
        out.push(p.id);
        break;
      }
      cur = cur.parentPort ? byId(cur.parentPort) : undefined;
    }
  }
  return out;
}

/** Framing box: the manifest's root bounds when plausible metres, else null (measure the GLB). */
export function plausibleBounds(b: Bounds | null | undefined): Bounds | null {
  if (!b) return null;
  const ext = [0, 1, 2].map((i) => b.max[i] - b.min[i]);
  if (ext.some((e) => !Number.isFinite(e) || e <= 0 || e > 2000)) return null;
  return b;
}
