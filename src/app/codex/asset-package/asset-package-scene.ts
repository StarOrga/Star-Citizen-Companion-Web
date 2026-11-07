/**
 * The three.js side of the asset package viewer. Imported ONLY dynamically
 * (`await import('./asset-package-scene')`) so three, GLTFLoader, OrbitControls
 * and the meshopt decoder land in a lazy chunk, never in the initial bundle.
 *
 * Contract: root GLB at the origin, every part GLB put under the scene root
 * with its placement's `position`/`rotation` verbatim (absolute, root-relative
 * — never nested under the parent placement). Geometry is parsed once per sha
 * and shared by every placement of it.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Bounds, PackagePlacement } from './asset-package.model';
import {
  HoloLook,
  HOLO_MAX_FOCUS,
  HOLO_XRAY_HULL_OPACITY,
  HOLO_XRAY_PART_OPACITY,
  countTriangles,
  type HoloRole,
  type Rgb,
} from '../holo-look';
import { type Rect, type SafeArea, fitDistance, rectOf, ringPose, usableSafeArea } from './holo-overlay';

export type { Rgb } from '../holo-look';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** In front of the camera and inside the canvas. */
  readonly onScreen: boolean;
}

/**
 * Which end the start view shows. Packages are glTF Y-up with the nose on -Z
 * (CryEngine +Y forward), like the hulls. 'side' is the long-standing
 * three-quarter view from the +Z side (a ship's quarter); 'nose' is the same
 * view half a turn round, so a missile points its nose at the reader instead of its exhaust.
 */
export type StartFacing = 'side' | 'nose';

/** Camera direction (from the orbit centre, not normalised) of the start view. */
export function startViewDir(facing: StartFacing): readonly [number, number, number] {
  return facing === 'nose' ? [-1, 0.55, -1.25] : [1, 0.55, 1.25];
}

// X-ray opacities and the dim factor live in holo-look.ts (HOLO_XRAY_*, HOLO_DIM_*).
const HULL_OPACITY_INTERIOR = 0.28;

/** Render order: x-rayed hull/parts → glow halo → focused component on top of it. */
const ORDER_HALO = 5;
const ORDER_FOCUS = 10;
const ORDER_RING = 20;

// The empty-slot ring: a dashed outer ring that rotates, a thin inner ring and
// a soft core, all in the manufacturer accent, drawn on a camera-facing quad.
const RING_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uAngle;
varying vec2 vUv;
const float TAU = 6.2831853;
void main() {
  float r = length(vUv);
  float aa = fwidth(r) * 1.5;
  float outer = smoothstep(0.74 - aa, 0.74, r) * (1.0 - smoothstep(0.86, 0.86 + aa, r));
  float a = atan(vUv.y, vUv.x) + uAngle;
  float dash = step(0.42, fract(a / TAU * 12.0));
  float inner = smoothstep(0.5 - aa, 0.5, r) * (1.0 - smoothstep(0.54, 0.54 + aa, r));
  float core = (1.0 - smoothstep(0.0, 0.5, r)) * 0.35;
  float halo = (1.0 - smoothstep(0.86, 1.0, r)) * smoothstep(0.6, 0.86, r) * 0.25;
  float m = max(max(outer * dash, inner * 0.7), max(core, halo));
  vec3 c = mix(uColor, vec3(1.0), 0.25 * outer * dash);
  gl_FragColor = vec4(c * m * uAlpha, m * uAlpha);
}
`;

/** WebGL runs on the CPU (SwiftShader, llvmpipe, Microsoft Basic Render Driver). */
export function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(name ?? ''));
  } catch {
    return false;
  }
}

/** How many points of the model the safe-area fit solves against. */
const MAX_FIT_POINTS_PER_MESH = 256;
const MAX_FIT_POINTS = 2500;

/** Soft radial falloff (white, alpha only) for the glow halo; tinted by the sprite colour. */
function haloTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(Math.hypot(x - c, y - c) / c, 1);
      const a = Math.pow(1 - d, 2.2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function sameMatrix(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  return a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-5);
}

export class PackageScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 5000);
  private readonly controls: OrbitControls;
  private readonly loader = new GLTFLoader();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envTarget: THREE.WebGLRenderTarget;

  /** Concept-hologram materials + cached crease edges (holo-look.ts). */
  private readonly look: HoloLook;
  private readonly t0 = performance.now();
  private readonly reducedMotion: boolean;

  private root: THREE.Object3D | null = null;
  private interior: THREE.Object3D | null = null;
  /** sha → parsed template (geometry owned here, shared by clones). */
  private readonly templates = new Map<string, THREE.Object3D>();
  /** placement id → its placed node (a clone of the template). */
  private readonly placed = new Map<string, THREE.Object3D>();
  /** placement id → its world position, for hotspot projection. */
  private readonly anchors = new Map<string, THREE.Vector3>();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private focused = new Set<string>();
  /** Parts not relevant to the picked Einsatz: quieter, still there. */
  private quiet: ReadonlySet<string> = new Set();
  /** Current look role per placed node, so a role change only touches what changed. */
  private readonly roles = new Map<string, HoloRole>();
  /** Hull see-through. Follows the focus unless the caller says otherwise (holotable: selection only). */
  private seeThrough = false;
  /** Box of everything framed (hull + placed parts): its projection is the label's "silhouette". */
  private readonly contentBox = new THREE.Box3();
  private frameId = 0;
  private disposed = false;
  private paused = false;
  private readonly tmp = new THREE.Vector3();

  // Safe-area framing (holotable). Null: the classic framing, untouched.
  private safe: SafeArea | null = null;
  private fitPoints: THREE.Vector3[] = [];
  private width = 0;
  private height = 0;
  /** The user's zoom relative to the fitted distance; 1 = exactly fitted. */
  private zoom = 1;
  private readonly lastDir = new THREE.Vector3();
  private lastDist = 0;
  private readonly seenView = new THREE.Matrix4();
  private readonly seenProjection = new THREE.Matrix4();

  // Highlight markers: glow halos (focused anchors) and empty-slot rings.
  private readonly haloTex = haloTexture();
  private readonly haloMat: THREE.SpriteMaterial;
  private readonly halos: THREE.Sprite[] = [];
  private readonly ringGeo = new THREE.PlaneGeometry(1, 1);
  private readonly ringMat: THREE.ShaderMaterial;
  private readonly rings: THREE.Mesh[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    base: Rgb,
    accent: Rgb,
    reducedMotion: boolean,
    private readonly onFrame: () => void,
    /** Runs `fn` outside Angular's zone (the frame loop must not trigger change detection). */
    private readonly outsideZone: <T>(fn: () => T) => T = (fn) => fn(),
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    // Without a GPU (software WebGL, hardware acceleration switched off) one
    // frame of the hull takes seconds; the animated loop would freeze the page.
    // Such a device gets the reduced-motion scene: rendered on demand only.
    reducedMotion ||= isSoftwareRenderer(this.renderer);
    this.reducedMotion = reducedMotion;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTarget = this.pmrem.fromScene(room, 0.04);
    room.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
    });
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.35;
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    // Concept-hologram look (holo-look.ts): body in the app accent, rim and
    // highlight in the manufacturer accent; focus/x-ray only flip uniforms.
    this.look = new HoloLook(base, accent, reducedMotion, true);

    this.haloMat = new THREE.SpriteMaterial({
      map: this.haloTex,
      color: this.look.accent,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.55,
      toneMapped: false,
    });
    this.ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      uniforms: { uColor: { value: this.look.accent }, uAlpha: { value: 1 }, uAngle: { value: 0 } },
      transparent: true,
      // Never occluded: an empty slot is often inside the hull.
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = !reducedMotion;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.requestRender());
    void this.disposed;
  }

  /** Seconds since the scene was created (scan band, ring pulse). */
  private elapsed(): number {
    return (performance.now() - this.t0) / 1000;
  }

  private parse(buf: ArrayBuffer): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => this.loader.parse(buf, '', (g) => resolve(g.scene), reject));
  }

  /** Dress every mesh in the look's `role` (GLBs are geometry-only), remember geometries for disposal. */
  private adopt(obj: THREE.Object3D, role: HoloRole): void {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const old = mesh.material;
      for (const m of Array.isArray(old) ? old : [old]) m?.dispose();
      this.geometries.add(mesh.geometry);
    });
    this.look.dress(obj, role);
  }

  async setRoot(buf: ArrayBuffer): Promise<void> {
    const obj = await this.parse(buf);
    // Fit first: the hull's line detail depends on its size and triangle count.
    this.look.fit(new THREE.Box3().setFromObject(obj), countTriangles(obj));
    this.adopt(obj, 'hull');
    this.root = obj;
    this.scene.add(obj);
    this.requestRender();
  }

  async addPart(sha: string, buf: ArrayBuffer): Promise<void> {
    if (this.templates.has(sha)) return;
    const obj = await this.parse(buf);
    this.adopt(obj, 'part');
    this.templates.set(sha, obj);
  }

  /** Place every placement whose part template is loaded (clones share geometry). */
  place(placements: readonly PackagePlacement[]): void {
    for (const p of placements) {
      if (!p.position || !p.rotation) continue;
      this.anchors.set(p.id, new THREE.Vector3(p.position[0], p.position[1], p.position[2]));
      if (!p.partSha256 || this.placed.has(p.id)) continue;
      const tpl = this.templates.get(p.partSha256);
      if (!tpl) continue;
      const node = tpl.clone(true);
      node.position.set(p.position[0], p.position[1], p.position[2]);
      node.quaternion.set(p.rotation[0], p.rotation[1], p.rotation[2], p.rotation[3]);
      node.userData['placementId'] = p.id;
      this.placed.set(p.id, node);
      this.scene.add(node);
    }
    this.requestRender();
  }

  async setInterior(buf: ArrayBuffer): Promise<void> {
    if (this.interior) return;
    const obj = await this.parse(buf);
    this.adopt(obj, 'interior');
    this.interior = obj;
    this.scene.add(obj);
    this.requestRender();
  }

  hasInterior(): boolean {
    return !!this.interior;
  }

  /** Whether a placement has a rendered part (false = empty slot, marked by a ring). */
  hasPart(id: string): boolean {
    return this.placed.has(id);
  }

  setVisibility(visible: ReadonlySet<string>, interiorOn: boolean): void {
    for (const [id, node] of this.placed) node.visible = visible.has(id);
    if (this.interior) this.interior.visible = interiorOn;
    this.interiorOn = interiorOn && !!this.interior;
    this.applyOpacity();
  }

  private interiorOn = false;

  /**
   * Hull/part translucency: x-ray while something is focused; with the
   * interior layer on, the hull alone turns glassy so the cabin reads.
   */
  private applyOpacity(): void {
    const xray = this.seeThrough;
    for (const role of ['hull', 'part', 'interior', 'quiet'] as const) {
      let opacity = 1;
      if (xray) opacity = role === 'hull' ? HOLO_XRAY_HULL_OPACITY : HOLO_XRAY_PART_OPACITY;
      else if (this.interiorOn && role === 'hull') opacity = HULL_OPACITY_INTERIOR;
      this.look.setOpacity(role, opacity);
    }
    // Highlight: everything that is not the focus dims, the focus glows.
    this.look.setDim(xray);
    this.requestRender();
  }

  /**
   * Highlight: the focused placements render as lit models in the accent
   * inside a glow cloud; a focused empty slot shows its ring marker instead.
   * The x-ray over the hull comes with any focus by default; the holotable
   * keeps it for a selection (a hover only lights).
   */
  setFocus(ids: readonly string[], seeThrough = ids.length > 0): void {
    this.focused = new Set(ids);
    this.seeThrough = seeThrough;
    this.applyRoles();
    const points = ids.map((id) => this.anchors.get(id)).filter((p): p is THREE.Vector3 => !!p);
    this.look.setFocusPoints(points);
    this.syncMarkers(
      points.slice(0, HOLO_MAX_FOCUS),
      ids.filter((id) => !this.placed.has(id) && this.anchors.has(id)).map((id) => this.anchors.get(id)!),
    );
    this.applyOpacity();
  }

  /** Mark the parts that stay quiet (another Einsatz); they keep their place and their hotspot. */
  setQuiet(ids: ReadonlySet<string>): void {
    this.quiet = ids;
    this.applyRoles();
    this.requestRender();
  }

  private applyRoles(): void {
    for (const [id, node] of this.placed) {
      const role: HoloRole = this.focused.has(id) ? 'focus' : this.quiet.has(id) ? 'quiet' : 'part';
      if ((this.roles.get(id) ?? 'part') === role) continue;
      this.roles.set(id, role);
      this.look.setRole(node, role, role === 'focus' ? ORDER_FOCUS : 0);
    }
  }

  /** One halo per glow point, one ring per empty slot (pooled). */
  private syncMarkers(haloAt: readonly THREE.Vector3[], ringAt: readonly THREE.Vector3[]): void {
    const r = this.look.focusRadius;
    while (this.halos.length < haloAt.length) {
      const s = new THREE.Sprite(this.haloMat);
      s.renderOrder = ORDER_HALO;
      s.raycast = () => undefined;
      this.halos.push(s);
      this.scene.add(s);
    }
    this.halos.forEach((s, i) => {
      s.visible = i < haloAt.length;
      if (s.visible) {
        s.position.copy(haloAt[i]);
        s.scale.setScalar(r * 2.2);
      }
    });
    while (this.rings.length < ringAt.length) {
      const m = new THREE.Mesh(this.ringGeo, this.ringMat);
      m.renderOrder = ORDER_RING;
      m.raycast = () => undefined;
      this.rings.push(m);
      this.scene.add(m);
    }
    this.rings.forEach((m, i) => {
      m.visible = i < ringAt.length;
      if (m.visible) m.position.copy(ringAt[i]);
    });
    this.poseRings(this.elapsed());
  }

  /** Billboard + animate the rings (static pose with reduced motion). */
  private poseRings(seconds: number): void {
    const pose = ringPose(seconds, this.reducedMotion);
    this.ringMat.uniforms['uAngle'].value = pose.angle;
    this.ringMat.uniforms['uAlpha'].value = pose.alpha;
    const size = this.look.focusRadius * 1.6 * pose.scale;
    for (const m of this.rings) {
      if (!m.visible) continue;
      m.quaternion.copy(this.camera.quaternion);
      m.scale.setScalar(size);
    }
  }

  /** Frame the camera on `bounds` (manifest) or, when null, the loaded root's measured box. */
  frame(bounds: Bounds | null, facing: StartFacing = 'side'): void {
    const box = new THREE.Box3();
    if (bounds) box.set(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max));
    else if (this.root) box.setFromObject(this.root);
    for (const node of this.placed.values()) box.expandByObject(node);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    this.contentBox.copy(box);
    this.fitPoints = this.safe ? this.sampleFitPoints(box) : [];
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(this.tmp).length() / 2, 0.1);
    const dir = new THREE.Vector3(...startViewDir(facing)).normalize();
    // Orientation first: the safe-area fit solves against the camera's axes.
    this.camera.position.copy(center).addScaledVector(dir, radius);
    this.camera.lookAt(center);
    // The bounding sphere overestimates a flat, long hull; 0.8 fills the stage.
    const dist = this.safe ? Math.max(this.fittedDistance(), 0.1) : (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 0.8;
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 200, 0.01);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.3;
    this.controls.maxDistance = dist * 4;
    this.controls.update();
    this.zoom = 1;
    this.noteCamera();
    this.requestRender();
  }

  /**
   * Keep the model out of these insets (CSS px): the camera's centre moves to
   * the middle of what is left (view offset, so orbiting pivots there too) and
   * the distance is solved from the projected box. Null: classic framing.
   */
  setSafeArea(safe: SafeArea | null): void {
    if (safe && !this.safe && !this.contentBox.isEmpty()) this.fitPoints = this.sampleFitPoints(this.contentBox);
    this.safe = safe;
    this.applyViewOffset();
    this.refit();
  }

  private usable(): SafeArea {
    return usableSafeArea(this.safe ?? { left: 0, right: 0, top: 0, bottom: 0 }, { w: this.width, h: this.height });
  }

  private applyViewOffset(): void {
    if (!this.safe || this.width <= 0 || this.height <= 0) {
      this.camera.clearViewOffset();
      return;
    }
    const s = this.usable();
    this.camera.setViewOffset(this.width, this.height, (s.right - s.left) / 2, (s.bottom - s.top) / 2, this.width, this.height);
  }

  /**
   * Points on the model itself (hull + placed parts, inside the framed box). A
   * hull's box corners stand far off its silhouette from a three-quarter view;
   * fitting those leaves the model at half the safe area.
   */
  private sampleFitPoints(box: THREE.Box3): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const v = new THREE.Vector3();
    const margin = box.clone().expandByScalar(box.getSize(this.tmp).length() * 0.01);
    const take = (o: THREE.Object3D): void => {
      o.updateWorldMatrix(true, true);
      o.traverse((c) => {
        const pos = (c as THREE.Mesh).isMesh ? (c as THREE.Mesh).geometry?.getAttribute('position') : null;
        if (!pos) return;
        const step = Math.max(1, Math.floor(pos.count / MAX_FIT_POINTS_PER_MESH));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld);
          if (margin.containsPoint(v)) out.push(v.clone());
        }
      });
    };
    if (this.root) take(this.root);
    for (const node of this.placed.values()) take(node);
    if (out.length <= MAX_FIT_POINTS) return out;
    const thin = Math.ceil(out.length / MAX_FIT_POINTS);
    return out.filter((_, i) => i % thin === 0);
  }

  /** Distance at which the framed model fits the safe area, from the current viewing direction. */
  private fittedDistance(): number {
    const { min, max } = this.contentBox;
    const corners: THREE.Vector3[] = [];
    if (this.fitPoints.length > 0) corners.push(...this.fitPoints);
    else {
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    const q = this.camera.quaternion;
    return fitDistance(
      corners,
      this.contentBox.getCenter(new THREE.Vector3()),
      {
        right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
        back: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
      },
      this.camera.fov,
      { w: this.width, h: this.height },
      this.usable(),
    );
  }

  /** Put the camera at this distance from the orbit centre, widening the limits it would run into. */
  private placeAt(dir: THREE.Vector3, distance: number): void {
    this.camera.position.copy(this.controls.target).addScaledVector(dir, distance);
    if (distance * 4 > this.controls.maxDistance) {
      this.controls.maxDistance = distance * 4;
      this.camera.far = this.controls.maxDistance * 5;
      this.camera.updateProjectionMatrix();
    }
    this.noteCamera();
  }

  private noteCamera(): void {
    const off = this.tmp.copy(this.camera.position).sub(this.controls.target);
    this.lastDist = off.length();
    this.lastDir.copy(off).divideScalar(this.lastDist || 1);
  }

  /** Re-solve the distance for the current view, keeping the user's zoom (safe-area mode only). */
  private refit(): void {
    if (!this.safe || this.contentBox.isEmpty() || this.width <= 0) return;
    const dir = this.tmp.copy(this.camera.position).sub(this.controls.target).normalize().clone();
    this.placeAt(dir, this.fittedDistance() * this.zoom);
    this.requestRender();
  }

  /**
   * An orbit must not swing a long hull under a gutter: when the direction
   * changed, re-solve the distance. A changed distance is the user's zoom
   * (pinch, which can rotate a hair as well): it carries over. Neither happened
   * (hover, selection): nothing moves.
   */
  private keepFit(): void {
    if (!this.safe || this.contentBox.isEmpty() || this.width <= 0) return;
    const off = this.tmp.copy(this.camera.position).sub(this.controls.target);
    const dist = off.length();
    if (dist <= 0) return;
    off.divideScalar(dist);
    const zoomed = Math.abs(dist - this.lastDist) > dist * 1e-4;
    if (zoomed && this.lastDist > 0) this.zoom *= dist / this.lastDist;
    if (off.dot(this.lastDir) < 1 - 1e-7) this.placeAt(off.clone(), this.fittedDistance() * this.zoom);
    else if (zoomed) this.noteCamera();
  }

  /** Zoom by a wheel delta (positive = out), inside the controls' limits. */
  zoomBy(delta: number): void {
    if (this.contentBox.isEmpty()) return;
    const off = this.tmp.copy(this.camera.position).sub(this.controls.target);
    const dist = off.length();
    if (dist <= 0) return;
    const next = THREE.MathUtils.clamp(dist * Math.exp(delta * 0.0015), this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).addScaledVector(off.divideScalar(dist), next);
    this.zoom = next / Math.max(this.fittedDistance(), 1e-3);
    this.noteCamera();
    this.controls.update();
    this.requestRender();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.applyViewOffset();
    this.refit();
    this.requestRender();
  }

  /**
   * True once after the camera really moved since the last call. The look can
   * animate every frame with a resting camera; projecting 120 anchors is only
   * worth it when this says so.
   */
  viewChanged(): boolean {
    this.camera.updateMatrixWorld();
    // Not exact: OrbitControls' spherical round trip jitters the low bits on every update.
    if (sameMatrix(this.seenView, this.camera.matrixWorld) && sameMatrix(this.seenProjection, this.camera.projectionMatrix)) return false;
    this.seenView.copy(this.camera.matrixWorld);
    this.seenProjection.copy(this.camera.projectionMatrix);
    return true;
  }

  /** CSS-pixel position of each anchor (placement origin). */
  project(ids: readonly string[]): Map<string, ScreenPoint> {
    const out = new Map<string, ScreenPoint>();
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const id of ids) {
      const a = this.anchors.get(id);
      if (!a) continue;
      this.tmp.copy(a).project(this.camera);
      const onScreen = this.tmp.z < 1 && Math.abs(this.tmp.x) <= 1 && Math.abs(this.tmp.y) <= 1;
      out.set(id, { x: ((this.tmp.x + 1) / 2) * w, y: ((1 - this.tmp.y) / 2) * h, onScreen });
    }
    return out;
  }

  /** Screen rectangle of the framed content (its box's projected corners), CSS px; null before framing. */
  silhouette(): Rect | null {
    if (this.contentBox.isEmpty()) return null;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const { min, max } = this.contentBox;
    const pts = [];
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          this.tmp.set(x, y, z).project(this.camera);
          if (this.tmp.z >= 1) continue;
          pts.push({ x: ((this.tmp.x + 1) / 2) * w, y: ((1 - this.tmp.y) / 2) * h });
        }
      }
    }
    return rectOf(pts);
  }

  /** Pause the frame loop (viewer off screen / tab hidden); resuming draws a frame at once. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused && this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
    if (!paused) this.requestRender();
  }

  /** Render on demand: one frame, continued only while damping moves the camera or the look animates. */
  requestRender(): void {
    if (this.frameId || this.disposed || this.paused) return;
    this.frameId = this.outsideZone(() => requestAnimationFrame(() => {
      this.frameId = 0;
      const moving = this.controls.enableDamping && this.controls.update();
      this.keepFit();
      const t = this.elapsed();
      this.look.tick(t);
      this.poseRings(t);
      this.renderer.render(this.scene, this.camera);
      this.onFrame();
      // The scan band and the slot ring keep the loop alive; with reduced
      // motion the scene renders on demand only.
      if (moving || this.look.animated || this.look.tweening) this.requestRender();
    }));
  }

  dispose(): void {
    this.disposed = true;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.controls.dispose();
    for (const g of this.geometries) g.dispose();
    this.look.dispose();
    this.haloMat.dispose();
    this.haloTex.dispose();
    this.ringMat.dispose();
    this.ringGeo.dispose();
    this.envTarget.dispose();
    this.pmrem.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
