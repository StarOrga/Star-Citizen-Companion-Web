/**
 * Blueprint drawings: one hull -> two SVG files (docs/blueprint.md).
 *
 *   full  top + side view, outline, main and detail lines, 1600 units along
 *         the hull's longest side. The ship page's schema view draws the
 *         hardpoints onto its top view.
 *   icon  top view only, outline + a few main lines, 400 units. Search rows
 *         and the tile placeholder shown until the store image has loaded.
 *
 * Both LODs come from ONE analysis per view at full resolution: the icon is
 * the same outline and the longest main lines, scaled down and simplified
 * harder — a low-resolution raster of its own would stair-step the outline.
 * Both embed the model -> drawing projection per view, so a client can put any
 * model-space point (a hardpoint from the asset package manifest) on them.
 */
import {
  DEFAULT_FEATURES,
  type Extent,
  type FeatureLine,
  type Pts,
  type TriMesh,
  type ViewName,
  type ViewWindow,
  coverageMask,
  featureLines,
  loopArea,
  meshExtent,
  rasterize,
  simplify,
  simplifyLoop,
  traceContours,
  viewWindow,
} from './geometry.js';
import { type Projection, type SvgView, writeSvg } from './svg.js';

/** Bumped whenever the drawing changes for the same hull (invalidates on-disk caches). */
export const BLUEPRINT_GENERATOR = 'sc-blueprint/1';

/** Drawing units along the hull's longest side at full detail. */
const FULL_LONG = 1600;

interface LodSpec {
  long: number;
  margin: number;
  gap: number;
  views: ViewName[];
  /** Outline simplification, in the LOD's own units. */
  outlineTol: number;
  lineTol: number;
  /** Outline loops under this share of the view box are dropped. */
  minLoopShare: number;
  minor: boolean;
  /** Main lines shorter than this share of `long` are dropped. */
  minMajorShare: number;
  maxMajor: number;
  /** Point budget for all lines of one view (outline excluded). */
  pointBudget: number;
}

export const LODS: Record<'full' | 'icon', LodSpec> = {
  full: {
    long: FULL_LONG, margin: 16, gap: 40, views: ['top', 'side'], outlineTol: 0.7, lineTol: 0.6,
    minLoopShare: 0.00002, minor: true, minMajorShare: 0.004, maxMajor: 4000, pointBudget: 9000,
  },
  icon: {
    long: 400, margin: 6, gap: 0, views: ['top'], outlineTol: 0.9, lineTol: 0.8,
    minLoopShare: 0.0006, minor: false, minMajorShare: 0.035, maxMajor: 48, pointBudget: 500,
  },
};

export interface BlueprintFiles {
  full: string;
  icon: string;
  extentM: [number, number, number];
}

interface ViewAnalysis {
  win: ViewWindow;
  /** Raster origin offset (pixels) — subtract to get window units. */
  pad: number;
  loops: Pts[];
  lines: FeatureLine[];
}

/** null = nothing drawable (empty or degenerate mesh). */
export function buildBlueprints(mesh: TriMesh): BlueprintFiles | null {
  const e = meshExtent(mesh);
  if (!e) return null;
  const extentM: [number, number, number] = [e.max[2] - e.min[2], e.max[0] - e.min[0], e.max[1] - e.min[1]];
  if (!extentM.every((v) => v > 0.05)) return null;
  const k = FULL_LONG / Math.max(...extentM);
  const analysed = new Map<ViewName, ViewAnalysis>();
  const analyse = (view: ViewName): ViewAnalysis => {
    let a = analysed.get(view);
    if (!a) {
      a = analyseView(mesh, e, view, k);
      analysed.set(view, a);
    }
    return a;
  };
  return {
    full: drawLod('full', LODS.full, analyse, k, extentM),
    icon: drawLod('icon', LODS.icon, analyse, k, extentM),
    extentM,
  };
}

function analyseView(mesh: TriMesh, e: Extent, view: ViewName, k: number): ViewAnalysis {
  const win = viewWindow(view, e);
  const r = rasterize(mesh, win, k);
  const mask = coverageMask(r, 1);
  return {
    win,
    pad: r.pad,
    loops: traceContours(mask, r.w, r.h),
    lines: featureLines(mesh, r, mask, DEFAULT_FEATURES),
  };
}

function drawLod(
  lod: 'full' | 'icon',
  spec: LodSpec,
  analyse: (v: ViewName) => ViewAnalysis,
  kFull: number,
  extentM: [number, number, number],
): string {
  const s = spec.long / FULL_LONG;
  const k = kFull * s;
  const views: SvgView[] = [];
  let y = spec.margin;
  let width = 0;
  for (const view of spec.views) {
    const a = analyse(view);
    const boxW = Math.ceil(a.win.uSpan * k);
    const boxH = Math.ceil(a.win.vSpan * k);
    // Full-resolution raster pixel -> this LOD's drawing unit.
    const place = (pts: Pts): Pts => pts.map((v, i) => (v - a.pad) * s + (i % 2 ? y : spec.margin));

    const minArea = Math.max(spec.minLoopShare * boxW * boxH, 2) / (s * s);
    const hull = a.loops
      .filter((l) => loopArea(l) >= minArea)
      .map((l) => place(simplifyLoop(l, spec.outlineTol / s)))
      .filter((l) => l.length >= 6);

    const { major, minor } = pickLines(a.lines, spec, s);

    // u = -z, v = x (top) or -y (side); drawing = (u - uMin) * k + margin.
    const projection: Projection = view === 'top'
      ? [[0, 0, -k, spec.margin - k * a.win.uMin], [k, 0, 0, y - k * a.win.vMin]]
      : [[0, 0, -k, spec.margin - k * a.win.uMin], [0, -k, 0, y - k * a.win.vMin]];
    views.push({
      view,
      box: { x: spec.margin, y, w: boxW, h: boxH },
      projection,
      hull,
      major: major.map(place),
      minor: minor.map(place),
    });
    width = Math.max(width, boxW + 2 * spec.margin);
    y += boxH + spec.gap;
  }
  const height = y - spec.gap + spec.margin;
  return writeSvg({ lod, width, height, extentM, views });
}

const byLength = (a: FeatureLine, b: FeatureLine): number =>
  b.length - a.length || a.pts[0]! - b.pts[0]! || a.pts[1]! - b.pts[1]!;

/** Longest lines first, within the LOD's count and point budget; returns full-res points. */
function pickLines(lines: FeatureLine[], spec: LodSpec, s: number): { major: Pts[]; minor: Pts[] } {
  let budget = spec.pointBudget;
  const take = (pool: FeatureLine[], max: number): Pts[] => {
    const out: Pts[] = [];
    for (const l of pool) {
      if (out.length >= max) break;
      const pts = s < 1 ? simplify(l.pts, spec.lineTol / s) : l.pts;
      const n = pts.length / 2;
      if (n > budget) continue;
      budget -= n;
      out.push(pts);
    }
    return out;
  };
  const minMajor = (spec.minMajorShare * spec.long) / s;
  const major = take(lines.filter((l) => l.kind === 'major' && l.length >= minMajor).sort(byLength), spec.maxMajor);
  const minor = spec.minor
    ? take(lines.filter((l) => l.kind === 'minor' && l.length >= 3).sort(byLength), Infinity)
    : [];
  return { major, minor };
}
