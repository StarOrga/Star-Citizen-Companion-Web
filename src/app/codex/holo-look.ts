/**
 * Concept-hologram look for the texture-free hull GLBs.
 *
 * The hulls carry geometry only (no CIG textures, Fankit rules — see
 * ship-hologram.ts). A flat PBR material on bare geometry reads as a grey
 * silhouette: the surfaces between the outline say nothing. This module draws
 * the character lines instead: one small ShaderMaterial per role (no post
 * processing) plus crease edges from THREE.EdgesGeometry, so panel breaks,
 * intakes and wing roots show without every triangle doing so.
 *
 * Two colours: the body (fill, scanlines, edge lines) is the app accent for
 * every ship; the accents (Fresnel rim, the glow cloud of a highlight, the lit
 * focused component) take the manufacturer's colour (holo-manufacturer.ts).
 *
 * Big hulls thin their edge lines to the coarse character edges
 * ({@link edgeDetail}): a Reclaimer with every greeble outlined is a white
 * blob, not a hologram.
 *
 * Only imported from lazy chunks (the model-viewer chunk and the asset
 * package scene), never from the initial bundle.
 */
import * as THREE from 'three';
import type { Rgb } from './holo-manufacturer';

export type { Rgb } from './holo-manufacturer';
export type HoloRole = 'hull' | 'part' | 'interior' | 'focus';

const ROLES: readonly HoloRole[] = ['hull', 'part', 'interior', 'focus'];

/** Crease angle for panel/character lines on a normal-sized hull: below it a seam is "smooth surface". */
export const HOLO_CREASE_DEG = 30;
/** Crease angle the biggest hulls reach: only the coarse character edges remain. */
export const HOLO_CREASE_DEG_MAX = 55;
/** Above this many triangles a geometry gets no edge lines (EdgesGeometry is O(n) with a hash per edge). */
export const HOLO_EDGE_MAX_TRIANGLES = 1_200_000;
/** Focus points the shader can glow at once. */
export const HOLO_MAX_FOCUS = 4;
/** Strength of the fine static scanlines (the concept study had 0.05 — kept, but quieter). */
export const HOLO_SCANLINES = 0.022;
/** Strength of the slow sweep band (concept study: 0.32). */
export const HOLO_SWEEP = 0.2;
/** Opacity of the crease lines. */
export const HOLO_EDGE_OPACITY = 0.45;

export interface EdgeDetail {
  /** Crease angle (degrees) for THREE.EdgesGeometry. */
  readonly creaseDeg: number;
  /** Segments shorter than this (world units) are dropped — the greebles of a big hull. */
  readonly minSegment: number;
  /** 0 = full detail (fighter) … 1 = coarsest (capital hull). */
  readonly thinning: number;
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/**
 * How much line detail a hull of `extent` (largest bounding-box side, metres)
 * and `triangles` keeps. A fighter keeps every crease line; from ~40 m or
 * ~160 k triangles on the lines thin out, reaching the coarsest character
 * edges at ~150 m or ~1.6 M triangles.
 */
export function edgeDetail(extent: number, triangles: number): EdgeDetail {
  const bySize = clamp01((extent - 40) / 110);
  const byTris = clamp01((Math.log10(Math.max(triangles, 1)) - 5.2) / 1.0);
  const t = Math.max(bySize, byTris);
  return {
    creaseDeg: HOLO_CREASE_DEG + (HOLO_CREASE_DEG_MAX - HOLO_CREASE_DEG) * t,
    minSegment: Math.max(extent, 0) * 0.006 * t,
    thinning: t,
  };
}

/** Full detail: parts, focused components, anything not fitted. */
export const FULL_DETAIL: EdgeDetail = { creaseDeg: HOLO_CREASE_DEG, minSegment: 0, thinning: 0 };

/** Triangles of every mesh under `root`. */
export function countTriangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
    if (g) n += trianglesOf(g);
  });
  return n;
}

function trianglesOf(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
}

// Normals come from screen-space derivatives of the view position, not from
// the normal attribute: the stripped hull exports carry unreliable normals
// (mirrored parts, quantised or missing), which lit whole panels as rim.
// Faceted shading also suits a concept model — every panel reads as a plane.
const VERTEX = /* glsl */ `
varying vec3 vViewPos;
varying vec3 vWorld;
void main() {
  vec4 local = vec4(position, 1.0);
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
#endif
  vec4 world = modelMatrix * local;
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const EDGE_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 local = vec4(position, 1.0);
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
#endif
  vec4 world = modelMatrix * local;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FOCUS_CHUNK = /* glsl */ `
uniform vec3 uFocus[${HOLO_MAX_FOCUS}];
uniform int uFocusCount;
uniform float uFocusRadius;
float focusMask() {
  float f = 0.0;
  for (int i = 0; i < ${HOLO_MAX_FOCUS}; i++) {
    if (i >= uFocusCount) break;
    float d = distance(vWorld, uFocus[i]);
    f = max(f, 1.0 - smoothstep(uFocusRadius * 0.3, uFocusRadius, d));
  }
  return f;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform vec3 uAccent;
uniform float uLevel;
uniform float uOpacity;
uniform float uDim;
uniform float uGlow;
uniform float uTime;
uniform float uScan;
uniform float uScale;
uniform float uLines;
uniform float uSweep;
varying vec3 vViewPos;
varying vec3 vWorld;
${FOCUS_CHUNK}
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  float rim = pow(1.0 - ndv, 4.0);
  float up = N.y * 0.5 + 0.5;
  // Body in the app accent: a faint fill graded by facing and height of the
  // normal, fine static scanlines and one slow sweep band.
  float y = vWorld.y * uScale;
  float lines = smoothstep(0.55, 1.0, sin(y * 520.0)) * uLines;
  float band = fract(y * 0.8 - uTime * 0.05);
  float sweep = smoothstep(0.0, 0.05, band) * (1.0 - smoothstep(0.05, 0.14, band)) * uScan;
  vec3 col = uTint * (0.035 + 0.11 * ndv * (0.35 + 0.65 * up));
  col += uTint * (lines + sweep * uSweep) * (0.35 + ndv);
  // Accent: the Fresnel rim in the manufacturer's colour.
  col += mix(uAccent, vec3(1.0), 0.2) * rim * 0.95;
  col *= uLevel;
  // Highlight: everything else dims, a glow cloud lights the hull around the
  // focus points, a focused component renders as a lit model in the accent.
  float fm = focusMask();
  col *= mix(1.0, 0.3, uDim * (1.0 - max(fm, uGlow)));
  vec3 cloud = mix(uAccent, vec3(1.0), 0.3) * (0.55 + 0.35 * ndv + 0.9 * fres);
  col = mix(col, cloud, fm * 0.85 * (1.0 - uGlow));
  vec3 lit = uAccent * (0.22 + 0.78 * ndv * (0.4 + 0.6 * up));
  lit += mix(uAccent, vec3(1.0), 0.55) * rim * 1.1;
  col = mix(col, lit, uGlow);
  // Alpha is only the x-ray opacity: the canvas composites premultiplied, so
  // a partial alpha on an opaque pass would wash the colour out to white.
  // The glow cloud stays visible on an x-rayed hull.
  gl_FragColor = vec4(col, max(uOpacity, fm * 0.7 * (1.0 - uGlow)));
}
`;

const EDGE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uOpacity;
uniform float uDim;
uniform float uGlow;
varying vec3 vWorld;
${FOCUS_CHUNK}
void main() {
  float fm = max(focusMask(), uGlow);
  vec3 c = uColor * mix(1.0, 0.45, uDim * (1.0 - fm));
  c = mix(c, mix(uAccent, vec3(1.0), 0.5), fm);
  float a = uOpacity * mix(1.0, 0.55, uDim * (1.0 - fm));
  gl_FragColor = vec4(c, mix(a, 1.0, fm));
}
`;

const ROLE_LEVEL: Record<HoloRole, number> = { hull: 1, part: 1.1, interior: 0.6, focus: 1 };

/** Mark on a LineSegments child this module added. */
const EDGE_FLAG = 'holoEdges';

const toColor = (c: Rgb) => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);

export class HoloLook {
  /** Animated scan running (off with reduced motion). */
  readonly animated: boolean;
  private readonly tint: THREE.Color;
  private readonly accentColor: THREE.Color;
  private readonly fills = new Map<HoloRole, THREE.ShaderMaterial>();
  private readonly lines = new Map<HoloRole, THREE.ShaderMaterial>();
  /** source geometry → its crease edges; computed once, disposed with the look. */
  private readonly edgeCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry | null>();
  /** Line detail of the fitted hull (hull + interior roles). */
  private hullDetail: EdgeDetail = FULL_DETAIL;
  // Uniform objects shared by every material, so one write reaches all roles.
  private readonly shared = {
    uDim: { value: 0 },
    uTime: { value: 0 },
    uScan: { value: 0 },
    uScale: { value: 1 },
    uFocus: { value: Array.from({ length: HOLO_MAX_FOCUS }, () => new THREE.Vector3()) },
    uFocusCount: { value: 0 },
    uFocusRadius: { value: 1 },
  };

  /**
   * @param base   body colour (the app accent, same for every ship)
   * @param accent manufacturer accent (rim, highlight)
   */
  constructor(base: Rgb, accent: Rgb, reducedMotion: boolean) {
    this.animated = !reducedMotion;
    this.shared.uScan.value = this.animated ? 1 : 0;
    this.tint = toColor(base);
    this.accentColor = toColor(accent);
    const edgeColor = this.tint.clone().lerp(new THREE.Color(1, 1, 1), 0.3);
    for (const role of ROLES) {
      const focus = role === 'focus';
      const fill = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          ...this.shared,
          uTint: { value: this.tint.clone() },
          uAccent: { value: this.accentColor.clone() },
          uLevel: { value: ROLE_LEVEL[role] },
          uOpacity: { value: 1 },
          uGlow: { value: focus ? 1 : 0 },
          uLines: { value: HOLO_SCANLINES },
          uSweep: { value: HOLO_SWEEP },
        },
        side: THREE.DoubleSide,
        // Opaque: a translucent hull over its own interior surfaces adds up
        // to a white blob and needs sorting. The glow is in the colours (dark
        // fill, bright rim) on the dark stage instead. The focus is the one
        // exception: it sits in the transparent pass (alpha 1, depth written)
        // so it draws after the glow halo and stays recognisable inside it.
        transparent: focus,
        depthWrite: true,
        // Pushed back a hair so the crease lines draw on top without z-fighting.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        toneMapped: false,
      });
      const line = new THREE.ShaderMaterial({
        vertexShader: EDGE_VERTEX,
        fragmentShader: EDGE_FRAGMENT,
        uniforms: {
          uDim: this.shared.uDim,
          uFocus: this.shared.uFocus,
          uFocusCount: this.shared.uFocusCount,
          uFocusRadius: this.shared.uFocusRadius,
          uColor: { value: edgeColor.clone() },
          uAccent: { value: this.accentColor.clone() },
          uOpacity: { value: HOLO_EDGE_OPACITY * (role === 'interior' ? 0.5 : 1) },
          uGlow: { value: focus ? 1 : 0 },
        },
        transparent: true,
        depthWrite: false,
        // Lines add up (glow on dark) instead of blending over.
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.fills.set(role, fill);
      this.lines.set(role, line);
    }
  }

  fill(role: HoloRole): THREE.ShaderMaterial {
    return this.fills.get(role)!;
  }

  line(role: HoloRole): THREE.ShaderMaterial {
    return this.lines.get(role)!;
  }

  /** The manufacturer accent as a three colour (for markers the scene draws itself). */
  get accent(): THREE.Color {
    return this.accentColor.clone();
  }

  /** Line detail the hull roles use (set by {@link fit}). */
  get detail(): EdgeDetail {
    return this.hullDetail;
  }

  /** Number of geometries whose edges were computed (cache size). */
  get edgeCacheSize(): number {
    return this.edgeCache.size;
  }

  /**
   * Crease edges of `geometry` at `detail`, computed on first request and
   * cached. `worldScale` converts the detail's world-space minimum segment
   * into the geometry's own units.
   */
  edgesFor(geometry: THREE.BufferGeometry, detail: EdgeDetail = FULL_DETAIL, worldScale = 1): THREE.BufferGeometry | null {
    if (this.edgeCache.has(geometry)) return this.edgeCache.get(geometry) ?? null;
    const tris = trianglesOf(geometry);
    let edges: THREE.BufferGeometry | null =
      tris > 0 && tris <= HOLO_EDGE_MAX_TRIANGLES ? new THREE.EdgesGeometry(geometry, detail.creaseDeg) : null;
    const minLocal = detail.minSegment / (worldScale > 0 ? worldScale : 1);
    if (edges && minLocal > 0) edges = dropShortSegments(edges, minLocal);
    this.edgeCache.set(geometry, edges);
    return edges;
  }

  /**
   * Put every mesh under `root` into `role`: swap its material for the look's
   * fill and give it one crease-edge child. Re-dressing an already dressed
   * mesh only swaps materials (the edge child is reused). Hull and interior
   * use the fitted line detail, parts keep every crease.
   */
  dress(root: THREE.Object3D, role: HoloRole, accept: (mesh: THREE.Mesh) => boolean = () => true): void {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && accept(o as THREE.Mesh)) meshes.push(o as THREE.Mesh);
    });
    const detail = role === 'hull' || role === 'interior' ? this.hullDetail : FULL_DETAIL;
    if (detail.minSegment > 0) root.updateWorldMatrix(true, true);
    for (const mesh of meshes) {
      mesh.material = this.fill(role);
      let edge = mesh.children.find((c) => c.userData[EDGE_FLAG]) as THREE.LineSegments | undefined;
      if (!edge) {
        const scale = detail.minSegment > 0 ? mesh.matrixWorld.getMaxScaleOnAxis() : 1;
        const geo = this.edgesFor(mesh.geometry, detail, scale);
        if (!geo) continue;
        edge = new THREE.LineSegments(geo, this.line(role));
        edge.userData[EDGE_FLAG] = true;
        edge.raycast = () => undefined;
        edge.matrixAutoUpdate = false;
        mesh.add(edge);
      }
      edge.material = this.line(role);
    }
  }

  /** Swap materials of an already dressed subtree (focus on/off). */
  setRole(root: THREE.Object3D, role: HoloRole, renderOrder = 0): void {
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = this.fill(role);
        o.renderOrder = renderOrder;
      } else if (o.userData[EDGE_FLAG]) {
        (o as THREE.LineSegments).material = this.line(role);
        o.renderOrder = renderOrder + 1;
      }
    });
  }

  /**
   * Scale scan density, focus radius and the hull's line detail to the model
   * (its world bounding box and triangle count). Call before dressing the hull.
   */
  fit(box: THREE.Box3, triangles = 0): void {
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 1e-3);
    this.shared.uScale.value = 1 / extent;
    this.shared.uFocusRadius.value = extent * 0.07;
    this.hullDetail = edgeDetail(extent, triangles);
  }

  /** World radius of the glow cloud (after {@link fit}). */
  get focusRadius(): number {
    return this.shared.uFocusRadius.value;
  }

  /** Overall opacity of a role (x-ray); the fill turns transparent below 1. */
  setOpacity(role: HoloRole, opacity: number): void {
    const fill = this.fill(role);
    fill.uniforms['uOpacity'].value = opacity;
    const transparent = role === 'focus' || opacity < 1;
    if (fill.transparent !== transparent) {
      fill.transparent = transparent;
      fill.depthWrite = role === 'focus' || !transparent;
      fill.needsUpdate = true;
    }
    // Lines keep a floor so an x-rayed hull still reads as a wireframe ghost.
    const base = HOLO_EDGE_OPACITY * (role === 'interior' ? 0.5 : 1);
    this.line(role).uniforms['uOpacity'].value = base * Math.max(opacity, 0.45);
  }

  /** Dim everything that is not a focus (hull, other parts). */
  setDim(dim: boolean): void {
    this.shared.uDim.value = dim ? 1 : 0;
  }

  get dimmed(): boolean {
    return this.shared.uDim.value > 0;
  }

  /** World-space points the hull glows around (the glow cloud); empty clears. */
  setFocusPoints(points: readonly THREE.Vector3[]): void {
    const n = Math.min(points.length, HOLO_MAX_FOCUS);
    for (let i = 0; i < n; i++) this.shared.uFocus.value[i].copy(points[i]);
    this.shared.uFocusCount.value = n;
  }

  get focusCount(): number {
    return this.shared.uFocusCount.value;
  }

  /** Advance the scan (seconds). A no-op when the look is not animated. */
  tick(seconds: number): void {
    if (this.animated) this.shared.uTime.value = seconds;
  }

  dispose(): void {
    for (const m of this.fills.values()) m.dispose();
    for (const m of this.lines.values()) m.dispose();
    for (const g of this.edgeCache.values()) g?.dispose();
    this.edgeCache.clear();
  }
}

/** A copy of `edges` without the segments shorter than `minLength`; disposes the input. */
function dropShortSegments(edges: THREE.BufferGeometry, minLength: number): THREE.BufferGeometry {
  const pos = edges.getAttribute('position');
  const keep: number[] = [];
  const min2 = minLength * minLength;
  for (let i = 0; i + 1 < pos.count; i += 2) {
    const dx = pos.getX(i + 1) - pos.getX(i);
    const dy = pos.getY(i + 1) - pos.getY(i);
    const dz = pos.getZ(i + 1) - pos.getZ(i);
    if (dx * dx + dy * dy + dz * dz < min2) continue;
    keep.push(pos.getX(i), pos.getY(i), pos.getZ(i), pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
  }
  edges.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3));
  return out;
}
