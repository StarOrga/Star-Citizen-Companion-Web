/**
 * Ship blueprints: the line drawings the data uploader draws from every hull
 * (`data-uploader/docs/blueprint.md`). Not the crafting blueprints of
 * `blueprint-detail.component.ts` — those are game recipes.
 *
 * The SVG file is DATA here, never markup: `parseShipBlueprint` reads the
 * viewBox, the per-view projection and the three path strings out of it, and
 * the components draw those paths with their own elements and the app's
 * tokens. Nothing from the file is ever injected into the DOM, so a broken or
 * hostile file can at worst draw nothing.
 *
 * Everything in this file is pure (no Angular, no fetch) for the specs.
 */
import type { AssetPackageManifest, PlacementGroup } from '../asset-package/asset-package.model';
import type { HardpointMarker } from '../hardpoint-map';

export type BlueprintLod = 'full' | 'icon';
export type BlueprintViewName = 'top' | 'side';
/** glTF model space, metres: +X starboard, +Y up, -Z nose. */
export type Vec3 = readonly [number, number, number];
type Row = readonly [number, number, number, number];

export interface BlueprintBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BlueprintView {
  view: BlueprintViewName;
  box: BlueprintBox;
  /** Model -> drawing: svg_x = m[0]·(x, y, z, 1), svg_y = m[1]·(x, y, z, 1). */
  projection: readonly [Row, Row];
  /** Outer silhouette and holes (fill-rule even-odd). */
  hull: string;
  /** Main lines: view contours and sharp creases. */
  major: string;
  /** Detail lines (full LOD only). */
  minor: string;
}

export interface ShipBlueprint {
  lod: BlueprintLod;
  width: number;
  height: number;
  /** Length (nose-tail), beam, height in metres, when the file states them. */
  extentM: readonly [number, number, number] | null;
  views: readonly BlueprintView[];
}

/** M / l / z with numbers only — what the generator writes. */
const PATH_DATA = /^[MmLlZz0-9\s.,-]*$/;
const MAX_PATH_CHARS = 600_000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function numbers(text: string | null, n: number): number[] | null {
  if (!text) return null;
  const parts = text.trim().split(/[\s,]+/).map(Number);
  return parts.length === n && parts.every(Number.isFinite) ? parts : null;
}

function pathOf(g: Element, cls: string): string {
  const d = g.querySelector(`:scope > path.${cls}`)?.getAttribute('d') ?? '';
  return d.length <= MAX_PATH_CHARS && PATH_DATA.test(d) ? d : '';
}

function projectionOf(raw: string | null): { projection: [Row, Row]; box: BlueprintBox } | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = data as { frame?: unknown; m?: unknown; box?: unknown };
  if (o?.frame !== 'gltf-y-up-metres' || !Array.isArray(o.m) || o.m.length !== 2) return null;
  const rows = o.m.map((r) => (Array.isArray(r) && r.length === 4 && r.every(finite) ? (r as unknown as Row) : null));
  const box = Array.isArray(o.box) && o.box.length === 4 && o.box.every(finite) ? (o.box as number[]) : null;
  if (!rows[0] || !rows[1] || !box || box[2]! <= 0 || box[3]! <= 0) return null;
  return { projection: [rows[0], rows[1]], box: { x: box[0]!, y: box[1]!, w: box[2]!, h: box[3]! } };
}

/** Reads a blueprint file; null for anything that is not one (the caller keeps today's look). */
export function parseShipBlueprint(text: string, parser: DOMParser = new DOMParser()): ShipBlueprint | null {
  if (!text || text.length > 2 * MAX_PATH_CHARS) return null;
  const doc = parser.parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  if (root.getAttribute('data-sc-blueprint') !== '1') return null;
  const lod = root.getAttribute('data-lod');
  if (lod !== 'full' && lod !== 'icon') return null;
  const vb = numbers(root.getAttribute('viewBox'), 4);
  if (!vb || vb[2]! <= 0 || vb[3]! <= 0) return null;
  const extent = numbers(root.getAttribute('data-extent-m'), 3);
  const views: BlueprintView[] = [];
  for (const g of Array.from(root.children)) {
    if (g.localName !== 'g') continue;
    const view = g.getAttribute('data-view');
    if (view !== 'top' && view !== 'side') continue;
    const p = projectionOf(g.getAttribute('data-projection'));
    if (!p) continue;
    const hull = pathOf(g, 'bp-hull');
    if (!hull) continue;
    views.push({ view, ...p, hull, major: pathOf(g, 'bp-major'), minor: pathOf(g, 'bp-minor') });
  }
  if (!views.some((v) => v.view === 'top')) return null;
  return {
    lod,
    width: vb[2]!,
    height: vb[3]!,
    extentM: extent && extent.every((v) => v > 0) ? (extent as unknown as [number, number, number]) : null,
    views,
  };
}

export function blueprintView(bp: ShipBlueprint, view: BlueprintViewName): BlueprintView | null {
  return bp.views.find((v) => v.view === view) ?? null;
}

/** A model-space point (glTF metres) in drawing units. */
export function projectToView(v: BlueprintView, p: Vec3): { x: number; y: number } {
  const [a, b] = v.projection;
  return {
    x: a[0] * p[0] + a[1] * p[1] + a[2] * p[2] + a[3],
    y: b[0] * p[0] + b[1] * p[1] + b[2] * p[2] + b[3],
  };
}

/** CryEngine model space (+Y nose, +Z up) -> glTF (+Y up, -Z nose): (X, Z, -Y). */
export function cryToGltf(p: readonly number[]): Vec3 {
  return [p[0]!, p[2]!, -p[1]!];
}

/** viewBox string framing one view with `pad` drawing units around it. */
export function viewBoxOf(v: BlueprintView, pad = 0): string {
  return `${v.box.x - pad} ${v.box.y - pad} ${v.box.w + 2 * pad} ${v.box.h + 2 * pad}`;
}

// ── Hardpoints on the schema view ─────────────────────────────────────────

export type SchemaGroup = 'weapons' | 'missiles' | 'components' | 'other';

/** One ship-level hardpoint with a model-space position. */
export interface SchemaHardpoint {
  port: string;
  position: Vec3;
  group: SchemaGroup;
  size: number | null;
  /** What is installed, as a class name (null = empty port or unknown). */
  itemClass: string | null;
  /** The installed item's type, or the first type the port accepts. */
  type: string | null;
}

const SCHEMA_GROUPS: ReadonlySet<PlacementGroup> = new Set<PlacementGroup>(['weapons', 'missiles', 'components']);

/**
 * Every ship-level hardpoint of a package: top-level placements with a
 * position in the weapon, missile and component groups — filled or empty.
 * Child items (the gun on a gimbal) sit on their parent's spot and are not
 * hardpoints of the ship; lights, seats and doors are not hardpoints either.
 */
export function schemaHardpointsFromManifest(m: AssetPackageManifest): SchemaHardpoint[] {
  const out: SchemaHardpoint[] = [];
  for (const p of m.placements) {
    if (p.parentPort || !p.position || !SCHEMA_GROUPS.has(p.group)) continue;
    out.push({
      port: p.portName,
      position: p.position,
      group: p.group as SchemaGroup,
      size: p.itemSize ?? p.port?.maxSize ?? null,
      itemClass: p.itemClass,
      type: p.itemType ?? p.port?.types[0] ?? null,
    });
  }
  return out;
}

/** The extractor's hardpoint positions (CryEngine space) for hulls without a package. */
export function schemaHardpointsFromPayload(markers: readonly HardpointMarker[]): SchemaHardpoint[] {
  return markers.map((m) => ({
    port: m.port,
    position: cryToGltf(m.position),
    group: 'other' as const,
    size: null,
    itemClass: null,
    type: null,
  }));
}

/** What the stage already knows about a port (its pin), used for the label. */
export interface SchemaPinInfo {
  portName: string;
  label: string;
  index: number;
}

export interface SchemaMarker extends SchemaHardpoint {
  /** Drawing units in the top view. */
  x: number;
  y: number;
  label: string;
  /** Pin number when the port has a pin on the stage, so both views agree. */
  index: number | null;
}

/** `hardpoint_weapon_left_wing` -> "Weapon Left Wing" (a port with no pin). */
export function humanizePort(port: string): string {
  const words = port
    .replace(/^hardpoint_/i, '')
    .split(/[_\s]+/)
    .filter(Boolean);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || port;
}

/** "WeaponGun.Gun" -> "Weapon Gun". */
export function humanizeType(type: string | null): string | null {
  if (!type) return null;
  const head = type.split('.')[0] ?? '';
  const spaced = head.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : null;
}

const GROUP_ORDER: Record<SchemaGroup, number> = { weapons: 0, missiles: 1, components: 2, other: 3 };

/**
 * Hardpoints projected onto the top view, one marker per port. A point outside
 * the drawn box (a helper a hair beyond the hull) is pinned to the box edge,
 * so no marker ever floats off the drawing. Ordered: pinned ports in pin
 * order first, then by group and nose-to-tail.
 */
export function placeSchemaMarkers(
  view: BlueprintView,
  hardpoints: readonly SchemaHardpoint[],
  pins: readonly SchemaPinInfo[] = [],
): SchemaMarker[] {
  const byPort = new Map(pins.map((p) => [p.portName, p]));
  const seen = new Set<string>();
  const out: SchemaMarker[] = [];
  const { x: bx, y: by, w, h } = view.box;
  for (const hp of hardpoints) {
    if (seen.has(hp.port) || !hp.position.every(Number.isFinite)) continue;
    seen.add(hp.port);
    const p = projectToView(view, hp.position);
    const pin = byPort.get(hp.port);
    out.push({
      ...hp,
      x: Math.min(Math.max(p.x, bx), bx + w),
      y: Math.min(Math.max(p.y, by), by + h),
      label: pin?.label || humanizePort(hp.port),
      index: pin?.index ?? null,
    });
  }
  return out.sort(
    (a, b) =>
      (a.index ?? Infinity) - (b.index ?? Infinity) ||
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      b.x - a.x ||
      a.port.localeCompare(b.port),
  );
}
