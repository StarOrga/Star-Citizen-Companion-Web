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

export type Rgb = readonly [number, number, number];

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** In front of the camera and inside the canvas. */
  readonly onScreen: boolean;
}

const HULL_OPACITY_XRAY = 0.1;
const PART_OPACITY_XRAY = 0.06;
const HULL_OPACITY_INTERIOR = 0.28;

export class PackageScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 5000);
  private readonly controls: OrbitControls;
  private readonly loader = new GLTFLoader();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envTarget: THREE.WebGLRenderTarget;

  private readonly hullMat: THREE.MeshStandardMaterial;
  private readonly partMat: THREE.MeshStandardMaterial;
  private readonly interiorMat: THREE.MeshStandardMaterial;
  private readonly focusMat: THREE.MeshStandardMaterial;

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
  private frameId = 0;
  private disposed = false;
  private readonly tmp = new THREE.Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    accent: Rgb,
    reducedMotion: boolean,
    private readonly onFrame: () => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
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
    // RoomEnvironment is a bright studio; dimmed, it leaves the hull dark with
    // a lit rim — the hologram, not a white plastic model.
    this.scene.environmentIntensity = 0.35;
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    // Hologram look (same recipe as ship-hologram.ts for model-viewer): dark
    // accent base, metallic + smooth so the environment draws a bright rim,
    // low self-glow.
    const c = new THREE.Color().setRGB(accent[0] / 255, accent[1] / 255, accent[2] / 255, THREE.SRGBColorSpace);
    const holo = (glow: number, base = 0.2) =>
      new THREE.MeshStandardMaterial({
        color: c.clone().multiplyScalar(base),
        metalness: 0.9,
        roughness: 0.2,
        emissive: c.clone().multiplyScalar(glow),
      });
    this.hullMat = holo(0.12);
    this.partMat = holo(0.2, 0.3);
    this.interiorMat = holo(0.08, 0.15);
    this.focusMat = holo(0.95, 0.6);
    this.focusMat.metalness = 0.4;
    this.focusMat.roughness = 0.35;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = !reducedMotion;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.requestRender());
    void this.disposed;
  }

  private parse(buf: ArrayBuffer): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => this.loader.parse(buf, '', (g) => resolve(g.scene), reject));
  }

  /** Swap every material for `mat` (GLBs are geometry-only), remember geometries for disposal. */
  private adopt(obj: THREE.Object3D, mat: THREE.Material): void {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const old = mesh.material;
      for (const m of Array.isArray(old) ? old : [old]) m?.dispose();
      mesh.material = mat;
      this.geometries.add(mesh.geometry);
    });
  }

  async setRoot(buf: ArrayBuffer): Promise<void> {
    const obj = await this.parse(buf);
    this.adopt(obj, this.hullMat);
    this.root = obj;
    this.scene.add(obj);
    this.requestRender();
  }

  async addPart(sha: string, buf: ArrayBuffer): Promise<void> {
    if (this.templates.has(sha)) return;
    const obj = await this.parse(buf);
    this.adopt(obj, this.partMat);
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
    this.adopt(obj, this.interiorMat);
    this.interior = obj;
    this.scene.add(obj);
    this.requestRender();
  }

  hasInterior(): boolean {
    return !!this.interior;
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
    const xray = this.focused.size > 0;
    for (const m of [this.hullMat, this.partMat, this.interiorMat]) {
      let opacity = 1;
      if (xray) opacity = m === this.hullMat ? HULL_OPACITY_XRAY : PART_OPACITY_XRAY;
      else if (this.interiorOn && m === this.hullMat) opacity = HULL_OPACITY_INTERIOR;
      const transparent = opacity < 1;
      if (m.transparent !== transparent || m.opacity !== opacity) {
        m.transparent = transparent;
        m.depthWrite = !transparent;
        m.opacity = opacity;
        m.needsUpdate = true;
      }
    }
    this.requestRender();
  }

  /** X-ray: hull + other parts translucent, the focused placements solid and bright. */
  setFocus(ids: readonly string[]): void {
    const next = new Set(ids);
    for (const [id, node] of this.placed) {
      const on = next.has(id);
      if (on === this.focused.has(id)) continue;
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = on ? this.focusMat : this.partMat;
        mesh.renderOrder = on ? 10 : 0;
      });
    }
    this.focused = next;
    this.applyOpacity();
  }

  /** Frame the camera on `bounds` (manifest) or, when null, the loaded root's measured box. */
  frame(bounds: Bounds | null): void {
    const box = new THREE.Box3();
    if (bounds) box.set(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max));
    else if (this.root) box.setFromObject(this.root);
    for (const node of this.placed.values()) box.expandByObject(node);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(this.tmp).length() / 2, 0.1);
    // The bounding sphere overestimates a flat, long hull; 0.8 fills the stage.
    const dist = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 0.8;
    const dir = new THREE.Vector3(1, 0.55, 1.25).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 200, 0.01);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.3;
    this.controls.maxDistance = dist * 4;
    this.controls.update();
    this.requestRender();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
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

  /** Render on demand: one frame, continued only while damping still moves the camera. */
  requestRender(): void {
    if (this.frameId || this.disposed) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = 0;
      const moving = this.controls.enableDamping && this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.onFrame();
      if (moving) this.requestRender();
    });
  }

  dispose(): void {
    this.disposed = true;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.controls.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of [this.hullMat, this.partMat, this.interiorMat, this.focusMat]) m.dispose();
    this.envTarget.dispose();
    this.pmrem.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
