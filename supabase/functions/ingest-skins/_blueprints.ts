// Blueprint drawings (data-uploader/docs/blueprint.md) — pure helpers.
//
// Two SVGs per ship hull, drawn by the uploader from the hull GLB:
//   _blueprints/<sha>.svg   `full` (top + side view) and `icon` (top view)
// Content-addressed like the hulls: the sha256 of the bytes is the name, the
// object is final once written, the Worker serves it `immutable`.
//
// The files are served from the assets Worker's origin, and the web app parses
// them (it never injects them), but an SVG opened directly is a document that
// could run script. So commit reads every new object back and accepts only
// the generator's own vocabulary: <svg>, <g>, <path>, a fixed attribute list,
// no entities, no processing instructions, no text. Anything else is deleted.

import { hullSha, sha256Hex } from './_hulls.ts';

export type BlueprintType = 'full' | 'icon';

export const BLUEPRINTS_DIR = '_blueprints/';
/** Real drawings: full ~80-140 kB, icon ~2-4 kB. */
export const MAX_BLUEPRINT_BYTES: Record<BlueprintType, number> = {
  full: 512 * 1024,
  icon: 64 * 1024,
};

export function isBlueprintType(v: unknown): v is BlueprintType {
  return v === 'full' || v === 'icon';
}

export function blueprintPath(sha: string): string {
  return `${BLUEPRINTS_DIR}${sha}.svg`;
}

export function isBlueprintPath(path: unknown): path is string {
  return typeof path === 'string' && /^_blueprints\/[0-9a-f]{64}\.svg$/.test(path);
}

export interface BlueprintObject {
  type: BlueprintType;
  sha: string;
  bytes: number;
  path: string;
}

/** Validates one sign entry; a string is the reason it is refused. */
export function parseBlueprintObject(o: { type?: unknown; sha256?: unknown; bytes?: unknown }): BlueprintObject | string {
  if (!isBlueprintType(o.type)) return 'type must be full|icon';
  const sha = hullSha(o.sha256);
  if (!sha) return 'sha256 must be 64 lowercase hex chars';
  const bytes = o.bytes;
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) return 'bytes must be a positive integer';
  if (bytes > MAX_BLUEPRINT_BYTES[o.type]) return `${o.type} blueprint over the ${MAX_BLUEPRINT_BYTES[o.type]} byte limit`;
  return { type: o.type, sha, bytes, path: blueprintPath(sha) };
}

/** The sign request must name exactly one full and one icon drawing. */
export function parseBlueprintObjects(list: unknown): BlueprintObject[] | string {
  if (!Array.isArray(list) || list.length !== 2) return 'objects must hold one full and one icon entry';
  const out: BlueprintObject[] = [];
  for (const o of list) {
    const p = parseBlueprintObject((o ?? {}) as Record<string, unknown>);
    if (typeof p === 'string') return p;
    out.push(p);
  }
  if (out[0]!.type === out[1]!.type) return 'objects must hold one full and one icon entry';
  return out;
}

const ELEMENTS = new Set(['svg', 'g', 'path']);
const ATTRIBUTES = new Set([
  'xmlns',
  'viewBox',
  'data-sc-blueprint',
  'data-lod',
  'data-extent-m',
  'data-view',
  'data-projection',
  'class',
  'd',
  'fill',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
]);
const TAG = /<(\/?)([A-Za-z][\w:.-]*)([^<>]*)>/g;
const ATTR = /\s+([A-Za-z][\w:.-]*)=("[^"<>]*"|'[^'<>]*')/g;

/** null = the markup is the generator's own vocabulary; else the first violation. */
export function blueprintMarkupError(svg: string, type: BlueprintType): string | null {
  if (/[&]|<!|<\?/.test(svg)) return 'entities, doctypes, comments and processing instructions are not allowed';
  let rest = '';
  let last = 0;
  let root = false;
  for (const m of svg.matchAll(TAG)) {
    rest += svg.slice(last, m.index);
    last = m.index! + m[0].length;
    const [, closing, name, attrs] = m;
    if (!ELEMENTS.has(name!)) return `element <${name}> not allowed`;
    if (closing) {
      if (attrs!.trim()) return 'attributes on a closing tag';
      continue;
    }
    for (const a of attrs!.matchAll(ATTR)) {
      if (!ATTRIBUTES.has(a[1]!)) return `attribute ${a[1]} not allowed`;
    }
    // Everything between the name and `>` must be attributes (plus a self-closing slash).
    if (attrs!.replace(ATTR, '').replace(/\/\s*$/, '').trim() !== '') return `malformed attributes on <${name}>`;
    if (name === 'svg' && !root) {
      root = true;
      if (!/\sdata-sc-blueprint="1"/.test(attrs!)) return 'not a blueprint (data-sc-blueprint missing)';
      if (!new RegExp(`\\sdata-lod="${type}"`).test(attrs!)) return `not a ${type} blueprint`;
    }
  }
  rest += svg.slice(last);
  if (rest.trim() !== '') return 'text content not allowed';
  if (!root) return 'no <svg> root';
  if (!svg.trimStart().startsWith('<svg')) return 'must start with <svg>';
  return null;
}

export type BlueprintCheck = { ok: true } | { ok: false; error: string; message: string };

/** Size, hash, UTF-8 and markup of one stored drawing. */
export async function checkBlueprintBytes(
  bytes: Uint8Array,
  expectedSha: string,
  type: BlueprintType,
): Promise<BlueprintCheck> {
  if (bytes.byteLength > MAX_BLUEPRINT_BYTES[type]) {
    return { ok: false, error: 'blueprint_too_large', message: String(bytes.byteLength) };
  }
  if ((await sha256Hex(bytes)) !== expectedSha) return { ok: false, error: 'blueprint_hash_mismatch', message: expectedSha };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: 'blueprint_invalid', message: 'not UTF-8' };
  }
  const err = blueprintMarkupError(text, type);
  return err ? { ok: false, error: 'blueprint_invalid', message: err } : { ok: true };
}

/** Previously linked drawings this commit replaced — deletion CANDIDATES (check references first). */
export function droppedBlueprints(previous: (string | null)[], keep: Set<string>): string[] {
  return [...new Set(previous.filter(isBlueprintPath))].filter((p) => !keep.has(p));
}
