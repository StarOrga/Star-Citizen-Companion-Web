/**
 * Hardpoint anchors read out of a ship's own `.glb` (#256).
 *
 * Where a hardpoint sits on the hull is already IN the model we ship: the
 * CryEngine `hardpoint_*` / `helper_*` locator nodes survive the export
 * (`cgf-converter` -> `gltf-transform optimize`) as ordinary empty nodes, and
 * their names are the very same strings the codex payload uses as
 * `itemPorts[].portName` / `defaultLoadout[].itemPortName`. So the join between
 * "the component in this slot" and "where that slot is on the ship" is an exact
 * NAME match against the glb's node tree — no coordinate conversion, no second
 * data source, and nothing that has to be re-extracted before it works.
 *
 * That is deliberately a different path from `hardpoint-map.ts`, which projects
 * the extractor's `payload.hardpointTransforms` (CryEngine model space, `+X`
 * starboard / `+Y` nose / `+Z` up) onto two 2D schematics. Here the numbers are
 * already in the glb's own space — glTF is Y-up, so the same locator reads as
 * `(X, Z, -Y)` — which is exactly the space `<model-viewer>` expects in a
 * hotspot's `data-position`. Reading them from the model removes the axis
 * question entirely instead of answering it.
 *
 * Only the JSON chunk is parsed. Node transforms live there in full, so the
 * (draco-compressed) binary chunk is never touched and a range request over the
 * first few hundred KB of the file is enough.
 *
 * Hardened like the rest of the codex pipeline: a malformed header, a cyclic
 * node graph or a non-finite transform yields NO anchor rather than a marker at
 * the origin. A hotspot in the wrong place is worse than no hotspot at all.
 */

/** GLB container magic (`glTF`, little-endian u32) and the JSON chunk type. */
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;

/** Bound the work a single (untrusted) model can cause. */
const MAX_NODES = 20_000;
const MAX_DEPTH = 64;

/** A 4x4 matrix in glTF's column-major order. */
type Mat4 = readonly number[];

/** Model-space position, metres, in the glb's own (Y-up) coordinate space. */
export type Vec3 = readonly [number, number, number];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

interface GltfNode {
  name?: unknown;
  children?: unknown;
  matrix?: unknown;
  translation?: unknown;
  rotation?: unknown;
  scale?: unknown;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** A numeric tuple of exactly `len` finite entries, or null. */
function numbers(v: unknown, len: number): number[] | null {
  if (!Array.isArray(v) || v.length !== len) return null;
  const out: number[] = [];
  for (const n of v) {
    if (!isFiniteNumber(n)) return null;
    out.push(n);
  }
  return out;
}

/** `a * b`, both column-major. */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * A node's local matrix: the explicit `matrix` when present, else the composed
 * translation * rotation * scale (glTF's own order). Defaults per spec, so a
 * node carrying nothing at all is the identity.
 */
function localMatrix(node: GltfNode): Mat4 | null {
  if (node.matrix !== undefined) {
    // Declared but unreadable is a broken node, not a defaultable one.
    return numbers(node.matrix, 16);
  }

  const t = node.translation === undefined ? [0, 0, 0] : numbers(node.translation, 3);
  const r = node.rotation === undefined ? [0, 0, 0, 1] : numbers(node.rotation, 4);
  const s = node.scale === undefined ? [1, 1, 1] : numbers(node.scale, 3);
  if (!t || !r || !s) return null;

  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const [sx, sy, sz] = s;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}

/** The JSON chunk of a GLB container, or null when the bytes are not a GLB. */
export function readGlbJson(buffer: ArrayBuffer): unknown {
  if (buffer.byteLength < 20) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) return null;
  if (view.getUint32(4, true) !== 2) return null;

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (length < 0 || start + length > buffer.byteLength) return null;
    if (type === CHUNK_JSON) {
      const text = new TextDecoder().decode(new Uint8Array(buffer, start, length));
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    }
    // Chunks are 4-byte aligned; the padding is not counted in `length`.
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  return null;
}

/**
 * Every named node of a glb, mapped to its position in model space.
 *
 * Names are kept verbatim (they are matched against raw port names, which are
 * case-sensitive in the payload but compared case-insensitively by the lookup
 * helper below). A name that occurs twice keeps its FIRST occurrence — the glb
 * node order is the export order, and a duplicate later in the tree is an
 * instanced copy rather than the canonical locator.
 */
export function parseGlbNodePositions(buffer: ArrayBuffer): Map<string, Vec3> {
  const gltf = readGlbJson(buffer) as { nodes?: unknown; scenes?: unknown; scene?: unknown } | null;
  const out = new Map<string, Vec3>();
  if (!gltf || typeof gltf !== 'object') return out;

  const nodes = Array.isArray(gltf.nodes) ? (gltf.nodes as GltfNode[]) : [];
  if (nodes.length === 0 || nodes.length > MAX_NODES) return out;

  // Roots: the default scene's nodes when declared, else every node nothing
  // else claims as a child (a glb without scenes is still readable).
  const roots = sceneRoots(gltf, nodes);

  // Iterative DFS so a deep tree cannot blow the stack, carrying the parent's
  // accumulated matrix with each entry. Siblings are pushed in REVERSE so the
  // LIFO pop visits them in declared order — that order is the export order,
  // and it is what makes "first occurrence of a name wins" mean anything.
  const seen = new Set<number>();
  const stack: Array<{ index: number; parent: Mat4; depth: number }> = roots
    .map((index) => ({ index, parent: IDENTITY, depth: 0 }))
    .reverse();

  while (stack.length > 0) {
    const { index, parent, depth } = stack.pop()!;
    if (depth > MAX_DEPTH) continue;
    // A node reachable twice is an instance; a node reachable from itself is a
    // malformed cycle. Both are handled by visiting each node exactly once.
    if (seen.has(index)) continue;
    seen.add(index);

    const node = nodes[index];
    if (!node || typeof node !== 'object') continue;
    const local = localMatrix(node);
    if (!local) continue;
    const world = multiply(parent, local);

    const name = typeof node.name === 'string' ? node.name : '';
    if (name && !out.has(name)) {
      const position: Vec3 = [world[12], world[13], world[14]];
      if (position.every(isFiniteNumber)) out.set(name, position);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (typeof child === 'number' && Number.isInteger(child) && child >= 0 && child < nodes.length) {
        stack.push({ index: child, parent: world, depth: depth + 1 });
      }
    }
  }

  return out;
}

/** Root node indices to start the walk from. */
function sceneRoots(gltf: { scenes?: unknown; scene?: unknown }, nodes: GltfNode[]): number[] {
  const scenes = Array.isArray(gltf.scenes) ? gltf.scenes : [];
  const index = isFiniteNumber(gltf.scene) ? gltf.scene : 0;
  const scene = scenes[index] as { nodes?: unknown } | undefined;
  const declared = Array.isArray(scene?.nodes) ? scene!.nodes : null;
  if (declared) {
    return declared.filter(
      (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < nodes.length,
    );
  }

  const claimed = new Set<number>();
  for (const node of nodes) {
    const children = Array.isArray(node?.children) ? node.children : [];
    for (const child of children) if (typeof child === 'number') claimed.add(child);
  }
  return nodes.map((_, i) => i).filter((i) => !claimed.has(i));
}

/**
 * The node names a port may legitimately be stored under, most specific first.
 *
 * Ship meshes name a locator after its port (`hardpoint_quantum_drive`), but
 * some are additionally wrapped in a `helper_` node — either keeping the port
 * name (`helper_hardpoint_relay_front`) or replacing the `hardpoint_` prefix
 * with it (`helper_life_support` for port `hardpoint_life_support`). All three
 * are exact, mechanical rewrites of the port name, NOT fuzzy matching: each
 * either hits a node of that exact name or misses.
 */
function candidateNames(port: string): string[] {
  const names = [port, `helper_${port}`];
  const stem = port.replace(/^hardpoint[_.]/i, '');
  if (stem && stem !== port) names.push(`helper_${stem}`);
  return names;
}

/**
 * Position of the locator a raw port name refers to.
 *
 * Exact match first, then case-insensitive — port names and mesh node names
 * agree on spelling but not always on case (`hardpoint_Left_Body_Weapon` vs
 * `hardpoint_left_body_weapon`). Never fuzzy: a near-miss would put the marker
 * on the wrong part of the hull, which is the one failure mode worth avoiding.
 */
export function positionForPort(positions: Map<string, Vec3>, port: string): Vec3 | null {
  if (!port) return null;
  const candidates = candidateNames(port);
  for (const name of candidates) {
    const hit = positions.get(name);
    if (hit) return hit;
  }
  const wanted = candidates.map((c) => c.toLowerCase());
  for (const [name, position] of positions) {
    if (wanted.includes(name.toLowerCase())) return position;
  }
  return null;
}

/** One hotspot the viewer can render. */
export interface HardpointAnchor {
  /** Raw port name — the key the loadout list and the 2D map highlight by. */
  port: string;
  /** Humanized label for the marker's tooltip. */
  label: string;
  /** What is installed there, if anything. */
  itemName: string | null;
  position: Vec3;
}

/** `data-position` attribute value for a `<model-viewer>` hotspot. */
export function hotspotPosition(position: Vec3): string {
  return position.map((v) => v.toFixed(4)).join(' ');
}

/**
 * Resolve the ports the detail view knows about against a glb's locators.
 *
 * Ports with no locator in the model are dropped: the model is the only source
 * of truth for where something sits, so an unresolved port simply has no marker.
 */
export function resolveAnchors(
  positions: Map<string, Vec3>,
  ports: ReadonlyArray<{ port: string; label: string; itemName: string | null }>,
): HardpointAnchor[] {
  const out: HardpointAnchor[] = [];
  const taken = new Set<string>();
  for (const p of ports) {
    if (!p?.port || taken.has(p.port)) continue;
    const position = positionForPort(positions, p.port);
    if (!position) continue;
    taken.add(p.port);
    out.push({ port: p.port, label: p.label, itemName: p.itemName ?? null, position });
  }
  return out;
}
