/**
 * Pure projection for the 2D deck schematic (#797).
 *
 * The extractor (`data-uploader/python/sc_extract/ship_rooms.py`) emits, per
 * deck of `payload.decks`, the rooms that map to it with their floor
 * footprints in the hull's model frame — the same frame as the hardpoint
 * transforms (`hardpoint-map.ts`): metres, `+X` starboard, `+Y` nose.
 *
 * Here they become a top view with the nose pointing UP, in a viewBox measured
 * in metres. Every deck of a ship is drawn in ONE shared frame (the union of
 * all deck bounds), so switching decks keeps the scale and a room stays where
 * the one above or below it is.
 *
 * Validation first, like the hardpoint map: a malformed room is dropped, a
 * deck without one valid room is no deck here, and a ship without any yields
 * an empty list — the caller then renders nothing.
 */
import type { Lang, ShipDeck, ShipDeckRoom } from './codex.types';
import { cleanDeckName, deckLabel } from './detail/codex-detail-facts';

export interface DeckPlanRoom {
  key: string;
  label: string;
  /** SVG path data per outlined footprint (polygon or box), in viewBox space. */
  paths: string[];
  /**
   * Floor triangles of a trimesh volume merged into one path: filled, never
   * stroked, so the mesh's inner edges do not show. `''` when there are none.
   */
  mesh: string;
  /** Label anchor in viewBox space (centroid of the largest footprint, else the pivot). */
  anchor: { x: number; y: number };
  /** Footprint area in m² (0 for a pin). */
  area: number;
  /** Width/height of the largest footprint's box (m) — whether a label fits inline. */
  box: { w: number; h: number };
}

export interface DeckPlan {
  key: string;
  label: string;
  order: number;
  rooms: DeckPlanRoom[];
}

export interface DeckPlanSet {
  decks: DeckPlan[];
  /** `minX minY width height` for the SVG viewBox (metres, padded). */
  viewBox: string;
  width: number;
  height: number;
}

const PAD_M = 1.5;
const MIN_SPAN_M = 1;

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function readPolygon(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const pts: [number, number][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || !num(p[0]) || !num(p[1])) return null;
    pts.push([p[0], p[1]]);
  }
  return pts;
}

interface ParsedRoom {
  key: string;
  name: ShipDeckRoom['name'];
  pos: [number, number];
  shapes: [number, number][][];
  tris: [number, number][][];
}

function readRoom(raw: unknown): ParsedRoom | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ShipDeckRoom>;
  if (typeof r.key !== 'string' || !r.key || !Array.isArray(r.pos) || !num(r.pos[0]) || !num(r.pos[1])) return null;
  const polys = (v: unknown) =>
    Array.isArray(v) ? v.map(readPolygon).filter((s): s is [number, number][] => !!s) : [];
  return { key: r.key, name: r.name ?? null, pos: [r.pos[0], r.pos[1]], shapes: polys(r.shapes), tris: polys(r.tris) };
}

/** Signed-area-free polygon area + centroid (shoelace). */
function areaCentroid(poly: [number, number][]): { area: number; cx: number; cy: number } {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i === 0 ? poly.length - 1 : i - 1];
    const [x1, y1] = poly[i];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length;
    return { area: 0, cx: poly.reduce((s, p) => s + p[0], 0) / n, cy: poly.reduce((s, p) => s + p[1], 0) / n };
  }
  return { area: Math.abs(a / 2), cx: cx / (3 * a), cy: cy / (3 * a) };
}

/**
 * Fallback room label from the container entity name:
 * `MedicalBay_Office_Room_RN` → "Medical Bay Office", `Corridors_Middle_Left_Room1_Room_RN`
 * → "Corridors Middle Left 1".
 */
export function humanizeRoomKey(key: string): string {
  return key
    .replace(/~\d+$/, '')
    .replace(/[-_]\d+$/, '')
    .replace(/_?Room_RN$/i, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split('_')
    .filter(Boolean)
    .join(' ')
    .replace(/\s+Room(\d*)$/i, ' $1')
    .trim() || key;
}

function roomLabel(name: ShipDeckRoom['name'], key: string, lang: Lang): string {
  const primary = lang === 'de' ? cleanDeckName(name?.de) : cleanDeckName(name?.en);
  return primary || cleanDeckName(name?.en) || cleanDeckName(name?.de) || humanizeRoomKey(key);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Every deck with at least one room, bottom-up, in one shared top-view frame. */
export function buildDeckPlans(decks: readonly ShipDeck[] | null | undefined, lang: Lang): DeckPlanSet | null {
  if (!Array.isArray(decks)) return null;
  const list: readonly ShipDeck[] = decks;
  const parsed = [...list]
    .filter((d: ShipDeck) => d && typeof d.key === 'string')
    .sort((a: ShipDeck, b: ShipDeck) => (a.order ?? 0) - (b.order ?? 0))
    .map((d: ShipDeck) => ({
      deck: d,
      rooms: ((Array.isArray(d.rooms) ? d.rooms : []) as unknown[]).map(readRoom).filter((r): r is ParsedRoom => !!r),
    }))
    .filter((d) => d.rooms.length > 0);
  if (parsed.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { rooms } of parsed) {
    for (const room of rooms) {
      const all = [...room.shapes, ...room.tris];
      const pts = all.length ? all.flat() : [room.pos];
      for (const [x, y] of pts) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const width = Math.max(maxX - minX, MIN_SPAN_M) + 2 * PAD_M;
  const height = Math.max(maxY - minY, MIN_SPAN_M) + 2 * PAD_M;
  // Model → viewBox: x stays (starboard right), y flips so the nose is up.
  const sx = (x: number) => r2(x - minX + PAD_M);
  const sy = (y: number) => r2(maxY - y + PAD_M);

  const out: DeckPlan[] = parsed.map(({ deck, rooms }) => ({
    key: deck.key,
    label: deckLabel(deck, lang),
    order: deck.order ?? 0,
    rooms: rooms
      .map((room) => {
        const d = (s: [number, number][]) => 'M' + s.map(([x, y]) => `${sx(x)} ${sy(y)}`).join('L') + 'Z';
        // Pieces a label can sit on: each outlined footprint, and the trimesh
        // floor as ONE piece (its triangles only make sense together).
        const pieces = [...room.shapes.map((s) => [s]), ...(room.tris.length ? [room.tris] : [])];
        let area = 0;
        let anchor = { x: sx(room.pos[0]), y: sy(room.pos[1]) };
        let box = { w: 0, h: 0 };
        let best = -1;
        for (const piece of pieces) {
          let a = 0;
          let cx = 0;
          let cy = 0;
          for (const s of piece) {
            const c = areaCentroid(s);
            a += c.area;
            cx += c.cx * c.area;
            cy += c.cy * c.area;
          }
          area += a;
          if (a > best && a > 0) {
            best = a;
            anchor = { x: sx(cx / a), y: sy(cy / a) };
            const xs = piece.flat().map((p) => p[0]);
            const ys = piece.flat().map((p) => p[1]);
            box = { w: r2(Math.max(...xs) - Math.min(...xs)), h: r2(Math.max(...ys) - Math.min(...ys)) };
          }
        }
        return {
          key: room.key,
          label: roomLabel(room.name, room.key, lang),
          paths: room.shapes.map(d),
          mesh: room.tris.map(d).join(''),
          anchor,
          area: r2(area),
          box,
        };
      })
      // Largest first, so a small room drawn later stays on top and hoverable.
      .sort((a, b) => b.area - a.area),
  }));
  return { decks: out, viewBox: `0 0 ${r2(width)} ${r2(height)}`, width: r2(width), height: r2(height) };
}
