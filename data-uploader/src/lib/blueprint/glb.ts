/**
 * Blueprint drawings: hull GLB -> welded world-space triangles.
 *
 * Reads the web hull exactly as the site shows it (meshopt-compressed,
 * quantized; `hull3d.py` -> `gltf-transform optimize`), so the drawing and its
 * projection sit in the same model space as the 3D view and the asset package
 * manifest (`gltf-y-up-metres`). Vertices are welded on a 0.5 mm grid across
 * all primitives: a crease between two materials is still one shared edge.
 */
import { type Mesh, type Node, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import type { TriMesh } from './geometry.js';

const TRIANGLES = 4;
const WELD_GRID = 2000; // 1 / 0.5 mm

let io: Promise<NodeIO> | null = null;

function reader(): Promise<NodeIO> {
  io ??= MeshoptDecoder.ready.then(() =>
    new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }),
  );
  return io;
}

/** Applies a column-major 4x4 matrix to a point. */
function apply(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

export async function loadHullMesh(bytes: Uint8Array): Promise<TriMesh> {
  const doc = await (await reader()).readBinary(bytes);
  const weld = new Map<string, number>();
  const positions: number[] = [];
  const indices: number[] = [];
  const visit = (node: Node): void => {
    const mesh: Mesh | null = node.getMesh();
    if (mesh) {
      const world = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        if (prim.getMode() !== TRIANGLES) continue;
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const n = pos.getCount();
        const remap = new Uint32Array(n);
        const el: number[] = [0, 0, 0];
        for (let i = 0; i < n; i++) {
          // getElement() denormalizes quantized (normalized) accessors.
          pos.getElement(i, el);
          const [x, y, z] = apply(world, el[0]!, el[1]!, el[2]!);
          const key = `${Math.round(x * WELD_GRID)},${Math.round(y * WELD_GRID)},${Math.round(z * WELD_GRID)}`;
          let id = weld.get(key);
          if (id === undefined) {
            id = positions.length / 3;
            weld.set(key, id);
            positions.push(x, y, z);
          }
          remap[i] = id;
        }
        const idx = prim.getIndices();
        if (idx) {
          const m = idx.getCount();
          for (let i = 0; i + 2 < m; i += 3) {
            indices.push(remap[idx.getScalar(i)]!, remap[idx.getScalar(i + 1)]!, remap[idx.getScalar(i + 2)]!);
          }
        } else {
          for (let i = 0; i + 2 < n; i += 3) indices.push(remap[i]!, remap[i + 1]!, remap[i + 2]!);
        }
      }
    }
    for (const child of node.listChildren()) visit(child);
  };
  for (const scene of doc.getRoot().listScenes()) for (const node of scene.listChildren()) visit(node);
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}
