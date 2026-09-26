import type * as THREE from 'three';

/**
 * The six equippable positions of the AN BORD figure — the same role slots the
 * panel links out with, so "equipped" means exactly one thing in the SVG
 * fallback and in the 3D suit.
 */
export type SuitPart = 'helmet' | 'core' | 'arms' | 'legs' | 'backpack' | 'undersuit';

export const SUIT_PARTS: readonly SuitPart[] = [
  'helmet',
  'core',
  'arms',
  'legs',
  'backpack',
  'undersuit',
];

/** The zone's colour vocabulary, read off CSS custom properties at boot. */
export interface SuitPalette {
  /** `--idle` — an open position. */
  idle: string;
  /** `--tint` — an equipped position, and nothing else. */
  tint: string;
  /** `--sc-accent` — the visor, the chest lamp and the rim light; never a state. */
  accent: string;
}

export interface Hardsuit {
  root: THREE.Group;
  /** One material per position, so (un)equipping is a colour swap, not a rebuild. */
  armour: Record<SuitPart, THREE.MeshStandardMaterial>;
  /** The meshes of each position — what the hit zones are projected from. */
  groups: Record<SuitPart, THREE.Group>;
  /** Joints and seals — always dark, whatever is equipped. They are what makes
   *  the plates read AS plates instead of one moulded body. */
  joint: THREE.MeshStandardMaterial;
  /** Visor glass and the chest lamp: the only emissive surfaces on the suit. */
  glass: THREE.MeshStandardMaterial;
  dispose(): void;
}

/**
 * Builds the hard-suit as real geometry: primitives placed in 3D space and lit
 * by a key light plus an accent rim (set up in the component). Nothing here is a
 * painted-on highlight — the volume IS the model, which is the point of the
 * round that replaced the drawn SVG suit ("vllt. doch mit einer 3d engine? aber
 * nur 2d Ansicht … es soll schnieke aussehen").
 *
 * Everything is deliberately **low-poly and flat-shaded**: 6- and 8-sided prisms
 * rather than smooth capsules, so each facet catches the light separately and
 * the suit reads as hard surface at 108 px instead of as a rounded mannequin.
 * The proportions are **genderless armour** — a straight octagonal torso, no
 * waist taper below the abdomen bands, and a silhouette that is all pauldron,
 * knee plate and boot. The figure is 1.8 units tall with its feet on y = 0.
 */
export function buildHardsuit(T: typeof THREE, palette: SuitPalette): Hardsuit {
  const geometries: THREE.BufferGeometry[] = [];

  const armour = {} as Record<SuitPart, THREE.MeshStandardMaterial>;
  for (const part of SUIT_PARTS) {
    armour[part] = new T.MeshStandardMaterial({
      color: 0xffffff,
      metalness: part === 'undersuit' ? 0.25 : 0.58,
      roughness: part === 'undersuit' ? 0.78 : 0.4,
      flatShading: true,
    });
    paintPart(T, armour[part], palette, false);
  }
  const joint = new T.MeshStandardMaterial({
    color: 0x18242f,
    metalness: 0.75,
    roughness: 0.45,
    flatShading: true,
  });
  const glass = new T.MeshStandardMaterial({
    color: 0x061019,
    metalness: 0.95,
    roughness: 0.1,
    flatShading: true,
  });

  const root = new T.Group();
  const groups = {} as Record<SuitPart, THREE.Group>;
  for (const part of SUIT_PARTS) {
    groups[part] = new T.Group();
    root.add(groups[part]);
  }

  interface Placed {
    scale?: readonly [number, number, number];
    rotation?: readonly [number, number, number];
    material?: THREE.Material;
  }

  const put = (
    part: SuitPart,
    geometry: THREE.BufferGeometry,
    position: readonly [number, number, number],
    opts: Placed = {},
  ): THREE.Mesh => {
    geometries.push(geometry);
    const m = new T.Mesh(geometry, opts.material ?? armour[part]);
    m.position.set(position[0], position[1], position[2]);
    if (opts.scale) m.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]);
    if (opts.rotation) m.rotation.set(opts.rotation[0], opts.rotation[1], opts.rotation[2]);
    groups[part].add(m);
    return m;
  };

  // An 8-sided prism with a flat face pointing at the camera — the shape the
  // whole suit is built from.
  const prism = (rTop: number, rBottom: number, h: number, sides = 8): THREE.CylinderGeometry =>
    new T.CylinderGeometry(rTop, rBottom, h, sides);
  const FACE = Math.PI / 8;

  // ── RUCKSACK — life support behind the shoulders. Furthest back, so the torso
  //    overlaps it: that overlap is what puts it *behind* the figure.
  //    The pack's top edge clears the shoulder yoke and two fins stand beside
  //    the helmet: from the fixed camera the pack is otherwise hidden behind
  //    the torso, and the set page draws a leader line to it — a slot needs a
  //    visible body part to point at (concept C1, 2026-09-26). One centred fin
  //    sat exactly behind the helmet and never showed.
  put('backpack', new T.BoxGeometry(0.34, 0.34, 0.11), [0, 1.32, -0.145]);
  put('backpack', prism(0.042, 0.042, 0.3), [-0.1, 1.32, -0.215]);
  put('backpack', prism(0.042, 0.042, 0.3), [0.1, 1.32, -0.215]);
  put('backpack', new T.BoxGeometry(0.24, 0.05, 0.05), [0, 1.13, -0.155]);
  for (const side of [-1, 1]) {
    // Fins, not insect antennae (the first cut read as one).
    put('backpack', new T.BoxGeometry(0.016, 0.22, 0.1), [side * 0.22, 1.6, -0.185], {
      rotation: [0.16, 0, 0],
    });
    put('backpack', new T.BoxGeometry(0.07, 0.035, 0.05), [side * 0.195, 1.475, -0.185]);
  }

  // ── UNTERSUIT — the soft layer the plates ride on: abdomen bands and hips.
  //    The neck seal below is a joint, not a plate.
  put('undersuit', prism(0.145, 0.15, 0.07), [0, 1.07, 0], { scale: [1.1, 1, 0.78] });
  put('undersuit', prism(0.152, 0.158, 0.06), [0, 1.0, 0], { scale: [1.1, 1, 0.78] });
  put('undersuit', prism(0.165, 0.15, 0.11), [0, 0.92, 0], { scale: [1.1, 1, 0.82] });
  put('undersuit', prism(0.056, 0.056, 0.07), [0, 1.55, 0], { material: joint });

  // ── BEINE — thigh, knee joint + knee plate, shin + shin guard, boot.
  for (const side of [-1, 1]) {
    put('legs', prism(0.096, 0.082, 0.36, 6), [side * 0.105, 0.74, 0], { scale: [1, 1, 0.94] });
    put('legs', new T.SphereGeometry(0.079, 8, 6), [side * 0.105, 0.545, 0], { material: joint });
    put('legs', new T.BoxGeometry(0.115, 0.12, 0.045), [side * 0.105, 0.55, 0.066]);
    put('legs', prism(0.079, 0.066, 0.34, 6), [side * 0.105, 0.36, 0], { scale: [1, 1, 0.94] });
    put('legs', new T.BoxGeometry(0.11, 0.24, 0.04), [side * 0.105, 0.36, 0.072]);
    put('legs', new T.BoxGeometry(0.14, 0.11, 0.25), [side * 0.105, 0.06, 0.03]);
    put('legs', new T.BoxGeometry(0.13, 0.06, 0.08), [side * 0.105, 0.03, 0.165]);
  }

  // ── TORSO — octagonal chest, the plate over it, the shoulder yoke and the
  //    chest lamp. Straight, never tapered.
  put('core', prism(0.205, 0.185, 0.34), [0, 1.28, 0], { rotation: [0, FACE, 0], scale: [1.12, 1, 0.72] });
  put('core', new T.BoxGeometry(0.24, 0.2, 0.06), [0, 1.3, 0.115]);
  put('core', new T.BoxGeometry(0.4, 0.055, 0.15), [0, 1.44, 0]);
  put('core', new T.BoxGeometry(0.05, 0.026, 0.03), [0, 1.365, 0.15], { material: glass });

  // ── ARME — pauldron, upper arm, elbow joint, forearm + plate, glove.
  for (const side of [-1, 1]) {
    put('arms', prism(0.112, 0.082, 0.14, 6), [side * 0.255, 1.4, 0], {
      rotation: [0, 0, side * -0.18],
      scale: [1, 1, 0.92],
    });
    put('arms', prism(0.06, 0.054, 0.24, 6), [side * 0.27, 1.22, 0]);
    put('arms', new T.SphereGeometry(0.052, 8, 6), [side * 0.27, 1.09, 0], { material: joint });
    put('arms', prism(0.057, 0.05, 0.2, 6), [side * 0.27, 0.98, 0]);
    put('arms', new T.BoxGeometry(0.085, 0.15, 0.035), [side * 0.27, 0.98, 0.058]);
    put('arms', new T.BoxGeometry(0.088, 0.115, 0.095), [side * 0.27, 0.83, 0]);
  }

  // ── HELM — an 8-sided shell with a flat face forward, a low crown, an angled
  //    visor band and the breather. The visor is the one thing the accent light
  //    is allowed to sit on, which is what makes the head read at 108 px.
  put('helmet', prism(0.112, 0.098, 0.17), [0, 1.655, 0], {
    rotation: [0, FACE, 0],
    scale: [1, 1, 0.92],
  });
  put('helmet', new T.SphereGeometry(0.112, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), [0, 1.735, 0], {
    scale: [1, 0.55, 0.92],
  });
  put('helmet', new T.BoxGeometry(0.14, 0.075, 0.035), [0, 1.685, 0.082], {
    rotation: [-0.14, 0, 0],
    material: glass,
  });
  put('helmet', new T.BoxGeometry(0.1, 0.05, 0.045), [0, 1.6, 0.075]);
  put('helmet', new T.BoxGeometry(0.03, 0.055, 0.055), [-0.113, 1.66, -0.005]);
  put('helmet', new T.BoxGeometry(0.03, 0.055, 0.055), [0.113, 1.66, -0.005]);

  return {
    root,
    armour,
    groups,
    joint,
    glass,
    dispose() {
      for (const g of geometries) g.dispose();
      for (const part of SUIT_PARTS) armour[part].dispose();
      joint.dispose();
      glass.dispose();
    },
  };
}

/**
 * Paints one position. Equipped is `--tint` pulled down into the panel's own
 * darkness plus a little emissive, so it lights up rather than turning into a
 * gold statue; open is `--idle` lifted toward white — a figure with nothing
 * equipped must still read as a suit, which was the original complaint
 * ("einfach nur schwarz").
 */
export function paintPart(
  T: typeof THREE,
  material: THREE.MeshStandardMaterial,
  palette: SuitPalette,
  equipped: boolean,
  emphasis: PartEmphasis = 'normal',
): void {
  if (emphasis === 'lit') {
    // The part the set page points at: the accent, whatever it carries —
    // "equipped" is still told by the tile next to it.
    material.color.set(palette.accent).lerp(new T.Color(0x1b2733), 0.25);
    material.emissive.set(palette.accent).multiplyScalar(0.35);
  } else if (equipped) {
    material.color.set(palette.tint).lerp(new T.Color(0x1b2733), 0.4);
    material.emissive.set(palette.tint).multiplyScalar(0.14);
  } else {
    material.color.set(palette.idle).lerp(new T.Color(0xffffff), 0.2);
    material.emissive.set(0x000000);
  }
  if (emphasis === 'dim') {
    material.color.multiplyScalar(0.42);
    material.emissive.multiplyScalar(0.3);
  }
  material.needsUpdate = true;
}

/** How one part is drawn while another (or none) is highlighted. */
export type PartEmphasis = 'normal' | 'lit' | 'dim';

// ── Projection ───────────────────────────────────────────────────────────────
//
// COORDINATE SYSTEM of every anchor and hit zone below: fractions of the
// FIGURE BOX — the canvas / fallback SVG, both `width: 100%` of the host and
// 120:184 tall, top-left anchored. x = 0 is the box's left edge, 1 its right
// edge; y = 0 is the top, 1 the bottom (screen orientation, y grows DOWN). With
// the host at its default `height: auto` the figure box is the host box.

/** The fixed camera the 3D suit is rendered with — shared by the renderer and
 *  by the pure projection, so anchors and zones can never drift from the image. */
export const SUIT_CAMERA = {
  position: [2.05, 1.5, 5.6] as const,
  target: [0, 0.93, 0] as const,
  /** Half the visible height in world units; the width follows the box aspect. */
  halfHeight: 1.025,
} as const;

/** The figure box's width / height — the canvas keeps the drawn suit's ratio. */
export const FIGURE_ASPECT = 120 / 184;

export type Vec3 = readonly [number, number, number];
export interface FigurePoint {
  x: number;
  y: number;
}
export type AnchorSide = 'left' | 'right';

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The camera basis `lookAt` builds (world up = +y). */
const FWD = unit3(sub3(SUIT_CAMERA.target, SUIT_CAMERA.position));
const RIGHT = unit3(cross3(FWD, [0, 1, 0]));
const UP = cross3(RIGHT, FWD);

/**
 * Orthographic projection of a world point to figure-box fractions — the same
 * maths three.js runs for `OrthographicCamera.lookAt` + a symmetric frustum of
 * `halfHeight` × `halfHeight·aspect` (the spec pins the two against each other).
 */
export function projectSuitPoint(p: Vec3, aspect = FIGURE_ASPECT): FigurePoint {
  const d = sub3(p, SUIT_CAMERA.position);
  const halfW = SUIT_CAMERA.halfHeight * aspect;
  const nx = dot3(d, RIGHT) / halfW;
  const ny = dot3(d, UP) / SUIT_CAMERA.halfHeight;
  return { x: (nx + 1) / 2, y: (1 - ny) / 2 };
}

/**
 * Where a leader line ends on each part of the 3D suit, per side of the
 * figure: a point on the part's VISIBLE surface from the fixed camera (checked
 * against the occluders in `buildHardsuit`: the helmet's comms nubs at visor
 * height, the chest plate's upper half, the forearm's outer face / forearm
 * plate, the thigh's outer face, the abdomen band between torso and arm, and
 * the backpack fins beside the helmet).
 */
export const SUIT_ANCHORS_3D: Record<SuitPart, Record<AnchorSide, Vec3>> = {
  helmet: { left: [-0.128, 1.675, -0.005], right: [0.128, 1.675, -0.005] },
  core: { left: [-0.07, 1.36, 0.145], right: [0.07, 1.36, 0.145] },
  arms: { left: [-0.327, 0.98, 0], right: [0.3, 0.98, 0.075] },
  legs: { left: [-0.19, 0.76, 0], right: [0.19, 0.76, 0.03] },
  undersuit: { left: [-0.14, 1.0, 0.03], right: [0.14, 1.0, 0.03] },
  backpack: { left: [-0.222, 1.62, -0.145], right: [0.222, 1.62, -0.225] },
};

/** The same anchors on the drawn fallback suit (viewBox 0 0 120 184). */
const FALLBACK_ANCHOR_UNITS: Record<SuitPart, Record<AnchorSide, readonly [number, number]>> = {
  helmet: { left: [41, 27], right: [79, 27] },
  core: { left: [40, 62], right: [80, 62] },
  arms: { left: [29, 110], right: [91, 110] },
  legs: { left: [46, 135], right: [74, 135] },
  undersuit: { left: [45, 118], right: [75, 118] },
  backpack: { left: [44, 44], right: [76, 44] },
};

const perPart = <T>(fn: (part: SuitPart) => T): Record<SuitPart, T> =>
  Object.fromEntries(SUIT_PARTS.map((p) => [p, fn(p)])) as Record<SuitPart, T>;

export function suitAnchors3d(aspect = FIGURE_ASPECT): Record<SuitPart, Record<AnchorSide, FigurePoint>> {
  return perPart((part) => ({
    left: projectSuitPoint(SUIT_ANCHORS_3D[part].left, aspect),
    right: projectSuitPoint(SUIT_ANCHORS_3D[part].right, aspect),
  }));
}

export function fallbackAnchors(): Record<SuitPart, Record<AnchorSide, FigurePoint>> {
  const f = ([x, y]: readonly [number, number]): FigurePoint => ({ x: x / 120, y: y / 184 });
  return perPart((part) => ({
    left: f(FALLBACK_ANCHOR_UNITS[part].left),
    right: f(FALLBACK_ANCHOR_UNITS[part].right),
  }));
}

/** One part's pointer target: polygons in figure-box fractions. */
export interface PartZone {
  part: SuitPart;
  polygons: FigurePoint[][];
}

/** Paint order of the parts, back to front — later zones sit on top. */
export const ZONE_ORDER: readonly SuitPart[] = ['backpack', 'undersuit', 'legs', 'core', 'arms', 'helmet'];

/** Hit zones of the drawn fallback: the bounding boxes of its own shapes. */
const FALLBACK_ZONE_RECTS: Record<SuitPart, readonly (readonly [number, number, number, number])[]> = {
  backpack: [[35, 9, 55, 56], [65, 30, 76, 56]],
  undersuit: [[53, 36, 67, 50], [45, 100, 75, 129]],
  legs: [[44, 122, 76, 178]],
  core: [[38, 48, 82, 102]],
  arms: [[26, 49, 41, 132], [79, 49, 94, 132]],
  helmet: [[41, 6, 79, 40]],
};

export function fallbackZones(): PartZone[] {
  return ZONE_ORDER.map((part) => ({
    part,
    polygons: FALLBACK_ZONE_RECTS[part].map(([x0, y0, x1, y1]) =>
      [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({ x: x / 120, y: y / 184 })),
    ),
  }));
}

/**
 * Hit zones of the 3D suit, from the real meshes: every vertex of every mesh
 * in world space, run through `projectSuitPoint`, and the convex hull of each
 * mesh's projected vertices — one polygon per mesh, grouped per part. Every
 * primitive in the suit is convex, so that hull IS the mesh's silhouette on
 * the render.
 */
export function suitZones(T: typeof THREE, suit: Hardsuit, aspect = FIGURE_ASPECT): PartZone[] {
  suit.root.updateMatrixWorld(true);
  const v = new T.Vector3();
  return ZONE_ORDER.map((part) => {
    const polygons: FigurePoint[][] = [];
    suit.groups[part].traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const pos = mesh.geometry.getAttribute('position');
      const projected: FigurePoint[] = [];
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        projected.push(projectSuitPoint([v.x, v.y, v.z], aspect));
      }
      polygons.push(convexHull(projected));
    });
    return { part, polygons };
  });
}

/** Andrew's monotone chain. */
export function convexHull(points: FigurePoint[]): FigurePoint[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: FigurePoint, a: FigurePoint, b: FigurePoint): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: FigurePoint[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: FigurePoint[] = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Even-odd point-in-polygon test (used by the spec and by callers). */
export function pointInPolygon(p: FigurePoint, poly: FigurePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
