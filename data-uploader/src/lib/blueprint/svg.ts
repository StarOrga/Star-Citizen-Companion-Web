/**
 * Blueprint drawings: the SVG half (docs/blueprint.md § File format).
 *
 * The file is deliberately plain so the web app can read it with a DOMParser
 * and re-draw it with its own styles instead of trusting markup:
 *
 *   <svg data-sc-blueprint="1" data-lod="full|icon" viewBox="0 0 W H" …>
 *     <g class="bp-view" data-view="top|side" data-projection="{…}">
 *       <path class="bp-hull"  d="…"/>   outer silhouette + holes (even-odd)
 *       <path class="bp-major" d="…"/>   main lines (contours, sharp creases)
 *       <path class="bp-minor" d="…"/>   detail lines (soft creases, panel borders)
 *     </g>
 *   </svg>
 *
 * Paths use only M, l and z with integer coordinates. Stroke defaults sit on
 * the root as presentation attributes (`currentColor`), so the file also
 * renders on its own; any CSS rule overrides them.
 */
import type { Pts } from './geometry.js';

export const BLUEPRINT_FORMAT = 1;

/**
 * Model point (glTF Y-up metres) -> drawing unit:
 *   svg_x = m[0][0]*x + m[0][1]*y + m[0][2]*z + m[0][3]
 *   svg_y = m[1][0]*x + m[1][1]*y + m[1][2]*z + m[1][3]
 */
export type Projection = [[number, number, number, number], [number, number, number, number]];

export interface SvgView {
  view: 'top' | 'side';
  /** Box the view occupies in the viewBox. */
  box: { x: number; y: number; w: number; h: number };
  projection: Projection;
  hull: Pts[];
  major: Pts[];
  minor: Pts[];
}

export interface SvgDoc {
  lod: 'full' | 'icon';
  width: number;
  height: number;
  /** Hull size in metres: length (nose-tail), beam (width), height. */
  extentM: [number, number, number];
  views: SvgView[];
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Integer path data; each polyline starts absolute, then relative steps. */
export function pathData(lines: Pts[], close: boolean): string {
  const parts: string[] = [];
  for (const pts of lines) {
    if (pts.length < 4) continue;
    let px = Math.round(pts[0]!);
    let py = Math.round(pts[1]!);
    const steps: string[] = [];
    for (let i = 2; i < pts.length; i += 2) {
      const x = Math.round(pts[i]!);
      const y = Math.round(pts[i + 1]!);
      if (x === px && y === py) continue;
      steps.push(`${x - px} ${y - py}`);
      px = x;
      py = y;
    }
    if (!steps.length) continue;
    parts.push(`M${Math.round(pts[0]!)} ${Math.round(pts[1]!)}l${steps.join(' ')}${close ? 'z' : ''}`);
  }
  return parts.join('');
}

export function writeSvg(doc: SvgDoc): string {
  const out: string[] = [];
  const [l, b, h] = doc.extentM.map((v) => v.toFixed(2));
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${doc.width} ${doc.height}" ` +
      `data-sc-blueprint="${BLUEPRINT_FORMAT}" data-lod="${doc.lod}" data-extent-m="${l} ${b} ${h}" ` +
      `fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">`,
  );
  for (const v of doc.views) {
    const proj = JSON.stringify({
      frame: 'gltf-y-up-metres',
      m: v.projection.map((row) => row.map(r6)),
      box: [v.box.x, v.box.y, v.box.w, v.box.h],
    });
    out.push(`<g class="bp-view" data-view="${v.view}" data-projection='${proj}'>`);
    const hull = pathData(v.hull, true);
    if (hull) out.push(`<path class="bp-hull" fill-rule="evenodd" stroke-width="2" d="${hull}"/>`);
    const major = pathData(v.major, false);
    if (major) out.push(`<path class="bp-major" stroke-width="1.2" d="${major}"/>`);
    const minor = pathData(v.minor, false);
    if (minor) out.push(`<path class="bp-minor" stroke-width="0.6" stroke-opacity="0.7" d="${minor}"/>`);
    out.push('</g>');
  }
  out.push('</svg>\n');
  return out.join('\n');
}
