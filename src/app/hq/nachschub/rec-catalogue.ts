/*
 * Adapter: codex FPS catalogue rows -> the flattened catalogue "Passt dazu" (recommend.ts) scores.
 *
 * What the codex tables carry and what they do not (docs/concepts/nachschub-recommendations-research.md section 6):
 *  - armor set key: NOT a column. Derived from the class name - every token before the part token (`helmet`, `core`,
 *    `arms`, `legs`, `backpack`, `undersuit`) is the set, e.g. `pembroke_armor_heavy_helmet_01_01_01` -> `pembroke_armor_heavy`.
 *  - armor part: the attach type (`Char_Armor_Helmet` ...), a column.
 *  - weapon magazine: NOT a column; `magazineClass` stays empty, so a weapon is only matched by maker and activity.
 *  - ship components (shield, cooler, power plant, quantum drive: kind + size columns), missiles (size, sub type, tracking
 *    signal from the class name) and consumables (sub type): lean promoted columns only, see the row adapters below.
 *  - ships, paints, blueprints/recipes, places, FPS magazines and ship racks: not adapted (they need payload reads per row or
 *    have no catalogue link); the engine finds no relation for them and suggests nothing.
 */
import type { CodexListRow } from '../../codex/codex.service';
import { trackingSignalOf } from '../../codex/codex-missile';
import type { RecItem } from './recommend';

const PART_TOKENS = ['helmet', 'core', 'torso', 'arms', 'legs', 'backpack', 'undersuit'] as const;

/** attach type -> armor part of the recommendation engine's fixed order. */
export function armorPartOf(attachType: string | null): string | null {
  const t = (attachType ?? '').toLowerCase();
  if (t.endsWith('helmet')) return 'helmet';
  if (t.endsWith('torso')) return 'torso';
  if (t.endsWith('arms')) return 'arms';
  if (t.endsWith('legs')) return 'legs';
  if (t.endsWith('backpack')) return 'backpack';
  if (t.endsWith('undersuit')) return 'undersuit';
  return null;
}

/** The set an armor class belongs to: the class name up to its part token; null when there is no such token. */
export function armorSetKey(className: string): string | null {
  const tokens = className.toLowerCase().split('_');
  const at = tokens.findIndex((t, i) => i > 0 && (PART_TOKENS as readonly string[]).includes(t));
  // A single token before the part is only the maker (`cds_core_...`): it would lump unrelated families into one set.
  return at > 1 ? tokens.slice(0, at).join('_') : null;
}

/** Catalogue entries of one FPS catalogue read; variants are kept (the engine excludes them) so a wished variant resolves. */
export function fpsRowsToRecItems(rows: readonly CodexListRow[], category: 'armor' | 'weapon'): RecItem[] {
  const out: RecItem[] = [];
  for (const r of rows) {
    const className = r.classNameSlug;
    if (!className) continue;
    const name = r.nameLocalized?.trim() || className;
    if (category === 'armor') {
      out.push({
        className,
        name,
        kind: 'armor',
        manufacturer: r.manufacturerCode,
        setKey: armorSetKey(className),
        armorPart: armorPartOf(r.attachType),
        grade: gradeNumber(r.grade),
        activity: 'fps',
        isVariant: r.isVariant,
      });
    } else {
      out.push({
        className,
        name,
        kind: 'fps_weapon',
        manufacturer: r.manufacturerCode,
        slotType: 'fps_weapon',
        size: r.size,
        grade: gradeNumber(r.grade),
        activity: 'fps',
        isVariant: r.isVariant,
      });
    }
  }
  return out;
}

function gradeNumber(g: string | null): number | null {
  if (g == null) return null;
  const n = Number(g);
  return Number.isFinite(n) ? n : null;
}

/** The component kinds that make up a loadout (`codex_components.kind`). */
export const REC_COMPONENT_KINDS = ['Shield', 'Cooler', 'PowerPlant', 'QuantumDrive'] as const;

/** Ship components of the core loadout kinds; rows without kind or size carry no relation and are dropped. */
export function componentRowsToRecItems(rows: readonly CodexListRow[]): RecItem[] {
  const out: RecItem[] = [];
  for (const r of rows) {
    if (!r.classNameSlug || !r.componentKind || r.size == null) continue;
    if (!(REC_COMPONENT_KINDS as readonly string[]).includes(r.componentKind)) continue;
    out.push({
      className: r.classNameSlug,
      name: r.nameLocalized?.trim() || r.classNameSlug,
      kind: 'ship_component',
      manufacturer: r.manufacturerCode,
      slotType: r.componentKind,
      size: r.size,
      grade: gradeNumber(r.grade),
      isVariant: r.isVariant,
    });
  }
  return out;
}

/** `codex_items` rows with attach type `Missile` (facet = tracking signal) or `FPS_Consumable` (facet = sub type). */
export function itemRowsToRecItems(rows: readonly CodexListRow[], category: 'missile' | 'consumable'): RecItem[] {
  const out: RecItem[] = [];
  for (const r of rows) {
    if (!r.classNameSlug) continue;
    const base = { className: r.classNameSlug, name: r.nameLocalized?.trim() || r.classNameSlug, manufacturer: r.manufacturerCode, isVariant: r.isVariant };
    if (category === 'missile') {
      const signal = trackingSignalOf(r.classNameSlug);
      if (!signal || r.size == null || !r.subType) continue;
      out.push({ ...base, kind: 'missile', slotType: r.subType, size: r.size, facet: signal });
    } else {
      if (!r.subType) continue;
      out.push({ ...base, kind: 'consumable', facet: r.subType });
    }
  }
  return out;
}
