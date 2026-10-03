/**
 * Manufacturer concept-hologram look for the texture-free hull GLBs.
 *
 * The hulls carry geometry only (no CIG textures, Fankit rules — see
 * ship-hologram.ts). A flat PBR material on bare geometry reads as a grey
 * silhouette: the surfaces between the outline say nothing. This module draws
 * the character lines instead: one small ShaderMaterial per role (no post
 * processing) plus crease edges from THREE.EdgesGeometry, so panel breaks,
 * intakes and wing roots show without every triangle doing so.
 *
 * Three variants (holo-variant.ts) share one shader through a define, and one
 * set of uniforms drives the component highlight in all of them: the hull
 * dims, a focused part (or a focus point on the hull, for viewers that only
 * know a locator position) glows in the accent.
 *
 * Only imported from lazy chunks (the model-viewer chunk and the asset
 * package scene), never from the initial bundle.
 */
import * as THREE from 'three';
import type { HoloVariant } from './holo-variant';

export type Rgb = readonly [number, number, number];
export type HoloRole = 'hull' | 'part' | 'interior' | 'focus';

const ROLES: readonly HoloRole[] = ['hull', 'part', 'interior', 'focus'];

/** Crease angle for panel/character lines: below it a seam is "smooth surface". */
export const HOLO_CREASE_DEG = 30;
/** Above this many triangles a geometry gets no edge lines (EdgesGeometry is O(n) with a hash per edge). */
export const HOLO_EDGE_MAX_TRIANGLES = 1_200_000;
/** Focus points the shader can glow at once. */
export const HOLO_MAX_FOCUS = 4;

const VARIANT_INDEX: Record<HoloVariant, number> = { a: 0, b: 1, c: 2 };

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
uniform vec3 uBase;
uniform float uLevel;
uniform float uOpacity;
uniform float uDim;
uniform float uGlow;
uniform float uTime;
uniform float uScan;
uniform float uScale;
varying vec3 vViewPos;
varying vec3 vWorld;
${FOCUS_CHUNK}
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  float up = N.y * 0.5 + 0.5;
  vec3 col;
#if VARIANT == 0
  // Concept Holo: a faint fill graded by facing and height of the normal,
  // a bright Fresnel rim, fine static scanlines and one slow sweep band.
  float y = vWorld.y * uScale;
  float lines = smoothstep(0.55, 1.0, sin(y * 520.0)) * 0.05;
  float band = fract(y * 0.8 - uTime * 0.05);
  float sweep = smoothstep(0.0, 0.05, band) * (1.0 - smoothstep(0.05, 0.14, band)) * uScan;
  float rim = pow(1.0 - ndv, 4.0);
  col = uTint * (0.035 + 0.11 * ndv * (0.35 + 0.65 * up));
  col += mix(uTint, vec3(1.0), 0.25) * rim * 0.95;
  col += uTint * (lines + sweep * 0.32) * (0.35 + ndv);
#elif VARIANT == 1
  // Studio Clay: procedural matcap — hemisphere ambient, a key light from
  // upper left, soft specular, accent rim; a grazing-angle falloff stands in
  // for cavity (no baked AO), the crease lines carry the panel breaks.
  vec3 L = normalize(vec3(-0.45, 0.65, 0.6));
  float diff = max(dot(N, L), 0.0);
  vec3 amb = mix(vec3(0.24, 0.26, 0.31), vec3(0.9, 0.93, 0.98), up);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 42.0) * 0.16;
  float cavity = pow(1.0 - ndv, 2.0);
  col = uBase * (amb * 0.55 + diff * 0.6) + spec;
  col *= 1.0 - cavity * 0.4;
  col += uTint * pow(1.0 - ndv, 3.0) * 0.28;
#else
  // Blueprint: dark drafting fill, faint 45-degree hatch heavier on the
  // surfaces turned away, a thin light rim.
  float hatch = 1.0 - step(1.15, mod(gl_FragCoord.x + gl_FragCoord.y, 7.0));
  float away = 1.0 - ndv;
  col = uBase + uTint * (0.04 + 0.08 * ndv * up);
  col += uTint * hatch * (0.05 + 0.16 * away);
  col += mix(uTint, vec3(1.0), 0.4) * fres * 0.32;
#endif
  col *= uLevel;
  float fm = max(focusMask(), uGlow);
  col *= mix(1.0, 0.3, uDim * (1.0 - fm));
  vec3 glow = mix(uTint, vec3(1.0), 0.3) * (0.55 + 0.35 * ndv + 0.9 * fres);
  col = mix(col, glow, fm * 0.85);
  // Alpha is only the x-ray opacity: the canvas composites premultiplied, so
  // a partial alpha on an opaque pass would wash the colour out to white.
  gl_FragColor = vec4(col, uOpacity);
}
`;

const EDGE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTint;
uniform float uOpacity;
uniform float uDim;
uniform float uGlow;
varying vec3 vWorld;
${FOCUS_CHUNK}
void main() {
  float fm = max(focusMask(), uGlow);
  vec3 c = uColor * mix(1.0, 0.45, uDim * (1.0 - fm));
  c = mix(c, mix(uTint, vec3(1.0), 0.5), fm);
  float a = uOpacity * mix(1.0, 0.55, uDim * (1.0 - fm));
  gl_FragColor = vec4(c, mix(a, 1.0, fm));
}
`;

interface VariantStyle {
  /** Fill base colour (sRGB 0..1); the accent is mixed in by the shader. */
  readonly base: THREE.Color;
  /** Edge lines add up (glow on dark) instead of blending over. */
  readonly glowLines: boolean;
  readonly edgeColor: (tint: THREE.Color) => THREE.Color;
  readonly edgeOpacity: number;
}

const STYLES: Record<HoloVariant, VariantStyle> = {
  a: {
    base: new THREE.Color(0, 0, 0),
    glowLines: true,
    edgeColor: (t) => t.clone().lerp(new THREE.Color(1, 1, 1), 0.3),
    edgeOpacity: 0.45,
  },
  b: {
    base: new THREE.Color(0.6, 0.64, 0.7),
    glowLines: false,
    edgeColor: () => new THREE.Color(0.1, 0.13, 0.19),
    edgeOpacity: 0.5,
  },
  c: {
    base: new THREE.Color(0.03, 0.07, 0.13),
    glowLines: false,
    edgeColor: (t) => t.clone().lerp(new THREE.Color(1, 1, 1), 0.55),
    edgeOpacity: 0.9,
  },
};

const ROLE_LEVEL: Record<HoloRole, number> = { hull: 1, part: 1.1, interior: 0.6, focus: 1 };

/** Mark on a LineSegments child this module added. */
const EDGE_FLAG = 'holoEdges';

export class HoloLook {
  readonly variant: HoloVariant;
  /** Animated scan running (variant A without reduced motion). */
  readonly animated: boolean;
  private readonly style: VariantStyle;
  private readonly tint: THREE.Color;
  private readonly fills = new Map<HoloRole, THREE.ShaderMaterial>();
  private readonly lines = new Map<HoloRole, THREE.ShaderMaterial>();
  /** source geometry → its crease edges; computed once, disposed with the look. */
  private readonly edgeCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry | null>();
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

  constructor(variant: HoloVariant, accent: Rgb, reducedMotion: boolean) {
    this.variant = variant;
    this.style = STYLES[variant];
    this.animated = variant === 'a' && !reducedMotion;
    this.shared.uScan.value = this.animated ? 1 : 0;
    this.tint = new THREE.Color(accent[0] / 255, accent[1] / 255, accent[2] / 255);
    const edgeColor = this.style.edgeColor(this.tint);
    for (const role of ROLES) {
      const fill = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        defines: { VARIANT: VARIANT_INDEX[variant] },
        uniforms: {
          ...this.shared,
          uTint: { value: this.tint.clone() },
          uBase: { value: this.style.base.clone() },
          uLevel: { value: ROLE_LEVEL[role] },
          uOpacity: { value: 1 },
          uGlow: { value: role === 'focus' ? 1 : 0 },
        },
        side: THREE.DoubleSide,
        // Opaque in every variant: a translucent hull over its own interior
        // surfaces adds up to a white blob and needs sorting. The glow is in
        // the colours (dark fill, bright rim) on the dark stage instead.
        transparent: false,
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
          uTint: { value: this.tint.clone() },
          uOpacity: { value: this.style.edgeOpacity * (role === 'interior' ? 0.5 : 1) },
          uGlow: { value: role === 'focus' ? 1 : 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: this.style.glowLines ? THREE.AdditiveBlending : THREE.NormalBlending,
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

  /** Number of geometries whose edges were computed (cache size). */
  get edgeCacheSize(): number {
    return this.edgeCache.size;
  }

  /** Crease edges of `geometry`, computed on first request and cached. */
  edgesFor(geometry: THREE.BufferGeometry): THREE.BufferGeometry | null {
    if (this.edgeCache.has(geometry)) return this.edgeCache.get(geometry) ?? null;
    const tris = (geometry.index ? geometry.index.count : (geometry.getAttribute('position')?.count ?? 0)) / 3;
    const edges = tris > 0 && tris <= HOLO_EDGE_MAX_TRIANGLES ? new THREE.EdgesGeometry(geometry, HOLO_CREASE_DEG) : null;
    this.edgeCache.set(geometry, edges);
    return edges;
  }

  /**
   * Put every mesh under `root` into `role`: swap its material for the look's
   * fill and give it one crease-edge child. Re-dressing an already dressed
   * mesh only swaps materials (the edge child is reused).
   */
  dress(root: THREE.Object3D, role: HoloRole, accept: (mesh: THREE.Mesh) => boolean = () => true): void {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && accept(o as THREE.Mesh)) meshes.push(o as THREE.Mesh);
    });
    for (const mesh of meshes) {
      mesh.material = this.fill(role);
      let edge = mesh.children.find((c) => c.userData[EDGE_FLAG]) as THREE.LineSegments | undefined;
      if (!edge) {
        const geo = this.edgesFor(mesh.geometry);
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

  /** Scale scan density and focus radius to the model (its world bounding box). */
  fit(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 1e-3);
    this.shared.uScale.value = 1 / extent;
    this.shared.uFocusRadius.value = extent * 0.07;
  }

  /** Overall opacity of a role (x-ray); the fill turns transparent below 1. */
  setOpacity(role: HoloRole, opacity: number): void {
    const fill = this.fill(role);
    fill.uniforms['uOpacity'].value = opacity;
    const transparent = opacity < 1;
    if (fill.transparent !== transparent) {
      fill.transparent = transparent;
      fill.depthWrite = !transparent;
      fill.needsUpdate = true;
    }
    // Lines keep a floor so an x-rayed hull still reads as a wireframe ghost.
    const base = this.style.edgeOpacity * (role === 'interior' ? 0.5 : 1);
    this.line(role).uniforms['uOpacity'].value = base * Math.max(opacity, 0.45);
  }

  /** Dim everything that is not a focus (hull, other parts). */
  setDim(dim: boolean): void {
    this.shared.uDim.value = dim ? 1 : 0;
  }

  get dimmed(): boolean {
    return this.shared.uDim.value > 0;
  }

  /** World-space points the hull glows around (locator-only highlight); empty clears. */
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
