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
  put('backpack', new T.BoxGeometry(0.3, 0.3, 0.11), [0, 1.3, -0.145]);
  put('backpack', prism(0.042, 0.042, 0.26), [-0.1, 1.3, -0.215]);
  put('backpack', prism(0.042, 0.042, 0.26), [0.1, 1.3, -0.215]);
  put('backpack', new T.BoxGeometry(0.24, 0.05, 0.05), [0, 1.13, -0.155]);
  // A fin, not an insect antenna (the first cut read as one).
  put('backpack', new T.BoxGeometry(0.014, 0.22, 0.07), [-0.125, 1.6, -0.185], {
    rotation: [0.16, 0, 0],
  });

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
): void {
  if (equipped) {
    material.color.set(palette.tint).lerp(new T.Color(0x1b2733), 0.4);
    material.emissive.set(palette.tint).multiplyScalar(0.14);
  } else {
    material.color.set(palette.idle).lerp(new T.Color(0xffffff), 0.2);
    material.emissive.set(0x000000);
  }
  material.needsUpdate = true;
}
